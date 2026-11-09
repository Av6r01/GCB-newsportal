# Incident Response Guide — Global Chronicle News

**Version**: 1.0.0-rc1 | **Updated**: 2026-11-10

---

## 1. Severity Levels

| Level | Name | Definition | Response SLA |
|---|---|---|---|
| **SEV-1** | Critical | Site completely down / database corrupted / security breach / data leak | Immediate — 15 min |
| **SEV-2** | Major | Publishing pipeline broken / CMS inaccessible / health check degraded | 30 min |
| **SEV-3** | Minor | Single feature degraded (e.g. TTS / AI / media upload slow) | 2 hours |
| **SEV-4** | Low | Performance issue / cosmetic bug / non-breaking warning | Next business day |

---

## 2. First Response Steps

### 2.1 Check Health Status

```bash
curl -sf https://yourdomain.com/api/health | jq .
```

Interpret the response:
- `status: "ok"` — all subsystems healthy.
- `status: "degraded"` — at least one subsystem down. Check `checks.database.status` and `checks.scheduler.status`.
- HTTP 503 — server is responding but degraded.
- Connection refused / timeout — server is completely down.

### 2.2 Check Application Logs

```bash
# Docker deployment
docker-compose logs --tail=200 app

# Systemd / PM2
journalctl -u global-chronicle -n 200 --no-pager
pm2 logs global-chronicle --lines 200
```

### 2.3 Check Database Connectivity

```bash
# Test raw PostgreSQL connection
psql "$DATABASE_URL" -c "SELECT NOW(), COUNT(*) FROM articles;"

# Check health endpoint database status specifically
curl -sf https://yourdomain.com/api/health | jq .checks.database
```

---

## 3. Common Incidents and Resolutions

### INC-001: Server Not Starting (Exit on Boot)

**Symptoms**: Container exits immediately; logs show `[FATAL]` errors.

**Common causes**:
- `JWT_SECRET` missing / too short / known-insecure default → Set a strong secret.
- `APP_URL` is `http://` or `localhost` in production → Set `APP_URL=https://yourdomain.com`.
- `DB_DRIVER=json` in `NODE_ENV=production` → Set `DB_DRIVER=postgres` + `DATABASE_URL`.
- `STORAGE_DRIVER=s3` with missing S3 credentials → Supply all `S3_*` env vars.

```bash
# Check exact boot error
docker-compose logs migrate | grep FATAL
docker-compose logs app | grep FATAL
```

### INC-002: Database Degraded (503)

**Symptoms**: `GET /api/health` returns HTTP 503; `checks.database.status = "degraded"`.

**Steps**:
1. Verify PostgreSQL is running: `docker-compose ps db` or `pg_isready -h host -p 5432`.
2. Test connection: `psql "$DATABASE_URL" -c "SELECT 1;"`.
3. Check if migrations are applied: `npx prisma migrate status`.
4. If DB reachable but app still degraded: restart the app process.

```bash
docker-compose restart app
```

### INC-003: Scheduler Degraded

**Symptoms**: `checks.scheduler.status = "degraded"` in health check; scheduled articles not publishing.

**Steps**:
1. Check scheduler logs: `docker-compose logs app | grep SCHEDULER`.
2. Manually trigger a sweep: `POST /api/admin/scheduler/sweep` (admin token).
3. Retry a specific failed job: `POST /api/admin/scheduler/jobs/:id/retry`.
4. If scheduler loop is dead, restart the app process (scheduler is in-process).

### INC-004: Media Upload Failures

**Symptoms**: `POST /api/media/file-upload` returns 500; images not appearing.

**Steps**:
1. Check storage configuration: `curl /api/health | jq .checks.storage`.
2. Verify local directory is writable: `ls -la $STORAGE_LOCAL_DIR`.
3. For S3: verify credentials and bucket policy; check AWS CloudTrail for access denied.
4. Check disk space: `df -h`.

### INC-005: Publishing Pipeline Broken (Cannot Submit/Approve Articles)

**Symptoms**: State transitions return 403 or 500; articles stuck in `IN_REVIEW`.

**Steps**:
1. Verify user roles: `GET /api/admin/users` with admin token — confirm role assignments.
2. Check for self-approval attempt (reporters/copy-editors cannot approve their own articles).
3. Check workflow logs: `docker-compose logs app | grep WORKFLOW`.
4. If DB is healthy but transitions fail, check for schema migration lag.

### INC-006: Security Incident / Unauthorized Access

**Immediate steps**:
1. **Rotate `JWT_SECRET` immediately** — this invalidates ALL active sessions.
   ```bash
   # Generate new secret
   npm run gen:secret
   # Update in environment + restart server
   ```
2. Revoke specific user sessions via admin API: `POST /api/admin/users/:id/revoke-sessions`.
3. Audit login events: check server logs for `POST /api/auth/login` with unusual IPs.
4. Notify affected users to change passwords.
5. File a full incident report (see Section 5).

### INC-007: Data Loss / Accidental Deletion

**Immediate steps**:
1. **Stop the application** to prevent further changes.
2. Identify the last clean backup: `ls -lt /backups/*.dump`.
3. Restore to an isolated database (see `docs/BACKUP_RESTORE.md` Section 3.2).
4. Verify data integrity: `npm run db:verify`.
5. If correct: promote the restored database (requires downtime + DNS/connection switch).
6. Document exactly what was lost and when.

---

## 4. Escalation Path

```
On-call engineer
  → Engineering Lead (SEV-1 / SEV-2 after 15 min without resolution)
    → CTO / Technical Director (SEV-1 data loss or security breach)
      → Legal / Privacy team (if personal data exposure)
        → Public communications (if public-facing outage > 1 hour)
```

---

## 5. Incident Report Template

After every SEV-1 or SEV-2 incident, complete a post-mortem within 48 hours:

```markdown
## Incident Report — [Date] [Short Title]

**Severity**: SEV-1 / SEV-2 / SEV-3
**Start time**: YYYY-MM-DD HH:MM UTC
**Resolution time**: YYYY-MM-DD HH:MM UTC
**Duration**: X hours Y minutes
**Reporter**:

### Timeline
- HH:MM — Incident detected via [alert / health check / user report]
- HH:MM — Root cause identified: [description]
- HH:MM — Mitigation applied: [description]
- HH:MM — Service restored

### Root Cause
[Technical description of what went wrong]

### Impact
- Users affected: [estimate]
- Features affected: [list]
- Data loss: [none / description]

### Resolution
[What was done to restore service]

### Prevention
[What changes will prevent recurrence — with owner and deadline]
```

---

## 6. Monitoring and Alert Recommendations

The application does not ship with a monitoring agent — configure your hosting platform:

| Check | Recommended Interval | Alert Threshold |
|---|---|---|
| `GET /api/health` → HTTP 200 | 60 seconds | Any non-200 response → SEV-2 |
| `checks.database.status == "healthy"` | 60 seconds | `degraded` → SEV-2 |
| `checks.scheduler.status == "ACTIVE"` | 5 minutes | `degraded` → SEV-3 |
| Memory `rssMb` | 5 minutes | > 512 MB → warn; > 1 GB → SEV-3 |
| Disk space (`STORAGE_LOCAL_DIR`) | 15 minutes | > 80% → warn; > 95% → SEV-2 |
| Login failures (`POST /api/auth/login 400`) | real-time | > 50/minute from one IP → possible brute force → SEV-2 |
| Upload errors (`POST /api/media/file-upload 5xx`) | real-time | > 10/minute → SEV-3 |

# Backup and Restoration Guide — Global Chronicle News

**Version**: 1.0.0-rc1 | **Updated**: 2026-11-10

---

## 1. What to Back Up

| Asset | Location | Criticality | Backup Method |
|---|---|---|---|
| **PostgreSQL database** | `DATABASE_URL` host | **P0 — Critical** | pg_dump + WAL archiving |
| **Media uploads (local driver)** | `STORAGE_LOCAL_DIR` | **P0 — Critical** | rsync to S3/offsite |
| **Media uploads (S3 driver)** | S3 bucket | **P0 — Critical** | S3 versioning + cross-region replication |
| **Environment secrets** | Secrets manager / `.env` | **P0 — Critical** | Encrypted backup in separate secure location |
| **Application code** | Git repository | P1 | Tag each release (`git tag 1.0.0-rc1`) |

---

## 2. Database Backup (PostgreSQL)

### 2.1 Manual Backup

```bash
# Full logical backup (plain SQL — human readable, easy to inspect)
pg_dump \
  --no-password \
  --format=custom \          # compressed binary — faster restore
  --verbose \
  "postgresql://user:pass@host:5432/global_chronicle" \
  > /backups/gcn_$(date +%Y%m%d_%H%M%S).dump

# Verify the dump is readable
pg_restore --list /backups/gcn_<timestamp>.dump | head -40
```

### 2.2 Automated Nightly Backup (cron)

```bash
# /etc/cron.d/gcn-backup
0 2 * * * postgres pg_dump \
  --format=custom \
  "$DATABASE_URL" \
  > /backups/gcn_$(date +\%Y\%m\%d).dump \
  && find /backups -name "gcn_*.dump" -mtime +30 -delete
```

### 2.3 Pre-Deployment Snapshot (Always Before Migrations)

```bash
# Run BEFORE every production deployment
pg_dump --format=custom "$DATABASE_URL" \
  > /backups/pre-deploy_$(git rev-parse --short HEAD)_$(date +%Y%m%d).dump
```

---

## 3. Database Restoration

### 3.1 Restore to the Same Database

```bash
# DANGER: this overwrites the target database
dropdb global_chronicle           # only if re-creating from scratch
createdb global_chronicle
pg_restore \
  --no-acl --no-owner \
  --verbose \
  -d "postgresql://user:pass@host:5432/global_chronicle" \
  /backups/gcn_<timestamp>.dump
```

### 3.2 Restore to an Isolated Test Instance (Recommended for Verification)

```bash
# 1. Create a fresh isolated database
createdb gcn_restore_test

# 2. Restore the backup
pg_restore --no-acl --no-owner \
  -d "postgresql://user:pass@host:5432/gcn_restore_test" \
  /backups/gcn_<timestamp>.dump

# 3. Run integrity checks
DATABASE_URL="postgresql://user:pass@host:5432/gcn_restore_test" \
  npm run db:verify

# 4. Spot-check: article count, latest published article
psql "postgresql://user:pass@host:5432/gcn_restore_test" \
  -c "SELECT status, COUNT(*) FROM articles GROUP BY status;"

# 5. Drop the test instance when done
dropdb gcn_restore_test
```

> [!IMPORTANT]
> Always restore to an isolated database first. Verify integrity before promoting the restore to production.

---

## 4. Media File Backup

### 4.1 Local Storage Provider

```bash
# Incremental sync to S3 offsite
aws s3 sync \
  /var/data/gcn-media/ \
  s3://gcn-backup-bucket/media/ \
  --delete \
  --storage-class STANDARD_IA

# Automated nightly sync (cron)
0 3 * * * aws s3 sync /var/data/gcn-media/ s3://gcn-backup-bucket/media/ --delete
```

### 4.2 S3 Storage Provider

Enable S3 versioning and cross-region replication via AWS Console or CLI:

```bash
# Enable versioning on the production bucket
aws s3api put-bucket-versioning \
  --bucket gcn-media-production \
  --versioning-configuration Status=Enabled

# Set lifecycle policy: move to Glacier after 90 days, expire after 365 days
aws s3api put-bucket-lifecycle-configuration \
  --bucket gcn-media-production \
  --lifecycle-configuration file://s3-lifecycle.json
```

---

## 5. Orphaned Media Cleanup

The application tracks which media assets are referenced by articles. Use the admin endpoints to identify and clean up orphaned objects:

```bash
# List orphaned media objects (dry-run)
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://yourdomain.com/api/admin/media/orphans

# Collect (delete) orphaned objects — requires admin token + confirmation
curl -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://yourdomain.com/api/admin/media/orphans/collect
```

---

## 6. Backup Retention Policy

| Backup Type | Frequency | Retention |
|---|---|---|
| PostgreSQL daily dump | Daily at 02:00 UTC | 30 days |
| Pre-deployment snapshot | Per deployment | 90 days |
| S3 media versioning | Continuous | 365 days |
| Secrets backup | On rotation | Manual, encrypted, offsite |

---

## 7. Recovery Time Objectives (Target)

| Scenario | Target RTO |
|---|---|
| Database corruption (restore from last daily backup) | < 1 hour |
| Media loss on local storage (restore from S3 offsite) | < 2 hours |
| Full server failure (restore from backup + redeploy) | < 4 hours |
| Accidental data deletion (point-in-time recovery) | < 30 minutes if WAL archiving enabled |

---

## 8. Testing Backups

Backups are only as good as the last tested restoration. Recommended test schedule:

- **Weekly**: Restore previous day's dump to `gcn_restore_test` and run `npm run db:verify`.
- **Monthly**: Full disaster recovery drill — restore from backup + redeploy app + verify all 15 health checks.
- **Before every production deployment**: Pre-deploy snapshot + dry-run restore verification.

---

## 9. JSON Store Backup (Dev/Staging Only)

```bash
# Back up the development JSON database
cp data/database.json data/backups/database_$(date +%Y%m%d_%H%M%S).json

# Export in canonical format
npm run db:export
# → creates data/migration/export_<timestamp>.json with SHA-256 checksum
```

> [!CAUTION]
> The JSON store is for development only. It must never be used in production. Any JSON store backups cannot be restored directly — use the `npm run db:import` migration pipeline.

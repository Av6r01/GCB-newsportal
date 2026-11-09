# Deployment Runbook — Global Chronicle News

**Version**: 1.0.0-rc1  
**Updated**: 2026-11-10  
**Node.js**: 22 LTS (Dockerfile base) / 24.x (dev host, fully compatible)  
**Start command**: `npm start` → `tsx server.ts`  
**Port**: `env.PORT` (default 3000; override with `PORT=8080 npm start`)

---

## 1. Pre-Deployment Requirements

| Requirement | Status | Notes |
|---|---|---|
| Node.js ≥ 22 LTS | REQUIRED | Dockerfile uses `node:22-alpine`; dev host v24.19 also works |
| PostgreSQL 15 or 16 | REQUIRED for prod | `DATABASE_URL` + `DB_DRIVER=postgres`; JSON store **not** allowed in `NODE_ENV=production` |
| Object storage | REQUIRED for prod | `STORAGE_DRIVER=s3` or `STORAGE_DRIVER=local` with `STORAGE_LOCAL_DIR` |
| `JWT_SECRET` ≥ 32 chars | REQUIRED | Server **throws** at boot if missing or known-insecure default is used |
| `APP_URL` = `https://` | REQUIRED | Server **throws** in prod if `localhost` or non-https |
| `SMTP_HOST/USER/PASS` | RECOMMENDED | Soft-dependency — password reset returns 503 without it |

---

## 2. Local Development Setup (Demo / Testing)

```bash
# 1. Enter the project
cd gcn

# 2. Install dependencies (from lockfile)
npm install

# 3. Create .env from template
cp .env.example .env
# Edit .env — minimum required for local dev:
#   PORT=3000
#   NODE_ENV=development
#   JWT_SECRET=<run: npm run gen:secret>
#   DB_DRIVER=json        ← JSON store for local dev (no Postgres needed)
#   APP_URL=http://localhost:3000

# 4. Start the dev server
npm run dev
# → Vite HMR frontend + Express API on http://localhost:3000
# → JSON persistence driver active (data/database.json)
# → Scheduler daemon starts automatically
```

**Verify local server**:
```bash
curl http://localhost:3000/api/health
# → {"status":"ok","checks":{"database":{"status":"healthy","driver":"json"},...}}
```

**Create first admin account** (local dev only):
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Admin","email":"admin@local.dev","password":"Admin1234!","role":"ADMIN"}'
# Then use the returned token or login at /cms
```

> [!NOTE]
> `npm run seed` loads fictional Bangla/English newsroom demo data. It is safe to run multiple times (idempotent). **Never run seed against a production database.**

---

## 3. Environment Variables — Required vs Optional

See `docs/ENVIRONMENT_REFERENCE.md` for the complete reference. Summary:

| Variable | Required | Dev Default | Production Rule |
|---|---|---|---|
| `NODE_ENV` | Yes | `development` | Must be `production` |
| `PORT` | No | `3000` | Set to match your host/proxy config |
| `JWT_SECRET` | **Yes** | *(dev default — throw in prod)* | ≥ 32 chars, cryptographically random |
| `APP_URL` | **Yes** | `http://localhost:3000` | Must be `https://` + real domain |
| `DATABASE_URL` | Prod only | n/a | PostgreSQL connection string |
| `DB_DRIVER` | Prod only | `json` | Must be `postgres` in production |
| `STORAGE_DRIVER` | **Prod required** | `local` | `local` or `s3` |
| `SMTP_HOST/USER/PASS` | Recommended | n/a | Required for password reset |
| `GEMINI_API_KEY` | Optional | n/a | For AI summary / TTS |
| `TRUST_PROXY` | Conditional | n/a | Set to `1` or proxy IP when behind nginx/ELB |

---

## 4. PostgreSQL Setup and Migration

```bash
# Generate Prisma client (run once after npm install in production)
npx prisma generate

# Apply all versioned migrations to a fresh PostgreSQL database
DATABASE_URL="postgresql://user:pass@host:5432/global_chronicle" \
  npm run db:migrate:deploy

# (First-time only) Import existing JSON data to PostgreSQL
DATABASE_URL="..." npm run db:import -- --dry-run   # always dry-run first
DATABASE_URL="..." npm run db:import                 # real import

# Verify post-import integrity
DATABASE_URL="..." npm run db:verify
```

> [!IMPORTANT]
> `DB_DRIVER=json` is **rejected** in `NODE_ENV=production`. The server exits with a clear error. Never use the JSON store outside development.

> [!WARNING]
> Never run `prisma migrate dev` in production — only `prisma migrate deploy`. `migrate dev` can destroy data.

---

## 5. Object Storage Setup

### Local Storage (Staging / Small Deployments)
```bash
STORAGE_DRIVER=local
STORAGE_LOCAL_DIR=/var/data/gcn-media      # must be a persistent volume
STORAGE_PUBLIC_BASE_URL=https://yourdomain.com
STORAGE_MEDIA_VISIBILITY=public
```

### AWS S3 / MinIO / Cloudflare R2 (Production)
```bash
STORAGE_DRIVER=s3
S3_BUCKET=gcn-media-production
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=AKIA...
S3_SECRET_ACCESS_KEY=...
# S3_ENDPOINT=https://... (MinIO/R2 only — omit for real AWS)
STORAGE_PUBLIC_BASE_URL=https://cdn.yourdomain.com   # or S3 bucket URL
STORAGE_MEDIA_VISIBILITY=public                       # or 'private' for HMAC-signed URLs
```

> [!IMPORTANT]
> The server **fails closed** if `STORAGE_DRIVER=s3` and any of `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` is missing. There is no silent fallback.

---

## 6. Docker Deployment

```bash
# Build the production image (from gcn/ directory)
docker build -t global-chronicle-news:1.0.0-rc1 .

# Launch with docker-compose (sets up Postgres, runs migrations, starts app)
JWT_SECRET=$(npm run --silent gen:secret) \
GEMINI_API_KEY=your-key \
docker-compose up -d

# Verify the stack
docker-compose ps
curl http://localhost:3000/api/health
```

The `docker-compose.yml` runs three services in order:
1. **db** — PostgreSQL 16, persists data to `postgres_data` named volume.
2. **migrate** — one-shot `npm run db:migrate:deploy`, exits 0 on success.
3. **app** — waits for both; health-checked via `/api/health` (must include `driver: postgres`).

---

## 7. Reverse Proxy (nginx)

```nginx
server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    # SSL termination — certificates managed externally (Let's Encrypt / ACM)
    ssl_certificate     /etc/ssl/certs/fullchain.pem;
    ssl_certificate_key /etc/ssl/private/privkey.pem;

    # Proxy to Node.js app
    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Serve media uploads directly (bypass Node for static files)
    location /uploads/ {
        alias /var/data/gcn-media/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}

# Redirect HTTP → HTTPS
server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$host$request_uri;
}
```

> [!IMPORTANT]
> Set `TRUST_PROXY=1` in your `.env` when deploying behind nginx so that `req.ip` resolves correctly from `X-Forwarded-For` for rate limiting.

---

## 8. Health Check

**Endpoint**: `GET /api/health`  
**Expected response (healthy)**: HTTP 200

```json
{
  "status": "ok",
  "version": "1.0.0-rc1",
  "checks": {
    "database": { "status": "healthy", "driver": "postgres" },
    "storage":  { "status": "healthy", "driver": "s3" },
    "scheduler":{ "status": "ACTIVE", "lastSweep": "..." },
    "memory":   { "rssMb": 180, "heapUsedMb": 70 }
  }
}
```

**Degraded** (`503` returned when database or scheduler is down):
- `database.status = "degraded"` → DB unreachable, check `DATABASE_URL` and PostgreSQL.
- `scheduler.status = "degraded"` → scheduler loop crashed; restart the process.
- `storage.status = "unknown"` → storage provider failed to initialize; check S3/local config.

---

## 9. Scheduler / Worker Process

The publishing scheduler runs **in-process** with the Express server as a `setInterval` daemon (60-second sweep). No separate worker process is needed.

- **Idempotency**: each publication is keyed by `sched-pub-<articleId>-<version>`; sweeps never double-publish.
- **Restart resilience**: on restart, the scheduler immediately reconciles overdue schedules.
- **Monitoring**: `GET /api/health` reports `scheduler.lastSweep`, `processedCount`, `failedCount`.
- **Manual retry**: `POST /api/admin/scheduler/jobs/:id/retry` (admin token required).

> [!NOTE]
> For high-availability deployments (multiple replicas), ensure only ONE instance runs the scheduler. Set `DISABLE_SCHEDULER=true` on replica instances and dedicate one primary instance as the scheduler host (or extract the scheduler to a separate cron job).

---

## 10. Deployment Smoke Tests

After every deployment, run these in order:

```bash
# 1. Health check — all subsystems green
curl -sf https://yourdomain.com/api/health | jq .status
# → "ok"

# 2. Database driver confirmed (never "json" in production)
curl -sf https://yourdomain.com/api/health | jq .checks.database.driver
# → "postgres"

# 3. Storage driver confirmed
curl -sf https://yourdomain.com/api/health | jq .checks.storage.driver
# → "s3" or "local"

# 4. Homepage loads
curl -sf https://yourdomain.com/api/homepage | jq .leadStory.title

# 5. Sitemap present
curl -sf https://yourdomain.com/sitemap.xml | grep -c '<url>'

# 6. Admin login (replace credentials)
TOKEN=$(curl -sf -X POST https://yourdomain.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@yourdomain.com","password":"YOUR_PASS"}' \
  | jq -r .token)
echo "Admin token: ${TOKEN:0:20}..."

# 7. Anonymous access to CMS is blocked
curl -so /dev/null -w "%{http_code}" https://yourdomain.com/api/admin/users
# → 401
```

---

## 11. Rollback Procedure

```bash
# 1. Switch the reverse proxy or load balancer to the previous stable image
docker pull global-chronicle-news:previous-tag
docker-compose down app
docker-compose up -d app  # with previous image tag

# 2. If migrations were applied and need reversal:
#    — Prisma does not support auto-down migrations
#    — Restore from the pre-deployment database backup (see docs/BACKUP_RESTORE.md)
DATABASE_URL="..." psql -c "\i /backups/pre-deploy-backup.sql"

# 3. Verify health
curl https://yourdomain.com/api/health

# 4. File an incident report (see docs/INCIDENT_RESPONSE.md)
```

---

## 12. Rate Limits and Security Headers

All rate limits are configurable via environment variables (`REACTIONS_RATE_MAX`, `COMMENTS_RATE_MAX`, etc.) — see `docs/ENVIRONMENT_REFERENCE.md` for the full list.

**Security headers applied by Express on every response**:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 0` (CSP handles XSS)
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` (production only)
- `Content-Security-Policy` (restricts script/style/media origins)

**CORS**: The API does not set permissive CORS headers by default. All browser-originated requests come from the same origin (served by the same Express instance). If a separate frontend domain is used, add `CORS_ORIGIN=https://frontend.yourdomain.com` and handle in `server.ts` middleware.

---

## 13. Search Console and Sitemap Registration

1. Verify domain ownership in [Google Search Console](https://search.google.com/search-console).
2. Submit sitemap URLs:
   - `https://yourdomain.com/sitemap.xml` (all published articles + static pages)
   - `https://yourdomain.com/sitemap-news.xml` (Google News sitemap — last 48 hours)
3. `robots.txt` is served at `https://yourdomain.com/robots.txt` and already references both sitemaps.
4. Verify canonical tags on article pages match `APP_URL` exactly.

---

## 14. Staging / Production Separation

| Setting | Staging | Production |
|---|---|---|
| `NODE_ENV` | `production` | `production` |
| `DATABASE_URL` | Separate staging DB | Production DB (restricted access) |
| `APP_URL` | `https://staging.yourdomain.com` | `https://yourdomain.com` |
| `S3_BUCKET` | `gcn-media-staging` | `gcn-media-production` |
| `JWT_SECRET` | Separate secret | Separate secret |
| `SMTP_HOST` | Mailtrap / no-send | Real SMTP relay |
| Seed data | `npm run seed` allowed | Never seed |

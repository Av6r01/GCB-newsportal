# Environment Variable Reference — Global Chronicle News

**Version**: 1.0.0-rc1 | **Updated**: 2026-11-10  
**Source of truth**: `gcn/src/configuration/env.ts`

> [!IMPORTANT]
> Never commit `.env` to version control. Copy `.env.example` to `.env` and fill in values. In production, inject all secrets via your hosting platform's secrets manager, not via checked-in files.

---

## Server

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | Yes | `development` | Must be `production` for production deployments. Controls fail-closed validation of secrets, database driver, and APP_URL. |
| `PORT` | No | `3000` | TCP port the Express server binds to. Must match your reverse proxy upstream. |
| `TRUST_PROXY` | Conditional | *(unset)* | Set to `1` or proxy IP when behind nginx/ELB. Enables correct `req.ip` for rate limiting. Accepts `true`, a number of hops, or IP/subnet list. |

---

## Security & Authentication

| Variable | Required | Default | Description |
|---|---|---|---|
| `JWT_SECRET` | **Yes (prod)** | *(insecure dev default — boot fails in prod)* | HMAC-SHA256 signing key for JWTs. Minimum 32 characters. Must not be a known-insecure default. Generate: `npm run gen:secret` or `openssl rand -hex 48`. Rotating this secret invalidates all active sessions immediately. |
| `JWT_EXPIRES_IN_SECONDS` | No | `28800` (8 h) | JWT token lifetime in seconds. Min 300 (5 min), max 86400 (24 h). Users must re-authenticate after expiry. |

---

## Application URL (Canonical Origin)

| Variable | Required | Default | Description |
|---|---|---|---|
| `APP_URL` | **Yes (prod)** | `http://localhost:3000` | Absolute URL of the production site. Used as the canonical origin for every sitemap `<loc>`, JSON-LD URL, canonical link, password reset link, and `robots.txt` Sitemap entry. Must be `https://` in production. Must NOT resolve to `localhost`. Boot fails if this rule is violated. |

---

## Database

| Variable | Required | Default | Description |
|---|---|---|---|
| `DB_DRIVER` | Prod only | `json` | Persistence driver. `json` = development JSON file store (never allowed in `NODE_ENV=production`). `postgres` = Prisma/PostgreSQL (required in production). |
| `DATABASE_URL` | Prod only | n/a | PostgreSQL connection string. Format: `postgresql://user:pass@host:5432/dbname`. Required when `DB_DRIVER=postgres`. |

---

## Email / SMTP

All `SMTP_*` variables are optional in development — password reset tokens are logged to stdout and returned as `_testToken` in the API response.

**In production**, all four (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`) must be set, or password reset returns HTTP 503.

| Variable | Required | Default | Description |
|---|---|---|---|
| `SMTP_HOST` | Prod recommended | *(unset)* | SMTP relay hostname (e.g. `smtp.sendgrid.net`). |
| `SMTP_PORT` | No | `587` | SMTP port. 587 = STARTTLS, 465 = SSL/TLS. |
| `SMTP_SECURE` | No | `false` | `true` for port 465 (SSL). `false` for STARTTLS on 587. |
| `SMTP_USER` | Prod recommended | *(unset)* | SMTP authentication username. |
| `SMTP_PASS` | Prod recommended | *(unset)* | SMTP authentication password. Store in a secrets manager. |
| `SMTP_FROM` | No | `noreply@globalchronicle.news` | From address for transactional email. |

---

## AI Assistant (Gemini)

| Variable | Required | Default | Description |
|---|---|---|---|
| `GEMINI_API_KEY` | Optional | *(unset)* | Google Gemini API key for AI headline generation, article summarisation, and Text-to-Speech synthesis. When absent, the AI assistant and TTS features are disabled gracefully (no crash). |

---

## Storage Provider

| Variable | Required | Default | Description |
|---|---|---|---|
| `STORAGE_DRIVER` | **Yes (prod)** | `local` | Active storage provider: `local` or `s3`. In production, this must be explicitly set — the server fails closed if unset. |
| `STORAGE_LOCAL_DIR` | Conditional | *(auto)* | Filesystem root for the local provider. Required in production when `STORAGE_DRIVER=local`. Must be a persistent volume path. |
| `STORAGE_MEDIA_VISIBILITY` | No | `public` | Default visibility for uploaded media: `public` (direct read URLs) or `private` (HMAC-signed expiring URLs). |
| `STORAGE_PUBLIC_BASE_URL` | No | `APP_URL` | Base URL for constructing public media read URLs. For S3+CDN, set to your CDN origin (e.g. `https://cdn.yourdomain.com`). Must NOT end with `/`. |
| `STORAGE_SIGNED_URL_TTL_SECONDS` | No | `900` (15 min) | TTL for private media signed URLs. Min 30s, max 86400s. |

### S3 / MinIO / Cloudflare R2

| Variable | Required | Default | Description |
|---|---|---|---|
| `S3_BUCKET` | Conditional | *(unset)* | S3 bucket name. **Required** when `STORAGE_DRIVER=s3`. |
| `S3_REGION` | Conditional | *(unset)* | AWS/S3 region (e.g. `us-east-1`). **Required** when `STORAGE_DRIVER=s3`. |
| `S3_ACCESS_KEY_ID` | Conditional | *(unset)* | S3 access key ID. **Required** when `STORAGE_DRIVER=s3`. |
| `S3_SECRET_ACCESS_KEY` | Conditional | *(unset)* | S3 secret access key. **Required** when `STORAGE_DRIVER=s3`. Store in a secrets manager. |
| `S3_ENDPOINT` | Optional | *(AWS default)* | Custom endpoint URL for MinIO, Cloudflare R2, or other S3-compatible services. Omit for real AWS S3. |
| `S3_UPLOAD_PREFIX` | No | *(none)* | Key prefix for all uploaded objects (e.g. `media` → `media/<key>`). |

---

## Rate Limiting (Public API Abuse Controls)

All values are integers. Rates apply per IP address per window.

| Variable | Default | Description |
|---|---|---|
| `REACTIONS_RATE_MAX` | `20` | Max reaction events per IP per window. |
| `REACTIONS_RATE_WINDOW_MS` | `60000` (1 min) | Reaction rate window in milliseconds. |
| `REACTION_DEDUPE_COOLDOWN_MS` | `600000` (10 min) | Prevents duplicate reactions within this window. |
| `COMMENTS_RATE_MAX` | `5` | Max comments per IP per window. |
| `COMMENTS_RATE_WINDOW_MS` | `3600000` (1 hr) | Comment rate window. |
| `COMMENT_MAX_CONTENT_CHARS` | `2000` | Maximum comment length in characters. |
| `POLLS_RATE_MAX` | `10` | Max poll votes per IP per window. |
| `POLLS_RATE_WINDOW_MS` | `60000` (1 min) | Poll rate window. |
| `ANALYTICS_RATE_MAX` | `60` | Max analytics events per IP per window. |
| `ANALYTICS_RATE_WINDOW_MS` | `60000` (1 min) | Analytics rate window. |
| `ANALYTICS_METADATA_MAX_BYTES` | `1024` | Max analytics event metadata payload size in bytes. |
| `NEWSLETTER_RATE_MAX` | `5` | Max newsletter subscriptions per IP per window. |
| `NEWSLETTER_RATE_WINDOW_MS` | `3600000` (1 hr) | Newsletter rate window. |

---

## Text-to-Speech (TTS) Cost Controls

| Variable | Default | Description |
|---|---|---|
| `TTS_MAX_CHARS` | `5000` | Maximum article character count the TTS service will synthesise in one request. |
| `TTS_DAILY_QUOTA_PER_USER` | `30` | Maximum TTS requests per authenticated user per calendar day. `0` = unlimited. |
| `TTS_TIMEOUT_MS` | `20000` (20 s) | TTS synthesis request timeout. |
| `TTS_MAX_CONCURRENT` | `3` | Maximum concurrent TTS synthesis requests in-flight at once. |

---

## Example Production `.env`

```bash
# DO NOT COMMIT THIS FILE
NODE_ENV=production
PORT=3000
TRUST_PROXY=1

JWT_SECRET=<96-hex-char-random-string-from-openssl-rand-hex-48>
JWT_EXPIRES_IN_SECONDS=28800

APP_URL=https://www.globalchronicle.news

DB_DRIVER=postgres
DATABASE_URL=postgresql://gcn_user:STRONG_PASS@db.internal:5432/global_chronicle

STORAGE_DRIVER=s3
S3_BUCKET=gcn-media-production
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
S3_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
STORAGE_PUBLIC_BASE_URL=https://media.globalchronicle.news
STORAGE_MEDIA_VISIBILITY=public

SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=apikey
SMTP_PASS=SG.xxxxx
SMTP_FROM=noreply@globalchronicle.news

GEMINI_API_KEY=AIzaSy...
```

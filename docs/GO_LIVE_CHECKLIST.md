# Go-Live Checklist — Global Chronicle News

**Version**: 1.0.0-rc1 | **Updated**: 2026-11-10  
**Instructions**: Complete every P0 item before going live. P1 items must be completed within 7 days of launch. Use PASS / FAIL / BLOCKED / NOT RUN.

---

## SECTION A — Infrastructure & Environment

| # | Item | Owner | Status | Notes |
|---|---|---|---|---|
| A1 | Server provisioned (Node 22 LTS or higher) | Ops | NOT RUN | Requires hosting account |
| A2 | PostgreSQL 15/16 provisioned and accessible | Ops | NOT RUN | Required; dev JSON store rejected in prod |
| A3 | `DATABASE_URL` set in production environment | Ops | NOT RUN | |
| A4 | `DB_DRIVER=postgres` set in production | Ops | NOT RUN | |
| A5 | Prisma migrations applied (`npm run db:migrate:deploy`) | Ops | NOT RUN | Run before first boot |
| A6 | S3 bucket (or persistent local volume) provisioned | Ops | NOT RUN | Required for media uploads |
| A7 | `STORAGE_DRIVER`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` set | Ops | NOT RUN | |
| A8 | SMTP relay configured and tested (send test email) | Ops | NOT RUN | Required for password reset |
| A9 | Reverse proxy (nginx/Caddy) configured with HTTPS | Ops | NOT RUN | Required for HSTS header |
| A10 | SSL certificate issued and auto-renewing (Let's Encrypt / ACM) | Ops | NOT RUN | |
| A11 | `TRUST_PROXY=1` set (if behind nginx/ELB) | Ops | NOT RUN | Required for correct rate limiting |

---

## SECTION B — Secrets & Security

| # | Item | Owner | Status | Notes |
|---|---|---|---|---|
| B1 | `JWT_SECRET` generated (`npm run gen:secret`) and stored in secrets manager | Dev/Ops | NOT RUN | ≥ 32 chars; never the dev default |
| B2 | `JWT_SECRET` NOT committed to version control | Dev | NOT RUN | Check `.gitignore` includes `.env` |
| B3 | `APP_URL=https://yourdomain.com` set (no trailing slash, no localhost) | Ops | NOT RUN | Boot fails if violated |
| B4 | `NODE_ENV=production` set | Ops | NOT RUN | |
| B5 | No debug tokens or test credentials in production environment | Dev | NOT RUN | |
| B6 | CORS policy reviewed for any additional frontend origins | Dev | NOT RUN | |
| B7 | Security headers verified on production (`X-Frame-Options: DENY`, CSP, HSTS) | Dev | NOT RUN | Use securityheaders.com |

---

## SECTION C — Database & Data

| # | Item | Owner | Status | Notes |
|---|---|---|---|---|
| C1 | Migrations applied and `db:verify` passes | Ops | NOT RUN | |
| C2 | JSON → PostgreSQL import completed (if migrating from dev data) | Ops | NOT RUN | Use `npm run db:import` — never `seed` |
| C3 | Pre-launch database backup taken | Ops | NOT RUN | Store offsite |
| C4 | Backup restoration tested to isolated instance | Ops | NOT RUN | Required before launch |
| C5 | Automated nightly backup cron configured | Ops | NOT RUN | See `docs/BACKUP_RESTORE.md` |
| C6 | Backup retention policy applied (30-day daily + 90-day pre-deploy) | Ops | NOT RUN | |

---

## SECTION D — Application Checks

| # | Item | Owner | Status | Notes |
|---|---|---|---|---|
| D1 | `GET /api/health` returns HTTP 200, `database.driver = "postgres"` | Dev | NOT RUN | Proves production DB connected |
| D2 | `GET /api/health` → `storage.driver = "s3"` (or `local` with explicit dir) | Dev | NOT RUN | Proves storage provider live |
| D3 | `GET /api/health` → `scheduler.status = "ACTIVE"` | Dev | NOT RUN | |
| D4 | Homepage loads with real articles (not seed data) | Dev | NOT RUN | |
| D5 | Article detail page loads with correct canonical URL | Dev | NOT RUN | Confirm `APP_URL` matches |
| D6 | Sitemap at `/sitemap.xml` lists real published articles | Dev | NOT RUN | |
| D7 | `robots.txt` at `/robots.txt` references correct sitemap URLs | Dev | NOT RUN | |
| D8 | Search returns results | Dev | NOT RUN | |
| D9 | Category pages load correctly | Dev | NOT RUN | |
| D10 | Static pages load: `/page/about`, `/page/privacy`, `/page/terms`, `/page/contact`, `/page/standards` | Dev | NOT RUN | |

---

## SECTION E — CMS & Editorial Workflow

| # | Item | Owner | Status | Notes |
|---|---|---|---|---|
| E1 | Admin account created (using `POST /api/auth/register` with ADMIN role, then restrict registration) | Ops | NOT RUN | Do this before going live |
| E2 | At least one editor account created | Editorial | NOT RUN | |
| E3 | At least one reporter account created | Editorial | NOT RUN | |
| E4 | Test article: draft → review → approve → publish flow completed end-to-end | Editorial | NOT RUN | |
| E5 | Published test article visible on homepage and category page | Editorial | NOT RUN | |
| E6 | Slug redirect works (rename slug → verify 301) | Dev | NOT RUN | |
| E7 | Media upload works in production (image uploaded, appears in article) | Editorial | NOT RUN | |
| E8 | AI features (if `GEMINI_API_KEY` set): headline/summary generation tested | Editorial | NOT RUN | Optional |
| E9 | TTS audio generation tested (if Gemini configured) | Editorial | NOT RUN | Optional |
| E10 | Password reset tested end-to-end (email received, link works) | Ops | NOT RUN | |

---

## SECTION F — SEO, Performance & Accessibility

| # | Item | Owner | Status | Notes |
|---|---|---|---|---|
| F1 | Google Search Console: domain verified | Marketing | NOT RUN | |
| F2 | Sitemap submitted to Google Search Console | Marketing | NOT RUN | |
| F3 | Google News sitemap (`/sitemap-news.xml`) tested | Marketing | NOT RUN | Required for Google News indexing |
| F4 | JSON-LD structured data verified (use Google Rich Results Test) | Dev | NOT RUN | |
| F5 | Page speed / Core Web Vitals baseline measured | Dev | NOT RUN | Use Lighthouse / PageSpeed Insights |
| F6 | Mobile layout tested on real iOS and Android devices | Dev/Design | NOT RUN | |
| F7 | Keyboard navigation tested across all major flows | Dev | NOT RUN | |
| F8 | `prefers-reduced-motion` verified (animations disabled for affected users) | Dev | NOT RUN | |

---

## SECTION G — Monitoring & Alerting

| # | Item | Owner | Status | Notes |
|---|---|---|---|---|
| G1 | Uptime monitoring configured for `/api/health` | Ops | NOT RUN | Use UptimeRobot / Pingdom / Datadog |
| G2 | Alert on `status != "ok"` → page on-call engineer | Ops | NOT RUN | |
| G3 | Disk space monitoring for media volume | Ops | NOT RUN | Alert at >80% |
| G4 | Log aggregation configured (ship to ELK / CloudWatch / Papertrail) | Ops | NOT RUN | |
| G5 | Error rate alerting on 5xx responses | Ops | NOT RUN | |
| G6 | On-call rotation documented and tested | Ops | NOT RUN | |

---

## SECTION H — Legal, Content & Policy Pages

| # | Item | Owner | Status | Notes |
|---|---|---|---|---|
| H1 | Privacy Policy reviewed and accurate for jurisdiction | Legal | NOT RUN | `/page/privacy` |
| H2 | Terms of Use reviewed | Legal | NOT RUN | `/page/terms` |
| H3 | Editorial Standards page reviewed and accurate | Editorial | NOT RUN | `/page/standards` |
| H4 | Contact page has real email/addresses | Editorial | NOT RUN | `/page/contact` |
| H5 | Media rights confirmed for all launch-day photography | Editorial | NOT RUN | |
| H6 | Cookie consent mechanism reviewed (if applicable for your jurisdiction) | Legal | NOT RUN | GDPR / PECR |
| H7 | GDPR/data-subject request process documented | Legal | NOT RUN | Email to `newsroom@globalchronicle.org` |

---

## GO / NO-GO DECISION

**Date of assessment**: 2026-11-10  
**Assessed by**: Engineering Team

### Automated Tests (All verified on 2026-11-10)

| Test Suite | Result |
|---|---|
| TypeScript check | **PASS** (0 errors) |
| Core unit & integration (36 tests) | **PASS** |
| Security regression (176 assertions) | **PASS** |
| Phase 7-11 regression (530+ assertions) | **PASS** |
| Phase 13 Critical E2E (15 journeys) | **PASS** |
| Production build | **PASS** |

### Remaining User Actions Before Production Launch

> [!CAUTION]
> The application code is Release Candidate quality. The following actions require **manual human steps** — no deployment should proceed without completing all P0 items.

**P0 — Required before any traffic is served**:
1. 🔐 **Provision `JWT_SECRET`** — run `npm run gen:secret`, store in secrets manager.
2. 🗄️ **Provision PostgreSQL** — apply migrations (`npm run db:migrate:deploy`), import data (`npm run db:import`), verify (`npm run db:verify`).
3. 📦 **Provision object storage** — create S3 bucket (or persistent local volume), configure CORS, set lifecycle policy.
4. 🌐 **Set `APP_URL=https://yourdomain.com`** — required for canonical URLs and HSTS.
5. 📧 **Configure SMTP** — required for password reset; test email delivery end-to-end.
6. 🔒 **DNS and SSL certificate** — configure domain → reverse proxy → app; verify HTTPS redirect.
7. 💾 **Take and test a pre-launch backup** — restore to isolated database and verify.

**P1 — Complete within 7 days of launch**:
1. Configure automated nightly database backups with 30-day retention.
2. Set up uptime monitoring on `/api/health` with alerting.
3. Submit sitemaps to Google Search Console.
4. Legal review of Privacy Policy and Terms of Use for target jurisdiction.

**VERDICT**: 🔴 **NOT READY FOR PRODUCTION** — Code is RC-quality; infrastructure and secrets provisioning by operator required.  
**Code quality verdict**: 🟢 **READY** — All automated checks pass; zero P0 code defects.

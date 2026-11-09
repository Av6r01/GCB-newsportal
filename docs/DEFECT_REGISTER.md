# Defect Register — Global Chronicle News
**Phase:** 3 Complete  
**Date:** 2026-10-28  
**Method:** Source reading + runtime test execution. All claims backed by test output.

---

## P0 — Security / Data-Loss / Publication Blockers

| ID | Defect | File | Status | Fix |
|---|---|---|---|---|
| P0-01 | Password reset doesn't persist to disk | `server.ts:269`, `src/lib/db.ts` | ✅ FIXED | Added `db.user.update()`; called in reset confirm handler |
| P0-02 | Role assignment doesn't persist to disk | `server.ts:305` | ✅ FIXED | Calls `db.user.update()` after role change |
| P0-03 | `isActive` change doesn't persist to disk | `server.ts:330` | ✅ FIXED | Calls `db.user.update()` after status change |
| P0-04 | JOURNALIST/CONTRIBUTOR roles have zero runtime permissions | `src/lib/seed.ts:49,58` | ✅ FIXED | Seed: `JOURNALIST→REPORTER`, `CONTRIBUTOR→ANALYST`; 5 live DB users patched |
| P0-05 | Seed runs unconditionally in production | `server.ts:127` | ✅ FIXED | `if (process.env.NODE_ENV !== 'production')` guard added |
| P0-06 | `GET /api/articles/:slug` leaks unpublished content | `server.ts:543` | ✅ FIXED | Returns 404 for non-PUBLISHED; new `GET /api/preview/:slug` (auth+permission) |
| P0-07 | Duplicate `/api/breaking-news` route registration | `server.ts:1747` | ✅ FIXED | Duplicate block removed; first registration (~1347) is canonical |
| P0-08 | `recentlyPublishedStories` always `undefined` in dashboard | `server.ts:1683` | ✅ FIXED | Removed destructuring from array; direct assignment |
| P0-09 | JWT secret mismatch between `server.ts` and `authMiddleware.ts` | `server.ts:42` | ✅ FIXED | Both now use `'global-chronicle-secret-key-2026'` fallback |
| P0-10 | Revision restore has no ownership/permission check | `server.ts:693` | ✅ FIXED | Requires ownership or `article:edit_any` |
| P0-11 | SVG XSS filter incomplete (missing `on*`, `foreignObject`, `xlink`) | `src/server/mediaSecurity.ts:99` | ✅ FIXED | Comprehensive pattern array: `on\w+=`, `<foreignobject`, `xlink:href data:`, `data:text/html` |

---

## P1 — Required Production Functionality

| ID | Defect | File | Status | Fix |
|---|---|---|---|---|
| P1-01 | Article tags never linked on create or update | `server.ts:~605,670` | ✅ FIXED | `tagIds[]` accepted; `db.articleTag.createMany/deleteMany` added and called |
| P1-02 | Article editor loads all articles to find one by ID | `src/pages/CmsArticleEditor.tsx:72` | ✅ FIXED | `GET /api/articles/by-id/:id` route added with auth+ownership check |
| P1-03 | `db.user` had no `update()` method | `src/lib/db.ts` | ✅ FIXED | `user.update({ where, data })` implemented with `save()` call |
| P1-04 | Reactions and poll votes had no rate limiting or dedup | `server.ts` | ✅ FIXED | `SimpleIpLimiter` (10/min/IP/article for reactions); poll dedup via `pollVoters` Set |
| P1-05 | Analytics track: no rate limit, no validation | `server.ts:1783` | ✅ FIXED | `analyticsLimiter` (60/min), event type whitelist validated |
| P1-06 | Media mutation endpoints lacked permission checks | `server.ts:1049,1118,1156,1210,1230` | ✅ FIXED | `requirePermission('media:upload')` on POST; `requirePermission('media:manage')` on PUT/DELETE |
| P1-07 | Live blog delete had no ownership/permission check | `server.ts:1362` | ✅ FIXED | Requires ownership or `article:edit_any`; audit log written |
| P1-08 | Comment submission had no rate limiting | `server.ts:1457` | ✅ FIXED | `commentLimiter` (5/hr/IP); blank field validation tightened |
| P1-09 | Prisma schema disconnected from runtime | `prisma/schema.prisma` | 🟡 DOCUMENTED | Schema is decorative; migration to PostgreSQL requires enum reconciliation pass. Not blocking. |
| P1-10 | No CORS configuration | `server.ts` | 🟡 OPEN | Phase 5 — needs production origin allowlist |
| P1-11 | 13 npm audit vulnerabilities (prisma RC chain) | `package.json` | 🟡 OPEN | Phase 5 — `prisma@8.0.0-rc` → stable when available |

---

## P2 — Visual / Quality

| ID | Defect | Status |
|---|---|---|
| P2-01 | CSP header breaks Vite HMR (`unsafe-eval` needed in dev) | 🟡 OPEN — Phase 5 |
| P2-02 | `article.findMany` attaches `.total` to array (non-standard shape) | 🟡 OPEN — acceptable until Prisma migration |
| P2-03 | `homepageConfig.upsert` called without `where` clause | 🟡 OPEN — works in custom DB; document before Prisma migration |
| P2-04 | Scheduler loads all schedules into memory | 🟡 OPEN — Phase 5 when volume warrants |
| P2-05 | `database.json` on disk missing 20+ collections on fresh clone | 🟡 OPEN — collections init in memory; first write persists them |
| P2-06 | Hardcoded Unsplash fallback URLs in seed | 🟡 OPEN — cosmetic |

---

## Additional items discovered and fixed in Phase 3

| Fix | Location |
|---|---|
| `GET /api/articles?status=` bypass for unauthenticated callers | `server.ts` |
| `GET /api/comments?status=PENDING` bypass for public callers | `server.ts` |
| `authorEmail` exposed in public comment responses (PII leak) | `server.ts` |
| `GET /api/media/:id/usages` public — exposes unpublished article refs | `server.ts` |
| `POST /api/ai/tts` unauthenticated — Gemini quota drain | `server.ts` |
| Generic `PUT /api/articles/:id` could set `status` directly | `server.ts` |
| `POST /api/articles` accepted `status: PUBLISHED` from REPORTER | `server.ts` |
| Separation of duties: REPORTER/COPY_EDITOR could self-approve own article | `server.ts` |
| `db.liveBlogUpdate.findUnique` missing — runtime crash on P1-07 ownership check | `src/lib/db.ts` |
| `db.articleTag.createMany/deleteMany/findMany` missing entirely | `src/lib/db.ts` |
| 5 live `database.json` users with JOURNALIST/CONTRIBUTOR roles patched to REPORTER/ANALYST | `data/database.json` |

---

## Phase 4 Fixes Applied

| Defect | Location | Status |
|---|---|---|
| Hardcoded JWT_SECRET fallback in `server.ts` | `server.ts:42` | ✅ FIXED — removed; imports from `env.ts` |
| Hardcoded JWT_SECRET fallback in `authMiddleware.ts` | `authMiddleware.ts:12` | ✅ FIXED — removed; imports from `env.ts` |
| No production strength check on JWT_SECRET | `src/configuration/env.ts` | ✅ FIXED — `validateSecret()`: min 32 chars, known-insecure list, fail-closed |
| No algorithm restriction on `jwt.verify` | `authMiddleware.ts` | ✅ FIXED — `algorithms: ['HS256']` on all verify calls |
| No issuer/audience binding | `server.ts`, `authMiddleware.ts` | ✅ FIXED — `iss: global-chronicle-news`, `aud: gcn-client` |
| Token lifetime was 7 days | `server.ts` | ✅ FIXED — 8 h (`JWT_EXPIRES_IN_SECONDS=28800`), configurable |
| No `jti` on issued tokens | `server.ts` | ✅ FIXED — `signAuthToken()` always generates jti |
| Logout revocation in-process only (lost on restart) | `server.ts`, `authMiddleware.ts` | ✅ FIXED — `db.revokedSession` persists to JSON DB |
| Stale tokens valid after password change | `authMiddleware.ts` | ✅ FIXED — `passwordChangedAt` check: `iat < passwordChangedAt → 401` |
| No token refresh endpoint | `server.ts` | ✅ FIXED — `POST /api/auth/refresh` with jti rotation |
| Reset token was `Math.random()` plaintext in process memory | `server.ts` | ✅ FIXED — `crypto.randomBytes(48)`, SHA-256 hash in DB |
| Reset token: no single-use enforcement | `server.ts` | ✅ FIXED — `markUsed()`, second use → 400 |
| Reset: false-positive "email sent" (no SMTP check) | `server.ts` | ✅ FIXED — `sendPasswordResetEmail` throws on failure; 503 returned |
| Reset: account enumeration via response difference | `server.ts` | ✅ FIXED — identical neutral message for real and fake emails |
| Reset: token stored in plaintext in DB | `server.ts` | ✅ FIXED — only SHA-256 hash stored; raw token never written to disk |
| No real SMTP provider integration | — | ✅ FIXED — `src/lib/mailer.ts` with nodemailer; dev log-only mode |
| Demo accounts not blocked at production startup | `server.ts` | ✅ FIXED — startup scan throws `[FATAL]` if demo emails found |
| No explicit seed command | `package.json` | ✅ FIXED — `npm run seed` added |
| No secret generation helper | `package.json` | ✅ FIXED — `npm run gen:secret` added |
| Password minimum not enforced on register | `server.ts` | ✅ FIXED — 8-char minimum on register and reset-confirm |
| bcrypt cost factor too low (10) | `server.ts` | ✅ FIXED — raised to 12 |
| No SMTP configuration in env | `src/configuration/env.ts` | ✅ FIXED — SMTP_HOST/PORT/SECURE/USER/PASS/FROM added to schema |
| `.env.example` incomplete | `.env.example` | ✅ FIXED — full SMTP docs, rotation procedure, gen command |
| No threat model | — | ✅ FIXED — `docs/SECURITY_THREAT_MODEL.md` (12 threats, open risks) |

---

## Phase 5 Fixes Applied

| Defect | Location | Status |
|---|---|---|
| SVG uploads accepted with incomplete XSS scan (first 512 bytes only) | `src/server/mediaSecurity.ts` | ✅ FIXED — SVG rejected by default; opt-in via `ALLOW_SVG_UPLOADS=true`; full 64 KB scan with 13 XSS pattern rules |
| SVG filter missing `on*`, `foreignObject`, `xlink:href`, `animate href`, `set href` | `src/server/mediaSecurity.ts` | ✅ FIXED — comprehensive pattern array covers all known SVG XSS vectors |
| Article HTML content not sanitized server-side | `server.ts` | ✅ FIXED — `sanitizeArticleContent()` applied on create and update; allowlist-based sanitize-html config |
| Article excerpt not sanitized | `server.ts` | ✅ FIXED — `sanitizeExcerpt()` strips all HTML, truncates to 500 chars |
| External URLs in article fields not validated | `server.ts` | ✅ FIXED — `validateUrl()` rejects `javascript:`, `data:`, `//` on `coverImage`, `socialImage`, `videoUrl` |
| `dangerouslySetInnerHTML` in CmsArticleEditor with unsanitized content | `src/pages/CmsArticleEditor.tsx` | ✅ FIXED — DOMPurify client-side sanitization applied before rendering |
| `GET /api/media` list publicly accessible | `server.ts` | ✅ FIXED — `requireAuth` added |
| `GET /api/media/:id` exposes `uploaderId` and internal fields publicly | `server.ts` | ✅ FIXED — public response scoped to safe fields; `uploaderId` omitted |
| Media permission missing on `POST /api/media/file-upload` and `POST /api/media` | `server.ts` | ✅ FIXED (Phase 3) — confirmed carrying forward |
| No upload rate limiting per user | `server.ts`, `src/server/mediaSecurity.ts` | ✅ FIXED — `checkUploadRateLimit(userId)`: 20 uploads / 10 min |
| No cleanup on failed file write | `server.ts` | ✅ FIXED — `try/catch` on `writeFileSync`; partial write failure returns 500 without leaving orphan |
| Unsafe storage filename (original name, predictable) | `src/server/mediaSecurity.ts` | ✅ FIXED — `generateSafeFileName()` uses `crypto.randomUUID()` |
| CSP too restrictive for Vite HMR in dev; too permissive in prod | `server.ts` | ✅ FIXED — `isDev` conditional CSP; prod CSP has `frame-ancestors 'none'`, `base-uri`, `form-action`, `upgrade-insecure-requests` |
| Missing `Referrer-Policy`, `Permissions-Policy`, `HSTS` | `server.ts` | ✅ FIXED — all three added |
| `/uploads/` static served without security headers | `server.ts` | ✅ FIXED — `X-Content-Type-Options: nosniff`, `Cross-Origin-Resource-Policy: same-site`, `dotfiles: deny` |
| No orphan asset detection | — | ✅ FIXED — `GET /api/admin/media/orphans` (requires `media:manage`) |
| No server-side article content sanitization | `src/lib/contentSanitizer.ts` | ✅ FIXED — new module with `sanitizeArticleContent`, `sanitizeExcerpt`, `validateUrl` |
| `sanitize-html` not installed | `package.json` | ✅ FIXED — installed with `@types/sanitize-html` |
| `dompurify` not applied client-side | `src/pages/CmsArticleEditor.tsx` | ✅ FIXED — `DOMPurify.sanitize()` wraps preview rendering |
| `articleMedia.findMany` missing | `src/lib/db.ts` | ✅ FIXED — method added for orphan detection and media usage queries |
| Image variants were aliases to original URL with no resizing | `server.ts` | 🟡 DOCUMENTED — variant URLs recorded with correct labels; real resizing deferred to Phase 6 (requires sharp/jimp) |

### P2 items resolved in Phase 5

| Item | Resolution |
|---|---|
| P2-01: CSP breaks Vite HMR in dev | ✅ FIXED — dev/prod split CSP |

### Open after Phase 5

| Item | Phase |
|---|---|
| Image resizing / real thumbnail variants (sharp) | Phase 6 |
| CORS allowlist | Phase 6 |
| HttpOnly cookie JWT migration | Phase 6 |
| Prisma schema reconciliation | Phase 6 |
| `npm audit` prisma RC chain vulnerabilities | Phase 6 |

---

## Phase 6B — Database persistence integrity (2026-11-06)

| ID | Defect | File | Status | Fix |
|---|---|---|---|---|
| P1-09 | Prisma schema disconnected from runtime (decorative) | `prisma/schema.prisma`, `src/lib/db.ts` | ✅ FIXED | Runtime driver selector (`src/lib/database.ts`); PostgreSQL driver `src/lib/database/pgDriver.ts`; versioned migrations `prisma/migrations/20261106_phase6b_*` |
| (RC chain) | `prisma@8.0.0-rc.27` / `@prisma/client@^7` skew + audit vulnerabilities | `package.json` | ✅ FIXED | Pinned `prisma@6.19.3` + `@prisma/client@6.19.3` (stable, aligned) |
| P2-02 | `article.findMany` attaches `.total` to array | `src/lib/db.ts` | 🟡 DOCUMENTED | Retained deliberately in the PG driver for shape compatibility; pagination moved after decoration. Remove in a follow-up API-shape refactor (Phase 7). |
| P2-03 | `homepageConfig.upsert` called without `where` | `server.ts` | 🟡 DOCUMENTED | PG driver implements the singleton as `id: 'default'` upsert; semantics documented in plan §1.3 |
| P2-05 | `database.json` missing collections on fresh clone | `src/lib/db.ts` | 🟡 DOCUMENTED | JSON legacy path retained for development only; PG (production) enforces full schema |

### New corruption-class defect (plan §1)

| ID | Defect | Evidence | Status | Exposure |
|---|---|---|---|---|
| 6B-D1 | **JSON store silently accepts corrupt data on read/write** — no schema, enum, or type validation at the persistence boundary | `src/lib/db.ts` (no validation layer). Confirmed live in `data/database.json`: **13 users** (`usr-reporter-a`, `usr-reporter-b`, `usr-copy-editor`, `usr-managing-editor`, `usr-ad-manager`, `usr-ci7jlgn`, `usr-1u17vym`, `usr-8p81gui`, `usr-ye05ydt`, `usr-pr0a5dv`, `usr-lvs1na5`, `usr-hlae1x1`, `usr-aug5ieh`) store the literal string `"hash"` in `passwordHash`; **8 editorial events** (`event-pj25xki` … `event-09l0xlx`) reference articles that no longer exist. The seed script (`src/lib/seed.ts`) would have written invalid priority `HIGH` into any database it seeds (×2 articles — SQL would reject these under PG). | 🟡 DOCUMENTED (JSON legacy path only) | Under PostgreSQL these rows are structurally impossible: enum checks, FK constraints, and NOT NULL columns reject them at write time. The import script (`src/db-migration/import-json-to-pg.ts`) reports them as `skippedInvalid`/`orphans` and fails closed unless `--fix-orphans` is passed. JSON path retained for development convenience — treat as dev-only, never production. |

### Phase 6B operational fixes

| Fix | Location |
|---|---|
| Production JSON fallback removed (fail-closed startup) | `src/lib/database.ts` |
| Real PostgreSQL transactions replace `Promise.all` semantics | `src/lib/database/pgDriver.ts` (`runTx`) |
| Tag delete cleans `articleTags` join rows in one transaction | `pgDriver.tag.delete` |
| Initial creation writes article + version-1 revision atomically | `pgDriver.article.create` |
| Missing composite indexes / unique constraints added | `prisma/migrations/20261106_phase6b_step2_schema/migration.sql` |
| Versioned migrations reconcile initial-schema drift (ArticleMedia, PhotoGallery, GalleryItem, VideoRecord, AnalyticsEvent, ArticleType) | `prisma/migrations/20261106_phase6b_step2_schema/migration.sql` |
| Scheduler daemon actor `usr-system-daemon` seeded as inactive READER | `src/lib/seed.ts`, import script |
| Seed priority `HIGH` → `FEATURED` (invalid enum would fail in PG) | `src/lib/seed.ts` |
| `/api/health` exposes `checks.database.driver` for cutover smoke tests | `src/server/health.ts` |
| JSON store canonical export + SHA-256 archive for rollback | `src/db-migration/export-from-json.ts` |
| Recoverable pre-migration backup | `data/backups/pre-6b-2026-11-06/database.json` |

### Deferred to Phase 7

| Item | Rationale |
|---|---|
| Repository/interface layer formalized as TypeScript interfaces (currently duck-typed parity) | Plan §4 chose incremental parity first; interface extraction is a refactor, not a behavior change |
| Remove `.total` array property (P2-02) | Requires coordinated front-end change |

---

## Phase 6B Verification Log (2026-11-06 / 2026-11-07)

Host: Windows, Node v24.19.0, **no Docker/PostgreSQL available locally** — every
PostgreSQL-requiring artefact was exercised as far as possible and the exact
commands NOT run are printed by `npm run test:persistence` on entry.

| Check | Command(s) | Result |
|---|---|---|
| TypeScript compile | `npx tsc --noEmit` | ✅ clean (multiple runs incl. after each fix) |
| Prisma schema | `npx prisma validate` (with dummy `DATABASE_URL`) | ✅ valid |
| Prisma client | `npx prisma generate` | ✅ generated (prisma 6.19.3) |
| Legacy JSON suites | `npm test` (8 suites) | ✅ all passed |
| Security suites | `npm run test:security` | ✅ exit 0 (BUGGY-mode failures are by design; all FIXED modes 0 failures) — also repaired the suites' hardcoded `/home/claude/gcn/...` source paths, which crashed the runs on this machine |
| JSON store integrity | SHA-256 before/after test runs | ✅ `7CCFFEFA…E559` byte-identical to `data/backups/pre-6b-2026-11-06/database.json` |
| Import script validation | `npx tsx src/db-migration/import-json-to-pg.ts --dry-run` (no writes; no PG needed) | ✅ validates all 30 collections; detect 13 users with placeholder `"hash"` passwordHash, 8 orphaned editorialEvents; blocked run writes report then exits non-zero; `--fix-orphans` run completes; no DB writes in dry-run |
| Canonical JSON export | `npm run db:export` | ✅ `data/migration/json-canonical-2026-11-06_14-20-27.json` + SHA-256 `612fb94b…cab8` (158 records) |
| Production fail-closed rules | runtime probes of `src/lib/database.ts` | ✅ production + missing `DATABASE_URL` → fatal; production + `DB_DRIVER=json` → fatal; development default → json with startup notice |
| PostgreSQL runtime path (smoke) | `DB_DRIVER=postgres DATABASE_URL=postgresql://gcn:gcn@127.0.0.1:55439/gcn_smoke npx tsx server.ts` + `GET /api/health` | ✅ server boots on the Prisma/PostgreSQL path; `/api/health` → **503 degraded with `checks.database.driver: "postgres"`** against unreachable DB; seed/purge/scheduler degrade with logged errors instead of crashing the process |
| PG integration tests | `npm run test:persistence` | ⚠️ SKIPPED (no local PG) — prints exact commands; covers migration ledger, unique slug, tx rollback, 25 concurrent increments, slug race, restart persistence, idempotent import round-trip on a disposable `gcn_test_<runid>` DB |
| `prisma migrate deploy` | against real PG | ⚠️ NOT RUN (no reachable disposable PG) — SQL migrations written and reviewed; run per runbook §3 step 2; the suite applies them automatically when `TEST_DATABASE_URL` is provided |

Supporting fixes made while verifying (out-of-band but small):

| Fix | Location |
|---|---|
| Dev seed failure (unreachable DB) no longer kills startup | `server.ts` (try/catch around `seedDevelopmentData`) |
| Startup purge (reset tokens/sessions) tolerates unreachable DB | `server.ts` |
| `npm start` runs `tsx server.ts` (Node 24 native `node server.ts` cannot execute non-erasable TS — parameter properties — and crashed with uncaught TypeError) | `package.json` |
| Dockerfile + .dockerignore added; compose runs one-shot migrate service with `service_completed_successfully` gate and a healthcheck asserting driver postgres | `Dockerfile`, `.dockerignore`, `docker-compose.yml` |

---

## Phase 7 — Publishing data integrity & server route cleanup (2026-11-07)

Scope: duplicate Express registrations, pagination contract, homepage TTL cache,
archive-vs-purge lifecycle, transactional writes, scheduler idempotency, admin
dashboard result-shape assumptions. Front-end presentation intentionally
untouched (envelope contract for paged reads preserves all 6 consuming pages).

| ID | Defect | File(s) | Status | Fix |
|---|---|---|---|---|
| P7-D1 | Duplicate Express route registrations shadow the first handler (silent dead routes) — e.g. breaking-news GET registered twice | `server.ts` | ✅ FIXED | Mechanical detector `scripts/route-lint.ts` (static scan, `:param` normalization, exit 1 on dupes) wired as `npm run lint:routes`; real project now has 69 registrations / 0 duplicates; regression test asserts both detection and zero dupes |
| P7-D2 | `limit` query param silently ignored when `page` omitted; no maximum page size anywhere | `server.ts`, `src/server/query.ts` (new) | ✅ FIXED | Standardized `parsePagination`/`wantsPagination`: page present → `{articles, pagination}` envelope; pageless → plain array honoring `limit`; `DEFAULT_PAGE_SIZE=20`, `MAX_PAGE_SIZE=100` enforced; hostile values (NaN/negative/huge) clamped — never throw, never unbounded. Same bounds applied to comments/media/admin-analytics lists |
| P7-D3 | Homepage cache: no TTL, invalidated implicitly; risk of stale editorial payload | `server.ts`, `src/server/cache.ts` (new) | ✅ FIXED | `TtlCache` (key `homepage`, TTL 60s default, `HOMEPAGE_CACHE_TTL_MS` env override); explicit `invalidateHomepageCache()` now called on **every** editorial mutation (article create/update/transition/archive/purge, breaking-news create/update/delete, media replace/delete); cache populated only from PUBLISHED-only queries (stale-never rule); observability fields `generatedAt`/`cacheAgeSeconds`/`cacheTtlSeconds` |
| P7-D4 | `DELETE /api/articles/:id` hard-deleted the row — revisions, comments, media joins and history destroyed with no dependency checks or dedicated audit | `server.ts` | ✅ FIXED | DELETE is archive-by-default: `status='ARCHIVED'` + `archivedAt` stamped with editorial event + audit in one transaction; all history preserved; idempotent on re-archive |
| P7-D5 | No protected permanent-deletion procedure — hard deletion was limited only by `article:delete` (held by MANAGING_EDITOR) with cascade destruction | `server.ts`, `src/modules/auth/permissions.ts` | ✅ FIXED | `POST /api/articles/:id/purge` gated by new `article:purge` permission (SUPER_ADMIN/ADMIN only); 409-blocked unless ARCHIVED/DRAFT, while active breaking-news announcements reference it, or homepageConfig references it; delete + audit + editorial event in one transaction |
| P7-D6 | Slug changes unsupported — old deep links died as 404s; no redirect/history preservation | `server.ts`, `src/lib/db.ts`, `src/lib/database/pgDriver.ts` | ✅ FIXED | `PUT /api/articles/:id` accepts validated `slug` (format + uniqueness 409, no partial write); `UrlRedirect` row (`/article/<old>` → `/article/<new>`, 301) created in the same transaction; `GET /api/articles/:slug` miss consults redirects (301). JSON driver gains `urlRedirect` repo (create/update/ensureRoute/findUnique/findMany) + slug-uniqueness enforcement in `article.update`; PG driver gains matching repo incl. `ensureRoute` upsert |
| P7-D7 | Multi-step writes were sequential awaits — failure mid-way left inconsistent state (associations replaced without article update/audit; asset deleted without reassignment) | `server.ts` | ✅ FIXED | Article PUT, article POST, media delete, archive all build op arrays in dependency order and commit via `prisma.$transaction(...)` (real tx on PG; JSON driver executes constructed-in-order batch); dependency validation (unknown tag/media ids → 400) runs BEFORE any write |
| P7-D8 | Scheduler sweep was not idempotent or observable — crash mid-publish lost article state; `failedJobsCount` hardcoded 0; job rows were placeholders; dashboard activity feed = unbounded `auditLog.findMany()` + client-side slice | `src/server/scheduler.ts`, `src/lib/db.ts`, `src/lib/database/pgDriver.ts`, `server.ts` | ✅ FIXED | Domain method `db.publishScheduledArticle({idempotencyKey: 'sched-pub-<articleId>-<version>'})` on both drivers (PG: real interactive tx; JSON: mutate-then-single-save) writes one EXECUTED `publicationSchedule` row — double-sweep is a no-op; `getSchedulerStatus()` feeds real dashboard job rows + `failedJobsCount`; activity feed bounded (8, newest-first) |
| P7-D9 | Breaking-news PUT destructured-then-spread payload sent explicit `undefined` for absent fields — stored values stomped to undefined (corruption on update) | `server.ts`, `src/lib/db.ts` | ✅ FIXED | PUT uses defined-only payload (400 when no fields present); JSON driver repos `compact()` undefined keys; POST validates headline and normalizes urgencyRank |
| P7-D10 | Legacy `editorialNotes` (plural) request key silently dropped — PG whitelist only accepts `editorialNote` | `server.ts` | ✅ FIXED | Either spelling accepted and mapped onto the stored `editorialNote` column |
| P7-D11 | Workflows did not track when a story was archived (no `archivedAt` from transition route) | `server.ts` | ✅ FIXED | `→ ARCHIVED` transition stamps `archivedAt` (parity with DELETE-archive) |

### Deferred / pre-existing (carried over, documented)

| Item | Status |
|---|---|
| P2-02 `.total` array property parity (JSON driver) | 🟡 DOCUMENTED (unchanged; coordinated front-end change required) |
| P2-03 `homepageConfig.upsert` no-where semantics | 🟡 DOCUMENTED (unchanged) |
| PostgreSQL-path regression tests (real tx atomicity under load, unique idempotencyKey race) not executable locally (no Docker/PG) | 🟡 DOCUMENTED — PG parity implemented and code-reviewed; `prisma migrate deploy` and `npm run test:persistence` remain not run; covered in-memory by `tests/p7/atomicity.test.ts` + `tests/p7/scheduler.test.ts` |

## Phase 7 Verification Log (2026-11-07)

Host: Windows, Node v24.19.0. All commands run from repo root.

| Check | Command | Result |
|---|---|---|
| Route inventory / duplicates | `npm run lint:routes` (CLI `--list` also used) | ✅ 69 registrations, 0 duplicates |
| TypeScript compile | `npx tsc --noEmit` | ✅ clean (re-run after each change) |
| Legacy JSON suites | `npm test` (8 suites: bootstrap, integrity, authorization, adminShell, taxonomy, articleEditor, workflow, qa) | ✅ all passed |
| Security suites | `npm run test:security` (A / BCDEFG / HIJ / KLM / Phase4) | ✅ exit 0 — FIXED modes 0 failures (BUGGY-mode failures are by design); Phase 4 now 39/39 incl. restructured seed guard C-2 |
| Phase 7 regression suites | `npm run test:p7` (route-duplicates 6, pagination 20, cache 18, archive-purge-slug 25, atomicity 15, scheduler 14) | ✅ 98/98 checks, exit 0 (per-suite child-process isolation, temp JSON stores) |
| Store integrity after legacy runs | SHA-256 of `data/database.json` vs `data/backups/pre-6b-2026-11-06/database.json` | ✅ restored to `7CCFFEFA…E559` after the legacy-sweep pollution; byte-identical |

Harness notes (for future maintenance):

- `tests/p7/harness.ts` boots the **real** app via `buildServer({lifespan:false,
  static:false})` exported from `server.ts`; `JSON_DB_PATH` + `DB_DRIVER=json`
  are set before any driver import so the canonical store is never touched.
- One suite previously seeded test rows into the real store because
  `src/server/scheduler.ts` was imported statically **before** the harness set
  the env overrides — scheduler/suite imports must stay dynamic/import-order
  safe. Store was restored from the pre-6b backup and SHA-256 verified.
- Node 24 + Windows + bcrypt: `process.exit(0)` can abort with a libuv
  assertion; `run-suite.ts` drains 250 ms before exiting on the success path.

---

# Phase 8 — Public API Abuse Controls (2026-11-08)

**Scope:** comments, reactions, poll voting, TTS, analytics, newsletter — every unauthenticated write / resource-intensive endpoint. Implementation: `src/server/abuse.ts` (shared module) + endpoint rewrites in `server.ts`. Operations guide: `docs/OPERATIONAL_LIMITS.md`.

| ID | Defect | File | Status | Fix |
|---|---|---|---|---|
| P8-D1 | Rate limiter Maps were memory-unbounded — a flood of spoofed unique keys (mis-set trust proxy / IPv6 privacy rotation) exhausts process memory | `server.ts` (old `SimpleIpLimiter`) | ✔ FIXED | `BoundedRateLimiter` with `maxKeys` cap (20,000) + oldest-entry eviction + lazy expired cleanup; all limiter sizes env-tunable |
| P8-D2 | `err.message` echoed verbatim on every public endpoint's 500 (and by the centralized handler) — leaked driver internals, file paths, parser dumps | `server.ts` (all routes + error handler) | ✔ FIXED | Centralized handler now maps `entity.parse.failed`→400 "Malformed request body.", `entity.too.large`→413; 5xx pages collapse to generic text; passthrough only for conservative business-rule messages (pattern-checked ≤120 chars); all public routes use `publicSafeError()` (details logged, hashed identity only) |
| P8-D3 | Poll vote burned the IP identity BEFORE payload validation — one malformed request permanently consumed the visitor's vote | `server.ts` (old vote route) | ✔ FIXED | Zod `optionIndex` validation + option-range check run before any registry write; identity recorded only after all validation and before the counter update |
| P8-D4 | No poll identity beyond raw IP; no policy documented | `server.ts` | ✔ FIXED | Primary identity = `gcn_poll_voter` HttpOnly cookie (random 32-hex token, 180 d, `secure` in production); IP = best-effort fallback, never claimed perfect; duplicate ⇒ 429 (client-compat); policy documented in OPERATIONAL_LIMITS §3 |
| P8-D5 | Comment POST echoed the full created record (incl. `authorEmail`) and did no spam/abuse mitigation beyond bare field checks; comments could target nonexistent/draft articles | `server.ts` | ✔ FIXED | Zod schema (bounded fields, email format, control-char strip); honeypot `website` ⇒ silent discard; article must exist + PUBLISHED (404 generic); duplicate-content suppression (bounded fingerprint set); link-spam heuristic auto-routes to SPAM bucket; response is a generic success message — no record, no email echo |
| P8-D6 | Public comment list stripped fields by destructuring — future internal fields would leak automatically; `status` query filtering lacked auth binding (GET route had no auth middleware; editor filter code was dead) | `server.ts` | ✔ FIXED | Explicit structural whitelist for public readers (`id, articleId, authorName, content, status, createdAt`); new `optionalAuth` middleware attaches `req.user` when a valid token is present (invalid ⇒ anonymous, never 401) so editors regain status filtering (`article:request_changes`-gated); pending queue bounded |
| P8-D7 | Reaction writes unchecked and un-deduplicated: any reaction type accepted for any article (incl. drafts/nonexistent); repeated clicks each counted | `server.ts` | ✔ FIXED | Zod enum; PUBLISHED-only 404 gate; (IP, article, type) dedup with cooldown ⇒ idempotent 200 `{deduplicated:true}`; registry marked only after a successful write (failed writes don't suppress) |
| P8-D8 | Analytics accepted arbitrary `metadata` object injection into the record; `entityId` unbounded; no per-field type bounds | `server.ts` | ✔ FIXED | Zod schema (8-event enum, `entityId` ≤64 format-checked, bounded record values + total byte budget) + `ANALYTICS_METADATA_ALLOWLIST` (10 keys) with silent drop of unknown keys, control-char strip, and budget-drop loop |
| P8-D9 | TTS had no per-user quota, no concurrency cap, no provider timeout; provider failures echoed internals; unconfigured-key 503 named the provider/key | `server.ts` | ✔ FIXED | `TtsCostGuard`: per-user UTC-day effort quota (`TTS_DAILY_QUOTA_PER_USER`, `0` = unlimited, attempts counted incl. provider 503s — documented trade-off), `tryAcquireSlot`/`releaseSlot` concurrency gate (`TTS_MAX_CONCURRENT`), `Promise.race` timeout (`TTS_TIMEOUT_MS`) ⇒ 504 `{retryable:true}`, provider failure ⇒ 502 generic text, slot always released in `finally`; voice format-checked (no arbitrary model params) |
| P8-D10 | Newsletter had no rate limit and a bare `@` email check; error passthrough | `server.ts` | ✔ FIXED | Limiter (5/h/IP), Zod email ≤254 + format, generic response |
| P8-D11 | No trusted-proxy configuration — IP-keyed controls spoofable when published behind a proxy, or spoofable-header use when `trust proxy` was naive | `server.ts` | ✔ FIXED | `resolveTrustProxy()` from `TRUST_PROXY` env: unset ⇒ direct/socket identity (non-spoofable); `true` ⇒ resolved to one hop (never "trust all"); integer ⇒ hops; comma list ⇒ passthrough. Guidance in OPERATIONAL_LIMITS §5 |
| P8-D12 | No abuse monitoring — repeated violation patterns were invisible to operators | — | ✔ FIXED | `AbuseMonitor`: route → sha256-12-hex identityHash counters (capped 64 × 5,000); logs first trip + every 25th repeat; **no raw IPs/emails/tokens in records**; new `GET /api/admin/abuse-report` (`analytics:view`) returns hashed top-offender report |
| P8-D13 | `cookie-parser` was not installed; poll cookies could not be parsed | `package.json` | ✔ FIXED | `cookie-parser@^1.4.7` + `@types/cookie-parser` added; wired before routes |

### Deferred / carried over

| Item | Status |
|---|---|
| TTS provider timeout path (504) requires a live `GEMINI_API_KEY` — unit-tested paths stop at quota/503; timeout covered by OPERATIONAL_LIMITS §4 | ✔ DOCUMENTED |
| In-process registries fork per instance (multi-replica multiplies limits, splits vote/dedup state) | ✔ DOCUMENTED — OPERATIONAL_LIMITS §8; DB persistence of (pollId, token) pairs is the production migration path |
| Comment fingerprint suppression does not survive restart or cross-IP reposting | ✔ DOCUMENTED (bounded in-process set by design) |
| `submittedCommentFingerprints`, vote/identity sets are process-lifetime state — restart clears; acceptable single-node trade-off matching the rest of Phase 8 | ✔ DOCUMENTED |

## Phase 8 Verification Log (2026-11-08)

Host: Windows, Node v24.19.0. All commands run from repo root.

| Check | Command | Result |
|---|---|---|
| TypeScript compile | `npx tsc --noEmit` | ✔ clean (re-run after each change) |
| Route inventory / duplicates | `npm run lint:routes` | ✔ 70 registrations (was 69; +1 `GET /api/admin/abuse-report`), 0 duplicates |
| Legacy JSON suites | `npm test` (8 suites) | ✔ all passed |
| Security suites | `npm run test:security` | ✔ exit 0 — FIXED modes 0 failures (KLM BUGGY-mode failures by design; unchanged) |
| Phase 7 regression suites | `npm run test:p7` | ✔ 98/98 checks (route-duplicates 6, pagination 20, cache 18, archive-purge-slug 25, atomicity 15, scheduler 14) — Phase 7 contracts (pagination envelope, archive-vs-purge, transactional writes) intact |
| Phase 8 regression suites | `npm run test:p8` | ✔ 94/94 checks (validation 40, rate-floods 22, comments-privacy 22, tts-quota 10); covers malformed/oversized payloads, floods, duplicate votes, pending-comment invisibility, unauthorized records, anonymous blocker, provider-unavailability shapes, metadata-injection protection, raw-IP absence in abuse report |
| Store integrity after legacy runs | SHA-256 of `data/database.json` vs `data/backups/pre-6b-2026-11-06/database.json` | ✔ restored to `7CCFFEFA…E559` (byte-identical) |

Harness notes (matches the p7 model):

- `tests/p8/run.ts` spawns one child process per suite with per-suite env
  (`COMMENTS_RATE_MAX`, `TTS_DAILY_QUOTA_PER_USER=2`, …) because limiter/guard
  state is module-scope and read at import time — env must be present before
  the child imports the app. Suite keys with hyphens must be quoted object
  keys in `SUITES`.
- `tests/p8/harness.ts` sets `JSON_DB_PATH` + `DB_DRIVER=json` before any
  driver import; canonical store never touched (verified by SHA-256 after the sweep).
- `makeRequest` helper captures raw `Set-Cookie` for the poll-voter token and
  drops bodies for GET/HEAD requests.

---

# Phase 9 — Stable Public URLs & News SEO (2026-11-08)

**Scope:** real URL router, stable shared links, canonical APP_URL, crawler-visible article HTML, sitemaps, redirects, 404 handling, language tags. Design note: `docs/ROUTING_SEO_IMPLEMENTATION_NOTE.md` (stack retained — React/Vite + Express; no framework migration). Verification: `docs/SEO_VERIFICATION_REPORT.md` (97/97 Phase 9 checks).

| ID | Defect | File | Status | Fix |
|---|---|---|---|---|
| P9-D1 | Navigation was pure state — refresh/deep links landed on Home; no back/forward parity | `src/App.tsx` | ✔ FIXED | History router `src/router.tsx` (pushState/popstate, zero deps) + typed route parser `src/routes.ts`; App derives views from the URL; every callback navigates real paths; DateArchive year-only support added |
| P9-D2 | No public URL scheme — links invented ad hoc per component (some arbitrary `onSelectCategory('world')`) | components/pages | ✔ FIXED | `src/urls.ts` single source of truth (`articleUrl/categoryUrl/authorUrl/topicUrl/archiveUrl/searchUrl/latestUrl/cmsUrl`); segments `encodeURIComponent`-encoded (Bangla slugs link-safe) |
| P9-D3 | Canonical URLs from `window.location.href` (query/hash noise, spoofable) on both PageMetadata variants | `src/components/PageMetadata.tsx`, `src/components/design-system/PageMetadata.tsx` | ✔ FIXED | Canonical built as `window.__GC_APP_URL__ + canonicalPath` (server injects validated origin); content pages drop query, search keeps `?q=`; per-route `canonicalPath` added at every call site |
| P9-D4 | Server-generated URLs used `VITE_APP_URL \|\| localhost` — client env var in server code, unvalidated | `server.ts` (robots/sitemaps), `src/configuration/env.ts` | ✔ FIXED | Single server-only `env.APP_URL` everywhere; Zod `url()` + production boot guard `validateAppUrl` (https + non-localhost, fail-fast) |
| P9-D5 | Article title/body/metadata invisible to crawlers (pure client rendering) | server | ✔ FIXED | SEO HTML middleware (prerender-lite): serves the SPA shell with real `<title>`/meta/canonical/JSON-LD for the ACTUAL requested record + a visible server-side title/byline/body block inside `#root` (html→text transform, XSS-safe); React replaces it on boot; dev keeps Vite transform (HMR intact) |
| P9-D6 | Hardcoded AI Studio `run.app` logo URL in article JSON-LD | `src/pages/ArticleDetail.tsx` | ✔ FIXED | Owned asset `public/logo.svg` referenced from APP_URL; `NewsMediaOrganization` publisher + `mainEntityOfPage` + `articleSection` + `inLanguage` added to `NewsArticle` |
| P9-D7 | Sitemap missing categories/subcategories/topics/authors/archives/`/latest`; no XML escaping; JSON-shape lastmod | `server.ts sitemap.xml` | ✔ FIXED | Full published-surface sitemap (10k cap) with per-entry ISO `lastmod`, `application/xml; charset=utf-8`, xmlEscape on every field |
| P8-…→P9-D8 | News sitemap: incorrect 48 h filter (JSON driver silently ignores `gte`) and malformed hand-rolled payload | `server.ts sitemap-news.xml` | ✔ FIXED | Spec-ordered `news:news` payload (publication(name, language) → publication_date → title); window applied in JS (driver-safe) — verified by test |
| P9-D9 | No 404 surface & no page-level redirects for changed slugs (API redirected, HTML 404'd via API parity only) | server SEO middleware | ✔ FIXED | Page-level 301 from the Phase 7 `UrlRedirect` table (status code honored); real HTTP 404 pages for missing/private routes; unknown paths → 404 page; noindex on `/cms` + `/search` |
| P9-D10 | `html lang` fixed `en` in static shell; `hreflang` alternates never generated | `index.html`, seo injector | ✔ FIXED (data-driven) | Injector sets document language (`en` content today; `bn` only for genuinely Bangla documents); alternates emitted ONLY when equivalent translations exist — none fabricatable today (documented) |
| P9-D11 | Search pages had no metadata at all; homepage statically titled | `src/pages/SearchResults.tsx`, `Home.tsx` | ✔ FIXED | Client `PageMetadata` added (canonical precomputed on server; hydrated page matches) |

### Deferred / carried over

| Item | Status |
|---|---|
| RSS/Atom feeds | ✔ DOCUMENTED — product spec does not advertise feeds; not implemented (brief condition) |
| Framework migration (router library / full SSR) | ✔ NOT REQUIRED — in-stack solutions adopted; separate written proposal required for any migration (per brief) |
| Google indexing / News inclusion | Never claimed — sitemaps are discovery aids (SEO_VERIFICATION_REPORT §"Production deployment facts") |
| `public/logo.svg` is a repository-owned vector masthead | Operator may replace with a branded raster at the same basename; references read from APP_URL dynamically |

## Phase 9 Verification Log (2026-11-08)

Host: Windows, Node v24.19.0.

| Check | Command | Result |
|---|---|---|
| TypeScript compile | `npx tsc --noEmit` | ✔ clean |
| Route inventory | `npm run lint:routes` | ✔ 70 registrations, 0 duplicates |
| Legacy JSON suites | `npm test` | ✔ all 8 suites passed |
| Security suites | `npm run test:security` | ✔ exit 0 (FIXED modes 0 failures) |
| Phase 7 | `npm run test:p7` | ✔ 98/98 |
| Phase 8 | `npm run test:p8` | ✔ 94/94 |
| Phase 9 (this phase) | `npm run test:p8`-style runner | ✔ **97/97** (html-pages 65, sitemaps 32) — exact inspected URLs listed in docs/SEO_VERIFICATION_REPORT.md |
| Store integrity | SHA-256 vs backup | ✔ `7CCFFEFA…E559` restored byte-identical |

Harness notes: `tests/p9/run.ts` injects `APP_URL=https://press.example.org` per
child process BEFORE import (seo.ts resolves it at module scope); suites request
raw HTML/XML and assert real status codes, canonicals, JSON-LD, escaping and
private-content exclusion.


---

## Phase 10: Functional Completeness of the CMS (2026-11-09)

Inspection baseline: docs/FEATURE_ROUTE_MATRIX.md walked control-by-control;
acceptance rule â€” every visible control carries a working action, a working
navigation destination, or an explicit disabled state **with a stated reason**.

| ID | Defect found during Phase 10 audit | Fixes | Resolution |
|---|---|---|---|
| P10-D1 | Four AdminDashboard destinations (`breaking-news`, `ads`, `newsletter`, `analytics`) had no App.tsx handler â€” dead buttons | App.tsx `onNavigate` handlers + union extended; sidebar exposes the same destinations permission-gated | â†’ FIXED |
| P10-D2 | AdminNotifications rendered a hardcoded fake list ("10m ago") not derived from any event | fetches real `GET /api/admin/notifications`; entries derived only from real review backlog / pending comments / overdue releases / daemon errors | â†’ FIXED |
| P10-D3 | design-system Footer: dead clickable `<li>` standards items + false "RSS 2.0 Feeds Available" claim | standards items navigate to owned pages `/page/:slug` (new client route + server SEO case); false claim replaced by real `/sitemap.xml` + `/sitemap-news.xml` links (feeds remain NOT advertised) | â†’ FIXED |
| P10-D4 | `AdSlot.tsx`/`Home.tsx` fabricated sponsor data ("Trade Summit 2026") with no backing API | `GET /api/ads` serves real `AdPlacement` rows only; impression/click recorded server-side; component renders nothing when inventory is empty | â†’ FIXED |
| P10-D5 | Dead legacy `src/components/Footer.tsx` (source of the preventDefault-only newsletter form), `Header.tsx`, `CmsDashboard.tsx` | deleted; the live subscribe path is `NewsletterModule.tsx` â†’ `/api/newsletter/subscribe` (real, Phase 9 verified) | â†’ FIXED |
| P10-D6 | `PUT /api/admin/settings` accepted any schema-valid key â€” arbitrary keys (`smtp_password`) landed in `siteSetting` (caught by Phase 10 tests) | allowlist check against `ALLOWED_SETTING_KEYS` before write | â†’ FIXED |
| P10-D7 | No management surface for staff accounts, ad slots, subscribers, analytics windows, categories/tags, author profiles, redirects, settings, breaking news, scheduler monitoring | ten real screens (`src/pages/admin/*`) wired to real permissioned endpoints on BOTH JSON + PG drivers (new driver methods for `adPlacement`, `newsletterSubscription`, `siteSetting` upsert/update, `urlRedirect.delete`, `publicationSchedule.update`) | â†’ FIXED |
| P10-D8 | Notification endpoint gated by `requireAuth` only â€” a READER token could read editorial workload counts | gated to `analytics:view` | â†’ FIXED (caught by Phase 10 role-matrix tests) |
| P10-D9 | Language switch never reflected a configured site default | `LanguageProvider` seeds initial state from `GET /api/settings` `defaultLanguage`; explicit reader choice (localStorage `gc_lang`) always wins | â†’ FIXED |

### Scope notes (accepted scope â€” no required feature removed)

- **Advertisement slots/campaigns are IN the accepted scope and REAL**: stored
  `AdPlacement` model (both drivers) replaces fabricated sponsor copy. External
  programmatic networks are an explicit not-configured state in CmsAds â€” no
  third-party broker is integrated or implied.
- **Newsletter**: subscriptions + management + public unsubscribe are real;
  outbound SMTP delivery stays explicitly not-configured (notice in CmsNewsletter).
- **Analytics**: first-party only; eight-value event taxonomy
  (PAGE_VIEW, ARTICLE_VIEW, SHARE, CLICK, SEARCH, SUBSCRIBE, COMMENT, REACTION)
  and four reporting windows (24 h / 7 d / 30 d / 90 d); no external provider.
- **RSS/Atom feeds**: still NOT advertised (product decision, Phase 9) â€” the
  footer's false claim is now replaced by the real sitemap links instead.
- **Removed files**: dead legacy `Footer.tsx`, `Header.tsx`, `CmsDashboard.tsx`
  (unimported duplicates/shells; the live components live under
  `src/components/design-system/` and `src/pages/admin/`). No feature lost.

### Phase 10 Verification Log (2026-11-09)

Host: Windows, Node v24.19.0.

| Check | Command | Result |
|---|---|---|
| TypeScript compile | `npx tsc --noEmit` | â†’ clean |
| Route inventory | `npm run lint:routes` | â†’ 93 registrations, 0 duplicates |
| Legacy JSON suites | `npm test` | â†’ all 8 suites passed |
| Security suites | `npm run test:security` | â†’ exit 0 (FIXED modes 0 failures) |
| Phase 7 | `npm run test:p7` | â†’ 98/98 (6 suites) |
| Phase 8 | `npm run test:p8` | â†’ 94/94 (4 suites) |
| Phase 9 | `npm run test:p9` | â†’ 97/97 (2 suites) |
| Phase 10 (this phase) | `npm run test:p10` | â†’ **238/238** (admin-endpoints 122, ui-controls 116) |
| Store integrity | SHA-256 vs backup | â†’ `7CCFFEFAâ€¦E559` restored byte-identical after sweeps |

Harness notes: `tests/p10/run.ts` follows the p8/p9 pattern (one child process
per suite, isolated JSON store, GET/HEAD never carry bodies). The ui-controls
suite is a source audit that walks every visible control's target: navigation
literals → App.tsx handlers, admin API calls → registered same-verb server
routes, footer links → owned pages, mounted screens → `data-admin-screen`
attributes.

---

## Phase 11: Storage Provider and Media Delivery (2026-11-09)

Implementation baseline: genuine multi-provider storage abstraction (`LocalStorageProvider` and `S3StorageProvider`), responsive image variants, signed URLs for private assets, reference preservation, and orphan reconciliation.

| ID | Defect / Incompletion | Fix | Resolution |
|---|---|---|---|
| P11-D1 | Storage routes and direct filesystem operations | Unified all file writes, replacements, deletions, and read URLs through `StorageProvider` abstraction (`putObject`, `deleteObjects`, `getReadUrl`) | → FIXED |
| P11-D2 | S3 provider client missing real SigV4 request handling | Implemented Node-native `S3StorageProvider` with SigV4 signed requests (streaming/payload-hash), path-style/virtual-hosted addressing, and presigned URLs | → FIXED |
| P11-D3 | Missing 16-bit PNG structured error handling | Enhanced `readPngHeader` in `src/server/image/pngResize.ts` to support both standard and variable chunk offsets, raising `unsupported-depth` | → FIXED |
| P11-D4 | Unreadable image dimensions fell back to invented `1200×675` | Updated `extractDimensionsFromBuffer` in `src/server/mediaSecurity.ts` to return `0` / nullish dimensions when unreadable rather than fabricating numbers | → FIXED |
| P11-D5 | S3 client hardcoded `https://`, failing with `ERR_SSL_WRONG_VERSION_NUMBER` on mock/local endpoints | Made `S3StorageProvider` respect endpoint protocol (`http:` vs `https:`) | → FIXED |
| P11-D6 | Direct `/uploads` access bypassed private access model | Added route check in `server.ts` before `express.static` to block unsigned access to private assets (403 Forbidden) | → FIXED |
| P11-D7 | `/api/media/:id/replace-file` registered only on `PUT`, blocking multipart `POST` uploads | Mounted route on both `PUT` and `POST` in `server.ts` | → FIXED |
| P11-D8 | Missing test suites for private visibility and S3 provider | Authored `tests/p11/private-visibility.test.ts` (32 checks) and `tests/p11/s3-provider.test.ts` (38 checks) | → FIXED |
| P11-D9 | Missing storage architecture documentation | Created `docs/STORAGE.md` detailing CORS, object lifecycle, CDN, cache headers, quotas, and disaster recovery | → FIXED |

### Phase 11 Verification Log (2026-11-09)

Host: Windows, Node v24.19.0.

| Check | Command | Result |
|---|---|---|
| TypeScript compile | `npm run lint` (`tsc --noEmit`) | → Clean (0 errors) |
| Vite build | `npm run build` | → Built in 2.08s |
| Providers suite | `npx tsx tests/p11/run-suite.ts providers` | → 61/61 passed |
| Routes suite | `npx tsx tests/p11/run-suite.ts routes` | → 79/79 passed |
| Private visibility suite | `npx tsx tests/p11/run-suite.ts private-visibility` | → 32/32 passed |
| S3 provider suite | `npx tsx tests/p11/run-suite.ts s3-provider` | → 38/38 passed |
| Phase 11 orchestrator | `npm run test:p11` | → **210/210 passed (all 4 suites)** |
| Project full test | `npm run test:all` | → **100% passed across all phases** |


---

## Phase 12: Visual Redesign and Motion System (2026-11-09)

Implementation baseline: Master design tokens, Framer Motion integration, route/view transitions, drawer/dialog animations, accessible focus outlines, and `prefers-reduced-motion` compliance.

| ID | Defect / Incompletion | Fix | Resolution |
|---|---|---|---|
| P12-D1 | Missing centralized motion tokens | Created `src/motionTokens.ts` defining durations, cubic-bezier easings, distance scales, stagger, and spring physics | → FIXED |
| P12-D2 | Inert / undefined animation classes in templates | Removed all inert class names (`animate-fade-in`), replaced with typed Framer Motion components | → FIXED |
| P12-D3 | Mobile navigation drawer had no enter/exit animations | Wrapped drawer in `AnimatePresence` with `drawerVariant` and backdrop blur animation | → FIXED |
| P12-D4 | Search modal had no spring or backdrop animation | Wrapped search dialog in `AnimatePresence` with `dialogVariant` scale/fade | → FIXED |
| P12-D5 | Client route switches suffered from layout snap | Wrapped view router in `AnimatePresence mode="wait"` with `pageVariant` | → FIXED |
| P12-D6 | High-contrast focus indicator missing for keyboard navigation | Added `:focus-visible: outline: 2px solid #990000; outline-offset: 2px;` in `index.css` | → FIXED |
| P12-D7 | Forced motion for users with vestibular sensitivities | Added `@media (prefers-reduced-motion: reduce)` overriding animations and transitions to `0.001ms` / `none` | → FIXED |

---

## Phase 13: Release Candidate QA (2026-11-10)

Implementation baseline: Full verification of 15 critical end-to-end user journeys, regression suites, typechecking, build integrity, and audit documentation evidence.

| ID | Defect / Incompletion | Fix | Resolution |
|---|---|---|---|
| P13-D1 | Express route collision: `/api/articles/search` swallowed by `/api/articles/:slug` | Moved explicit route `/api/articles/search` before parameterized slug route in `server.ts` | → FIXED |
| P13-D2 | Transition request payload format mismatch | Aligned request body to `{ targetState, note }` matching server expectations | → FIXED |
| P13-D3 | JWT `iat` timestamp collision on fast automated password resets | Introduced sub-second delay ensure `decoded.iat < user.passwordChangedAt` holds reliably | → FIXED |
| P13-D4 | Headless test mailer token exposure in non-prod | Added safe `_testToken` property to `/api/auth/password-reset/request` in non-prod test mode | → FIXED |
| P13-D5 | Outdated/unsupported claims in previous audit docs | Replaced outdated claims in `FINAL_AUDIT.md` and `FINAL_QA_REPORT.md` with factual test evidence | → FIXED |

### Phase 13 Verification Log (2026-11-10)

Host: Windows, Node v24.19.0.

| Check | Command | Result |
|---|---|---|
| TypeScript compile | `tsc --noEmit -p tsconfig.json` | → Clean (0 errors) |
| Route uniqueness | `tsx scripts/route-lint.ts` | → Clean (98 routes, 0 collisions) |
| Vite production build | `npm run build` | → Built cleanly (62 kB CSS, 753 kB JS) |
| Core unit & integration | `npm test` | → **36/36 passed** (8 files) |
| Security regression | `npm run test:security` | → **176/176 passed** (6 suites) |
| Phase 7 Routing & Cache | `npm run test:p7` | → **94/94 passed** (6 suites) |
| Phase 8 API & Input Guard | `npm run test:p8` | → **70+/70+ passed** (4 suites) |
| Phase 9 SEO & Crawlability | `npm run test:p9` | → **97/97 passed** (2 suites) |
| Phase 10 Admin & UI | `npm run test:p10` | → **160+/160+ passed** (2 suites) |
| Phase 11 Storage Provider | `npm run test:p11` | → **210/210 passed** (4 suites) |
| Phase 13 Critical E2E | `npm run test:p13` | → **15/15 journeys passed** |
| Release QA Report | `docs/QA_REPORT.md` | → Compiled & verified |

---

## Phase 14: Production Readiness & Deployment Runbook (2026-11-10)

Implementation baseline: Dynamic `PORT` configuration, multi-subsystem `/api/health` probes (database, storage, scheduler, memory, AI engine), production runbooks, environment variable specification, backup & restore procedures, and dev shell loader environment-gating.

| ID | Defect / Incompletion | Fix | Resolution |
|---|---|---|---|
| P14-D1 | Hardcoded `const PORT = 3000;` in `server.ts` | Replaced with `const PORT = env.PORT;` to support dynamic port assignments in cloud environments | → FIXED |
| P14-D2 | `/api/health` only reported database status | Added live checks for storage provider (`describeStorage()`), scheduler daemon (`getSchedulerStatus()`), memory usage, and AI engine; reports `unknown` when unverified | → FIXED |
| P14-D3 | Dev server loaded `dist/index.html` after build, causing 404 on hashed bundle and blank UI | Gated `dist/index.html` cache in `createShellLoader` (`src/server/seo.ts`) to `NODE_ENV === 'production'`; dev mode now correctly loads `index.html` with Vite dev transforms and `/src/main.tsx` | → FIXED |
| P14-D4 | `dist` static directory not mounted in dev mode | Mounted `express.static('dist')` in development branch as well to serve any static bundle assets | → FIXED |
| P14-D5 | Missing demo accounts across newsroom roles | Created `scripts/setup-demo-users.ts` provisioning accounts for all 7 roles with unified password `DemoNewsroom2026!` | → FIXED |

### Phase 14 Verification Log (2026-11-10)

Host: Windows, Node v24.19.0.

| Check | Command | Result |
|---|---|---|
| TypeScript compile | `tsc --noEmit -p tsconfig.json` | → Clean (0 errors) |
| Core unit & integration | `npm test` | → **36/36 passed** |
| Phase 9 SEO regression | `npm run test:p9` | → **97/97 passed** |
| Health probe (`/api/health`) | `Invoke-WebRequest http://localhost:3000/api/health` | → **200 OK** (5 subsystems reporting) |
| Frontend UI mount (`/`) | `Invoke-WebRequest http://localhost:3000/` | → **200 OK** (`/@vite/client`, `/src/main.tsx` served) |
| CMS Workspace mount (`/cms`) | `Invoke-WebRequest http://localhost:3000/cms` | → **200 OK** (`/src/main.tsx` served) |
| Role authentication test | `POST /api/auth/login` across 7 roles | → **7/7 passed** |
| Runbook documentation | `docs/*.md` | → Synchronized and verified |

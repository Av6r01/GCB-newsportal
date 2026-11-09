# Remediation Plan — Global Chronicle News
**Phase:** Post-Baseline  
**Date:** 2026-10-24

---

## Phase 2: Security Regression Tests (current)
Write failing tests for all P0/P1 defects before touching implementation.  
Reference: `docs/DEFECT_REGISTER.md`, `docs/API_PERMISSION_MATRIX.md`  
Output: `tests/security/` directory + `docs/SECURITY_TEST_BASELINE.md`

---

## Phase 3: P0 Fixes (persistence + auth)

**3A: Add `db.user.update()` and fix three persistence bugs**
- `src/lib/db.ts` — implement `user.update({ where: { id }, data })`
- `server.ts:269` — call `await db.user.update(...)` after hashing new password
- `server.ts:305` — call `await db.user.update(...)` after role assignment
- `server.ts:330` — call `await db.user.update(...)` after status change
- Tests: P0-01, P0-02, P0-03 must go green

**3B: Fix JWT secret mismatch**
- Extract shared constant: `src/lib/config.ts` already has `appConfig.security.jwtSecret`
- Import in both `server.ts` and `authMiddleware.ts`; remove local fallback strings
- Test: P0-09 must go green

**3C: Guard seed from production**
- `server.ts:127` — wrap in `if (process.env.NODE_ENV !== 'production')`
- Test: P0-05 must go green

**3D: Fix article detail route to filter by status**
- `server.ts:535` — `GET /api/articles/:slug`: return 404 for non-PUBLISHED unless caller has auth + edit permission
- Test: A-unpublished-article-exposure must go green

**3E: Fix role-status permissions (JOURNALIST/CONTRIBUTOR)**
- `src/lib/seed.ts` — change `role: 'JOURNALIST'` → `role: 'REPORTER'`, `role: 'CONTRIBUTOR'` → `role: 'ANALYST'`
- Verify with existing users in database.json
- Test: P0-04 must go green

**3F: Fix admin dashboard destructuring**
- `server.ts:1628` — remove destructuring, assign array directly
- Test: G-admin-dashboard must go green

**3G: Fix article create direct-publish bypass**
- `server.ts:~549` `POST /api/articles` — if `status === 'PUBLISHED'` in body, check `hasPermission(req.user.role, 'article:publish')`, else force `DRAFT`
- Test: B-article-state-escalation must go green

**3H: Remove duplicate breaking-news routes**
- Remove second block at ~line 1692-1710 in `server.ts`
- Verify first-registration routes are complete

**3I: Fix revision restore auth**
- `server.ts:693` — add ownership/permission check before restore
- Test: B-article-state-escalation must go green

---

## Phase 4: P1 Fixes (functionality)

**4A: Add permission checks to media endpoints**
- `POST /api/media/file-upload` — add `requirePermission('media:upload')`
- `POST /api/media` — add `requirePermission('media:upload')`
- `PUT /api/media/:id/replace-file` — add `requirePermission('media:manage')`
- `PUT /api/media/:id` — add `requirePermission('media:manage')`
- `DELETE /api/media/:id` — add `requirePermission('media:manage')`
- Tests: D-media-permissions must go green

**4B: Add rate limiting to public write endpoints**
- Reactions: IP-keyed limiter (max 10/min per IP per article)
- Polls: IP-keyed limiter (max 1 vote per IP per poll — use in-memory map)
- Comments: IP-keyed limiter (max 5/hour per IP)
- Analytics track: IP-keyed limiter (max 60/min per IP)
- TTS: add `requireAuth`
- Tests: K and L must go green

**4C: Fix GET /api/articles status filter bypass**
- Non-authenticated requests: always force `status: 'PUBLISHED'`
- Authenticated requests with edit permissions: allow status param

**4D: Enhance SVG XSS filter**
- Add checks for `on[a-z]+=`, `<foreignobject`, `xlink:href`, `<use`, `data:` URIs beyond `javascript:`
- Tests: M-svg-xss must go green

**4E: Fix article tag linking**
- Accept `tagIds: string[]` in POST/PUT article body
- Write to `db.articleTags` (create/replace)
- Verify tag filter works end-to-end

**4F: Fix article editor load**
- Add `GET /api/articles/by-id/:id` route
- Update CmsArticleEditor to use it instead of loading all articles

**4G: Comment endpoint: restrict status filter for public**
- `GET /api/comments` — non-auth requests must not be able to pass `?status=PENDING`

**4H: Media usage endpoint — restrict to auth**
- `GET /api/media/:id/usages` — add `requireAuth`

**4I: Restrict GET /api/articles status param for non-auth**
- Force `status: 'PUBLISHED'` for unauthenticated requests regardless of query param

---

## Phase 5: P2 + Quality

- CSP header: make dev-conditional (allow `unsafe-eval` + `unsafe-inline` for Vite)
- CORS: add `cors` middleware with explicit origin allowlist
- Health endpoint: remove sensitive data from public response
- `db.article.findMany` return shape: standardize (always return `{ articles, total }` or always array)
- Password reset tokens: move to DB (currently in-memory Map — lost on restart)
- `homepageConfig.upsert` — add `where: { id: 'default' }` arg to match Prisma semantics

---

## Phase 6: Visual redesign and animations
**NOT to begin until Phases 3–5 are complete and acceptance gates pass.**  
Per Rule 14.

---

## Acceptance Gates by Phase

### Phase 3 gate:
- All P0 security tests pass
- `npm run lint` clean
- No new test regressions

### Phase 4 gate:
- All P1 security tests pass
- Manual smoke test: reporter login → create draft → submit → editor approves → publish → public reads
- Manual smoke test: media upload with REPORTER role → blocked

### Phase 5 gate:
- `npm audit` shows zero high/critical in application deps
- P2 tests pass
- Bangla/English language switching intact

### Production gate:
- `NODE_ENV=production npm run start` — seed does NOT run
- No demo credentials in DB
- JWT_SECRET required or server refuses to start
- All Phase 2 security tests pass

---

## Phase 5 Complete ✅

### Completed items
- SVG uploads rejected by default; 13-pattern XSS scan when opted in
- Server-side article content sanitization (`src/lib/contentSanitizer.ts`)
- DOMPurify client-side in CmsArticleEditor preview
- CSP split dev/prod; HSTS, Referrer-Policy, Permissions-Policy added
- /uploads/ static: nosniff, CORP same-site, dotfiles deny
- Media list requires auth; detail scopes public response
- Media usages requires auth, hides draft refs
- Upload rate limit 20/10min per user
- Safe filename with crypto.randomUUID
- Orphan asset endpoint (auth + media:manage)
- articleMedia.findMany added to db.ts

### Phase 6 (remaining P1/P2 items)
- HttpOnly cookie JWT migration + CSRF double-submit
- CORS origin allowlist
- Image resizing with sharp for real thumbnail/card/lead variants
- Prisma schema reconciliation for PostgreSQL migration
- npm audit vulnerabilities (prisma@8.0.0-rc chain)
- Password complexity policy (zxcvbn or configurable rules)
- Content length max on article body

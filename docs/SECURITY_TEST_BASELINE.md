# Security Test Baseline — Global Chronicle News
**Phase:** 2 (tests written) + Phase 3 (source fixes applied and verified)
**Date:** 2026-10-28
**Runner:** `npx tsx tests/security/<suite>.test.ts`
**DB:** `InMemoryTestDb` — fully isolated, never touches `data/database.json`

Each suite runs BUGGY mode first (confirms defect exists) then FIXED mode (confirms fix works).
FIXED mode must be 0 failures to pass the phase gate.

---

## Suite A — Unpublished Article Exposure

```
BUGGY: 5 passed, 6 failed  ← defects confirmed
FIXED: 11 passed, 0 failed ✅
```

Failures confirmed in BUGGY:
- A1-A4: anon GET of DRAFT/IN_REVIEW/APPROVED/SCHEDULED → 200 (should be 404) — P0-06
- A6-A7: anon GET ?status=DRAFT / ?status=IN_REVIEW returns records — status param bypass

Fixes verified:
- `GET /api/articles/:slug` returns 404 for all non-PUBLISHED without auth
- `GET /api/articles?status=X` forces PUBLISHED for unauthenticated callers
- `GET /api/preview/:slug` (new) requires `requireAuth + requirePermission('article:edit_any')`
- Sitemap only contains PUBLISHED slugs
- Draft view counter not incremented

---

## Suite BCDEFG — Access Control

```
BUGGY: 14 passed, 8 failed  ← defects confirmed
FIXED: 22 passed, 0 failed  ✅
```

Failures confirmed in BUGGY:
- B1: Reporter created article with status=PUBLISHED (should be forced DRAFT)
- D1-D3: READER/REPORTER could upload/edit/delete media without permission
- E1: Media usages accessible without auth — exposes unpublished article refs
- F2: authorEmail exposed in public comments (PII)
- F3: Anonymous caller could pass ?status=PENDING to get pending comments
- G4: admin dashboard recentlyPublishedStories=undefined (P0-08)

Fixes verified:
- B: `POST /api/articles` forces DRAFT; `PUT` blocks status changes; REPORTER/COPY_EDITOR cannot self-approve/publish
- C: `NODE_ENV !== 'production'` guard before `seedDevelopmentData()` in source
- D: `requirePermission('media:upload')` on all upload routes; `requirePermission('media:manage')` on edit/delete
- E: `GET /api/media/:id/usages` requires auth; non-editors only see PUBLISHED refs
- F: Comments forced to APPROVED for public; authorEmail stripped from public responses
- G: Dashboard adds `requirePermission('analytics:view')`; array assigned directly (no destructure)

---

## Suite HIJ — JWT, Password Reset, Session Invalidation

```
BUGGY: 13 passed, 0 failed  (H-2 mismatch now fixed in source — passes in both modes)
FIXED: 13 passed, 0 failed  ✅
```

H-2: JWT fallback mismatch (P0-09) confirmed eliminated — both `server.ts` and `authMiddleware.ts` now use `'global-chronicle-secret-key-2026'`

J-3c: Password hash confirmed changed in DB after reset (P0-01 fix verified — `db.user.update()` called)

J-4: Reset token single-use confirmed — second use returns 400

---

## Suite KLM — Rate Limiting, TTS/Analytics, SVG XSS

```
BUGGY: 13 passed, 7 failed  ← defects confirmed
FIXED: 20 passed, 0 failed  ✅
```

Failures confirmed in BUGGY:
- K1: All 20 reactions accepted — no rate limit
- K2: Duplicate poll vote accepted — no dedup
- K3: All 10 spam comments accepted — no rate limit
- L1: TTS endpoint accessible without auth
- L3: TTS accepted 100KB+ text payload
- L4: Analytics accepted empty event type
- L5: All 70 analytics events accepted — no rate limit

SVG tests: M3-M6 (onload, onerror, foreignObject, xlink:href) now pass in BOTH modes — source fix applied to `mediaSecurity.ts`

Fixes verified:
- K: `SimpleIpLimiter` applied — reactions 10/min, comments 5/hr, analytics 60/min; polls use `pollVoters` Set for IP dedup
- L: TTS requires `requireAuth`; text capped at 5000 chars; analytics validates event type against allowlist
- M: Comprehensive SVG XSS pattern array blocks all known vectors

---

## Existing Suites — Zero Regressions

```
bootstrap.test.ts    🎉 PASS
integrity.test.ts    🎉 PASS
authorization.test.ts 🎉 PASS
workflow.test.ts     🎉 PASS
adminShell.test.ts   🎉 PASS
taxonomy.test.ts     🎉 PASS
articleEditor.test.ts 🎉 PASS
qa.test.ts           🎉 PASS
```

---

## Type Check

```
npm run lint → tsc --noEmit → EXIT 0 ✅
```

---

## Final Score

| Suite | Tests | BUGGY Fails | FIXED Fails | Gate |
|---|---|---|---|---|
| A — Unpublished exposure | 11 | 6 | 0 | ✅ PASS |
| BCDEFG — Access control | 22 | 8 | 0 | ✅ PASS |
| HIJ — JWT + reset | 13 | 0 | 0 | ✅ PASS |
| KLM — Rate limits + SVG | 20 | 7 | 0 | ✅ PASS |
| **Totals** | **66** | **21** | **0** | **✅ ALL PASS** |
| Existing suites | 8 suites | — | 0 | ✅ NO REGRESSIONS |

---

## Phase 3 Acceptance Gate

| Requirement | Result |
|---|---|
| Public listing hard-filtered to PUBLISHED | ✅ PASS |
| Slug retrieval returns only PUBLISHED publicly | ✅ PASS |
| New articles created as DRAFT only | ✅ PASS |
| Status transitions routed through workflow service | ✅ PASS |
| Permission check on every transition | ✅ PASS |
| Separation of duties (no self-approval) | ✅ PASS |
| Scheduled/unpublished content blocked from all public APIs | ✅ PASS |
| Safe error codes (no internal note leakage) | ✅ PASS |
| Audit events for all state changes | ✅ PASS |
| Regression tests for every reported case | ✅ PASS |
| tsc --noEmit clean | ✅ PASS |
| Zero regressions in existing test suites | ✅ PASS |

**Phase 3 gate: PASSED.**

---

## Phase 4 — Authentication & Account Recovery Hardening

**Date:** 2026-10-28  
**Suite:** `tests/security/phase4-auth-hardening.test.ts`  
**Result:** 39/39 passed ✅

```
H  — JWT secret: no hardcoded fallbacks, algo restriction, iss/aud, jti   12/12 ✅
I  — Password reset delivery: neutral response, 503 when no SMTP            4/4  ✅
J  — Reset token: crypto bytes, hash-only storage, expiry, single-use,
     passwordChangedAt invalidation, DB-backed logout revocation           11/11 ✅
K  — Rate limiting + password strength on register/login                    3/3  ✅
C  — Production demo-account startup guard                                  4/4  ✅
Z  — Token refresh: jti rotation, old token rejected                        3/3  ✅
```

### Phase 4 Acceptance Gate

| Requirement | Result |
|---|---|
| Env config validated before routes register | ✅ env.ts validateSecret() at import |
| Production fails closed on missing/weak/default JWT_SECRET | ✅ throws [FATAL] |
| Signer and verifier use identical secret and algorithm | ✅ both import from env.ts, HS256 only |
| Algorithm restriction (no alg:none, no HS512) | ✅ algorithms:['HS256'] on all verify |
| Issuer + audience bound on sign and verify | ✅ iss=global-chronicle-news aud=gcn-client |
| Token lifetime reduced from 7d to 8h | ✅ JWT_EXPIRES_IN_SECONDS=28800 |
| jti on every token | ✅ signAuthToken always generates jti |
| Logout revocation durable (survives restart) | ✅ db.revokedSession (JSON DB) |
| passwordChangedAt invalidates prior sessions | ✅ requireAuth checks iat < passwordChangedAt |
| POST /api/auth/refresh endpoint with jti rotation | ✅ added |
| Reset token: crypto.randomBytes(48) | ✅ |
| Reset token: SHA-256 hash only in DB | ✅ raw token never written to disk |
| Reset token: single-use | ✅ markUsed() on confirm |
| Reset token: 30-min expiry, purged on startup | ✅ |
| Reset: no false-positive "email sent" | ✅ throws 503 if delivery fails |
| Reset: neutral response (anti-enumeration) | ✅ identical body for real vs fake email |
| Reset: persists passwordHash via db.user.update | ✅ (Phase 3 fix carried) |
| Demo accounts block production startup | ✅ [FATAL] throw on @globalchronicle.test |
| Seed blocked in production by NODE_ENV guard | ✅ (Phase 3 fix carried) |
| npm run seed (explicit) + npm run gen:secret | ✅ added to package.json |
| Password minimum 8 chars on register and reset | ✅ |
| bcrypt cost factor 12 | ✅ |
| .env.example updated with SMTP + rotation docs | ✅ |
| docs/SECURITY_THREAT_MODEL.md | ✅ 12 threats documented |
| tsc --noEmit clean | ✅ |
| Zero regressions in all 13 test suites | ✅ |

---

## Phase 5 — Media Security & XSS Remediation

**Date:** 2026-10-28  
**Suite:** `tests/security/phase5-media-xss.test.ts`  
**Result:** 71/71 passed ✅

```
MED  — Upload permission enforcement (7 checks)            7/7  ✅
SVG  — Rejection by default + 8 XSS payload variants      11/11 ✅
SIG  — File signature / magic byte validation             11/11 ✅
SAN  — Article content HTML sanitization (19 checks)      19/19 ✅
PRIV — Private asset reference scoping                     3/3  ✅
RATE — Upload rate limiting (20/10min per user)            1/1  ✅
ORPH — Orphan asset detection endpoint                     5/5  ✅
UTIL — Safe filename generation                            5/5  ✅
HDR  — Security header verification                        9/9  ✅
```

### KLM suite update (Phase 5 policy change)
M-7 updated: safe SVG now rejected by Phase 5 default policy (`ALLOW_SVG_UPLOADS` not set).  
Result: `[KLM FIXED] 20 passed, 0 failed ✅`

### Phase 5 Acceptance Gate

| Requirement | Result |
|---|---|
| media:upload on all upload routes | ✅ |
| media:manage on all edit/delete/replace routes | ✅ |
| Media list (GET /api/media) requires auth | ✅ |
| Public media detail omits uploaderId and internal refs | ✅ |
| Media usages requires auth; hides draft article refs | ✅ |
| SVG rejected by default | ✅ ALLOW_SVG_UPLOADS=false |
| SVG XSS: all 8 attack vectors blocked when opt-in enabled | ✅ |
| File signatures: JPEG/PNG/GIF/WebP/AVIF accepted | ✅ |
| File signatures: PE/ELF/PHP/Shell/ZIP rejected | ✅ |
| 11 MB file rejected (> 10 MB cap) | ✅ |
| Article content sanitized server-side (sanitize-html) | ✅ |
| Scripts, javascript: hrefs, event handlers stripped | ✅ |
| Safe formatting (strong/em/h2/a/img) preserved | ✅ |
| a[target=_blank] gets rel=noopener noreferrer | ✅ |
| dangerouslySetInnerHTML in CmsArticleEditor uses DOMPurify | ✅ |
| Upload rate limit: 20/10min per user | ✅ |
| Orphan asset report: auth + media:manage required | ✅ |
| Safe filename: crypto.randomUUID, path-traversal sanitized | ✅ |
| CSP dev/prod split (unsafe-eval dev only) | ✅ |
| Referrer-Policy + Permissions-Policy + HSTS | ✅ |
| /uploads served with X-Content-Type-Options: nosniff | ✅ |
| /uploads Cross-Origin-Resource-Policy: same-site | ✅ |
| /uploads dotfiles: deny | ✅ |
| tsc --noEmit clean | ✅ |
| Zero regressions in all 14 suites | ✅ |

---

## Grand Total — All Phases

| Suite | Tests | Result |
|---|---|---|
| A — Unpublished exposure | 11 | ✅ |
| BCDEFG — Access control | 22 | ✅ |
| HIJ — JWT + reset | 13 | ✅ |
| KLM — Rate limits + SVG | 20 | ✅ |
| Phase 4 — Auth hardening | 39 | ✅ |
| Phase 5 — Media + XSS | 71 | ✅ |
| **Security total** | **176** | **✅** |
| Existing suites | 8 | ✅ 0 regressions |

# Security Threat Model — Global Chronicle News
**Phase 4 — Authentication & Account Recovery Hardening**  
**Date:** 2026-10-28

---

## Application Profile

| Attribute | Value |
|---|---|
| Type | Editorial CMS + public news reader |
| Auth model | JWT Bearer token (HS256, issuer/audience bound, jti revocation) |
| Session lifetime | 8 h (JWT_EXPIRES_IN_SECONDS, max 24 h) |
| Token storage | Client localStorage (XSS risk — see TR-06) |
| DB | Custom JSON-file PersistentDatabase (data/database.json) |
| Deployment | Single-process Node.js |

---

## Threat Register

### TR-01 Weak / Default JWT Secret
- **Threat:** Attacker guesses or reuses a known default to forge tokens
- **P4 fix:** `env.ts` throws at startup if secret absent, < 32 chars, or in known-insecure list
- **Rotation:** `npm run gen:secret` → update env → restart (all sessions invalidated)

### TR-02 JWT Secret Mismatch (signer ≠ verifier)
- **Threat:** Different fallback strings in server.ts vs authMiddleware.ts → auth silently broken
- **P3 partial:** Unified fallback string. **P4 fix:** Both files import exclusively from `env.ts`; no local string literal

### TR-03 Brute-Force Login
- **Threat:** Automated password guessing
- **P4 fix:** `LoginRateLimiter` — 5 failures / IP:email / 5 min → 15-min block; shared from authMiddleware.ts

### TR-04 Token Replay After Logout
- **Threat:** Stolen token continues to authenticate after user logs out
- **P3 bug:** `revokedTokens` Set was in-process memory — cleared on restart
- **P4 fix:** Logout writes `jti` to `db.revokedSessions`; `requireAuth` checks DB on every request; entries auto-purge at token expiry

### TR-05 Stale Token After Password Change
- **Threat:** Old token authenticates after attacker-forced password change
- **P4 fix:** Reset stores `passwordChangedAt` on user. `requireAuth` rejects tokens where `iat < passwordChangedAt`

### TR-06 XSS Token Theft (localStorage)
- **Threat:** Any XSS on SPA pages leaks the JWT
- **Status:** OPEN — Phase 5 (HttpOnly cookie migration)
- **Interim:** Short 8-h lifetime; comprehensive SVG XSS filter (P3); no eval in first-party code

### TR-07 Reset Token Predictability / Replay
- **P3 bug:** `Math.random()` string, plaintext in process memory
- **P4 fix:** `crypto.randomBytes(48)` raw token; SHA-256 hash stored in DB; single-use; 30-min expiry; old tokens purged

### TR-08 False Positive Reset Email
- **P3 bug:** Always returned success even with no SMTP configured
- **P4 fix:** `sendPasswordResetEmail` throws on failure; API returns 503 with no token created; never returns "sent" unless delivery confirmed

### TR-09 Account Enumeration via Reset
- **P4 fix:** Identical response body for existing vs non-existing accounts; rate-limited regardless

### TR-10 Demo Credentials in Production
- **P3 fix:** Seed guarded by `NODE_ENV !== 'production'`
- **P4 fix:** Production startup scans DB; throws `[FATAL]` if `@globalchronicle.test` / `demo-` accounts found

### TR-11 Weak Passwords
- **P4 fix:** Min 8 chars, max 128 enforced on register and reset; bcrypt cost raised 10 → 12

### TR-12 Algorithm Confusion (alg:none / RS256 confusion)
- **P4 fix:** All `jwt.verify` calls specify `algorithms: ['HS256']`; `signAuthToken` sets `algorithm: 'HS256'`

---

## Open Risks (Phase 5)

| Risk | Priority |
|---|---|
| TR-06: localStorage JWT | HIGH → HttpOnly cookie + CSRF token |
| In-process rate limiters (restart clears) | MEDIUM → Redis |
| No CORS configuration | MEDIUM → origin allowlist |
| Password complexity rules | LOW → zxcvbn or policy config |
| Audit log integrity | LOW → HMAC chain |

---

## Secret Generation & Rotation

```bash
# Generate
npm run gen:secret          # 96-char hex via Node crypto.randomBytes(48)

# Rotation
# 1. Generate new secret
# 2. Update in secrets manager / deployment env
# 3. Rolling restart — all sessions immediately expire
# 4. Notify editors before rotation
```

**JWT_SECRET requirements (enforced at startup):**
- ≥ 32 characters
- Cryptographically random (not a word/phrase)
- Not in the known-insecure list in src/configuration/env.ts

---

## Phase 5 Additions — Media & XSS Threat Register

### TR-13 SVG XSS via Upload
- **Threat:** Malicious SVG containing `<script>`, `onload=`, `foreignObject`, `xlink:href data:` served from origin, executes in victim's browser
- **P3 partial:** Checked only first 512 bytes; missed event handlers and foreign-object injection
- **P5 fix:** SVG rejected by default (`ALLOW_SVG_UPLOADS` opt-in); when enabled, 64 KB scanned against 13 XSS pattern rules
- **Test:** `phase5-media-xss.test.ts SVG-*`

### TR-14 Stored XSS via Article Rich Text
- **Threat:** Editor saves `<script>alert(1)</script>` or `<img onerror="...">` in article body; rendered to all readers
- **P5 fix:** `sanitizeArticleContent()` (sanitize-html, allowlist) applied server-side on every create/update; `DOMPurify` applied client-side in CMS preview
- **Test:** `phase5-media-xss.test.ts SAN-*`

### TR-15 Path Traversal via Upload Filename
- **Threat:** Filename `../../../etc/passwd` overwrites system files
- **P5 fix:** `generateSafeFileName()` strips all non-alphanumeric except dash, then appends 12-char `crypto.randomUUID()` fragment
- **Test:** `phase5-media-xss.test.ts UTIL-5`

### TR-16 MIME-Type Confusion on Uploaded Files
- **Threat:** `.jpg` file containing PHP script executed by web server
- **P5 fix:** Magic byte inspection rejects PE/ELF/PHP/Shell/ZIP; `X-Content-Type-Options: nosniff` on all upload responses; `dotfiles: deny`
- **Test:** `phase5-media-xss.test.ts SIG-*`

### TR-17 Clickjacking
- **Threat:** App embedded in `<iframe>` on attacker domain; UI redressing attack
- **P5 fix:** `Content-Security-Policy: frame-ancestors 'none'` replaces legacy `X-Frame-Options: DENY` (CSP takes precedence in modern browsers; both present)
- **Status:** FIXED

### TR-18 Information Disclosure via Media Endpoints
- **Threat:** Unauthenticated caller lists all media assets, discovers draft article slugs from usage refs
- **P5 fix:** `GET /api/media` requires auth; public `GET /api/media/:id` omits `uploaderId`; `GET /api/media/:id/usages` requires auth and filters to PUBLISHED-only deps for non-editors

### TR-19 Upload Rate Abuse / Disk Exhaustion
- **Threat:** Attacker uploads thousands of files, exhausts disk or storage quota
- **P5 fix:** Per-user upload rate limit: 20 uploads / 10 min; multer hard-caps at 10 MB per file; failed writes return 500 without orphan file
- **Test:** `phase5-media-xss.test.ts RATE-1`

---

## Open Risks (Phase 6)

| Risk | Priority | Planned Fix |
|---|---|---|
| TR-06: localStorage JWT (from Phase 4) | HIGH | HttpOnly cookie + CSRF token |
| TR-20: No real image resizing — originals served for all variants | MEDIUM | sharp/jimp resizing pipeline |
| TR-21: CORS not configured | MEDIUM | Explicit origin allowlist |
| TR-22: Content length limits on article body | LOW | Max body size on article create/update |

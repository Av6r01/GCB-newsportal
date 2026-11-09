# API Permission Matrix — Global Chronicle News
**Source:** `server.ts` — verified by reading every `app.get/post/put/delete` registration  
**Date:** 2026-10-24

Legend:  
✅ Correct — auth and permission match documented policy  
⚠️ Gap — auth present but permission check missing or wrong  
❌ Defect — missing auth, wrong permission, or data-loss bug  
🔴 DUPLICATE — second registration of same route (dead code)  

---

## Authentication Routes

| Method | Path | Auth Required | Permission | Status | Notes |
|---|---|---|---|---|---|
| POST | /api/auth/register | None | — | ✅ | Enforces `role: READER` only |
| POST | /api/auth/login | None | — | ✅ | Rate-limited per IP+email |
| POST | /api/auth/logout | requireAuth | — | ✅ | Token revocation |
| POST | /api/auth/password-reset/request | None | — | ✅ | Rate-limited; enum-safe |
| POST | /api/auth/password-reset/confirm | None | — | ❌ **P0-01** | Reset does not persist to disk |
| GET | /api/auth/me | requireAuth | — | ✅ | Returns own profile only |

---

## User & Role Management

| Method | Path | Auth Required | Permission | Status | Notes |
|---|---|---|---|---|---|
| PUT | /api/admin/users/:id/role | requireAuth | `roles:assign` + `preventPrivilegeEscalation` | ❌ **P0-02** | Role change in-memory only; not persisted |
| PUT | /api/admin/users/:id/status | requireAuth | `users:manage` | ❌ **P0-03** | isActive change in-memory only; not persisted |

---

## Categories

| Method | Path | Auth Required | Permission | Status | Notes |
|---|---|---|---|---|---|
| GET | /api/categories | None | — | ✅ | Public |
| POST | /api/categories | requireAuth | `categories:manage` | ✅ | |
| PUT | /api/categories/:id | requireAuth | `categories:manage` | ✅ | |
| DELETE | /api/categories/:id | requireAuth | `categories:manage` | ✅ | Referential integrity enforced |

---

## Tags

| Method | Path | Auth Required | Permission | Status | Notes |
|---|---|---|---|---|---|
| GET | /api/tags | None | — | ✅ | Public |
| POST | /api/tags | requireAuth | `tags:manage` | ✅ | |
| DELETE | /api/tags/:id | requireAuth | `tags:manage` | ✅ | |

---

## Authors

| Method | Path | Auth Required | Permission | Status | Notes |
|---|---|---|---|---|---|
| GET | /api/authors | None | — | ⚠️ | Returns user IDs; passwordHash excluded but role/email exposed |
| GET | /api/authors/:userId | None | — | ⚠️ | Returns email of author |
| PUT | /api/authors/:userId/profile | requireAuth | Self or ADMIN check in handler | ✅ | |

---

## Articles

| Method | Path | Auth Required | Permission | Status | Notes |
|---|---|---|---|---|---|
| GET | /api/articles | None | — | ⚠️ | Status defaults to PUBLISHED but can be overridden by `?status=DRAFT` with no auth |
| GET | /api/articles/:slug | None | — | ❌ **P0-06** | No status filter — returns DRAFT/IN_REVIEW/APPROVED/SCHEDULED publicly |
| POST | /api/articles | requireAuth | `article:create` | ⚠️ | Body can set `status: PUBLISHED` directly without `article:publish` permission |
| PUT | /api/articles/:id | requireAuth | Inline ownership + publish check | ✅ | Publish gate present inline |
| POST | /api/articles/:id/restore/:version | requireAuth | — | ❌ **P0-10** | No ownership or permission check |
| POST | /api/articles/:id/transition | requireAuth | Workflow validation | ✅ | `validateStateTransition` enforces role rules |
| DELETE | /api/articles/:id | requireAuth | `article:delete` | ✅ | **Phase 7**: archive-by-default — sets `status='ARCHIVED'` + `archivedAt`; revisions/comments/media joins preserved; no row is destroyed |
| POST | /api/articles/:id/purge | requireAuth | `article:purge` (SUPER_ADMIN, ADMIN) | ✅ | **Phase 7**: the only hard-deletion path. 409-blocked unless status is ARCHIVED/DRAFT, while active breaking-news announcements or homepageConfig reference the article. Delete + audit + editorial event commit atomically |

**Note on GET /api/articles:** The `status` query param defaults to `PUBLISHED` but an anonymous caller can pass `?status=DRAFT` and get all drafts. Should require auth for non-PUBLISHED status queries.

**Note on POST /api/articles:** The body accepts `status: 'PUBLISHED'` directly without checking `article:publish` permission. A REPORTER can create an article already published by setting status in the body.

---

## Homepage

| Method | Path | Auth Required | Permission | Status | Notes |
|---|---|---|---|---|---|
| GET | /api/homepage | None | — | ✅ | Public; only serves PUBLISHED articles |
| GET | /api/homepage/config | requireAuth | — | ⚠️ | Should require `article:publish` to view config |
| PUT | /api/homepage/config | requireAuth | `article:publish` | ✅ | |

---

## Media

| Method | Path | Auth Required | Permission | Status | Notes |
|---|---|---|---|---|---|
| GET | /api/media | None | — | ⚠️ | Lists all media assets publicly; includes uploader IDs |
| GET | /api/media/:id | None | — | ⚠️ | Exposes asset metadata |
| GET | /api/media/:id/usages | None | — | ❌ **P1-06 adjacent** | Exposes which unpublished articles reference asset |
| POST | /api/media/file-upload | requireAuth | — | ❌ **P1-06** | Missing `media:upload` permission check |
| POST | /api/media | requireAuth | — | ❌ **P1-06** | Missing `media:upload` permission check |
| PUT | /api/media/:id/replace-file | requireAuth | — | ❌ **P1-06** | Missing `media:manage` permission check |
| PUT | /api/media/:id | requireAuth | — | ❌ **P1-06** | Missing `media:manage` permission check |
| DELETE | /api/media/:id | requireAuth | — | ❌ **P1-06** | Missing `media:manage` permission check |

---

## Live Blogs

| Method | Path | Auth Required | Permission | Status | Notes |
|---|---|---|---|---|---|
| GET | /api/liveblogs/:articleId | None | — | ✅ | Public read |
| POST | /api/liveblogs | requireAuth | — | ⚠️ | No `article:create` or ownership check |
| DELETE | /api/liveblogs/:id | requireAuth | — | ❌ **P1-07** | No permission or ownership check |

---

## Breaking News (DUPLICATE ROUTES — first registration wins)

| Method | Path | Registration | Auth | Permission | Status |
|---|---|---|---|---|---|
| GET | /api/breaking-news | 1st (~line 1292) | None | — | ✅ Used |
| POST | /api/breaking-news | 1st (~line 1301) | requireAuth | `article:publish` | ✅ Used |
| PUT | /api/breaking-news/:id | 1st (~line 1311) | requireAuth | `article:publish` | ✅ Used |
| DELETE | /api/breaking-news/:id | 1st (~line 1321) | requireAuth | `article:publish` | ✅ Used |
| GET | /api/breaking-news | 🔴 2nd (~line 1692) | None | — | ❌ **P0-07** Dead code |
| POST | /api/breaking-news | 🔴 2nd (~line 1699) | requireAuth | `article:publish` | ❌ **P0-07** Dead code |

---

## Reactions

| Method | Path | Auth Required | Permission | Status | Notes |
|---|---|---|---|---|---|
| GET | /api/reactions/:articleId | None | — | ✅ | |
| POST | /api/reactions/:articleId | None | — | ✅ (Phase 8) | 20/min per (IP, article) rate limit; PUBLISHED-only 404 gate; (IP, article, type) dedup cooldown ⇒ idempotent 200 `{deduplicated:true}` |

---

## Comments

| Method | Path | Auth Required | Permission | Status | Notes |
|---|---|---|---|---|---|
| GET | /api/comments | optionalAuth | status≠APPROVED ⇒ `article:request_changes` | ✅ (Phase 8) | Public list structurally whitelisted to `id, articleId, authorName, content, status, createdAt` — authorEmail/moderation fields never leave the server; non-editor `?status=` filter ⇒ 401; list bounded by parsePagination |
| POST | /api/comments | None | — | ✅ (Phase 8) | 5/hr/IP rate limit (env-tunable); Zod validation; honeypot `website` field; link-spam auto-flag SPAM; duplicate-content suppression; generic response only (no record/email echo) |
| GET | /api/comments/pending | requireAuth | `article:request_changes` | ✅ | Bounded editorial queue (Phase 8) |
| PUT | /api/comments/:id/moderate | requireAuth | `article:request_changes` | ✅ | Phase 8: Zod-validated status; response whitelisted (client refetches) |

---

## Polls

| Method | Path | Auth Required | Permission | Status | Notes |
|---|---|---|---|---|---|
| GET | /api/polls | None | — | ✅ | |
| POST | /api/polls/:id/vote | None | — | ✅ (Phase 8) | Duplicate-vote policy: `gcn_poll_voter` HttpOnly cookie token primary, IP best-effort fallback; 10/min rate limit; validation BEFORE identity burn; duplicate ⇒ 429; policy in docs/OPERATIONAL_LIMITS.md §3 |

---

## AI Assistant

| Method | Path | Auth Required | Permission | Status | Notes |
|---|---|---|---|---|---|
| POST | /api/ai/summarize | requireAuth | — | ⚠️ | No per-user quota or rate limit on Gemini calls |
| POST | /api/ai/headlines | requireAuth | — | ⚠️ | No per-user quota or rate limit |
| POST | /api/ai/tts | requireAuth | any authenticated role | ✅ (Phase 8) | 5,000-char bound (`TTS_MAX_CHARS`); 30/user/day quota (`TTS_DAILY_QUOTA_PER_USER`, `0`=unlimited); 3-call concurrency gate; 20 s provider timeout ⇒ 504; generic 502/503 error shapes |

---

## Analytics

| Method | Path | Auth Required | Permission | Status | Notes |
|---|---|---|---|---|---|
| POST | /api/analytics/track | None | — | ✅ (Phase 8) | 60/min rate limit; 8-event allowlist; `entityId` format-bounded; metadata restricted to a 10-key allowlist with a 1,024-byte budget — arbitrary event/metadata injection blocked |
| GET | /api/admin/analytics | requireAuth | `analytics:view` | ✅ | |
| GET | /api/admin/abuse-report | requireAuth | `analytics:view` | ✅ (Phase 8) | Hashed-identity abuse report only — no raw IPs/PII in payload |

---

## Admin Dashboard

| Method | Path | Auth Required | Permission | Status | Notes |
|---|---|---|---|---|---|
| GET | /api/admin/dashboard | requireAuth | — | ❌ **P0-08, G** | No permission beyond auth; `recentlyPublishedStories` always undefined |

---

## Stats

| Method | Path | Auth Required | Permission | Status | Notes |
|---|---|---|---|---|---|
| GET | /api/stats | requireAuth | `analytics:view` | ✅ | |

---

## SEO

| Method | Path | Auth Required | Permission | Status | Notes |
|---|---|---|---|---|---|
| GET | /robots.txt | None | — | ✅ | |
| GET | /sitemap.xml | None | — | ✅ | PUBLISHED only |
| GET | /sitemap-news.xml | None | — | ✅ | PUBLISHED, last 48h |

---

## Newsletter

| Method | Path | Auth Required | Permission | Status | Notes |
|---|---|---|---|---|---|
| POST | /api/newsletter/subscribe | None | — | ✅ (Phase 8) | 5/hr/IP rate limit; Zod email validation (≤254 chars); generic response (no record echo; no confirmation email even when SMTP configured — unchanged) |

---

## Health

| Method | Path | Auth Required | Permission | Status | Notes |
|---|---|---|---|---|---|
| GET | /api/health | None | — | ⚠️ | Exposes DB category count, memory usage, AI config to public |

---

## Roles That Can Access Each Privileged Endpoint
(from `src/modules/auth/permissions.ts`)

| Permission | Roles |
|---|---|
| `article:create` | SUPER_ADMIN, ADMIN, MANAGING_EDITOR, SECTION_EDITOR, REPORTER |
| `article:edit_any` | SUPER_ADMIN, ADMIN, MANAGING_EDITOR, SECTION_EDITOR, COPY_EDITOR |
| `article:publish` | SUPER_ADMIN, ADMIN, MANAGING_EDITOR, SECTION_EDITOR |
| `article:delete` | SUPER_ADMIN, ADMIN, MANAGING_EDITOR |
| `article:purge` | SUPER_ADMIN, ADMIN — **Phase 7**: permanent deletion of archived stories; deliberately withheld from MANAGING_EDITOR |
| `media:upload` | SUPER_ADMIN, ADMIN, MANAGING_EDITOR, SECTION_EDITOR, COPY_EDITOR, REPORTER, PHOTOGRAPHER, VIDEO_EDITOR |
| `media:manage` | SUPER_ADMIN, ADMIN, MANAGING_EDITOR, SECTION_EDITOR, PHOTOGRAPHER, VIDEO_EDITOR |
| `roles:assign` | SUPER_ADMIN, ADMIN |
| `users:manage` | SUPER_ADMIN, ADMIN |
| `analytics:view` | SUPER_ADMIN, ADMIN, MANAGING_EDITOR, SECTION_EDITOR, ADVERTISING_MANAGER, ANALYST |
| `categories:manage` | SUPER_ADMIN, ADMIN, MANAGING_EDITOR, SECTION_EDITOR |
| `tags:manage` | SUPER_ADMIN, ADMIN, MANAGING_EDITOR, SECTION_EDITOR |

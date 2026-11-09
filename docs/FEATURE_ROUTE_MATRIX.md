# Feature / Route Matrix — Global Chronicle News
**Phase:** 1 Baseline  
**Date:** 2026-10-24

Maps every CMS button/action to its API handler and documents the full content path.

---

## Content Path: Editor Save → Database → Publication → Public

```
Editor (CmsArticleEditor.tsx)
  └─ POST /api/articles          (create)  → db.article.create() → data/database.json
  └─ PUT  /api/articles/:id     (update)  → db.article.update() → data/database.json
         ├─ status: DRAFT        → stays in CMS, not public
         ├─ status: IN_REVIEW    → CmsArticles.tsx review queue
         ├─ status: PUBLISHED    → homepageCache invalidated → public via /api/homepage
         └─ status: SCHEDULED    → scheduler.ts polls every 60s → publishes on time

Public Read Path:
  /api/articles          → filters status=PUBLISHED (GET list)
  /api/articles/:slug    → NO status filter ❌ (GET detail — defect P0-06)
  /api/homepage          → homepageCache or fresh DB query, PUBLISHED only
  /sitemap.xml           → PUBLISHED only
```

---

## Admin UI → API Route → Handler Map

### CmsDashboard.tsx
| UI Element | API Call | Handler | Status |
|---|---|---|---|
| Metrics panel | `GET /api/admin/dashboard` | `server.ts:~1610` | ❌ recentlyPublishedStories undefined (P0-08) |
| Published count | same | `prisma.article.count({status:'PUBLISHED'})` | ✅ |
| Pending review | same | `prisma.article.count({status:'IN_REVIEW'})` | ✅ |
| Total views | same | `prisma.article.aggregate()` | ✅ |

### CmsArticles.tsx
| UI Element | API Call | Handler | Status |
|---|---|---|---|
| Article list | `GET /api/articles?status=X` | `server.ts:~480` | ⚠️ No auth required for status filter |
| Workflow transition buttons | `POST /api/articles/:id/transition` | `server.ts:~714` | ✅ |
| Delete button | `DELETE /api/articles/:id` | `server.ts:~751` | ✅ requires `article:delete` |

### CmsArticleEditor.tsx
| UI Element | API Call | Handler | Status |
|---|---|---|---|
| Save / Autosave | `PUT /api/articles/:id` | `server.ts:~597` | ✅ (auth + ownership) |
| New article | `POST /api/articles` | `server.ts:~549` | ⚠️ can set status=PUBLISHED without publish perm |
| Media picker | `GET /api/media` | `server.ts:~1050` | ⚠️ public endpoint |
| AI Summarize | `POST /api/ai/summarize` | `server.ts:~1380` | ✅ requireAuth |
| AI Headlines | `POST /api/ai/headlines` | `server.ts:~1420` | ✅ requireAuth |
| Restore revision | `POST /api/articles/:id/restore/:version` | `server.ts:~693` | ❌ no permission check (P0-10) |

### CmsMediaManager.tsx
| UI Element | API Call | Handler | Status |
|---|---|---|---|
| Upload file | `POST /api/media/file-upload` | `server.ts:~1060` | ❌ no `media:upload` check |
| Add URL | `POST /api/media` | `server.ts:~1125` | ❌ no `media:upload` check |
| Edit metadata | `PUT /api/media/:id` | `server.ts:~1154` | ❌ no `media:manage` check |
| Replace file | `PUT /api/media/:id/replace-file` | `server.ts:~1100` | ❌ no `media:manage` check |
| Delete asset | `DELETE /api/media/:id` | `server.ts:~1174` | ❌ no `media:manage` check |
| Check usages | `GET /api/media/:id/usages` | `server.ts:~1032` | ⚠️ public; exposes unpublished refs |

### CmsComments.tsx
| UI Element | API Call | Handler | Status |
|---|---|---|---|
| Pending list | `GET /api/comments/pending` | `server.ts:~1250` | ✅ requireAuth + permission |
| Approve/Reject | `PUT /api/comments/:id/moderate` | `server.ts:~1260` | ✅ |

### CmsHomepageManager.tsx (component)
| UI Element | API Call | Handler | Status |
|---|---|---|---|
| Load config | `GET /api/homepage/config` | `server.ts:~887` | ⚠️ requireAuth but no publish perm |
| Save config | `PUT /api/homepage/config` | `server.ts:~905` | ✅ requires `article:publish` |

### AdminDashboard.tsx (admin/AdminDashboard.tsx)
| UI Element | API Call | Handler | Status |
|---|---|---|---|
| System metrics | `GET /api/admin/dashboard` | `server.ts:~1610` | ❌ P0-08 |

---

## Article Status State Machine

```
DRAFT
  ├─→ IN_REVIEW       (REPORTER/author, COPY_EDITOR, SECTION_EDITOR, MANAGING_EDITOR, ADMIN)
  └─→ ARCHIVED        (MANAGING_EDITOR, ADMIN, SUPER_ADMIN)

IN_REVIEW
  ├─→ CHANGES_REQUESTED  (COPY_EDITOR+; requires note)
  ├─→ APPROVED           (COPY_EDITOR+)
  ├─→ DRAFT              (rollback)
  └─→ ARCHIVED

CHANGES_REQUESTED
  ├─→ DRAFT
  ├─→ IN_REVIEW
  └─→ ARCHIVED

APPROVED
  ├─→ SCHEDULED       (SECTION_EDITOR+)
  ├─→ PUBLISHED       (SECTION_EDITOR+)
  ├─→ DRAFT           (rollback)
  └─→ ARCHIVED

SCHEDULED
  ├─→ PUBLISHED       (daemon auto-publish OR SECTION_EDITOR+)
  ├─→ APPROVED        (cancel schedule)
  ├─→ DRAFT
  └─→ ARCHIVED

PUBLISHED
  ├─→ UNPUBLISHED     (MANAGING_EDITOR+; requires note)
  └─→ ARCHIVED

UNPUBLISHED
  ├─→ DRAFT
  ├─→ IN_REVIEW
  ├─→ PUBLISHED       (re-publish)
  └─→ ARCHIVED

ARCHIVED
  └─→ DRAFT           (restore)
```

---

## Content Path: Article Create to Sitemap

```
1. DRAFT created (CmsArticleEditor → POST /api/articles)
2. Author submits (POST /api/articles/:id/transition {targetState: 'IN_REVIEW'})
3. Editor reviews in CmsArticles.tsx queue
4. Editor approves (transition → 'APPROVED')
5a. Immediate publish: transition → 'PUBLISHED'
    - publishedAt set to now()
    - homepageCache invalidated
    - article appears in GET /api/articles (default status=PUBLISHED)
    - article appears in /api/homepage
    - article appears in /sitemap.xml
5b. Scheduled: transition → 'SCHEDULED' with scheduledFor datetime
    - Scheduler daemon polls every 60s
    - When scheduledFor <= now, promotes to PUBLISHED
    - Same cache invalidation path
6. Public reads via GET /api/articles/:slug (Phase 7: PUBLISHED-only + UrlRedirect 301 on slug change)
```

---

## SEO Metadata Path
```
Article fields: title, seoTitle, seoDescription, socialImage
  └─→ PUT /api/articles/:id (stored in JSON DB)
  └─→ PageMetadata.tsx component reads from article object
  └─→ react-helmet renders <title>, <meta> tags
  └─→ /sitemap.xml includes slug + updatedAt
  └─→ /sitemap-news.xml includes title + publishedAt (48h window)
```

---

## Phase 7: Pagination Contract (GET /api/articles)

Standardized by `src/server/query.ts` (`parsePagination`, `wantsPagination`);
`DEFAULT_PAGE_SIZE=20`, `MAX_PAGE_SIZE=100` (hard cap on every list endpoint).

| Query                              | Response shape                              | Notes |
|------------------------------------|---------------------------------------------|-------|
| *(none)*                           | plain array — full corpus                   | legacy consumers (CmsArticleEditor, CmsArticles, RelatedStories) |
| `?limit=N` (no `page`)             | plain array — at most `N` items             | **fix**: `limit` used to be ignored without `page` (App.tsx `?limit=5`) |
| `?page=N&limit=M`                  | `{ articles, pagination: { total, page, limit } }` | 6 SPA pages depend on this envelope |
| hostile values (`NaN`, `-1`, `limit=99999999`) | clamped to defaults / `MAX_PAGE_SIZE` | never throws, never generates unbounded queries |

The same `parsePagination` bounds-side listing is applied to `/api/comments`
(default 100), `/api/media` (default 50) and `/api/admin/analytics`
(default 100, previously hardcoded `take: 1000`).

---

## Phase 7: Homepage Cache (key/TTL/invalidation)

| Property     | Value |
|--------------|-------|
| Key          | `homepage` (single rendered payload, `src/server/cache.ts` `TtlCache`) |
| TTL          | 60s default; env override `HOMEPAGE_CACHE_TTL_MS` (0 = disabled) |
| Sparse fields added on reads | `cached`, `cacheTime`, `generatedAt`, `cacheAgeSeconds`, `cacheTtlSeconds` |
| Stale-never rule | cache is populated only from `status: 'PUBLISHED'` queries — drafts, unpublished and archived rows can never enter the payload |

Explicit `invalidateHomepageCache()` call sites (cache miss forces regeneration):

| Mutation | Invalidation |
|----------|--------------|
| POST `/api/articles` (create) | yes |
| PUT `/api/articles/:id` (incl. slug change) | yes |
| POST `/api/articles/:id/transition` (any workflow move) | yes |
| DELETE `/api/articles/:id` (archive) | yes when previously PUBLISHED |
| POST `/api/articles/:id/purge` | yes |
| POST/PUT/DELETE `/api/breaking-news(…)` | yes (ticker renders on homepage) |
| DELETE `/api/media/:id` | yes when dependent articles exist |
| Scheduler daemon auto-publish | yes (via transition pipeline) |

---

## Phase 7: Status Distinction — unpublished / ARCHIVED / purged

| State           | Stored as | Visibility | History |
|-----------------|-----------|------------|---------|
| Unpublished     | `status` DRAFT/IN_REVIEW/…, no `archivedAt` | 404 for public readers, editable by owner/editorial | revisions kept |
| Archived        | `status='ARCHIVED'` + `archivedAt` stamped | 404 for public readers, sitemap excluded | revisions, comments, media joins preserved |
| Purged (deleted)| row removed by protected procedure | gone | revisions/comments/history removed; `ARTICLE_PURGED` audit + `editorialEvent` remain |

- `DELETE /api/articles/:id` is now **archive-by-default** (`article:delete`).
  Idempotent: re-archiving returns the stored state unchanged.
- `POST /api/articles/:id/purge` — separate **hard deletion** procedure gated by
  the new `article:purge` permission (SUPER_ADMIN, ADMIN only). Blocked with 409
  unless the article is ARCHIVED/DRAFT, while active breaking-news announcements
  reference it, or while homepageConfig references it (featured/breaking).
  Delete + audit log + editorial event commit in one transaction.

---

## Phase 7: Slug Changes & URL History

- `PUT /api/articles/:id` accepts `slug`; validated (`/^[a-z0-9]+(-[a-z0-9]+)*$/`,
  min length 3), uniqueness enforced (409 on conflict, no partial write).
- On change, a `UrlRedirect` row (`/article/<old>` → `/article/<new>`, 301) is
  created **in the same transaction** as the article update.
- `GET /api/articles/:slug` on a slug miss consults active `urlRedirects` and
  301-redirects to the destination instead of a dead 404.

---

## Phase 7: Background Scheduler Idempotency & Observability

- Each due article is published through the domain method
  `db.publishScheduledArticle({ articleId, idempotencyKey: 'sched-pub-<articleId>-<version>', … })`:
  article update + editorial event + audit log + `EXECUTED`
  `publicationSchedule` row commit **atomically** (JSON driver: single-save
  semantics; PG driver: real interactive transaction; `idempotencyKey` has a
  unique index so races are safe).
- Re-running a sweep is a no-op per article (`ALREADY_EXECUTED` /
  `ALREADY_PUBLISHED` skips), so restarts and overlapping sweeps never
  double-publish or duplicate events.
- `GET /api/admin/dashboard` surfaces real scheduler state from
  `getSchedulerStatus()` (`job-worker-01` status/lastRun per-run counters,
  `failedJobsCount` tied to actual failures) and a bounded, newest-first
  activity feed (max 8 entries).

---

## Phase 10: Functional Completeness â€” every visible control reaches a real API

Baseline for this phase: the matrix above (legacy screens) plus the new
management surface below. Acceptance rule (tests/p10): every visible control has
a working action, a working navigation destination, or an explicit disabled
state **with a stated reason**.

### New admin endpoints (server.ts, Phase 10 block)

| Endpoint | Method | Permission | Notes |
|---|---|---|---|
| `/api/admin/users` | GET | `users:view` | real roster, `passwordHash` stripped |
| `/api/admin/users` | POST | `users:manage` | bcrypt(12); SUPER_ADMIN/READER not creatable (schema) |
| `/api/ads` | GET | public | ACTIVE placements only â€” empty when none (no fabricated sponsors) |
| `/api/ads/:id/impression` `/:id/click` | POST | public | bounded counter increments via `incrementMetrics` |
| `/api/admin/ads(/:id)` | GET/POST/PUT/DELETE | `ad:manage` | delete archives first (metrics preserved), repeat deletes |
| `/api/admin/newsletter/subscribers(/:id)` | GET/DELETE | `users:view` / `users:manage` | real roster; delete = opt-out removal + audit |
| `/api/newsletter/unsubscribe` | POST | public | rate-limited; generic response (no address enumeration) |
| `/api/admin/analytics/report?window=24h|7d|30d|90d` | GET | `analytics:view` | JS aggregation (driver-safe): byType/byDay/recentEvents |
| `/api/settings` | GET | public | `PUBLIC_SETTING_KEYS` subset only â€” admin keys never leak |
| `/api/admin/settings` | GET/PUT | `settings:manage` | key allowlist (`ALLOWED_SETTING_KEYS`) + per-key type checks |
| `/api/admin/redirects(/:id)` | GET/POST/PUT/DELETE | `settings:manage` | self-redirect & duplicate source guarded (400/409) |
| `/api/admin/notifications` | GET | `analytics:view` | derived ONLY from real counts (review backlog, pending comments, overdue releases, daemon ERROR) |
| `/api/admin/scheduler/jobs` | GET | `analytics:view` | daemon counters + newest-100 schedule rows + stuck releases (SCHEDULED overdue > 2 min) |
| `/api/admin/scheduler/jobs/:articleId/retry` | POST | `article:publish` | re-runs atomic `publishScheduledArticle` (idempotency key) + `invalidateHomepageCache()` |

### New screens (`src/pages/admin/*`, all with `data-admin-screen`)

| Screen | Controls | Backing APIs |
|---|---|---|
| CmsBreakingNews | create/deactivate/delete announcements | `GET/POST/PUT/DELETE /api/breaking-news` |
| CmsAds | create/activate/delete slots, live impressions/clicks/CTR | `/api/admin/ads*`, `/api/ads` |
| CmsNewsletter | subscriber roster, per-row opt-out | `/api/admin/newsletter/subscribers*` |
| CmsAnalytics | 24 h/7 d/30 d/90 d windows, 8-event taxonomy, daily histogram | `/api/admin/analytics/report` |
| CmsTaxonomy | category tree CRUD + subcategory parenting, tag CRUD | `/api/categories*`, `/api/tags*` |
| CmsAuthors | own-profile editing (byline/designation/bio) | `GET /api/authors`, `PUT /api/authors/:userId/profile` |
| CmsStaff | create accounts, role change, activate/deactivate | `/api/admin/users*` |
| CmsRedirects | manual 301/308/302 rules, activate/deactivate | `/api/admin/redirects*` |
| CmsSettings | text/boolean/language settings with allowed-key list | `/api/admin/settings`, `/api/settings` |
| CmsJobs | daemon health, schedule rows, stuck-release retry (gated by `article:publish`) | `/api/admin/scheduler/jobs*` |

### Public fixes

| Defect | Fix |
|---|---|
| AdminDashboard destinations `breaking-news`/`ads`/`newsletter`/`analytics` dead (no App handler) | App.tsx handles all four; sidebar exposes the same set, permission-gated |
| AdminNotifications hardcoded fake data ("10m ago") | fetches `GET /api/admin/notifications` (real counts only) |
| design-system Footer: dead standards `<li>` items | clickable owned pages `/page/about`, `/page/standards`, `/page/contact`, `/page/privacy`, `/page/terms` (`/page/:slug` route added client + server SEO shell) |
| Footer: false "RSS 2.0 Feeds Available" claim | replaced with real `/sitemap.xml` + `/sitemap-news.xml` links (feeds remain NOT advertised â€” Phase 9 decision upheld) |
| `AdSlot.tsx`/`Home.tsx` fabricated sponsor data | renders real inventory from `GET /api/ads`, records impression/click, renders nothing when no active slot |
| dead legacy `src/components/Footer.tsx` (preventDefault-only newsletter form), `Header.tsx`, `CmsDashboard.tsx` | deleted (the live subscribe form `NewsletterModule.tsx` works â€” Phase 9 verified) |
| Language switch ignored site configuration | `LanguageProvider` seeds initial state from `GET /api/settings` `defaultLanguage` (`en`/`bn`); explicit reader choice (localStorage) wins |

### Not-configured external providers (explicit, never fabricated)

| Provider | Surface | State |
|---|---|---|
| Outbound newsletter delivery (SMTP) | CmsNewsletter | amber "Not configured" notice; stored state only, no delivery metrics |
| External ad networks (programmatic) | CmsAds | notice states slots are served from this app's own store; no third-party broker integrated |
| Third-party analytics (GA4 & co.) | CmsAnalytics | notice states dashboard reports first-party events only, no external account |

### Phase 10 test coverage

- `tests/p10/admin-endpoints.test.ts` â€” 122 checks: every new endpoint positive
  + 401/403/404/409/400 paths across five seeded roles, page-level 301 from the
  redirect table, stuck-release detection (> 2 min), atomic retry + honest 409s,
  derived-notification contracts, owned-page 200/404s.
- `tests/p10/ui-controls.test.ts` â€” 116 checks (source audit): every
  `onNavigate` literal handled in App.tsx, every admin `fetch`/`adminApi` call
  maps to a registered same-verb server route, sidebar/notification targets
  resolve, footer links resolve to owned pages, mounted screens carry
  `data-admin-screen` attributes, fabricated ad data + dead files absent.


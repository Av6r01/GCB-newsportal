# Phase 6A — Data-Layer Migration Plan (JSON → Prisma/PostgreSQL)

> **Status: IMPLEMENTED (Phase 6B) — implementation landed 2026-11-06.**
> Runtime today: driver selector `src/lib/database.ts` → PostgreSQL driver `src/lib/database/pgDriver.ts` (`DB_DRIVER=postgres`, required in production, fail-closed) or legacy JSON store `src/lib/db.ts` (development default only).
> Implementation deltas vs this plan: Prisma pinned to **6.19.3** (plan anticipated Prisma 7+, but Prisma 7 removed schema-level `url`, which would have rewritten every documented command); runtime roles realigned to `src/modules/auth/permissions.ts`; article FK relation renamed `coverImageAsset` with new `coverImage String?` URL column (Q2); scheduler actor seeded as inactive `usr-system-daemon` (Q3); tag delete cleans join rows (Q4). Findings and remaining openings are recorded in `docs/DEFECT_REGISTER.md` §Phase 6B.
> The original plan text below is preserved unchanged for review traceability.
>
> **Historical plan state (pre-6B): reviewed and approved; no runtime persistence changes applied at planning time.**
> Runtime today: `src/lib/db.ts` (in-memory snapshot of `data/database.json`).
> Target: Prisma Client on PostgreSQL. Prisma schema/migrations exist in `prisma/` but are **not** the runtime source of truth.
> **Nothing is migrated, reset, or switched yet. This document requires review sign-off before Phase 6B (implementation).**

---

## 0. Scope and Non-Goals

**In scope (this document only):**

1. Full inventory of `src/lib/db.ts` exported functions, every entity, query/update/delete semantics, and hidden assumptions in route handlers.
2. Mapping of every JSON entity + relationship to the Prisma/PostgreSQL schema.
3. Schema differences, missing constraints and indexes.
4. A repository/service interface design so route logic never depends on JSON internals.
5. Real transaction boundaries for multi-step operations.
6. Export/import/validation/checksum/rollback strategy.
7. JSON-storage policy going forward (isolated tests / explicit local dev only).
8. Migration handling for existing rows (users, password hashes, article statuses, media paths, timestamps, slugs).
9. Production-data risk assessment (**no production data was accessed**; only the repo's local `data/database.json` aggregates were read).
10. Test plan against a disposable PostgreSQL database.
11. Exact package/runtime requirements and migration commands.

**Non-goals / hard restrictions:**

- **No runtime persistence change in Phase 6A.** `server.ts` continues to run on `src/lib/db.ts` unchanged.
- No data export, import, reset, or schema `migrate` is executed now.
- No route/behavior changes; no API contract changes.

---

## 1. Current-State Inventory — `src/lib/db.ts`

### 1.1 Exported symbols

| Symbol | Kind | Notes |
|---|---|---|
| `db` | `PersistentDatabase` singleton instance | Full repository surface; one per process |
| `IntegrityError` | Error class | Thrown for referential/uniqueness violations (but *inconsistently* — some paths throw generic `Error`, see §2.3) |
| `DbSchema` | TypeScript interface | 30 top-level collections |

### 1.2 Persistence mechanics (the problems this migration fixes)

| Behavior | Consequence |
|---|---|
| Whole-`JSON.stringify` of the **entire** schema on every write (`fs.writeFileSync`) | Write cost grows with total corpus size; one view increment rewrites all 30 collections. |
| Synchronous non-atomic write (no tmp-file + `rename`) | Crash mid-write leaves a truncated/corrupt JSON file. |
| `readDb()` catch: corrupt/missing file → **logs and returns a fresh empty schema** | **Silent total data loss**: a corrupt file makes production "start over" with empty collections; first write then overwrites the file. Highest-severity storage defect. |
| `save()` errors only `console.error`-ed | Writes fail silently; process serves stale in-memory state believing it persisted. |
| `$transaction(promises)` = `Promise.all` | **Not a transaction.** Named like Prisma's API, but sibling writes can still interleave and partial failure leaves no rollback. |
| In-memory state is authoritative between reads | Safe only in a single process. All callers (server, scheduler sweeper, seed script) share one process today; multiple processes would race on `writeFileSync`. |
| Owner-coupled collections (`userSessions`, `urlRedirects`, `adPlacements`, `photoGalleries`, `galleryItems`, `videoRecords`) | Declared in `DbSchema` and persisted, but **no accessor object exists** in `db.ts` and **no route/daemon reads or writes them** (verified across `server.ts`). They are dormant legacy payload. |

### 1.3 Entity & operator inventory

Legend: ✅ = implemented, ❌ = absent.

| Repository (`db.<model>`) | Read ops | Write ops | Semantics worth preserving / hidden behavior |
|---|---|---|---|
| `category` | `count`, `findMany({include})`, `findUnique({id\|slug})` | `create`, `update`, `delete` | `create` enforces slug uniqueness + parent existence; generates `id`/`createdAt` defaults then spreads `data` **over** them (caller data can override defaults). `findMany` computes `children[]` and `_count.articles` in memory (N+1). `update` walks the ancestor chain to reject **circular self-parenting**. `delete` = *restrict*: refuses if any article references the category **or** any child category exists. |
| `user` | `count`, `findUnique({email\|id})`, `findMany` | `create`, `update({id\|email, data})`, `delete` | Email uniqueness is **case-insensitive** (`toLowerCase()` compare) — Postgres unique index is case-sensitive → needs normalized `email` or citext/functional index. `update` stamps `updatedAt`. `delete` = *restrict* if `authoredCount > 0` (articles by user). No active-flag rule on delete. |
| `authorProfile` | `findUnique({userId\|id})`, `findMany` | `create`, `update` (upsert-style) | `update` with `where.userId` **creates the profile if missing** (not Prisma `update` semantics — must become `upsert` in the repository). Also merges `userId: data.userId \|\| where.userId`. |
| `tag` | `findMany` | `create`, `delete` | Slug uniqueness enforced; **delete is unrestricted** (dangling `articleTags` rows are possible today if a tag is in use — JSON never cleans `articleTags`). |
| `passwordResetToken` | `findByHash(tokenHash)` (filters `usedAt == null`) | `create`, `markUsed(id)`, `purgeExpired()` | `create` **purges the user's expired tokens** in the same call (not atomic). Token is stored **hashed (SHA-256)**, never plaintext. Single-use via `usedAt`. |
| `revokedSession` | `isRevoked(jti)` (true only while `expiresAt > now`) | `revoke(jti,userId,expiresAt)`, `revokeAllForUser` (intentional no-op), `purgeExpired()` | Entries self-expire; every lookup filters on expiry. `userId` stored but unused in lookups today (useful for `revokeAllForUser` in PG — that can be **upgraded to a real implementation** on Postgres). |
| `articleTag` | `findMany({articleId})` | `createMany` (dedupes, returns `{count}`), `deleteMany({articleId})` | Join table with synthetic `id`, `createdAt`. Dedupe on `(articleId, tagId)`. `deleteMany` always keyed by article (replace-all strategy in routes). |
| `mediaAsset` | `findMany({uploaderId\|assetType\|search})`, `findUnique({id})` | `create`, `update`, `delete` | `findMany` sorts by `createdAt desc`, appends computed `usagesCount` (articles whose `coverImageId` = asset). `findUnique` appends `usages` list. `delete` = **restrict** if any article `coverImageId` matches. Defaults: `assetType:'IMAGE'`, `focalX:50`, `focalY:50`. `focalX/focalY` **do not exist in the Prisma schema** (gap, see §3). |
| `article` | `count({status})`, `aggregate({_sum.views})`, `findMany({where,orderBy,take,skip,include,select})`, `findUnique({slug\|id})` | `create`, `update`, `delete` | See §2.2 — the most behavior-dense repository. |
| `articleMedia` | `findMany({articleId})` | `create`, `deleteMany({articleId})` | Join table with `position`, `placement` ('INLINE' used by routes; 'HERO'/'SIDEBAR' supported by nothing). No uniqueness on `(articleId, mediaAssetId)` or `(articleId, position)`. |
| `articleRevision` | `findMany({articleId})` | `create` | Immutable snapshot; `version`, `editorId`, `changeSummary`, full `title/excerpt/content`. **Currently followed by `article.delete` cascades** (i.e., deleting an article destroys revision history). |
| `publicationSchedule` | `findMany` | `create` | Defaults `status:'QUEUED'`. Route/scheduler only read all + grep for `idempotencyKey` in JS; no `findUnique({idempotencyKey})`. |
| `editorialEvent` | `findMany({articleId?})` | `create` | `actorId` can be the pseudo-user `'usr-system-daemon'` — JSON tolerates **dangling FKs**, Postgres will not (see §4.3). |
| `articleContributor` | — | `create` | No read path in runtime; schema has `@@unique([articleId, userId])`. |
| `liveBlogUpdate` | `findMany({articleId})` (sorted desc), `findUnique({id})` | `create`, `delete` | |
| `breakingNewsAnnouncement` | `findMany({isActive?})`, `findUnique({id})` | `create`, `update`, `delete` | Sorted `createdAt desc`. Manual single-record crud. |
| `reaction` | `findMany({articleId})`, `getCounts(articleId)` | `create` | Grouped counts keyed by `type` (INSIGHTFUL/URGENT/ESSENTIAL/BALANCED + unknown types). **No dedupe / no rate-limit at data layer** — per-IP limiting only in `server.ts`. |
| `comment` | `count({status})`, `findMany({status})` | `create` (default status `PENDING`), `update` | `findMany` attaches `article {title, slug}`. No delete op. |
| `poll` | `findFirst({active})`, `findUnique({id})` | `create`, `update` | `options` = JSON array `[{option, votes}]`. Route does **read-modify-write** on votes (lost-update race, see §5.4). |
| `siteSetting` | `findUnique({key})` | `create` | **No update accessor** — re-creating the same key would produce a duplicate row on Postgres (unique `key` rejects). Needs `upsert`. |
| `auditLog` | `findMany` | `create` | Append-only. Route/admin UI lists all (no paging). |
| `homepageConfig` | `findFirst` | `upsert(data)` (always overwrites with `id:'default'`, does **not** honor `where`), `update` | Singleton semantics — must map to a PK-fixed single row. |
| `newsletterSubscription` | — | `upsert({where:{email}, update, create})` | `update` payload ignored for existing subscribers (idempotent). `subscribedAt` only on create. |
| `analyticsEvent` | `findMany({orderBy, take})` | `create` | Append-only telemetry. |
| *(dormant)* `userSessions`, `urlRedirects`, `adPlacements`, `photoGalleries`, `galleryItems`, `videoRecords` | ❌ none | ❌ none | Persisted in JSON but unreachable from code. Decision needed (§3.5). |

`userSession` note: `UserSession` exists in the Prisma schema (token-based UUID sessions) but the runtime auth system is **stateless JWT + jti revocation** (`revokedSessions`); the `UserSession` table is unused by runtime code either way.

### 1.4 every caller of `src/lib/db.ts`

| Caller | Import shape | Usage |
|---|---|---|
| `server.ts` | `import { db as prisma } from './src/lib/db.ts'` (**aliased as `prisma`**) | ~240 call sites across all public/admin/auth/workflow routes incl. `prisma.$transaction([...])` (list endpoint), fire-and-forget `article.update({views:{increment:1}})` on article view, purge jobs at startup |
| `src/server/scheduler.ts` | `import { db }` | `runPublishingSchedulerSweep` (60s): scheduled→published promotion + editorial event + audit log (3 separate writes, non-atomic), idempotency check implemented as JS `.find()` over `publicationSchedule.findMany()` |
| `src/server/health.ts` | `import { db }` | `db.category.count()` for `/health` |
| `src/lib/seed.ts` | `import { db }` | Dev seed via `user/category findUnique-or-create`, `authorProfile` |
| `src/server/authMiddleware.ts` | `import { db }` | `requireAuth` → `user.findUnique`, `revokedSession.isRevoked(jti)`, `passwordChangedAt` check |
| `tests/{bootstrap,integrity,authorization,adminShell,taxonomy,articleEditor,workflow,qa}.test.ts` | `import { db }` | **8 legacy test files against the real `data/database.json`** — writes test data into the live JSON store (§7, §9) |
| `tests/security/*` (all 6 spec files + harness) | `import { InMemoryTestDb } from './testDb.ts'` | Isolated in-memory reimplementation of the same interface; **no JSON file I/O, no production data** — this is the pattern to keep (§7) |

### 2. Hidden assumptions in route handlers (`server.ts`)

These are behaviors current route logic relies on, either **not implemented by Prisma semantics** or only implemented because of JSON quirks. The repository layer (§4) must reproduce or consciously change them — with review sign-off per row.

| # | Route(s) | Hidden assumption / quirk | Required in migration |
|---|---|---|---|
| 2.1 | `POST /api/articles` | Creates article, then (separately) `articleTag.createMany`, then looped `articleMedia.create`, then `auditLog.create` — each write rewrites the JSON file | Move to **one transaction** (§5.1). On PG each is a real FK/hooks. A partial failure today leaves an article with missing tags/media — the migration must not preserve that. |
| 2.2 | `POST /api/articles` | Slug generated as `kebab(title)+ '-' + Date.now().slice(-4)`; collisions unlikely but possible; slug uniqueness enforced by `IntegrityError` → 500 (should be 409) | Keep generator; add repository **slug-unique retry** + map `IntegrityError` → `P2002` → HTTP 409. |
| 2.3 | `PUT /api/articles/:id` | `articleMedia` and `articleTags` replaced by **deleteAll + recreate** inside digits of the same handler; revision snapshot + version increment happen inside `article.update` | Tx boundary (§5.2). Preserve "content-changed ⇒ new revision, version++" and **views increments must NOT create revisions or bump version**. |
| 2.4 | `PUT /api/articles/:id` | Extra fields written by routes (`imageCaption`, `imageCredit`, `sourceAttribution`, `seoTitle`, `seoDescription`, `socialImage`, `articleType`, `editorialNote`) are silently absorbed into the JSON document via spread | Prisma schema **does not have these columns** — silent data loss if unmigrated. Add columns (§3.3). |
| 2.5 | `POST /api/articles/:id/transition` | Sets `publishedAt` on first publish, `scheduledFor` for SCHEDULED, writes `editorialNote`; then editorial event, then audit log | Tx chain (§5.3). `editorialNote` column missing from schema. |
| 2.6 | `DELETE /api/articles/:id` | Cascade of comments, revisions, liveBlogUpdates, articleMedia happens **manually in JSON** with no atomicity | Rely on schema `onDelete: Cascade` (already declared) inside a tx; **decision needed**: revision history destruction on delete (§5.6 open question). |
| 2.7 | `GET /api/articles/:slug` public | View increment fire-and-forget with `.catch(() => {})` — a throw-away write; any unrecoverable PG hiccup is discarded | Keep fire-and-forget; on PG `{increment:1}` becomes atomic `UPDATE ... SET views = views + 1`. |
| 2.8 | `GET /api/articles` paginated | `prisma.$transaction([findMany, count])` — with JSON this is just two consistent-in-memory reads returning consistent totals | PG gives this **for free via one tx**; keep call shape. Also note JSON `findMany` appends `.total` to the array when paged — the destructuring in `server.ts` uses `Promise.all` result, so parity stays. |
| 2.9 | `GET /api/articles` search | `OR: [{title|excerpt|content: {contains: x, mode:'insensitive'}}]` | Prisma supports `mode: 'insensitive'` directly. JSON version lowercases title / excerpt / content but ignores `mode` flag — **JSON searches excerpt/content, PG `contains` filter would not**; the repository must keep the 3-field OR. |
| 2.10 | Archive/Filter routes | `year` / `month` filters (`new Date(publishedAt \|\| createdAt).getFullYear()`) implemented in JS over ISO strings | Map to `WHERE EXTRACT(YEAR ...)` computed by repository (add `@@index([publishedAt])` exists). |
| 2.11 | `PUT /api/articles/:id` | Route **forbids** status changes generically; only `/transition` may change state | Pure route logic — repository should expose an ordinary `update` that still refuses-represents? No: keep guard in service layer (§4). Not a repository concern. |
| 2.12 | Scheduler | Articles with `status:'SCHEDULED'` + `scheduledFor <= now` are promoted; idempotency key `sched-pub-${id}-${version}` checked by JS scan | Tx (§5.4) + `findUnique({idempotencyKey})` + single-runner advisory lock. Note: articles reaching `SCHEDULED` **never create a `PublicationSchedule` row today** — only the sweeper creates (implicitly none writes one either: the route **writes none**). The idempotency row is only written by ... nobody — replaced by a proper `upsert` in the new flow (§5.4). |
| 2.13 | Scheduler + transitions | `editorialEvent.actorId = 'usr-system-daemon'` for automated actions; **no such user exists** in the DB | `User` FK is `Restrict` on `EditorialEvent`. Either seed a locked system user OR make `actorId` nullable/optional.(seed currently creates no daemon user). |
| 2.14 | Login / reset / role change | `auditLog.create` happens *after* the primary write, in separate calls | Tx chains (§5.5); keep append-only. |
| 2.15 | `POST /api/media`, `PUT /api/media/:id`, `DELETE /api/media/:id` | Media metadata mutations + content rewrites (`content.replaceAll(originalUrl → replacementUrl)`) with no atomicity; content matching uses **raw substring** on stored HTML | Tx (§5.6). URL-matching/rewriting stays in service layer (§4). |
| 2.16 | Reactions / comments / poll votes | All single-write or read-modify-write | Atomic counters on PG (`{increment}`) + row-locking tx for poll (§5.4). |
| 2.17 | `GET /sitemap-news.xml` | `where: {status:'PUBLISHED', publishedAt: {gte: twoDaysAgo}}` — **JSON db does not implement `gte` filters** (returns all PUBLISHED) | Prisma handles natively — this is one of the places PG changes observable *data* (correctly). Document the behavior change. |
| 2.18 | `authorProfile.update` (route `PUT /api/authors/:userId`) | Upsert-style with implicit create; also merges `userId` from where | Repository exposes `upsert` explicitly. |
| 2.19 | `POST '/api/newsletter/subscribe'` | `upsert({update:{}})` idempotent; unique email key is case-sensitive in PG while JSON is exact-match too (here they actually match) | Normalize email to lowercase at write time (parity with `user.upsert` lowercasing on login lookup). |
| 2.20 | Error contract | `IntegrityError` → callers mostly `res.status(500)` anyway (no dedicated mapping) | Repository will express uniqueness as `P2002`-like `RepoUniqueViolationError` with typed names so routes can deliver 409. Not required to change response codes in 6B but recommended. |

### 2.5 Non-behavioral risks in today's JSON runtime worth restating for the plan

- **Corruption response = cold-fresh DB.** `readDb()` catch-path returns empty collections. Production publishing must **never** silently degrade to an empty ledger. *(Should be added to `docs/DEFECT_REGISTER.md` as a new OPEN defect in Phase 6B.)*
- **All-or-nothing writes are lost** since `save()` failures are swallowed (defect from §1.2).
- **`$transaction` is not a transaction** — every "multi-step" op can half-complete (defect from §1.2).
- **Legacy tests touched `data/database.json`** via `import { db }` (§1.4, last group). `npm test` today *pollutes* the JSON store. This must be addressed in the migration story (§7, §10).

---

## 3. Mapping: JSON entities → Prisma/PostgreSQL schema

### 3.1 Relationship mapping table (core deliverable #1)

Legend: `Cascade`/`Restrict`/`SetNull` from the Prisma schema's `onDelete`.

| JSON collection | Prisma model (exists?) | FK targets (child → parent) | Delete behaviour target | Notes / gaps |
|---|---|---|---|---|
| `users` | ✅ `User` | — | — | `role` enum mismatch (§3.2). Missing `passwordChangedAt`. Missing `behavior` fields? (see §3.3). |
| `userSessions` | ✅ `UserSession` → `User` (Cascade) | `userId` | Cascade | **Runtime-unused** (JWT stateless). Keep model, mark unused or drop with sign-off. |
| `authorProfiles` | ✅ `AuthorProfile` → `User` (Cascade) | `userId @unique` | Cascade | JSON ↔ this is parity. Schema has no index on `id` (it's PK — fine). |
| `categories` | ✅ `Category` | self-FK `parentId` → `Category` (**Restrict**) | Restrict | JSON also *restricts* via checks; parity. Needs **circular-hierarchy guard** preserved in service layer (PG has no cycle prevention) — replicate `db.category.update` ancestor-walk as service logic + optionally SQL `WITH RECURSIVE` guard. |
| `tags` | ✅ `Tag` | — | — | JSON `delete` is unrestricted ⇒ dangling `articleTags`. **Adding `Restrict` is a behavior change** — decide (§3.5 Q4). |
| `articleTags` | ✅ `ArticleTag` | `articleId` → Article (Cascade), `tagId` → Tag (Cascade) | Cascade | Natural PK `(articleId, tagId)` in schema; JSON has synthetic `id` + `createdAt` that will be **dropped**. Existing rows migrate by key. |
| `articles` | ✅ `Article` | `categoryId` → Category (**Restrict**), `authorId` → User ("PrimaryAuthor", **Restrict**), `coverImageId` → MediaAsset (SetNull) | Restrict / Restrict / SetNull | `coverImageId` is currently **null for ALL 30 rows** — articles use `coverImage` (a URL string) instead (§3.3, migration step). |
| `articleContributors` | ✅ `ArticleContributor` | `articleId` → Article (Cascade), `userId` → User (Restrict) | Cascade / Restrict | `@@unique([articleId, userId])` — good; **no runtime reader exists**. |
| `articleRevisions` | ✅ `ArticleRevision` | `articleId` → Article (Cascade), `editorId` → User (Restrict) | Cascade / Restrict | **Add `@@unique([articleId, version])`** — currently unenforced; duplicates possible from concurrent saves. **Add index `(articleId, createdAt)`?** (existing `articleId` + `version` indexes are enough). |
| `editorialEvents` | ✅ `EditorialEvent` | `articleId` → Article (Cascade), `actorId` → User (**Restrict**) | Cascade / Restrict | `actorId` FK will reject `'usr-system-daemon'` unless seeded (§4.3 / §5.4). `fromStatus` mismatch guard: JSON sometimes writes `fromStatus` not in enum? Current data is clean. |
| `publicationSchedules` | ✅ `PublicationSchedule` | `articleId` → Article (Cascade) | Cascade | `idempotencyKey @unique` — good; not yet used properly by the sweeper (§5.4 redesign). |
| `mediaAssets` | ✅ `MediaAsset` | `uploaderId` → User (**Restrict**) | Restrict | Missing columns `focalX`, `focalY` (JSON always stores them; defaults 50/50). `cdnUrl`, `width`, `height`, `altText`, `caption`, `credit` in schema — JSON has `altText`? Yes through route writes. Verify per-row nullity during export (§6.3). |
| `articleMedia` | ✅ `ArticleMedia` | `articleId` → Article (Cascade), `mediaAssetId` → MediaAsset (**Restrict**) | Cascade / Restrict | JSON schema adds `placement` ('INLINE','HERO','SIDEBAR') — keep TEXT or CHECK constraint. **Add `@@unique([articleId, mediaAssetId])`** and `@@index([articleId, position])`. |
| `photoGalleries` + `galleryItems` | ✅ `PhotoGallery` / `GalleryItem` → MediaAsset (Restrict) | — | Cascade | **Runtime-unused.** Migrate (empty today) anyway for completeness. |
| `videoRecords` | ✅ `VideoRecord` | — | — | Runtime-unused. |
| `liveBlogUpdates` | ✅ `LiveBlogUpdate` | `articleId` → Article (Cascade), `authorId` → User (**Restrict**) | Cascade / Restrict | |
| `breakingNewsAnnouncements` | ✅ `BreakingNewsAnnouncement` | `articleId` → Article (SetNull, `@unique`) | SetNull | JSON route writes never set `articleId` (only the auto synthetic `'brk-lead-auto'` object at response-time). Parity fine. |
| `comments` | ✅ `Comment` | `articleId` → Article (Cascade) | Cascade | `status` enum parity ('PENDING','APPROVED','REJECTED','SPAM'). |
| `polls` | ✅ `Poll` | — | — | `options` JSON — array of `{option, votes}` matches. |
| `newsletterSubscriptions` | ✅ `NewsletterSubscription` | — | — | `email @unique`. |
| `urlRedirects` / `adPlacements` | ✅ `UrlRedirect` / `AdPlacement` | — | — | Runtime-unused; `AdPlacement` has impression/click counters. |
| `siteSettings` | ✅ `SiteSetting` | — | — | JSON has no update op only create; parity via `upsert` at repository. |
| `auditLogs` | ✅ `AuditLog` | `userId` → User (SetNull) | SetNull | **Fix duplicated `@@index([action])`** in schema (declared twice). |
| `reactions` | ❌ **missing model** | — | — | Must add `Reaction` model: `articleId` FK, `type` text or enum, `ipHash` optional, timestamps (§3.3). |
| `passwordResetTokens` | ❌ **missing model** | — | — | Must add `PasswordResetToken`: `tokenHash @unique`, `userId` FK (Restrict), `expiresAt`, `usedAt`, `createdAt` (§3.3). |
| `revokedSessions` | ❌ **missing model** | — | — | Must add `RevokedSession`: `jti @unique`, `userId` FK, `revokedAt`, `expiresAt` (§3.3). |
| `homepageConfigs` | ❌ **missing model** | — | — | Must add `HomepageConfig`: singleton row (fixed PK), `featuredArticleId`/`breakingArticleId` optional FKs to Article (SetNull), `breakingBannerActive`, `sectionOrder JSONB` (§3.3). |

### 3.2 Role enum mismatch (must resolve before any user import)

Runtime `src/modules/auth/permissions.ts` `RoleType`:
`SUPER_ADMIN, ADMIN, MANAGING_EDITOR, SECTION_EDITOR, COPY_EDITOR, REPORTER, PHOTOGRAPHER, VIDEO_EDITOR, ADVERTISING_MANAGER, ANALYST, READER`

Prisma schema `RoleType` enum (out of sync with runtime):
`ADMIN, EDITOR, JOURNALIST, CONTRIBUTOR, READER`

Actual role values present in the live JSON store (local file counts, 2026-11-05):
`ADMIN(×2), REPORTER(×6), ANALYST(×1), COPY_EDITOR(×1), MANAGING_EDITOR(×1), ADVERTISING_MANAGER(×1), JOURNALIST(×6)`

Of those, only `JOURNALIST` even exists in the Prisma enum. **Migration must re-align the DB enum to the runtime `permissions.ts` list** (drop `EDITOR`, `CONTRIBUTOR` — unused by runtime code — and add `SUPER_ADMIN, MANAGING_EDITOR, SECTION_EDITOR, COPY_EDITOR, REPORTER, PHOTOGRAPHER, VIDEO_EDITOR, ADVERTISING_MANAGER, ANALYST`). Historical values map through §6.4.

### 3.3 Schema changes required (Phase 6B):

**New models** (§3.1 last four rows):
1. `Reaction`, `PasswordResetToken`, `RevokedSession`, `HomepageConfig` (singleton).

**New columns / fields** (routes write them, schema lacks them):
2. `User.passwordChangedAt DateTime?` (Phase 4 auth relies on it).
3. `MediaAsset.focalX Int @default(50)`, `MediaAsset.focalY Int @default(50)`.
4. `Article` additions: `imageCaption String?`, `imageCredit String?`, `sourceAttribution String?`, `seoTitle String?`, `seoDescription String?`, `socialImage String?`, `editorialNote String?`. (`articleType` column exists in schema — verified.)
5. `Article.coverImage String?` — the **URL string** the whole runtime persists today; `coverImageId` stays nullable FK alongside for future normalization. Do **not** drop `coverImage` in this migration (front-end renders it directly; §3.5 Q2).

**Missing constraints / indexes (add in migration SQL):**

| Location | Add | Why |
|---|---|---|
| `ArticleRevision` | `@@unique([articleId, version])` | Version integrity for restore endpoint |
| `ArticleMedia` | `@@unique([articleId, mediaAssetId])`, `@@index([articleId, position])` | Dedupe and ordered reads |
| `RevokedSession` (new) | `jti @unique`, `@@index([expiresAt])`, `@@index([userId])` | O(1) revocation checks; purge index |
| `PasswordResetToken` (new) | `tokenHash @unique`, `@@index([userId])`, `@@index([expiresAt])` | Hashed lookups + purge |
| `Reaction` (new) | `@@index([articleId, type])` | Counts endpoint |
| `AuditLog` | `@@index([entityType, entityId])` | Admin "who changed what" lookups; also fix duplicated `@@index([action])` |
| `AnalyticsEvent` | `@@index([type, createdAt])` | Dashboard filters |
| `Comment` | `@@index([articleId, status])` | Approved-per-article reads |
| `Article` | `@@index([status, publishedAt])` | Homepage, sitemap-news, scheduler scans |
| `User.email` | Keep unique index; **normalize all emails to lowercase at import**, keep `bcrypt` case-insensitive lookups at repository level (Postgres unique + citext both work; simplest is `lower(email)` normalization on all writes) | Case-insensitive uniqueness parity |

`SiteSetting.key @unique` — verify it exists in schema as unique (yes it does via `@unique`), then JSON seeds cleanly.

### 3.4 Data-shape conversions

| JSON shape | PostgreSQL target | Rule |
|---|---|---|
| `createdAt/updatedAt/publishedAt/scheduledFor/expiresAt/revokedAt/...` → ISO-8601 **strings** | `TIMESTAMP(3)` with `TIME ZONE` resolved via Postgres session (Prisma handles ISO string → DateTime conversion) | Parse every input; reject/repair non-ISO values at export time |
| `socialLinks` object | `AuthorProfile.socialLinks JSONB` | Straight copy |
| `poll.options` array of `{option, votes}` | `Poll.options JSONB` | Validate array shape |
| `siteSettings.value` | `SiteSetting.value JSONB` | Straight copy |
| `homepageConfigs` singleton | New `HomepageConfig` table, PK fixed to `'default'` | Only upsert if a row exists |
| `mediaAssets.focalX/focalY` numbers | ints | Code defaults 50/50 |
| `articles.coverImage` URL string | `Article.coverImage TEXT` (new column) | Straight copy of URLs (`https://images.unsplash.com/...`) — **no path rewriting** |
| `articles.coverImageId` | Stays null unless a matching `mediaAssets.id` actually exists | At import, if cover-URL equals a media `originalUrl`, optionally link `coverImageId` — snapshot this as *nice-to-have*, not required |
| `articleTags` synthetic `id`, `createdAt` | Natural PK `(articleId, tagId)` | Columns dropped |
| `revokedSessions`/`passwordResetTokens` text ids | New tables; `jti`/`tokenHash` as unique key, synthetic `id` optional | Either keep strings `prt-*` or uuid default; recommend **uuid default** and keep `tokenHash` uniqueness |
| JSON `id` prefixes (`art-`, `usr-`, `rev-`…) | TEXT PKs keep exact values | **Never regenerate IDs** — revisions/events/media reference them; keep app-generated prefixedIDs (repo returns created IDs as-is) |

### 3.5 dormant collections & open decisions (stop-for-review questions)

| # | Question | Recommendation |
|---|---|---|
| Q1 | Migrate dormant collections (`userSessions`, `urlRedirects`, `adPlacements`, `photoGalleries`, `galleryItems`, `videoRecords` — all empty in the local store) as empty tables? | Yes, keep schema parity; zero cost, avoids future schema surprises. |
| Q2 | `Article.coverImage` URL string alongside `coverImageId` FK — keep both through Phase 6, normalize later? | Keep both; single write path via repository (writes `coverImage` + optionally backfills `coverImageId`) — removes a **behavior landmine** where `db.mediaAsset.delete` blocks on `coverImageId` while the article still renders a URL. |
| Q3 | Should scheduler's pseudo-user `usr-system-daemon` become a real, seeded, disabled user or should `editorialEvent.actorId` become nullable? | Seed `usr-system-daemon` as `isActive:false`, role `READER`, name "System Daemon". Least schema churn; keeps auditability. |
| Q4 | `tag.delete` currently unrestricted ⇒ after PG migration keep restrict-free with cleanup? | Change to **Restrict** or cascade `articleTags` on delete. Recommend explicit `Restrict` + repository catches and deletes `articleTags` first — same visible behavior, no dangling rows. |
| Q5 | Deleting an article destroys revision history (JSON + Prisma schema both cascade). Editorial/legal requirement? | Confirm with newsroom policy. If history must be kept, switch `revisions` FK to `Restrict` and require explicit "archive" (matches homepage deletion semantics) — **needs product sign-off.** |
| Q6 | Prisma generator/CLI version skew: `@prisma/client ^7.10.1` (dep) vs `prisma ^8.0.0-rc.27` (devDep) — major mismatch. | Align both to one stable major (recommend matching the app's generator `provider = "prisma-client-js"` version before any `migrate`)  — §10. |

---

## 4. Repository / Service interface (core deliverable #3)

### 4.1 Two-tier design

```
Route (server.ts)  ──►  Service (domain rules, permissions, workflow)  ──►  Repository (data access port)
                                   │                                              │
                                   │                                     ┌────────┴────────┐
                                   │                                     ▼                 ▼
                                   │                             PrismaPgRepository  JsonRepository (test/dev only)
                                   │                                     (tx helpers live here)
```

- **Repository port**: the only thing that talks to storage. Interfaces mirror today's capabilities but **hide storage dialect** (no `{views:{increment}}` Prisma DSL leaking into routes — service names it `incrementArticleViews`).
- **Service**: workflow guards (state machine, separation of duties), ownership checks, sanitization, transactions.
- `server.ts` currently inlines these concerns; 6B moves them without changing HTTP responses.

### 4.2 Interface sketch (TypeScript, `src/db/ports.ts` — to be created in 6B)

```ts
// Doc-only sketch. Nothing added yet.
export interface UnitOfWork {
  run<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;   // real DB transaction
}

type ListArticlesParams = {
  status?: ArticleStatus; categoryIdSlug?; authorId?; year?; month?;
  search?: string;            // title/excerpt/content OR
  priority?: PriorityLevel;
  page?: number; limit?: number;   // returns { items, total }
};

export interface ArticleRepository {
  findById(id: string): Promise<ArticleView | null>;
  findBySlug(slug: string): Promise<ArticleView | null>;        // includes category/author/comments/revisions/media joins
  listPublished(params: ListArticlesParams): Promise<{ items: ArticleListItem[]; total: number }>;
  listForEditor(params: ListArticlesParams): Promise<{ items; total }>;
  create(input: NewArticle, actor: ActorRef): Promise<Article>;       // tx: article + revision#1 + editorial event + audit
  update(id: string, input: ArticleUpdate, actor: ActorRef): Promise<Article>;  // tx: revision (if content changed) + version bump
  replaceTags(articleId, tagIds): Promise<void>;                       // tx: deleteMany + createMany
  replaceMedia(articleId, mediaAssets[]): Promise<void>;               // tx: deleteMany + createMany
  transition(id, target, actor, note?): Promise<Article>;              // tx: update + publishedAt/scheduledFor + editorial event + audit
  incrementViews(id: string): Promise<void>;                           // atomic UPDATE views = views + 1
  delete(id: string, actor: ActorRef): Promise<void>;                  // tx with cascade + audit
  countByStatus(status): Promise<number>;
  totalViews(): Promise<number>;
  listPublishedSince(date): Promise<ArticleRef[]>;                     // sitemap-news
}

export interface UserRepository {
  findByEmail(emailNormalized): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  list(): Promise<User[]>;
  create(input: NewUser): Promise<User>;      // email case-normalized; unique → typed error
  update(id: string, patch: UserPatch): Promise<User>;
  deactivateIfNoArticles(id): Promise<'deleted'|'blocked'>;   // referential-protection parity
  count(): Promise<number>;
  markLogin(id): Promise<void>;  // audit handled by service
}

export interface SecurityTokenRepository {
  createPasswordResetToken({ tokenHash, userId, expiresAt }): Promise<void>;  // purges user's expired in same tx
  consumePasswordResetToken(tokenHash): Promise<ResetToken | null>;            // single tx read+markUsed
  revokeSession(jti, userId, expiresAt): Promise<void>;
  isSessionRevoked(jti): Promise<boolean>;                                     // expiresAt > now in SQL
  purgeExpiredSecurityTokens(): Promise<void>;                                 // both tables, one tx
}

export interface CategoryRepository { /* create/update/delete(restrict)/banner/graph ops */ }
export interface MediaRepository { /* create/update/delete(restrict+replacement rewrites) /list/findByUrl */ }
export interface EngagementRepository { /* reactions, comments, polls (row-locked vote tx) */ }
export interface SiteOpsRepository { /* settings upsert, homepage config, audit, analytics, newsletter */ }
export interface SchedulerRepository { /* due scheduled articles, find/create schedule by idempotency key (upsert) */ }
```

Error contract: repositories throw domain-typed errors — `RepoUniqueViolation`, `RepoForeignKeyViolation`, `RepoNotFound`, `RepoReferentialBlock` — plus Introduce `RepoCorrupt` convention for the PG-side unreachable case. Route handlers keep 500s except where they intentionally want 4xx (409 on uniqueness) — decided in 6B.

Wiring: `src/db/index.ts` exports `createRepositories(prismaClient | null)`; `server.ts` receives it; **`DB_DRIVER=json` is never valid in production** (§7).

---

## 5. Transaction boundaries (core deliverable #4)

The JSON `$transaction` is `Promise.all` — **not** atomic. Below are the real PostgreSQL transaction boundaries needed (`prisma.$transaction(async (tx) => {...})` interactive-transactions).

### 5.1 Article creation
```
TX createArticle:
  ├ validate category + author (FKs enforced anyway)
  ├ INSERT article (payload from route: title/slug/excerpt/content/coverImage/categoryId/authorId/status/priority/videoUrl)
  ├ INSERT revision #1 (title, excerpt, content, editor = author, changeSummary 'Initial article creation')
  ├ articleTag.createMany (dedupe) — only if tagIds supplied
  ├ articleMedia.create × n — only if mediaAssets supplied
  ├ editorial event (CREATE) + audit log (CREATE_ARTICLE)   ← currently in one step after, keep in the same TX
  └ commit
Failure ⇒ nothing visible; slug unique conflicts map to 409.
```

### 5.2 Article update (`PUT /api/articles/:id`)
```
TX updateArticle:
  ├ SELECT ... FOR UPDATE the article row (Prisma: return within interactive txn; serialize anyway by unique row)
  ├ version_prev → version_prev + 1
  ├ if content changed ⇒ INSERT revision (new version, content, editorId)
  ├ apply field patch (never status / scheduledFor — route forbids)
  ├ if mediaAssets provided ⇒ deleteMany + createMany (replace-all)
  ├ if tagIds provided ⇒ deleteMany + createMany (replace-all)
  └ audit log (UPDATE_ARTICLE) + commit
```

### 5.3 Workflow transition (`POST /api/articles/:id/transition`)
```
TX transitionArticle:
  ├ read current status (treat as authoritative inside tx — avoid TOCTOU on double-click)
  ├ state-machine validation (existing validateStateTransition) BEFORE writing
  ├ update article (status, publishedAt on first publish, scheduledFor for SCHEDULED, editorialNote)
  ├ editorial event (TRANSITION_TO_*)
  └ audit log (WORKFLOW_*)
```

### 5.4 Scheduler sweep (`runPublishingSchedulerSweep`)
```
Per-due-article TX + process-level lock:
  ├ pg advisory lock per article (single-flight against overlapping sweeps)
  ├ findUnique({idempotencyKey: sched-pub-${articleId}-${version}}) → if EXECUTED, skip
  ├ update article status/month: PUBLISHED, publishedAt = scheduledFor (preserve true publish time)
  ├ UPSERT PublicationSchedule (idempotencyKey, status EXECUTED, executedAt)     ← NEW: today no row is ever written; we make idempotency real
  ├ editorial event (AUTOMATED_PUBLISH|RECONCILED_PUBLISH, actor = seeded system daemon user)
  └ audit log
Failure ⇒ schedule row marked FAILED with failureReason; article untouched; retry next sweep.
```

### 5.5 Auth flows
```
Forgot password:      tx { purge user's expired tokens + insert new hashed token }
Reset password:       tx { read token(hash, usedAt null) → user.update(passwordHash, passwordChangedAt=now) → mark token used → audit }  // one atomic flow today; must stay atomic
Login:                single INSERT audit log—not critical, but keep in tx with session revocation
Logout:               tx { revokedSession.revoke(jti) + audit }
```

### 5.6 Media replace/delete (`DELETE /api/media/:id?replacementId=...`)
```
TX safeDeleteMedia:
  ├ compute dependent articles (coverImageId / coverImage-URL / content substring — same matching rules)
  ├ if no dependent articles ⇒ delete asset + audit
  ├ else if replacement provided ⇒ for each dependent:
  │     update coverImageId / coverImage URL / content.replaceAll(url→url) — three per-branch writes
  │   delete asset + audit
  └ else ⇒ refund logical 409 (unchanged handling)
```

### 5.7 Engagement
```
Poll vote:  tx { SELECT ... FOR UPDATE poll row → mutate options JSON → update }  // fixes lost-update race
Reactions:  single INSERT (keep IP limiting route-side; optionally composite-index counts)
Comments:   single INSERT / status update — keep simple
```

### 5.8 Media & view count parity
- `views` uses `{increment:1}` everywhere — Prisma native `increment` → single atomic SQL statement. No lost updates, no revision noise.
- `articleMedia.position` — replace-all strategy inside the same tx as the article update.

---

## 6. Export / Import (core deliverable #5)

### 6.1 Overview

```
export tool (reads current JSON store, read-only!)          import tool (targets disposable → then cutover PG)
  └─ validates per-entity schema + FK + enum + checksum record counts
```

Two new CLI scripts (created in 6B, not now):

| Script | Purpose |
|---|---|
| `npm run db:export` | `src/db-migration/export-from-json.ts` — parse `data/database.json` (read-only), validate, write `data/migration/legacy-export.json` + `data/migration/export.meta.json` (counts + SHA-256, produced by `crypto.createHash('sha256')` over canonicalized JSON) |
| `npm run db:import` | `src/db-migration/import-to-pg.ts` — read export + meta, transactionally insert all entities (topological order), verify counts + relationship invariants + checksum, write `data/migration/import.report.json` |
| `npm run db:verify` | `src/db-migration/verify-pg.ts` — re-run relationship validation + record counts against live PG; diff vs export.meta; exits 1 on drift |

### 6.2 Import order (topological, respects FKs)

```
1. users                     (role enum mapped per §3.2)
2. categories                (parents first, then children)
3. editorial system principals: usr-system-daemon (Q3)
4. authorProfiles            (depends on users)
5. tags
6. mediaAssets               (depends on users)
7. articles                  (depends on users, categories, optional coverImageId)
8. articleTags               (depends on articles, tags)
9. articleMedia              (depends on articles, mediaAssets)
10. articleRevisions         (depends on articles, users-as-editors)
11. editorialEvents          (depends on articles, system/user actors)
12. articleContributors      (depends on articles, users)
13. publicationSchedules
14. liveBlogUpdates, breakingNewsAnnouncements, comments, polls
15. newsletterSubscriptions, urlRedirects, adPlacements,
    photoGalleries + galleryItems, videoRecords, siteSettings,
    auditLogs, reactions, analyticsEvents, homepageConfigs
16. passwordResetTokens, revokedSessions         (security-critical, purge expired)
```

Wrap the entire import in one serializable transaction (or batched `tx`s of ~1k parents, controlled by `--batch-size`) so a failure never leaves a half-populated target.

### 6.3 Checks the export/import run

1. **Record counts per entity** — emitted per collection, compared before/after import, recorded in both meta and report files, exit non-zero on mismatch. Current local-store baseline (2026-11-05, **fresh count required at cutover**; these numbers came from reading supplied repo-local file, not any production system):

   users 18 · userSessions 0 · authorProfiles 9 · categories 12 · tags 0 · articleTags 0 · articles 30 · articleContributors 0 · articleRevisions 35 · editorialEvents 8 · publicationSchedules 0 · mediaAssets 16 · articleMedia 16 · photoGalleries 0 · galleryItems 0 · videoRecords 0 · liveBlogUpdates 0 · breakingNewsAnnouncements 0 · comments 0 · polls 1 · newsletterSubscriptions 0 · urlRedirects 0 · adPlacements 0 · siteSettings 1 · auditLogs 8 · reactions 0 · homepageConfigs 0 · analyticsEvents 0 · passwordResetTokens 0 · revokedSessions 4

2. **Relationship invariants** validated before import:
   - every `article.categoryId` → category exists
   - every `article.authorId` → user exists
   - every `articleMedia.articleId` → article exists AND `.mediaAssetId` → mediaAsset exists
   - every `articleTag.articleId/tagId` exists
   - every `articleRevision.articleId` → article exists; `editorId` → user exists
   - every `editorialEvent.articleId/actorId` exists (missing actor ⇒ substitute `usr-system-daemon` **only with explicit `--fix` flag**, else fail)
   - every `breakingNewsAnnouncement.articleId` exists (if non-null)
   - `liveBlogUpdate.authorId`, `articleContributor.userId`, `mediaAsset.uploaderId` exist
   - **dangling refs are exported to `data/migration/orphans.json` and must be reviewed before import proceeds** (the JSON layer tolerated them; PG will not).
3. **Enum mapping** (§6.4) — every `role`, `status`, `priority`, `assetType`, comment `status` value must be present in the target enum post-mapping.
4. **Slug integrity**: flag any duplicate `article.slug` (or `category.slug`, `tag.slug`, `videoRecord.slug`, `photoGallery.slug`) — the JSON layer only enforces on-create; slices that were hand-edited may violate.
5. **Timestamp parse**: every ISO string field parse; unparseable values listed in the report (fail unless `--fix` rewrites them to `createdAt` defaults).
6. **Content checksum**: SHA-256 of canonical per-entity payload (sorted keys, ISO normalisation) compared after import; per-entity `checksums: { users: e3b0..., articles: ...}`.
7. **Bcrypt hash integrity**: every `passwordHash` must match `^\$2[ab]\$10\$` (all 18 rows do today); any invalid hash fails the import, never "regenerates".
8. **Media URL/path audit**: list distinct `originalUrl` prefixes — local `/uploads/...` paths and external `https://*` — so post-migration media serving keeps working with no rewrites; verify each local path has a real file with the same name under `public/uploads/` (report-only, no auto-delete).

### 6.4 Value mappings

| Source value | Target value | Status |
|---|---|---|
| `ADMIN` | `ADMIN` | unchanged |
| `REPORTER` | `REPORTER` (new enum member) | added to managed enum |
| `ANALYST` | `ANALYST` (new) | added |
| `COPY_EDITOR` | `COPY_EDITOR` (new) | added |
| `MANAGING_EDITOR` | `MANAGING_EDITOR` (new) | added |
| `ADVERTISING_MANAGER` | `ADVERTISING_MANAGER` (new) | added |
| `JOURNALIST` | `JOURNALIST` (already in schema enum) | **decision needed** — runtime `permissions.ts` does not include JOURNALIST; treat as `REPORTER`? Keepas its own enum value for audit history? (§3.5 Q7) |
| `EDITOR`, `CONTRIBUTOR`, `READER` (schema-only roles) | — not present in data — decide whether to drop from enum (no historical rows) |
| article `status` values (`PUBLISHED`, `DRAFT` …) | Prisma `ArticleStatus` | parity |
| article `priority` (`BREAKING`, `FEATURED`, `NORMAL`) | Prisma `PriorityLevel` | parity |
| `mediaAssets.assetType` (`IMAGE`) | Prisma `MediaAssetType` | parity |

### 6.5 Rollback strategy

| Trigger | Action |
|---|---|
| Import fails validation | Nothing was written; PG target untouched. |
| Cutover smoke test fails | `DB_DRIVER` env remains `json`; no PG datasource selected — runtime decides by env, e.g. `DB_DRIVER=postgres\|json` (fail-closed: **production + `DB_DRIVER=json` ⇒ refuse to boot**; see §7). |
| Post-cutover defect discovered | Cold rollback: stop app, set `DB_DRIVER=json` (still keeping the untouched `data/database.json` snapshot), restart. **Write a re-export step** (`npm run db:export -- --from=pg`) that produces a JSON replenishment capsummed so the JSON snapshot can be refreshed from PG before rollback, if writes happened post-cutover. Full PG restore path: `pg_restore` of the pre-cutover dump. |
| Long-term rollback | Keep pre-cutover full snapshot: `data/database.json` frozen + `pg_dump` to `data/migration/backup-$ts.dump`. Both must be retained ≥ 30 days. |
| Warm dual-run (optional, recommended for safety) | After cutover, first N days: JSON snapshot file kept as read-only "shadow" updated only by a no-op admin command; **never read** by the running app. Prevents silent divergence while making rolled-back data harder to lose. Not a mandatory part of 6A plan — schedule for review. |

### 6.6 Cutover runbook (sketch — final runbook in 6B)

1. Maintenance window announced; app enters read-only mode (`MAINTENANCE_MODE=1` middleware gate) to stop writes.
2. `npm run db:export` on the live JSON store; **verify counts + checksums + orphans report = clean**.
3. `pg_dump` pre-migration snapshot.
4. `npm run db:import -- --target=$DATABASE_URL` (disposable first, then production DB).
5. `npm run db:verify` — must be a clean pass.
6. Point `NODE_ENV=production`, `DB_DRIVER=postgres`, `DATABASE_URL=...`; boot; smoke test (login, create article, upload media, publish, scheduler renders; `/health` shows `DB ok`).
7. Un-freeze writes; monitor error rate + scheduler sweeps for one editorial cycle.

---

## 7. JSON storage policy (core deliverable #6)

| Environment | Policy |
|---|---|
| `NODE_ENV=production` | **JSON is never used and never silently permitted.** `DB_DRIVER=json` must hard-fail startup with a config error naming the fix. No fallback chain. `DB_DRIVER=postgres` is the only boot path. |
| `db:import` / `db:verify` / `db:export` scripts | Rely on the same `DB_DRIVER` gate; they refuse to run against production URL without `--confirm-production` plus explicit `DATABASE_URL` echo-safety (also `--dryRun` first pass reporting only). |
| `NODE_ENV=development` | JSON still available (so tiny dev UX keeps working while ORM parity work is in flight) **only when `DB_DRIVER=json` is explicitly set**. Default for `NODE_ENV=development` becomes `json` — intentional, documented in `.env.example` with a "remigrate your brain" warning. |
| `tests/*` | Two tiers:<br>• unit/feature tests: **in-memory** `InMemoryTestDb` (as today's `tests/security/testDb.ts`) — never file-based;<br>• repository tests: **disposable Postgres** (§9), database per test run (`gcn_test_<runid>`), schema re-applied via `prisma migrate deploy`/`db push`.<br>**Legacy `tests/{bootstrap,integrity,…}.test.ts` files currently import the real `db` and write to the store — these must be retargeted to the in-memory repository or moved to the PG harness; no test file may import `src/lib/db.ts` directly.** |
| Fallback rule | **No automatic `json` fallback** in production ever. If `DB_DRIVER=postgres` fails to connect, the app crashes with a descriptive error rather than degrading. Health endpoint reports `degraded` only for transient issues after successful boot. |

---

## 8. Migration handling for pre-existing data (core deliverable #7)

| Concern | Handling |
|---|---|
| **Users** | Migrate all 18 rows with existing IDs, emails lower-cased+deduped, `isActive` from `isActive \|\| true` (schema default true), `role` mapped per §6.4. Add `passwordChangedAt = null` (all current tokens become valid — decision: security team sign-off that "null ⇒ no forced re-login" stays). |
| **Password hashes** | Copy `passwordHash` verbatim (`$2b$10$...`, bcrypt cost 10). **No rehashing during migration** (would invalidate all tokens & sessions). An opportunistic upgrade path (bcrypt cost or argon2) is a *separate* future phase, implemented at successful login, never as a bulk rewrite. |
| **Article statuses** | Already valid enum members (`PUBLISHED`, `DRAFT` ⇒ all also in schema). Any post-cutover new status requires a Prisma enum migration, never a data rewrite. |
| **`publishedAt` semantics** | Rows with `status='PUBLISHED'` must have `publishedAt`; rows with any other status may have null. Verified layout (all PUBLISHED rows have `publishedAt` set; all DRAFT null). Import fails loudly if any PUBLISHED row lacks `publishedAt` (report + list before fix). |
| **`viewCounts`/`version`** | `views` copied verbatim (Int, >= 0). `version` — its JSON default is 1 if missing; revisions are authored alongside, so their `version` numbers must strictly monotonically increase per article — verified during export. |
| **Article `slug`s** | Copied verbatim, lowercase-but-not-recreated; uniqueness re-verified; on conflict, the **older row (by `createdAt`, then ID) keeps the slug**, the newer gets `-${2}` suffix **only with explicit `--fix`; by default the import fails and humans decide.** |
| **Uploaded media paths** | `mediaAssets.originalUrl` copied verbatim: external `https://images.unsplash.com/...` and local `/uploads/<safe-file-name>` both kept. No path rewrite. `public/uploads/` directory **stays exactly where it is** until cloud storage is in scope. `filename` must match a file on disk (check only). No file moves. |
| **`cms`-side coverImage URL→ID backfill** | Qualified as "if a matching asset's `originalUrl` equals the article's `coverImage` URL, set `coverImageId`, else leave null" — optional, `--fix`-gated, not required. |
| **Timestamps** | All ISO strings parsed to `DateTime`. Prisma CLI writes `TIMESTAMP(3)`; lossy only to sub-ms precision, which JSON never carried (JS `Date.toISOString()` ms precision). Keep `@@map`-free column naming to preserve SQL column names exactly as in the schema. |
| **`revokedSessions`** | Only rows where `expiresAt > now` — expired rows dropped at import (count reported). Currently 4 rows, verify at cutover. |
| **`passwordResetTokens`** | Import only unexpired un-used tokens (currently 0). Token hashes migrate verbatim — they are opaque SHA-256 hashes, no encoding differences. |
| **`editorialEvents.actorId = 'usr-system-daemon'`** | Seeded as real, `isActive:false`, role `READER`, named "System Daemon" (Q3). Import without it will fail the editorialEvents FK otherwise. |
| **`auditLogs` vs `userId`** | `AuditLog.userId` FK is `SetNull`-on-delete — keep as a warning only (not a blocker) if an `authoredBy` user was soft-deleted. |
| **`articleContributors`, `articleTags`, `articleMedia`** | Convert synthetic JSON `id`+`createdAt` to the **natural composite PK** – the extra columns are intentionally dropped. Composite identity changes API responses do NOT (no endpoint returns those raw rows today — `articleTags.findMany` is internal replace-all). |
| **`revokedSessions`** → keep `jti` as the natural unique key; synthetic `id` dropped. |
| **JSON-only filters that can't exist in PG** (§2 rows 2.9/2.10/2.17) | Not a data-migration concern — repository-level query translation; flagged as behavior notes for regression tests. |

### 8.5 Deltas that will change observable behavior on PG (call out in test plan)

1. Tag deletion now blocks when in use (Q4) — a current 200 might become 409.
2. Case-insensitivity of user emails normalized at import (login by arbitrary case keeps working — the runtime already lowercases login lookups; **registration route should also lower-case on write**, §2 row 2.19).
3. `sitemap-news.xml` narrows to actually 48-hour-recent articles (§2 row 2.17 — a bug-fix improvement).
4. Orphaned `articleTags` (dangling tagId after a deleted tag) — cannot migrate; must be listed in orphans report. Currently count is 0, verify at cutover.
5. Revision uniqueness — if JSON created duplicate `(articleId,version)` rows (race), import fails; `--fix` renumbers the youngest duplicate.

---

## 9. Production-data risk assessment (core deliverable #8)

**Nothing in this phase touched production data.** `data/database.json` in the repo is treated as: local development/QA fixture. The assessment is *architectural* — risks the current persistence layer creates if it (or a copy of it) is ever in production:

### 9.1 Confirmed risks in the current JSON runtime (must not reach production)

1. **Silent empty-database restart** (§1.2 — corrupt/missing file → fresh schema). A single bad byte in the store erases the entire production newsroom on next boot. **Severity: catastrophic.**
2. **Non-atomic full-file writes** (crash mid-write ⇒ truncated JSON). Combined with #1 that means a crash can effectively wipe storage. **Severity: catastrophic.**
3. **`$transaction` is `Promise.all`** — every multi-step editorial operation (create-with-tags, update-with-media, transition-with-events) can half-commit. **Severity: high — silent data integrity erosion (e.g. published article missing tags/revision).**
4. **Swallowed `save()` errors** — process continues believing it persisted. **Severity: high.**
5. **No row-level concurrency control** — two article updates interleave last-writer-wins at whole-file granularity; scheduler + HTTP can race on the same article. **Severity: high under real editorial load.**
6. **`views` lost-update races** — two concurrent article views both read the same count and one increment is lost. **Severity: degrades analytics accuracy.**
7. **Append-only tables (`auditLogs`, `analyticsEvents`, `revokedSessions`) grow unboundedly inside one file**, and every write re-serializes everything (`write cost O(total corpus)`); with analytics events created per request that is a DoS-shaped latency cliff. **Severity: medium–high operational.**
8. **Legacy tests write into the live store** (§1.4, §7). Running `npm test` against a production-like store pollutes `data/database.json` with test fixtures. **Severity: process risk.**
9. **No backup/restore story for JSON** — the "backup" is whatever the last successful write left on disk; no WAL/concept of restore points.

### 9.2 Risks present at the target

1. `prisma` CLI (devDep, `^8.0.0-rc.27`) is an **RC** and a **major above** the runtime `@prisma/client ^7.10.1` — the generator/provider version mismatch could appear as subtle type failures or different behavior on `migrate`. **Must be aligned before any PG code ships (§3.5 Q6).**
2. `Article.coverImage` URL-string renderer-vs-FK mismatch (`mediaAsset.delete` blocks on `coverImageId`, while the page renders `coverImage` URL string) — a *pre-existing* data-model inconsistency, one segment of which is being fixed by repository write-path (§3.5 Q2). Flagged so review doesn't assume the migration normalizes it silently.
3. Bcrypt cost 10 is fast by 2026 standards; fine to migrate verbatim, flagged for security-team rollover plan separately.

### 9.3 Data-at-risk decision matrix

| Data class | At risk in JSON today? | Migrated with |
|---|---|---|
| Users + bcrypt hashes | corruption / empty-boot wipe | verbatim copy + normalization |
| Articles + history (revisions) | corruption, no tx, no backup | full copy + constraint add |
| editorialEvents / auditLogs | corruption, non-atomic | full copy |
| mediaAssets (metadata) | corruption; files on disk unaffected | full copy + path audit |
| revokedSessions / passwordResetTokens | corruption (**security**: forgot-password flows stop working) | copy (non-expired only) |
| analyticsEvents / reactions | loss tolerable but corruption still kills all writes | copy |
| polls / newsletter | corruption | copy |

**Workload unknowns to raise with the product owner before cutover:** No production data was accessed in this analysis. Before cutover, the ops owner must answer:
1. Does a production-hosted `data/database.json` exist outside this repo (backup schedule; copies on multiple hosts with independent failures)?
2. Any user-generated content since this store was last synced, i.e. is the repo copy a **subset** of production truth (news-publish + comments keep coming)?
3. Is the scheduler running in more than one process/host already (process-count parity matters for the advisory-lock strategy)?
4. Node version pinned per host (§10) and Postgres maintenance access.

---

## 10. Test plan (core deliverable #9)

### 10.1 Test tiers

| Tier | Target DB | Tooling | Scope |
|---|---|---|---|
| **T1: In-memory repository tests** | `InMemoryTestDb` | existing `tests/security/testDb.ts` harness | Repository *interface* conformance & workflow rules (fast; runs pre-migration continuously) |
| **T2: PG-conformance repository tests** | disposable Postgres, one DB per run | new `tests/persistence/*` harness in 6B | Same interface checks run against the Prisma repository — proves parity |
| **T3: Data-export/import/verify** | disposable Postgres | `db:export` → `db:import` → `db:verify` chains in `tests/persistence/roundTrip.test.ts` | Full-fidelity data round-trip, checksums, orphan invariant checks |
| **T4: HTTP behavior-parity tests** | disposable Postgres, real Express app | port `tests/security/*` suite style (already uses `buildTestApp`) | Existing 176 security/behavior tests re-run against the PG-backed app — **the same tests, only the repository wiring differs** (acceptance: identical assertions pass) |
| **T5: Scheduler/concurrency tests** | disposable Postgres | 20 parallel sweep calls + interleaved HTTP writes | No lost updates, unique slug/version, exactly-once publication, advisory-lock behavior |
| **T6: Load smoke** | disposable Postgres | autocannon/k6-style script (npx) | view-increment throughput, homepage latency under PG |

### 10.2 Pinned test scenarios (must exist in 6B)

1. **roundTrip fidelity**: export → import → verify → export again → second export byte-identical (modulo known conversions); every entity's checksum equal.
2. **create-with-tags race**: two parallel `POST /api/articles` collide; no half-created article, 409 on slug match, revision count 1 per article.
3. **update-with-media replace-all**: single tx — inject FK violation mid-chain and assert rollback (article fields unchanged, no orphan revision).
4. **transition atomicity**: transaction fails after `article.update` (simulate by FK break on editorial event) → status unchanged, no editorial event, no audit log row.
5. **scheduler exactly-once**: three sweeps start simultaneously with one due SCHEDULED article → exactly one `EXECUTED` row + exactly one PUBLISHED transition + exactly one `AUTOMATED_PUBLISH` event.
6. **poll vote row-locked**: 500 concurrent votes → sum of `options.votes` equals 500 exactly.
7. **views increment**: `ab -c 50 -n 500` style invasion still yields exactly 500 increments post-load (atomic `increment:1`).
8. **revocation flow**: logout → token rejected immediately; token that was never logged out still valid; after `expiresAt` purge, old jti rows gone; `passwordChangedAt` after reset invalidates prior tokens.
9. **media safe-delete**: delete-with-replacement replaces coverImages and *content URLs atomically*; rollback test when replacement row deleted concurrently.
10. **JOURNALIST role handling** (§6.4): the 6 JOURNALIST users import with the target role, can log in with old passwords, and receive the expected permission set from `permissions.ts` — no silent privilege inflation or deflation.
11. **legacy JSON regressions will not regress**: `tests/security/*` suite passes against both DB drivers (ID-agnostic: assertions on IDs use scoped lookups).
12. **corruption drill (JSON only)**: run the JSON repository under a corrupted `database.json` and assert a **startup refusal with a clear error**, not a fresh empty schema — no existing behavior preserved, this is a deliberate change from the current default; confirm before 6B.
13. **slug conflict**: duplicate-slug import attempts fail by default (orphan report shows candidates).
14. **email case-insensitive login** (post-import lower-case normalization).
15. **Webhook/timeout contention**: kill a process mid-`runPublishingSchedulerSweep` (SIGKILL) — restart, next sweep RE-publishes nothing; article is PUBLISHED once (idempotency key).

### 10.3 Disposable Postgres setup (CI + local)

```bash
# One-liner ephemeral target (or use the existing docker-compose if checked-in):
docker run --rm -d --name gcn-pg-test \
  -e POSTGRES_USER=gcn -e POSTGRES_PASSWORD=gcn-test \
  -e POSTGRES_DB=gcn_test -p 55432:5432 postgres:15-alpine

export DATABASE_URL="postgresql://gcn:gcn-test@localhost:55432/gcn_test"
npx prisma migrate deploy          # apply /prisma/migrations
npx prisma db push --skip-generate # optional, schema-only sync for fast iteration
npm run test:persistence           # Tier 2–5 harness
docker stop gcn-pg-test
```

Rules:
- Test harness **refuses** to run if `DATABASE_URL` contains `localhost:5432` with `NODE_ENV=production` or any non-disposable host name pattern (`--allow` flag required to override).
- Each test run creates database `gcn_test_<runid>` and drops it at exit (name-collision safe).
- CI (when present) reuses a containerised Postgres service and exports `DATABASE_URL` per-branch.

### 10.4 Acceptance criteria (Phase 6B only proceeds when… )

- [ ] `npm run test:all` (including new `test:persistence`) is green against disposable PG.
- [ ] `db:export`/`db:verify` round-trips a full fixture with checksums stable.
- [ ] No repo file imports `src/lib/db.ts` (verified by lint rule / grep CI check).
- [ ] Production boot with `DB_DRIVER=json` fails with a clear fatal message.
- [ ] Prisma CLI/runtime versions aligned (Q6).
- [ ] Every open question Q1–Q7 signed off.
- [ ] Cutover runbook reviewed by product owner + devops (including "no production data accessed/applicable yet" sign-off).

---

## 11. Package/runtime requirements and commands (core deliverable #10)

### 11.1 Versions to pin (and fix the current skew, Q6)

| Package | Current | Target |
|---|---|---|
| `@prisma/client` (dependencies) | `^7.10.1` | **same stable major as CLI** (e.g. `^8.x` stable once released, or both `^7.x`) — must match the CLI's generated-engine expectations |
| `prisma` CLI (devDependencies) | `^8.0.0-rc.27` | the **same version as `@prisma/client`**, non-RC |
| PostgreSQL server | n/a | **15+** (JSONB, `ON CONFLICT`, `EXTRACT`, pg advisory locks all used) |
| Node.js | unenforced | **≥ 20.x LTS** (repo's tsx/esbuild chain already assumes modern Node; enforce with `engines` + preinstall check in 6B) |
| TypeScript | `^7.0.2` | unchanged |
| `tsx` | `^4.21.0` | unchanged |
| bcrypt | `^6.0.0` | unchanged (no rehash at migration) |

### 11.2 Proposed package.json scripts (added in 6B — **not added now**)

```jsonc
// proposals only — do NOT alter package.json in Phase 6A
"db:export":        "tsx src/db-migration/export-from-json.ts",
"db:import":        "tsx src/db-migration/import-to-pg.ts",
"db:verify":        "tsx src/db-migration/verify-pg.ts",
"db:migrate:deploy":"prisma migrate deploy",
"db:migrate:dev":   "prisma migrate dev",
"db:studio":        "prisma studio",
"test:persistence": "tsx tests/persistence/run.ts",
```

### 11.3 Environment variables to add

| Var | Meaning | Owner |
|---|---|---|
| `DATABASE_URL` | Postgres DSN — already defined in `src/configuration/env.ts` (optional today); becomes **required under `DB_DRIVER=postgres`** and validated by the existing zod `envSchema` (extend with a DSN-format test in 6B) | env.ts |
| `DB_DRIVER` (`postgres` \| `json`) | Storage selector; **invalid in production** unless `postgres`; refuses to boot otherwise (§7) | env.ts |
| `DB_BATCH_SIZE` | Import batch size (default 1 000) | import script |
| `MAINTENANCE_MODE` | read-only middleware gate during cutover | server.ts |

All of this is `push`-ready once Q6 (version align) is resolved; add a `.env.example` block in 6B.

### 11.4 Command sequence (Phase 6B / cutover reference — NOT run now)

```bash
# 0. Align versions (package.json edit + lockfile)
npm install --save-exact @prisma/client@X prisma@X   # X = same stable major

# 1. Schema sync (schema-first, generated SQL reviewed by hand)
npx prisma migrate dev --name phase6_initial_pg --create-only   # review SQL
npx prisma migrate deploy                                       # apply migration to disposable DB first

# 2. Client generation + local boot against disposable PG
export DATABASE_URL="postgresql://gcn:gcn-test@localhost:55432/gcn_test"
export DB_DRIVER=postgres
npx prisma generate
docker compose up -d postgres      # or the docker run command in §10.3
npm run dev                        # smoke against disposable DB

# 3. Export / import / verify on the disposable DB
npm run db:export
npm run db:import -- --target="$DATABASE_URL" --dryRun
npm run db:import -- --target="$DATABASE_URL"
npm run db:verify

# 4. Full repo test matrix with the PG-backed app
npm run test:persistence
npm run test:all

# 5. Production cutover — follow the runbook in §6.6
#    (pg_dump backup, maintenance window, import, verify, boot with postgres driver)
```

`schema.prisma` changes 6B will apply (all enumerated in §3): *new models* (`Reaction`, `PasswordResetToken`, `RevokedSession`, `HomepageConfig`), *new columns* (`User.passwordChangedAt`, `MediaAsset.focalX/focalY`, new `Article` editorial/SEO fields, `Article.coverImage`), *unique/index additions* per §3.3 table, `RoleType` enum re-alignment per §3.2, remove the duplicated `AuditLog @@index([action])`.

---

## 12. Open questions to resolve before Phase 6B implementation

| # | Question | Default recommendation if un-decided |
|---|---|---|
| Q1 | Migrate dormant collections (`userSessions`, `urlRedirects`, `adPlacements`, `photoGalleries`, `galleryItems`, `videoRecords`) as empty tables, or drop them from the schema? | Migrate as empty tables (zero cost, schema parity). |
| Q2 | Keep `Article.coverImage` URL column alongside FK `coverImageId`? | Keep both through 6.x; normalize in a later phase via repository backfill. |
| Q3 | `usr-system-daemon` — seed a real user, or make `editorialEvent.actorId` nullable? | Seed the user (`isActive:false`, role `READER`, name `System Daemon`). |
| Q4 | `tag.delete` — keep unrestricted (current JSON behavior), or Restrict-with-cleanup? | Restrict + repository-level `articleTags` cleanup for identity of behavior, no dangling refs. |
| Q5 | Delete-article-destroys-revision-history — is that an editorial/legal requirement? | Confirm with newsroom; if history is sacred, switch revisions FK to `Restrict` and offer archive instead. |
| Q6 | Prisma CLI RC `^8.0.0-rc.27` vs runtime client `^7.10.1` — align to which stable? | Align to latest **stable** major that both packages publish; never ship an RC. |
| Q7 | `JOURNALIST` users (6 rows): map to `REPORTER`, or keep as its own enum value aligned with runtime `permissions.ts`? (Runtime has no `JOURNALIST` role.) | Ask editorial owner: keep JOURNALIST as an additional enum + permissions-registry entry so historical role labels aren't erased. |
| Q8 | Which environment owns production deployment (who can run the §6.6 runbook, and when is the maintenance window)? | owner + devops sign-off; required before any cutover. |

---

## 13. Summary

- **Storage defects today** (fresh-schema-on-corruption, non-atomic writes, swallow-save-errors, non-transactions) are *documented only* by this plan; Phase 6B will erase them through real Postgres transactions and an atomic-write, fail-closed runtime.
- **Every entity, FK, default, and hidden route assumption** is inventoried (§1–§2) so the Prisma repository layer can be produced against exact behavioral contracts, not guesses.
- **Schema deltas** are precisely enumerated (§3) including four missing models, seven missing columns, and eleven missing unique/index constraints.
- **Migration mechanics** (§6) are pushbutton-reproducible: topological import, orphans gating, per-entity checksums, both JSON and PG backup snapshots, and a clearly printed rollback gate.
- **`data/database.json` becomes test-only** local storage with explicit opt-in and is never a production fallback; legacy tests will be retargeted.
- **174+ existing security tests** will be reused unmodified against the PG-driven app (T4) — the fastest route to proving parity.
- **The repository/service interface** (§4) is designed so `server.ts`/routes need **minimal conditional code** — behavior differences stay behind one port.

*Phase 6A ends here; awaiting review sign-off on §3.5 Q1–Q7 and §12 before any implementation.*

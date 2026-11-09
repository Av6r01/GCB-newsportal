# Database Schema & Data Integrity Specification

## 1. Architectural Overview
The database layer models an enterprise newsroom publishing system with strict referential integrity, historical immutability, role-based security, and taxonomy nesting.

## 2. Entities & Relational Design

### 2.1 Users, Auth & Profiles
- **`User`**: Primary account record with role (`ADMIN`, `EDITOR`, `JOURNALIST`, `CONTRIBUTOR`, `READER`), `passwordHash`, `isActive`, timestamps.
- **`UserSession`**: Authentication sessions with secure token, user agent, IP address, and expiration. Cascades on user deletion (`onDelete: Cascade`).
- **`AuthorProfile`**: Public editorial byline, biography, credentials, and social links. Cascades on user deletion (`onDelete: Cascade`).

### 2.2 Taxonomy
- **`Category`**: News desk sections with self-referential nesting (`parentId` -> `Category`).
  - **Deletion Behavior**: `onDelete: Restrict`. Deleting a category that has existing articles or child sub-categories is strictly blocked to protect historical story URLs and navigation hierarchy.
- **`Tag` & `ArticleTag`**: Many-to-many topic tagging. Cascades on article or tag deletion.

### 2.3 Editorial Dispatches & Versioning
- **`Article`**: Core publication entity.
  - Foreign keys: `categoryId` (`onDelete: Restrict`), `authorId` (`onDelete: Restrict`), `coverImageId` (`onDelete: SetNull`).
  - Timestamps: `createdAt`, `updatedAt`, `publishedAt`, `archivedAt`, `scheduledFor`.
  - Constraints: Unique slug (`Article_slug_key`), compound indexes on status, category, author, and publication timestamp.
- **`ArticleRevision`**: Immutable historical audit snapshot.
  - Every content modification creates a new incremental version record (`version 1, 2, 3...`) preserving the previous title, excerpt, and body unaltered.
  - Editor foreign key: `onDelete: Restrict`.
- **`EditorialEvent`**: Log of workflow status transitions (`SUBMIT_REVIEW`, `REQUEST_REVISION`, `APPROVE`, `PUBLISH`, `ARCHIVE`) with reviewer notes and actor references.
- **`ArticleContributor`**: Multi-author and credits tracking (`roleTitle`).

### 2.4 Media Assets & Galleries
- **`MediaAsset`**: S3/CDN media file records with dimensions, MIME type, credit, and caption.
  - Uploader reference: `onDelete: Restrict`.
  - Cover references: `onDelete: SetNull` so deleting an asset detaches it without destroying the historical story.
- **`PhotoGallery` & `GalleryItem`**: Curated photo essay sequences.
- **`VideoRecord`**: Video dispatches with durations and streaming URLs.

### 2.5 Live Journalism & Alerts
- **`LiveBlogUpdate`**: Chronological live coverage updates with `isKeyEvent` flags.
- **`BreakingNewsAnnouncement`**: Global ticker alert banners with urgency rankings (Standard, High, Flash) and optional article linkage.

### 2.6 Publishing Schedules & Operations
- **`PublicationSchedule`**: Durable background scheduling queue with idempotency keys (`idempotencyKey`), target publish timestamps, execution status, and failure logs.
- **`UrlRedirect`**: 301/302 URL redirects preventing broken links on headline/slug changes.
- **`AdPlacement`**: Managed display ad slots (`LEADERBOARD_TOP`, `SIDEBAR_RECTANGLE`) with impression and click tracking.
- **`SiteSetting`**: Key-value JSON configuration store for editorial policies.
- **`AuditLog`**: System-wide security and mutation audit trail.

---

## 3. Data Integrity & Migration Strategy
- **Versioned Migration**: Initial schema migration archived in `prisma/migrations/20261023_initial_schema/migration.sql`.
- **Idempotent Development Seed**: `src/lib/seed.ts` provisions visibly fictional accounts and articles without colliding with existing records.
- **Automated Integrity Tests**: `tests/integrity.test.ts` validates category delete protection, author delete protection, foreign key validation, slug uniqueness, immutable revisions, and nested hierarchies.

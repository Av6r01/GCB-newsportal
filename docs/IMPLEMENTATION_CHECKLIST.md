# Implementation Checklist - Global Chronicle News

## Phase 1: Documentation & Requirements
- [x] Create `docs/AGENT_RULES.md`
- [x] Create `docs/PRODUCT_REQUIREMENTS.md`
- [x] Create `docs/REFERENCE_AUDIT.md`
- [x] Create `docs/FEATURE_INVENTORY.md`
- [x] Create `docs/USER_ROLES.md`
- [x] Create `docs/ACCEPTANCE_CRITERIA.md`
- [x] Create `docs/IMPLEMENTATION_CHECKLIST.md`

## Phase 2: Architecture & Security Design
- [x] Create `docs/ARCHITECTURE.md`
- [x] Create `docs/DATA_MODEL.md`
- [x] Create `docs/SECURITY_THREAT_MODEL.md`
- [x] Create `docs/ARCHITECTURE_DECISIONS.md`

## Phase 3: Project Bootstrap (Completed)
- [x] Standardized package configuration & scripts (`dev`, `build`, `start`, `lint`, `test`)
- [x] Strict TypeScript configuration and type-checking
- [x] Environment variable validation with Zod (`src/configuration/env.ts`)
- [x] Reusable application configuration module (`src/lib/config.ts`)
- [x] Standard error handling (`src/lib/errors.ts`) and structured logging (`src/lib/logger.ts`)
- [x] Health-check endpoint at `/api/health` (`src/server/health.ts`)
- [x] Unit & integration testing foundation (`tests/bootstrap.test.ts`)
- [x] Git ignore rules for secrets and persistence (`.gitignore`)
- [x] Clean `.env.example` without committed secrets
- [x] Comprehensive `README.md` with exact setup, run, and test instructions
- [x] Basic CI workflow for automated verification (`.github/workflows/ci.yml`)

## Phase 4: Database and Data Integrity (Completed)
- [x] Comprehensive relational schema with 20+ entities in `prisma/schema.prisma`
- [x] Referential integrity constraints (`onDelete: Restrict` for authors and categories; `SetNull` for media covers)
- [x] Nested category taxonomy (parent/child hierarchy)
- [x] Immutable article revision tracking (`ArticleRevision`)
- [x] Initial versioned migration DDL in `prisma/migrations/20261023_initial_schema/migration.sql`
- [x] Idempotent visibly fictional development seed data in `src/lib/seed.ts`
- [x] Automated database referential integrity test suite in `tests/integrity.test.ts`
- [x] Database schema documentation in `docs/DATABASE_SCHEMA.md`

## Phase 5: Authentication and Access Control (Completed)
- [x] Implemented 10 newsroom roles + reader in `src/modules/auth/permissions.ts`
- [x] Backend-enforced granular permission checking (`requirePermission`, `requireStoryAccess`)
- [x] Horizontal access control preventing reporters from editing other reporters' drafts
- [x] Publishing authority restriction separating Copy Editors from Managing/Section Editors
- [x] Separation of concerns: Advertising Manager and Analyst prohibited from editing stories
- [x] Privilege escalation prevention in `preventPrivilegeEscalation` middleware
- [x] Sliding-window brute-force login rate limiter in `loginRateLimiter` (5 attempts / lockout)
- [x] Real-time session invalidation / token revocation on logout (`revokedTokens`)
- [x] Enumeration-resistant password reset request and confirm flow
- [x] Automated authorization test suite with 100% pass rate (`tests/authorization.test.ts`)
- [x] Complete security and RBAC documentation in `docs/AUTHENTICATION_AND_ACCESS_CONTROL.md`

## Phase 6: Admin Application Shell (Completed)
- [x] Dedicated newsroom staff authentication interface in `src/pages/admin/AdminLogin.tsx`
- [x] Protected admin layout with role-based 403 access control in `src/components/admin/AdminLayout.tsx`
- [x] Responsive collapsible sidebar with desktop toggle and mobile slide-over drawer
- [x] Interactive breadcrumb navigation in `src/components/admin/AdminBreadcrumbs.tsx`
- [x] Newsroom notification drawer with live alerts in `src/components/admin/AdminNotifications.tsx`
- [x] User menu with role badges, active session details, and revocation sign-out
- [x] Editorial Command Center overview in `src/pages/admin/AdminDashboard.tsx`
- [x] Real database metrics contracts (`GET /api/admin/dashboard`) for published, review queue, scheduled, and views
- [x] Recently published stories feed and live editorial audit trail
- [x] Background publishing pipeline health indicator panel
- [x] Automated test suite verifying real database dashboard contracts (`tests/adminShell.test.ts`)

## Phase 7: Newsroom Taxonomy and Author Management (Completed)
- [x] Database-backed CRUD operations for Categories, Subcategories, Tags, and Author Profiles
- [x] Nested category support with parent-child relationships and ordering
- [x] Circular category reference validation and prevention (`IntegrityError`)
- [x] Safe article reassignment and archival protection rules
- [x] Author profiles including name, public slug, biography, profile image, credentials, and social links
- [x] Backend-enforced permission checks on every taxonomy and author operation (`categories:manage`, `tags:manage`, `authors:manage`)
- [x] Audit log recording for important administrative actions
- [x] Automated database-backed test suite verifying taxonomy and author operations (`tests/taxonomy.test.ts`)

## Phase 8: Article Model and Editor (Completed)
- [x] Full article metadata model (headline, standfirst, URL slug, structured body, category/subcategory, tags, contributors, cover image caption & credit, source attribution, SEO metadata, article type, editorial notes)
- [x] Rich text and structured block content editor in `src/pages/CmsArticleEditor.tsx`
- [x] 30-second debounced autosave with visible save status indicator ("All changes saved", "Saving...", "Unsaved changes")
- [x] Tabbed editor workspace: Story Content, Metadata & Media, SEO & Social, Revision History, and Live Preview
- [x] Revision history viewer with version comparison and version restoration (`POST /api/articles/:id/restore/:version`)
- [x] Server-side validation and sanitization preventing client bypasses or script injections
- [x] Automated test suite for article creation, metadata, and revision snapshots (`tests/articleEditor.test.ts`)

## Phase 9: Specialized Content Types (Completed)
- [x] Support for Video article type with responsive inline player
- [x] Support for Photo Gallery article type with interactive slideshow component
- [x] CMS integration for managing video URLs and multiple gallery media assets
- [x] Specialized metadata handling and SEO for non-standard content

## Phase 10: Final Verification & QA (Completed)
- [x] Run `compile_applet` and `lint_applet` to verify zero compilation or lint errors.
- [x] Comprehensive end-to-end lifecycle verification suite (`tests/qa.test.ts`)
- [x] Verify all 8 test suites PASS consistently.
- [x] Create `docs/QA_REPORT.md` documenting results.

## Phase 11: Storage Provider and Media Delivery (Completed)
- [x] Reliable local development provider (`LocalStorageProvider`) and S3-compatible production provider (`S3StorageProvider`).
- [x] Provider selection explicitly configured from validated environment variables (`STORAGE_DRIVER`, `validateStorageConfig`); fails closed on missing production credentials; honesty reporting in `describeStorage()`.
- [x] Upload, replace, delete, and read URL generation routed through storage abstraction.
- [x] Intentional public/private access models with signed URL generation and expiration/HMAC verification (`/media-signed/...` and SigV4 presigned URLs).
- [x] Real responsive image variants pipeline (`pngResize.ts`, `variants.ts`) recording width, height, and content types; honest handling of non-encodable formats.
- [x] Variant URLs point to distinct objects with unique keys and distinct bytes.
- [x] Safe article reference preservation on asset replacement; partial failure rollback and cleanup.
- [x] Storage reconciliation and orphan detection/collection endpoints (`/api/admin/media/orphans` and `/api/admin/media/orphans/collect`).
- [x] Complete architecture and operational documentation in `docs/STORAGE.md`.
- [x] 100% passing automated test suites in `tests/p11/` (`providers`, `routes`, `private-visibility`, `s3-provider`).

## Phase 12: Visual Redesign and Motion System (Completed)
- [x] Master design tokens defined in `src/index.css` (bilingual font hierarchy for English & Bengali, hairline broadsheet borders, paper background palette, ink contrast, focus-visible accessibility outlines).
- [x] Broadsheet masthead (`BrandHeader.tsx`) with dynamic bilingual date formatters and original brand identity.
- [x] Editorial hierarchy for lead, secondary, and latest stories with zero-CLS aspect ratios (`LeadStoryModule.tsx`, `NewsCard.tsx`).
- [x] Motion system tokens defined in `src/motionTokens.ts` (durations, cubic-bezier easings, distance scales, stagger, spring physics presets).
- [x] Route/view transitions via `AnimatePresence` and `motion.div` in `App.tsx`.
- [x] Drawer slide-in and backdrop fade animations via `motion` in `MobileNav.tsx` and `SearchInterface.tsx`.
- [x] Strict `prefers-reduced-motion` compliance resetting animation/transition durations to 0.01ms.
- [x] Full accessibility with keyboard focus outlines (`:focus-visible: outline: 2px solid #990000; outline-offset: 2px;`) and minimum touch targets.


## Phase 13: Release Candidate QA (Completed)
- [x] TypeScript static check verified (`tsc --noEmit -p tsconfig.json` -> 0 errors).
- [x] Route duplication linter verified (`tsx scripts/route-lint.ts` -> 98 routes, 0 duplicate paths).
- [x] Production build bundle verified (`vite build` -> clean CSS/JS chunking).
- [x] Core unit and integration test suite passing 100% (`npm test` -> 8 files, 36/36 tests passing).
- [x] Security regression test suite passing 100% (`npm run test:security` -> 6 suites, 176 assertions).
- [x] Phase 7–11 regression suites passing 100% (530+ assertions across 18 sub-suites).
- [x] Critical end-to-end 15-step newsroom journey passing 100% (`tests/p13/critical-e2e.test.ts`).
- [x] Unsupported claims in previous audit docs replaced with evidence-backed documentation.
- [x] Verified and produced comprehensive `docs/QA_REPORT.md` and `gcn/docs/QA_REPORT.md`.
- [x] Release Candidate certified: 1.0.0-rc1.

## Phase 14: Production Readiness and Deployment Runbook (Completed)
- [x] Node version (22 LTS / 24 compatible) and package start command (`npm start` -> `tsx server.ts`) verified.
- [x] Validated `PORT` configuration: `server.ts` respects `env.PORT` instead of hardcoded 3000.
- [x] Canonical server-only `APP_URL` verified: fail-closed against localhost and non-https in production.
- [x] Production secrets and session invalidation rules verified.
- [x] Storage provider, media persistence, and CDN behavior documented and tested.
- [x] Durable worker process / scheduler daemon verified with in-process 60s sweep.
- [x] Real multi-subsystem health checks in `/api/health` (database, storage, scheduler, memory, AI); reports UNKNOWN when unverified.
- [x] Sanitized logs with zero secret leaks.
- [x] Backup and tested restoration runbooks authored in `docs/BACKUP_RESTORE.md`.
- [x] Incident response runbooks authored in `docs/INCIDENT_RESPONSE.md`.
- [x] Staging and production separation rules documented in `docs/DEPLOYMENT_RUNBOOK.md`.
- [x] Deployment smoke tests and rollback procedures documented.
- [x] Rate limits, proxy configuration (`TRUST_PROXY`), security headers, and CORS verified.
- [x] Search Console, sitemap, and Google News sitemap submission instructions documented.
- [x] Legal, privacy, and editorial standards pages verified (`/page/about`, `/page/privacy`, `/page/terms`, `/page/contact`, `/page/standards`).
- [x] Created/updated: `docs/DEPLOYMENT_RUNBOOK.md`, `docs/ENVIRONMENT_REFERENCE.md`, `docs/BACKUP_RESTORE.md`, `docs/INCIDENT_RESPONSE.md`, `docs/GO_LIVE_CHECKLIST.md`, `docs/FINAL_AUDIT.md`.
- [x] Interactive system architecture diagram created and linked.
- [x] Go/no-go decision rendered with remaining operator actions.

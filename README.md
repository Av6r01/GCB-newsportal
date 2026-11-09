# 🌐 Global Chronicle News (গ্লোবাল ক্রনিকল নিউজ) — GCB Newsportal

<p align="center">
  <img src="https://img.shields.io/badge/Release_Candidate-1.0.0--rc1-059669?style=for-the-badge&logo=git&logoColor=white" alt="Release Candidate" />
  <img src="https://img.shields.io/badge/React-19.0-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-7.0-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Node.js-%E2%89%A520_%7C_22_LTS-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/Express-4.22-000000?style=for-the-badge&logo=express&logoColor=white" alt="Express" />
  <img src="https://img.shields.io/badge/Prisma-6.19-2D3748?style=for-the-badge&logo=prisma&logoColor=white" alt="Prisma" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-4.3-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white" alt="Tailwind CSS" />
  <img src="https://img.shields.io/badge/Framer_Motion-12.4-FF0055?style=for-the-badge&logo=framer&logoColor=white" alt="Framer Motion" />
  <img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg?style=for-the-badge" alt="License" />
</p>

---

**Global Chronicle News (GCB Newsportal)** is a modern, high-performance, bilingual digital news publication platform. Inspired by the editorial quality, typographic rigor, and hierarchical structure of world-class news organisations (*Al Jazeera*, *Somoy News*, *The Guardian*, *Kaler Kantho*), GCB features an enterprise-grade editorial CMS, atomic publishing state machines, live breaking news alerts, AI-assisted newsroom tools, multi-provider media storage, and comprehensive search engine crawlability.

---

## 📑 Table of Contents

- [Key Features](#-key-features)
- [System Architecture](#-system-architecture)
- [Interactive System Diagram](#-interactive-system-diagram)
- [Demo Credentials (All Roles)](#-demo-credentials-all-roles)
- [Quick Start Guide](#-quick-start-guide)
- [Testing & Quality Assurance](#-testing--quality-assurance)
- [Production Deployment](#-production-deployment)
- [Environment Configuration](#-environment-configuration)
- [Operations & Runbooks](#-operations--runbooks)
- [Project Directory Structure](#-project-directory-structure)
- [License](#-license)

---

## ✨ Key Features

### 📰 Public Newsportal & Reader Experience
- **Bilingual First-Class Typography**: High-contrast, broadsheet-inspired layouts supporting both English (`Playfair Display`, `Inter`) and Bangla (`Noto Serif Bengali`, `Hind Siliguri`).
- **Editorial Hierarchy**: Prominent lead story modules, secondary headline clusters, category grids, and chronological latest feeds.
- **Breaking News Ticker**: Real-time global alert bar with direct article linking and emergency priority promotion.
- **Audio TTS Narration**: Accessible server-side Text-to-Speech article synthesis.
- **Interactive Reader Engagement**: Reader polls, moderated comment threads, first-party reactions, and newsletter subscription forms.
- **Accessible Motion System**: Shared Framer Motion tokens, animated drawer slide-overs, modal scales, and full `@media (prefers-reduced-motion: reduce)` compliance.

### ✍️ Enterprise Editorial CMS
- **Complete Editorial Workflow**: Strict state machine enforcing `DRAFT` ➔ `IN_REVIEW` ➔ `APPROVED` ➔ `PUBLISHED` / `SCHEDULED` ➔ `ARCHIVED`.
- **Change Request Audit Trails**: Section editors can reject or request revisions with mandatory audit notes; reporters revise and resubmit seamlessly.
- **Scheduled Publishing Daemon**: Background publishing engine with a 60-second polling sweep; promotions are idempotent and keyed to prevent duplicate releases.
- **Separation of Duties**: Structural rule preventing reporters and copy-editors from approving or publishing their own dispatches.
- **Revision Snapshots**: Full historical versioning for every article edit, allowing rollbacks and editorial change auditing.
- **Slug Management & 301 Redirects**: Permanent automatic HTTP 301 redirects generated whenever an article slug is renamed, preserving SEO equity.

### 🔒 Security & Access Control
- **Role-Based Access Control (RBAC)**: Fine-grained permissions across 7 newsroom roles (`ADMIN`, `MANAGING_EDITOR`, `SECTION_EDITOR`, `COPY_EDITOR`, `REPORTER`, `ANALYST`, `READER`).
- **Session Security**: Cryptographically strong JWTs, token revocation via database-backed `jti` tracking, and automatic invalidation upon password changes (`passwordChangedAt`).
- **Brute-Force & Abuse Mitigation**: Multi-tiered rate limiters guarding login, password reset, comments, polls, and analytics endpoints.
- **Content Sanitization**: Multi-layer XSS protection using DOMPurify and `sanitize-html` alongside parameterised database transactions.

### 📦 Storage Abstraction & Media Pipeline
- **Multi-Provider Architecture**: Genuine storage abstraction supporting both `LocalStorageProvider` (partitioned filesystem) and `S3StorageProvider` (AWS S3, MinIO, Cloudflare R2 with SigV4).
- **Responsive Variant Generation**: Automatic generation of `thumbnail` (300px), `card` (600px), and `lead` (1200px) variants with dimensions, byte lengths, and MIME types recorded.
- **Security & Integrity**: Magic-byte binary signature inspection, HMAC-signed private URLs, and scheduled orphan object reconciliation.

### 🗺️ SEO & Search Engine Crawlability
- **Server SEO Shell Injection**: Pre-rendered semantic HTML shells (`<h1>`, summary, JSON-LD) served to crawlers before React mounts.
- **Structured Data**: Automatic `NewsArticle`, `WebSite`, `BreadcrumbList`, and `ProfilePage` JSON-LD schemas.
- **Dynamic Sitemaps**: Fast, standards-compliant `/sitemap.xml` and Google News `/sitemap-news.xml` (last 48 hours).
- **Canonical Origin Enforcement**: Server-validated `APP_URL` preventing dev origin leaks in canonical links and `robots.txt`.

---

## 🏛️ System Architecture

```mermaid
flowchart TD
    subgraph CLIENT["Client Layer (React 19 + TypeScript)"]
        UI_HOME["Homepage (Bilingual Broadsheet)"]
        UI_ART["Article Detail (SEO Hydrated)"]
        UI_CAT["Category Feeds"]
        UI_CMS["Editorial CMS (/cms)"]
        UI_ADMIN["Admin Dashboard"]
    end

    subgraph PROXY["Reverse Proxy / Edge"]
        NGINX["nginx (SSL Termination + HTTP/2)"]
        CDN["Media CDN (Public Edge)"]
    end

    subgraph SERVER["Express Application Core (:3000)"]
        MW["Security Middleware (CSP, HSTS, Rate Limiters, Morgan, Gzip)"]
        AUTH["Auth Subsystem (JWT, bcrypt, Session Invalidation)"]
        ART_API["Articles API (Workflow Engine, 301 Redirects)"]
        MEDIA_API["Media API (Magic Bytes, Responsive Variants)"]
        SCHED["Scheduler Daemon (60s Idempotent Polling)"]
        HEALTH["Health Monitor (/api/health — Live Multi-Subsystem Probe)"]
    end

    subgraph STORAGE["Storage Subsystem"]
        LOCAL["LocalStorageProvider (public/uploads/)"]
        S3["S3StorageProvider (AWS S3 / MinIO / R2)"]
        VARIANTS["Variants Pipeline (Thumbnail, Card, Lead)"]
    end

    subgraph PERSISTENCE["Database Engine"]
        JSON_STORE["JSON Store (Dev/Test: data/database.json)"]
        POSTGRES["Prisma PostgreSQL 16 (Production)"]
    end

    CLIENT -->|HTTPS| NGINX
    NGINX -->|Reverse Proxy| MW
    MW --> AUTH & ART_API & MEDIA_API & HEALTH
    ART_API & AUTH --> JSON_STORE
    ART_API & AUTH -.->|Production Target| POSTGRES
    MEDIA_API --> LOCAL
    MEDIA_API -.->|Production Target| S3
    LOCAL & S3 --> VARIANTS
    SCHED -->|Promotes Due Stories| ART_API
    NGINX -->|Direct Media| CDN
    CDN --> S3
```

---

## 🔐 Demo Credentials (All Roles)

For evaluation and testing in the local development environment, all newsroom roles are pre-configured with a universal password:

> **Universal Password**: `DemoNewsroom2026!`  
> **CMS Sign-in URL**: [http://localhost:3000/cms](http://localhost:3000/cms)

| Role | Demo Email | Portal Permissions |
|---|---|---|
| 👑 **ADMIN** | `admin@globalchronicle.news` | Full CMS privileges: User management, site settings, taxonomy, redirects, jobs, ads, analytics. |
| 🎖️ **MANAGING EDITOR** | `managing@globalchronicle.news` | Executive desk: Approve dispatches, immediate/scheduled publishing, category management. |
| ✍️ **SECTION EDITOR** | `editor@globalchronicle.news` | Desk lead: Review submitted drafts, request revisions with mandatory notes, approve stories. |
| 🔍 **COPY EDITOR** | `copyeditor@globalchronicle.news` | Quality & grammar: Edit article prose, adjust formatting, upload media. |
| 📝 **REPORTER** | `reporter@globalchronicle.news` | Dispatches: Draft new articles, upload lead imagery, set focal points, submit to review. |
| 📊 **ANALYST** | `analyst@globalchronicle.news` | Business metrics: Readership reports, section engagement, device metrics. |
| 👤 **READER** | `reader@globalchronicle.news` | Public user: Browse stories, participate in polls, submit comments (blocked from CMS mutations). |

---

## 🚀 Quick Start Guide

### Prerequisites
- **Node.js**: v20 LTS, v22 LTS, or v24
- **npm**: v10 or v11
- **Git**

### 1. Clone & Install
```bash
git clone https://github.com/Av6r01/GCB-newsportal.git
cd GCB-newsportal
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
```
*(The default `.env.example` is pre-configured for instant local development with the JSON store driver).*

### 3. Start Development Server
```bash
npm run dev
```
The server will boot on **[http://localhost:3000](http://localhost:3000)** with:
- ⚡ Full Vite Hot-Module Replacement (HMR)
- 🗃️ Local persistence store initialized with seed categories and articles
- ⏰ Background publishing scheduler running

### 4. Verify System Health
```bash
curl http://localhost:3000/api/health
```
Expected output:
```json
{
  "status": "ok",
  "version": "1.0.0-rc1",
  "publication": "Global Chronicle News",
  "environment": "development",
  "checks": {
    "database": { "status": "healthy", "driver": "json", "categoriesLoaded": 12 },
    "storage": { "status": "healthy", "driver": "local" },
    "scheduler": { "status": "ACTIVE" }
  }
}
```

---

## 🧪 Testing & Quality Assurance

GCB includes comprehensive test suites spanning unit tests, security barriers, route linting, and end-to-end publishing lifecycles:

| Suite | Command | Coverage |
|---|---|---|
| **TypeScript Compilation** | `npm run lint` | Static typecheck across frontend and backend (`tsc --noEmit`). |
| **Route Duplication Linter**| `npm run lint:routes` | Analyzes 98 routes for duplicate paths and collisions. |
| **Core Integration Tests** | `npm test` | 8 files (integrity, auth, workflow, taxonomy, editor, admin shell). |
| **Security Regression** | `npm run test:security` | 6 suites, 176 assertions (unpublished leaks, RBAC, session revocation, XSS). |
| **Phase 7 Routing & Cache** | `npm run test:p7` | 6 suites (slug redirects, pagination, cache invalidation, scheduler). |
| **Phase 8 API Guardrails** | `npm run test:p8` | 4 suites (Zod validation, rate floods, comment privacy, TTS quotas). |
| **Phase 9 SEO & Sitemaps** | `npm run test:p9` | 2 suites (HTML crawl shells, JSON-LD, XML sitemaps, robots.txt). |
| **Phase 10 Admin CMS** | `npm run test:p10` | 2 suites (admin endpoints, RBAC UI controls, accessibility focus). |
| **Phase 11 Storage Provider**| `npm run test:p11` | 4 suites (Local/S3 abstraction, variants pipeline, signed URLs). |
| **Phase 13 Critical E2E** | `npm run test:p13` | Full 15-step newsroom publication lifecycle journey. |
| **Complete Test Suite** | `npm run test:all` | Runs all suites sequentially. |

---

## 🚢 Production Deployment

### Option A: Docker Compose (Recommended)

The included `Dockerfile` and `docker-compose.yml` provide an automated, multi-container production deployment:

```bash
# 1. Generate a cryptographically secure JWT secret
export JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")

# 2. Launch the database, run migrations, and start the app
docker-compose up -d

# 3. Verify deployment health
curl http://localhost:3000/api/health
```

### Option B: Bare Metal / Cloud VPS (PostgreSQL + S3)

```bash
# 1. Build the production client bundle
npm run build

# 2. Deploy database migrations to PostgreSQL
DATABASE_URL="postgresql://user:pass@db-host:5432/newsdb" npm run db:migrate:deploy

# 3. (First time only) Import existing JSON data to PostgreSQL
DATABASE_URL="..." npm run db:import -- --dry-run
DATABASE_URL="..." npm run db:import
DATABASE_URL="..." npm run db:verify

# 4. Start production server
NODE_ENV=production \
DB_DRIVER=postgres \
DATABASE_URL="postgresql://user:pass@db-host:5432/newsdb" \
STORAGE_DRIVER=s3 \
S3_BUCKET=your-media-bucket \
S3_REGION=us-east-1 \
S3_ACCESS_KEY_ID=AKIA... \
S3_SECRET_ACCESS_KEY=... \
APP_URL=https://yourdomain.com \
JWT_SECRET=your-secret-min-32-chars \
npm start
```

---

## ⚙️ Environment Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | Yes | `development` | Set to `production` for production environments. |
| `PORT` | No | `3000` | Port Express binds to (supports host-provided port). |
| `APP_URL` | **Yes (prod)** | `http://localhost:3000` | Canonical origin for SEO, sitemaps, and password reset links. Must be `https://` in production. |
| `JWT_SECRET` | **Yes (prod)** | *(dev fallback)* | Secret for signing session JWTs (minimum 32 characters in production). |
| `DB_DRIVER` | Prod only | `json` | Persistence driver: `postgres` (production) or `json` (dev/test only). |
| `DATABASE_URL` | Prod only | n/a | PostgreSQL connection string. |
| `STORAGE_DRIVER` | **Yes (prod)** | `local` | Media storage provider: `local` or `s3`. |
| `S3_BUCKET` | S3 only | n/a | S3 bucket name. |
| `S3_REGION` | S3 only | n/a | S3 region (e.g. `us-east-1`). |
| `S3_ACCESS_KEY_ID` | S3 only | n/a | AWS / MinIO Access Key ID. |
| `S3_SECRET_ACCESS_KEY`| S3 only | n/a | AWS / MinIO Secret Access Key. |
| `SMTP_HOST` | Recommended | n/a | SMTP server for password recovery emails. |
| `GEMINI_API_KEY` | Optional | n/a | Google Gemini API key for AI assistant & TTS narration. |
| `TRUST_PROXY` | Conditional | n/a | Set to `1` when behind nginx or Cloudflare to ensure accurate client IP rate limiting. |

*See [`docs/ENVIRONMENT_REFERENCE.md`](docs/ENVIRONMENT_REFERENCE.md) for the complete reference of all 30+ configuration settings.*

---

## 📚 Operations & Runbooks

Comprehensive operational guides are available in the [`docs/`](docs/) directory:

- 📖 [**Deployment Runbook**](docs/DEPLOYMENT_RUNBOOK.md) — Node 22/24 setup, Docker, nginx SSL, smoke tests, and rollback procedures.
- ⚙️ [**Environment Reference**](docs/ENVIRONMENT_REFERENCE.md) — Exhaustive specification for all environment variables.
- 💾 [**Backup & Restoration Guide**](docs/BACKUP_RESTORE.md) — PostgreSQL logical dumps, isolated database verification, and S3 retention policies.
- 🚨 [**Incident Response Runbook**](docs/INCIDENT_RESPONSE.md) — SEV-1 to SEV-4 incident protocols, troubleshooting runbooks for 7 common failures, and post-mortem templates.
- ✅ [**Go-Live Checklist**](docs/GO_LIVE_CHECKLIST.md) — 50-point pre-flight checklist and operator readiness assessment.
- 📊 [**Release Candidate QA Report**](docs/QA_REPORT.md) — Command-by-command test execution log.
- 📦 [**Storage Architecture**](docs/STORAGE.md) — Multi-provider specifications, variant policies, signed URLs, and lifecycle rules.
- 🔐 [**API Permission Matrix**](docs/API_PERMISSION_MATRIX.md) — Complete mapping of routes to newsroom roles.

---

## 📂 Project Directory Structure

```
GCB-newsportal/
├── docs/                        # Architecture, runbooks, and QA reports
│   ├── BACKUP_RESTORE.md
│   ├── DEPLOYMENT_RUNBOOK.md
│   ├── ENVIRONMENT_REFERENCE.md
│   ├── GO_LIVE_CHECKLIST.md
│   ├── INCIDENT_RESPONSE.md
│   ├── QA_REPORT.md
│   └── STORAGE.md
├── prisma/                      # Database schema and migration ledgers
│   ├── schema.prisma
│   └── migrations/
├── public/                      # Static assets & public uploads
│   ├── favicon.ico
│   ├── logo.svg
│   └── uploads/
├── src/                         # Application source code
│   ├── components/              # Design system & editorial UI components
│   │   ├── design-system/       # Masthead, navigation, news cards, search
│   │   └── widgets/             # Polls, ticker, audio player, AI assistant
│   ├── configuration/           # Zod-validated environment config
│   ├── lib/                     # Database, logger, mailer, content sanitizers
│   ├── modules/                 # Auth permissions, article workflow state machine
│   ├── pages/                   # Public routes & Editorial CMS views
│   │   ├── admin/               # Admin dashboard, staff, redirects, settings
│   │   ├── ArticleDetail.tsx
│   │   ├── CategoryFeed.tsx
│   │   ├── CmsArticleEditor.tsx
│   │   └── Home.tsx
│   ├── server/                  # Server-side storage, health, scheduler, and SEO
│   │   ├── storage/             # Local and S3 storage providers
│   │   ├── health.ts            # Multi-subsystem health check handler
│   │   ├── scheduler.ts         # Publishing daemon
│   │   └── seo.ts               # HTML crawl shell and sitemap generators
│   ├── App.tsx                  # Client routing & Framer Motion transitions
│   ├── main.tsx                 # Client application entry point
│   └── motionTokens.ts          # Centralized animation tokens
├── tests/                       # Automated test suites
│   ├── p7/                      # Routing, pagination, cache tests
│   ├── p8/                      # Rate limiting & input resilience tests
│   ├── p9/                      # SEO crawl shells & XML sitemap tests
│   ├── p10/                     # Admin endpoints & accessible UI tests
│   ├── p11/                     # Multi-provider storage & variants tests
│   ├── p13/                     # Critical 15-step end-to-end journey test
│   └── security/                # Authentication, RBAC, and XSS tests
├── Dockerfile                   # Production container definition
├── docker-compose.yml           # Production service stack (app, db, migrate)
├── server.ts                    # Express backend entry point (routes & middleware)
├── package.json
└── tsconfig.json
```

---

## 📜 License

This project is open-source software licensed under the [Apache License, Version 2.0](LICENSE).

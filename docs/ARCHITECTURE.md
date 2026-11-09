# System Architecture - Global Chronicle News

## 1. Architectural Overview: Modular Monolith
Global Chronicle News is architected as a **Modular Monolith** using React/Vite (frontend) and Node.js/Express (`server.ts` backend) interacting with a PostgreSQL database via Prisma ORM. This design delivers the operational simplicity and transactional safety of a monolith while maintaining strict internal module boundaries (Auth, Articles, CMS, Comments, Media, Search, Analytics).

## 2. Architecture Diagrams

### Diagram 1: Public Reader Requests
```
[Client Browser / Mobile] 
       │ (HTTPS GET /article/slug)
       ▼
[Edge CDN / Load Balancer]
       │
       ▼
[Express Server (`server.ts`)]
       │ (Prisma ORM Query)
       ▼
[PostgreSQL Database] (Read Replica / Primary)
```

### Diagram 2: Authenticated Newsroom Requests
```
[Journalist / Editor Browser]
       │ (POST /api/articles with Session Cookie / Bearer Token)
       ▼
[Express Auth Middleware] (Validates session & RBAC role)
       │
       ├─► [Unauthorized] ──► 401 / 403 Response
       └─► [Authorized]
             │
             ▼
       [Article Controller & Service Layer]
             │
             ├─► [Audit Logger]
             └─► [PostgreSQL Database (Transaction)]
```

### Diagram 3: Article Creation through Publication Workflow
```
[Journalist Drafts Article] 
       │ (Status: DRAFT)
       ▼
[AI Journalist Assistant] (Gemini API for summary & headline suggestions)
       │
       ▼
[Submit for Review] ──► (Status: REVIEW)
       │
       ▼
[Editor Review Queue] 
       │
       ├─► [Reject] ──► Back to DRAFT with feedback
       └─► [Approve] 
             │
             ├─► [Publish Immediately] ──► (Status: PUBLISHED)
             └─► [Schedule Publication] ──► (Status: SCHEDULED + Cron Worker triggers publish at timestamp)
```

### Diagram 4: Media Upload & Delivery
```
[CMS Media Upload] ──► [Express Upload Handler] ──► [S3-Compatible Object Storage]
                                                              │
[Public Article View] ◄── [CDN / S3 Public URL] ◄─────────────┘
```

### Diagram 5: Search & SEO Indexing
```
[User Search Query (`/api/search?q=...`)] 
       │
       ▼
[PostgreSQL Full-Text Search (`tsvector` & `tsquery`)]
       │
       ▼
[Ranked Article Results]

[SEO & OpenGraph Meta Tags] ──► Injected server-side into HTML head (`index.html` / SSR wrapper) + JSON-LD Schema.org NewsArticle.
```

## 3. Module Boundaries
- **Auth & Users**: Session management, password hashing, RBAC (ADMIN, EDITOR, JOURNALIST, READER).
- **Articles & Categories**: Article CRUD, taxonomies, tags, view counters.
- **Editorial Workflow**: Draft, review, scheduled, published states and audit logs.
- **Comments & Engagement**: Comment submission, moderation queue, active polls.
- **Media**: Image uploads, metadata tracking, S3 storage integration.
- **Search**: PostgreSQL native full-text search indexing.

## 4. Caching & Performance Strategy
- **Static Assets**: Cached at Edge CDN with immutable cache-control headers.
- **Database Queries**: Indexed foreign keys, GIN indexes on full-text search columns, and connection pooling via Prisma.

# Data Model & Prisma Schema Specification - Global Chronicle News

## 1. Entity Relationship Overview
The database uses PostgreSQL with Prisma ORM. Below is the relational data model defining users, categories, articles, comments, polls, media assets, and audit logs.

## 2. Prisma Schema (`prisma/schema.prisma`)

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

enum Role {
  ADMIN
  EDITOR
  JOURNALIST
  READER
}

enum ArticleStatus {
  DRAFT
  REVIEW
  SCHEDULED
  PUBLISHED
  ARCHIVED
}

enum Priority {
  NORMAL
  BREAKING
  FEATURED
}

enum CommentStatus {
  PENDING
  APPROVED
  REJECTED
}

model User {
  id           String       @id @default(uuid())
  email        String       @unique
  passwordHash String
  name         String
  role         Role         @default(READER)
  avatar       String?
  articles     Article[]
  auditLogs    AuditLog[]
  createdAt    DateTime     @default(now())
  updatedAt    DateTime     @updatedAt
}

model Category {
  id          String    @id @default(uuid())
  name        String    @unique
  slug        String    @unique
  description String?
  color       String?
  articles    Article[]
  createdAt   DateTime  @default(now())
}

model Article {
  id           String        @id @default(uuid())
  title        String
  slug         String        @unique
  excerpt      String
  content      String        // Rich text / HTML
  coverImage   String?
  categoryId   String
  category     Category      @relation(fields: [categoryId], references: [id])
  authorId     String
  author       User          @relation(fields: [authorId], references: [id])
  status       ArticleStatus @default(DRAFT)
  priority     Priority      @default(NORMAL)
  views        Int           @default(0)
  scheduledFor DateTime?
  publishedAt  DateTime?
  comments     Comment[]
  createdAt    DateTime      @default(now())
  updatedAt    DateTime      @updatedAt

  @@index([categoryId])
  @@index([authorId])
  @@index([status])
  @@index([publishedAt])
}

model Comment {
  id          String        @id @default(uuid())
  articleId   String
  article     Article       @relation(fields: [articleId], references: [id], onDelete: Cascade)
  authorName  String
  authorEmail String
  content     String
  status      CommentStatus @default(PENDING)
  createdAt   DateTime      @default(now())

  @@index([articleId])
}

model Poll {
  id        String   @id @default(uuid())
  question  String
  options   Json     // Array of { option: string, votes: number }
  active    Boolean  @default(true)
  createdAt DateTime @default(now())
}

model AuditLog {
  id        String   @id @default(uuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  action    String
  details   String?
  createdAt DateTime @default(now())

  @@index([userId])
}
```

## 3. Migration & Transaction Strategy
- **Migrations**: Managed via Prisma Migrate (`prisma migrate dev` / `prisma migrate deploy`).
- **Transactions**: Prisma interactive transactions (`prisma.$transaction`) are used for multi-step editorial actions and audit logging.
- **Full-Text Search**: Indexed using PostgreSQL native capabilities with parameterized queries.

## 4. Phase 7: Lifecycle Semantics & Transactional Guarantees

### 4.1 Article status semantics (draft → public → cold)

| Status | Set by | `publishedAt` | `archivedAt` | Public read | Preserved on entry |
|---|---|---|---|---|---|
| `DRAFT` / `IN_REVIEW` / `REVISION_REQUESTED` / `APPROVED` / `SCHEDULED` | editorial workflow | — | — | 404 | — |
| `PUBLISHED` | workflow transition or scheduler daemon | stamped once (kept on re-publish) | — (cleared semantics: row remains visible) | 200 | — |
| `ARCHIVED` | `DELETE /api/articles/:id`, workflow transition, or restore-loop | kept | **stamped** | 404 (sitemap excluded) | revisions, comments, liveBlogUpdates, articleMedia, editorialEvents, `UrlRedirect` history |

- **Unpublished ≠ archived**: unpublished stories remain editable workflow
  states; `ARCHIVED` is the cold-storage terminal state stamped with
  `archivedAt` (Set on the DELETE-archive path and the
  `→ ARCHIVED` workflow transition).
- **Deleted ≠ archived**: deletion is the separate protected purge procedure
  (`POST /api/articles/:id/purge`, `article:purge` permission), blocked with
  409 for live stories, active breaking-news links and homepage layout
  references, and removes the row only together with its audit trail.

### 4.2 Transactional write paths (both drivers)

| Operation | Writes in one transaction |
|---|---|
| `PUT /api/articles/:id` | article update + slug `UrlRedirect` upsert + media join replace + tag join replace + `UPDATE_ARTICLE` audit log |
| `DELETE /api/articles/:id` (archive) | status/archivedAt update + editorial event + audit log |
| `POST /api/articles/:id/purge` | article delete + `ARTICLE_PURGED` audit log + editorial event |
| Scheduler publish (`publishScheduledArticle`) | article update + editorial event + audit log + `EXECUTED` `PublicationSchedule` (unique `idempotencyKey`) |
| Media delete / replacement | dependent article updates + asset delete + audit log |

Unknown `tagIds`/`mediaAssets` references are validated **before any write** in
both POST and PUT `/api/articles`, so a failed association replace can never be
half-applied.

### 4.3 Data-validation contracts added in Phase 7 (JSON driver parity)

- `article.update` enforces slug uniqueness (`IntegrityError` on conflict),
  matching the database unique index.
- Update/create payloads are **defined-only**: destructured-but-absent fields
  are stripped (`compact()`), so `undefined` can no longer overwrite stored
  values (breaking-news PUT regression).
- `editorialNote` (singular) is the stored column; the legacy
  `editorialNotes` (plural) request key is accepted and mapped.
- `UrlRedirect.sourcePath` is unique; `ensureRoute` provides
  upsert-by-sourcePath semantics for repeated slug changes.

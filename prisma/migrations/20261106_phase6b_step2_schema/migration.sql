-- Phase 6B step 2: reconcile prisma/migrations/20261023_initial_schema with
-- prisma/schema.prisma and add the Phase 6B hardening from
-- docs/DATABASE_MIGRATION_PLAN.md §3.3.
--
-- The historical initial migration never created the following schema objects
-- (schema drift): ArticleMedia, PhotoGallery, GalleryItem, VideoRecord,
-- AnalyticsEvent, the ArticleType enum, Article.articleType / Article.videoUrl.
-- All are created here with NOT NULL-safe defaults.

CREATE TYPE "ArticleType" AS ENUM ('STANDARD', 'LIVE_BLOG', 'VIDEO', 'PHOTO_GALLERY', 'OPINION', 'EXPLAINER');

-- ---------------------------------------------------------------------------
-- Article: columns routes have been persisting through the JSON layer
-- ---------------------------------------------------------------------------
ALTER TABLE "Article" ADD COLUMN "articleType" "ArticleType" NOT NULL DEFAULT 'STANDARD';
ALTER TABLE "Article" ADD COLUMN "videoUrl" TEXT;
ALTER TABLE "Article" ADD COLUMN "coverImage" TEXT;
ALTER TABLE "Article" ADD COLUMN "imageCaption" TEXT;
ALTER TABLE "Article" ADD COLUMN "imageCredit" TEXT;
ALTER TABLE "Article" ADD COLUMN "sourceAttribution" TEXT;
ALTER TABLE "Article" ADD COLUMN "seoTitle" TEXT;
ALTER TABLE "Article" ADD COLUMN "seoDescription" TEXT;
ALTER TABLE "Article" ADD COLUMN "socialImage" TEXT;
ALTER TABLE "Article" ADD COLUMN "editorialNote" TEXT;

CREATE INDEX "Article_status_publishedAt_idx" ON "Article"("status", "publishedAt");

-- ---------------------------------------------------------------------------
-- User: Phase 4 password revocation anchor
-- ---------------------------------------------------------------------------
ALTER TABLE "User" ADD COLUMN "passwordChangedAt" TIMESTAMP(3);

-- ---------------------------------------------------------------------------
-- MediaAsset: focal-point columns (JSON layer always stored them; defaults 50/50)
-- ---------------------------------------------------------------------------
ALTER TABLE "MediaAsset" ADD COLUMN "focalX" INTEGER NOT NULL DEFAULT 50;
ALTER TABLE "MediaAsset" ADD COLUMN "focalY" INTEGER NOT NULL DEFAULT 50;

-- ---------------------------------------------------------------------------
-- ArticleRevision: enforce (articleId, version) integrity for the restore endpoint
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "ArticleRevision_articleId_version_key" ON "ArticleRevision"("articleId", "version");

-- ---------------------------------------------------------------------------
-- ArticleMedia (in schema.prisma since the original schema, missing from the
-- initial migration — see docs/DATABASE_MIGRATION_PLAN.md §3.1)
-- ---------------------------------------------------------------------------
CREATE TABLE "ArticleMedia" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "mediaAssetId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "placement" TEXT NOT NULL DEFAULT 'INLINE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ArticleMedia_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ArticleMedia_articleId_idx" ON "ArticleMedia"("articleId");
CREATE INDEX "ArticleMedia_mediaAssetId_idx" ON "ArticleMedia"("mediaAssetId");
CREATE INDEX "ArticleMedia_articleId_position_idx" ON "ArticleMedia"("articleId", "position");
CREATE UNIQUE INDEX "ArticleMedia_articleId_mediaAssetId_key" ON "ArticleMedia"("articleId", "mediaAssetId");

ALTER TABLE "ArticleMedia" ADD CONSTRAINT "ArticleMedia_articleId_fkey"
    FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArticleMedia" ADD CONSTRAINT "ArticleMedia_mediaAssetId_fkey"
    FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- PhotoGallery / GalleryItem / VideoRecord / AnalyticsEvent (schema drift)
-- ---------------------------------------------------------------------------
CREATE TABLE "PhotoGallery" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PhotoGallery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PhotoGallery_slug_key" ON "PhotoGallery"("slug");

CREATE TABLE "GalleryItem" (
    "id" TEXT NOT NULL,
    "galleryId" TEXT NOT NULL,
    "mediaAssetId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "caption" TEXT,
    CONSTRAINT "GalleryItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GalleryItem_galleryId_idx" ON "GalleryItem"("galleryId");

ALTER TABLE "GalleryItem" ADD CONSTRAINT "GalleryItem_galleryId_fkey"
    FOREIGN KEY ("galleryId") REFERENCES "PhotoGallery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GalleryItem" ADD CONSTRAINT "GalleryItem_mediaAssetId_fkey"
    FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "VideoRecord" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "videoUrl" TEXT NOT NULL,
    "durationSec" INTEGER,
    "thumbnail" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VideoRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VideoRecord_slug_key" ON "VideoRecord"("slug");

CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AnalyticsEvent_type_idx" ON "AnalyticsEvent"("type");
CREATE INDEX "AnalyticsEvent_createdAt_idx" ON "AnalyticsEvent"("createdAt");
CREATE INDEX "AnalyticsEvent_type_createdAt_idx" ON "AnalyticsEvent"("type", "createdAt");

-- ---------------------------------------------------------------------------
-- Reaction (new model — plan §3.3)
-- ---------------------------------------------------------------------------
CREATE TABLE "Reaction" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Reaction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Reaction_articleId_idx" ON "Reaction"("articleId");
CREATE INDEX "Reaction_articleId_type_idx" ON "Reaction"("articleId", "type");

ALTER TABLE "Reaction" ADD CONSTRAINT "Reaction_articleId_fkey"
    FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- PasswordResetToken (new model — joins Phase 4 hashes to PostgreSQL)
-- ---------------------------------------------------------------------------
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");

ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- RevokedSession (new model — jti-based JWT revocation store)
-- ---------------------------------------------------------------------------
CREATE TABLE "RevokedSession" (
    "jti" TEXT NOT NULL,
    "userId" TEXT,
    "revokedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RevokedSession_pkey" PRIMARY KEY ("jti")
);

CREATE INDEX "RevokedSession_expiresAt_idx" ON "RevokedSession"("expiresAt");
CREATE INDEX "RevokedSession_userId_idx" ON "RevokedSession"("userId");

ALTER TABLE "RevokedSession" ADD CONSTRAINT "RevokedSession_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- HomepageConfig (new model — layout singleton)
-- ---------------------------------------------------------------------------
CREATE TABLE "HomepageConfig" (
    "id" TEXT NOT NULL,
    "featuredArticleId" TEXT,
    "breakingArticleId" TEXT,
    "breakingBannerActive" BOOLEAN NOT NULL DEFAULT true,
    "sectionOrder" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HomepageConfig_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- Comment / AuditLog composite indexes (plan §3.3)
-- ---------------------------------------------------------------------------
CREATE INDEX "Comment_articleId_status_idx" ON "Comment"("articleId", "status");
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

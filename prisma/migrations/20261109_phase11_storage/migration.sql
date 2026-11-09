-- Phase 11: storage abstraction bookkeeping for MediaAsset.
--
-- These columns record which storage provider actually holds each object
-- (storageDriver), where it lives inside that provider (storageKey), the
-- configured visibility (public = direct read URL, private = signed URL),
-- and the generated responsive variants. NULL storageKey/storageDriver on
-- historical rows means "pre-abstraction record" — the reconciliation tooling
-- reports them instead of guessing a provider.

ALTER TABLE "MediaAsset" ADD COLUMN "storageKey" TEXT;
ALTER TABLE "MediaAsset" ADD COLUMN "storageDriver" TEXT;
ALTER TABLE "MediaAsset" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'public';
ALTER TABLE "MediaAsset" ADD COLUMN "variants" JSONB;

-- External URL records have no byte identity on the provider; the former
-- fabricated default (524288) is gone in favour of a nullable size.
ALTER TABLE "MediaAsset" ALTER COLUMN "sizeBytes" DROP NOT NULL;

-- Reconciliation scans keys from the provider and joins against storageKey,
-- so every asset put through the Phase 11 pipeline becomes indexed.
CREATE INDEX "MediaAsset_storageKey_idx" ON "MediaAsset"("storageKey");

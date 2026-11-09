-- Phase 6B step 1: widen RoleType enum to match src/modules/auth/permissions.ts
-- (see docs/DATABASE_MIGRATION_PLAN.md §3.2).
--
-- PostgreSQL requires ALTER TYPE ... ADD VALUE to run before the new values can be
-- used (CREATE TABLE / ALTER TABLE) in the SAME transaction, so this migration only
-- widens the types. Schema changes that USE the new enum values live in
-- 20261106_phase6b_step2_schema.
--
-- Legacy runtime-only values stay untouched (data has none of them).

-- Runtime RoleType values missing from the historical initial schema:
ALTER TYPE "RoleType" ADD VALUE IF NOT EXISTS 'SUPER_ADMIN';
ALTER TYPE "RoleType" ADD VALUE IF NOT EXISTS 'MANAGING_EDITOR';
ALTER TYPE "RoleType" ADD VALUE IF NOT EXISTS 'SECTION_EDITOR';
ALTER TYPE "RoleType" ADD VALUE IF NOT EXISTS 'COPY_EDITOR';
ALTER TYPE "RoleType" ADD VALUE IF NOT EXISTS 'REPORTER';
ALTER TYPE "RoleType" ADD VALUE IF NOT EXISTS 'PHOTOGRAPHER';
ALTER TYPE "RoleType" ADD VALUE IF NOT EXISTS 'VIDEO_EDITOR';
ALTER TYPE "RoleType" ADD VALUE IF NOT EXISTS 'ADVERTISING_MANAGER';
ALTER TYPE "RoleType" ADD VALUE IF NOT EXISTS 'ANALYST';

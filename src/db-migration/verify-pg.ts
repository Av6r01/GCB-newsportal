/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Post-import verification for the JSON → PostgreSQL migration
 * (Phase 6B, docs/DATABASE_MIGRATION_PLAN.md §6.4).
 *
 * Checks, in order:
 *   1. Database is reachable and both Phase 6B migrations are applied.
 *   2. Per-table record counts against the JSON source (when data/database.json
 *      exists) — flagging each delta as expected (expired/orphaned) or missing.
 *   3. Relationship invariants: published articles have dates, revisions
 *      reference (articleId, version) uniquely, no dangling article_tag rows
 *      (guaranteed by FK), unique slugs, corrupt-session/token hygiene.
 *   4. Write path sanity inside a transaction that ROLLS BACK — proves the
 *      transactional round-trip without leaving test rows behind.
 *
 * Usage: npm run db:verify  (uses DATABASE_URL; exits 1 on any check failure)
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const JSON_DB = path.join(ROOT, 'data', 'database.json');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('[FATAL] DATABASE_URL is required for db:verify.');
  process.exit(1);
}

const prisma = new PrismaClient({ datasourceUrl: DATABASE_URL });

let failures = 0;
let warnings = 0;
function pass(label: string, detail = '') { console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`); }
function fail(label: string, detail: string) { failures++; console.error(`  ✗ ${label} — ${detail}`); }
function warn(label: string, detail: string) { warnings++; console.warn(`  ! ${label} — ${detail}`); }

const TABLES: Array<[string, any]> = [
  ['users', prisma.user], ['userSessions', prisma.userSession], ['authorProfiles', prisma.authorProfile],
  ['categories', prisma.category], ['tags', prisma.tag], ['articleTags', prisma.articleTag],
  ['articles', prisma.article], ['articleContributors', prisma.articleContributor],
  ['articleRevisions', prisma.articleRevision], ['editorialEvents', prisma.editorialEvent],
  ['publicationSchedules', prisma.publicationSchedule], ['mediaAssets', prisma.mediaAsset],
  ['articleMedia', prisma.articleMedia], ['photoGalleries', prisma.photoGallery],
  ['galleryItems', prisma.galleryItem], ['videoRecords', prisma.videoRecord],
  ['liveBlogUpdates', prisma.liveBlogUpdate], ['breakingNewsAnnouncements', prisma.breakingNewsAnnouncement],
  ['comments', prisma.comment], ['polls', prisma.poll], ['newsletterSubscriptions', prisma.newsletterSubscription],
  ['urlRedirects', prisma.urlRedirect], ['adPlacements', prisma.adPlacement], ['siteSettings', prisma.siteSetting],
  ['auditLogs', prisma.auditLog], ['reactions', prisma.reaction], ['homepageConfigs', prisma.homepageConfig],
  ['analyticsEvents', prisma.analyticsEvent], ['passwordResetTokens', prisma.passwordResetToken],
  ['revokedSessions', prisma.revokedSession],
] as Array<[string, any]>;

/** JSON keys that legitimately won't have an exact count match in PG (plan §6.4) */
const EXPECTED_LOWER = new Set(['userSessions', 'passwordResetTokens', 'revokedSessions']);

async function checkMigrations() {
  console.log('\n[1] Migration ledger');
  try {
    const applied = await prisma.$queryRawUnsafe<Array<{ migration_name: string }>>(
      'SELECT migration_name FROM _prisma_migrations ORDER BY migration_name'
    );
    const names = applied.map((r) => r.migration_name);
    for (const expected of ['20261023_initial_schema', 'phase6b_step1_enums', 'phase6b_step2_schema']) {
      if (names.some((n) => n.includes(expected))) {
        pass(`migration applied: ${expected}`);
      } else {
        fail(`migration applied: ${expected}`, 'missing from _prisma_migrations — run `npm run db:migrate:deploy`');
      }
    }
  } catch (err: any) {
    fail('migration ledger', `cannot read _prisma_migrations: ${err.message}`);
  }
}

async function checkCounts(jsonCounts: Record<string, number> | null) {
  console.log('\n[2] Record counts');
  const pgCounts: Record<string, number> = {};
  for (const [name, model] of TABLES) {
    pgCounts[name] = await model.count();
  }

  if (!jsonCounts) {
    warn('JSON source', 'data/database.json not found — counts not compared');
  } else {
    for (const [name, model] of TABLES) {
      const jsonCount = jsonCounts[name] ?? 0;
      const pgCount = pgCounts[name];
      if (pgCount === jsonCount) {
        pass(`${name}: ${pgCount}`);
      } else if (jsonCount === 0) {
        pass(`${name}: ${pgCount} (JSON had no rows)`);
      } else if (pgCount === 0 && EXPECTED_LOWER.has(name)) {
        warn(`${name}`, `JSON had ${jsonCount}, PG has 0 — expected if all rows were expired (dropped per plan §8)`);
      } else if (pgCount < jsonCount && EXPECTED_LOWER.has(name)) {
        warn(`${name}`, `JSON had ${jsonCount}, PG has ${pgCount} — expired rows dropped per plan §8`);
      } else if (pgCount > jsonCount) {
        pass(`${name}: ${pgCount}`, `PG has more rows than JSON (${jsonCount}) — e.g. daemon user/post-import writes; expected`);
      } else {
        fail(`${name}`, `JSON had ${jsonCount}, PG has ${pgCount} — rows missing after import`);
      }
    }
  }
  return pgCounts;
}

async function checkRelationships(pgCounts: Record<string, number>) {
  console.log('\n[3] Relationship invariants');

  const publishedWithoutDate = await prisma.article.count({ where: { status: 'PUBLISHED', publishedAt: null } });
  if (publishedWithoutDate === 0) pass('every PUBLISHED article has publishedAt');
  else fail('published dates', `${publishedWithoutDate} PUBLISHED article(s) without publishedAt`);

  const archivedWithoutDate = await prisma.article.count({ where: { status: 'ARCHIVED', archivedAt: null } });
  if (archivedWithoutDate === 0) pass('every ARCHIVED article has archivedAt');
  else warn('archived dates', `${archivedWithoutDate} ARCHIVED article(s) without archivedAt (allowed if source had none)`);

  // (articleId, version) must be unique — the composite index enforces it; verify no dupes
  const dupes = await prisma.$queryRawUnsafe<Array<{ articleId: string; version: number; n: number }>>(
    'SELECT "articleId", version, COUNT(*)::int AS n FROM "ArticleRevision" GROUP BY "articleId", version HAVING COUNT(*) > 1'
  );
  if (dupes.length === 0) pass('ArticleRevision (articleId, version) unique');
  else fail('revision versioning', `${dupes.length} duplicate (articleId, version) pair(s)`);

  // Every article has exactly one initial revision (version 1) when revisions exist
  const missingInitial = pgCounts.articles > 0 && pgCounts.articleRevisions > 0
    ? await prisma.article.findMany({
        where: { revisions: { none: { version: 1 } } },
        select: { id: true },
      })
    : [];
  if (missingInitial.length === 0) pass('every article with revisions has a version-1 snapshot');
  else warn('initial revisions', `${missingInitial.length} article(s) lack a version-1 revision (JSON source may not have had one)`);

  // Orphan checks across FK-joined tables — raw SQL so we can LEFT JOIN proof the constraints hold
  const danglingJoins = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
    `SELECT COUNT(*)::int AS n FROM "ArticleTag" t
     LEFT JOIN "Article" a ON a.id = t."articleId"
     LEFT JOIN "Tag" tg ON tg.id = t."tagId"
     WHERE a.id IS NULL OR tg.id IS NULL`
  );
  if (Number(danglingJoins[0]?.n) === 0) pass('no dangling article_tag join rows');
  else fail('article tags', `${danglingJoins[0]?.n} dangling join row(s)`);

  const mediaWithoutUploader = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
    `SELECT COUNT(*)::int AS n FROM "MediaAsset" m LEFT JOIN "User" u ON u.id = m."uploaderId" WHERE u.id IS NULL`
  );
  if (Number(mediaWithoutUploader[0]?.n) === 0) pass('every media asset has an uploader');
  else fail('media uploaders', `${mediaWithoutUploader[0]?.n} asset(s) without uploader`);

  const userWithUnknownRole = await prisma.$queryRawUnsafe<Array<{ role: string }>>(
    `SELECT DISTINCT role FROM "User" WHERE role NOT IN
     ('SUPER_ADMIN','ADMIN','MANAGING_EDITOR','SECTION_EDITOR','COPY_EDITOR','JOURNALIST','REPORTER','PHOTOGRAPHER','VIDEO_EDITOR','ADVERTISING_MANAGER','ANALYST','READER')`
  );
  if (userWithUnknownRole.length === 0) pass('all user roles within runtime RoleType enum');
  else fail('role enum', `unexpected roles: ${userWithUnknownRole.map((r) => r.role).join(', ')}`);

  // Security hygiene (plan §8): no expired password-reset rows
  const expiredResets = await prisma.passwordResetToken.count({ where: { expiresAt: { lte: new Date() } } });
  if (expiredResets === 0) pass('no expired password-reset tokens stored');
  else warn('expired reset tokens', `${expiredResets} expired token(s) present — run purgeExpired`);

  const daemon = await prisma.user.findUnique({ where: { id: 'usr-system-daemon' } });
  if (daemon) {
    if (daemon.isActive) fail('system daemon', 'usr-system-daemon must be inactive (non-loginable)');
    else pass('system daemon present and inactive');
  } else {
    warn('system daemon', 'usr-system-daemon missing — scheduler editorial events will fail actor lookup; run `npm run db:import` or seed');
  }
}

async function checkTransactionRollback() {
  console.log('\n[4] Transactional round-trip (rolls back — leaves no test rows)');
  const before = await prisma.article.count();
  const cat = await prisma.category.findFirst({ select: { id: true } });
  const usr = await prisma.user.findFirst({ select: { id: true } });
  if (!cat || !usr) { warn('txn smoke', 'no category/user present — skipped'); return; }

  let rolledBackCleanly = true;
  try {
    await prisma.$transaction(async (tx: any) => {
      await tx.article.create({
        data: {
          id: 'verify-txn-tmp', title: 'VERIFY TEMP', slug: 'verify-txn-tmp',
          excerpt: 'temp', content: 'temp', categoryId: cat.id, authorId: usr.id,
          status: 'DRAFT',
        },
      });
      throw new Error('intentional rollback');
    });
  } catch (err: any) {
    if (!/intentional rollback/.test(String(err.message))) {
      rolledBackCleanly = false;
      fail('txn rollback', `unexpected transaction error: ${err.message}`);
    }
  }
  const after = await prisma.article.count();
  if (rolledBackCleanly && after === before) {
    pass('transaction rolled back — no article row leaked');
  } else if (after !== before) {
    fail('txn rollback', `article count changed ${before} → ${after}: rollback left data behind`);
  }

  // Slug uniqueness proof: second insert with same slug must fail inside a transaction
  const slugProbe = `verify-dup-${crypto.randomBytes(3).toString('hex')}`;
  try {
    await prisma.$transaction(async (tx: any) => {
      await tx.article.create({
        data: {
          id: 'verify-dup-1', title: 'DUP', slug: slugProbe, excerpt: 'x', content: 'x',
          categoryId: cat.id, authorId: usr.id, status: 'DRAFT',
        },
      });
      await tx.article.create({
        data: {
          id: 'verify-dup-2', title: 'DUP', slug: slugProbe, excerpt: 'x', content: 'x',
          categoryId: cat.id, authorId: usr.id, status: 'DRAFT',
        },
      });
    });
    fail('slug uniqueness', 'duplicate slug accepted — unique index missing!');
    // Remove the evidence so the database isn't polluted by a failed check
    await prisma.article.deleteMany({ where: { slug: slugProbe } });
  } catch {
    pass(`unique slug constraint rejected duplicates (${slugProbe})`);
    // confirm nothing leaked
    const leaked = await prisma.article.count({ where: { slug: slugProbe } });
    if (leaked > 0) fail('txn rollback', 'duplicate-slug probe left rows behind');
  }
}

async function main() {
  console.log(`[VERIFY] target=${DATABASE_URL}`);
  try { await prisma.user.count(); } catch (err) {
    console.error(`[FATAL] cannot reach database: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
  const hasJson = fs.existsSync(JSON_DB);
  let jsonCounts: Record<string, number> | null = null;
  if (hasJson) {
    const raw = JSON.parse(fs.readFileSync(JSON_DB, 'utf-8'));
    jsonCounts = Object.fromEntries(TABLES.map(([name]) => [name, Array.isArray(raw[name]) ? raw[name].length : 0]));
  }

  await checkMigrations();
  const pgCounts = await checkCounts(jsonCounts);
  await checkRelationships(pgCounts);
  await checkTransactionRollback();

  const report = {
    verifiedAt: new Date().toISOString(),
    target: DATABASE_URL!.replace(/:[^:@]+@/, ':***@'),
    failures, warnings, pgCounts, jsonCounts,
  };
  const out = path.join(ROOT, 'data', 'migration', 'verify.report.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`\n[VERIFY] report → data/migration/verify.report.json`);
  if (failures > 0) {
    console.error(`[VERIFY] FAILED: ${failures} failed check(s), ${warnings} warning(s)`);
    process.exit(1);
  }
  console.log(`[VERIFY] PASSED (0 failures, ${warnings} warnings)`);
  process.exit(0);
}

main()
  .catch((err) => { console.error('[FATAL] verify failed:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());

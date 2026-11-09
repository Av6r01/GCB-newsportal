/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PostgreSQL persistence integration tests (Phase 6B, plan §10).
 *
 * Coverage:
 *   T1 migrations applied (ledger)
 *   T2 unique slug constraint enforced (dup insert rejected, no partial write)
 *   T3 interactive transaction rollback leaves no rows behind
 *   T4 concurrent writes: atomic views increment + slug race (one winner)
 *   T5 restart persistence: rows survive a full disconnect/reconnect cycle
 *   T6 data migration: idempotent JSON import, no silent overwrites, skip
 *      reporting (invalid hashes, orphaned events), count parity
 *
 * Isolation rules (Phase 6B acceptance gate):
 *   - WITHOUT TEST_DATABASE_URL the suite SKIPS cleanly and lists the exact
 *     commands it did not run (this dev machine has no PostgreSQL/Docker).
 *   - WITH TEST_DATABASE_URL: a per-run disposable database `gcn_test_<runid>`
 *     is created on the same server, migrated, filled, tested, and DROPPED.
 *     PRODUCTION data/database.json and uploads are never touched.
 *
 * Usage:
 *   TEST_DATABASE_URL=postgresql://user:pass@host:5432/postgres npm run test:persistence
 */

import { execSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const RUN_ID = crypto.randomBytes(6).toString('hex');

if (!TEST_DATABASE_URL) {
  console.log('================================================================');
  console.log('SKIPPED: PostgreSQL persistence integration tests not executed.');
  console.log('  A disposable PostgreSQL instance is required (this machine has');
  console.log('  neither Docker nor psql installed).');
  console.log('');
  console.log('Commands NOT run:');
  console.log('  npm run test:persistence  — started a disposable PG via:');
  console.log('    docker run --rm -d --name gcn-test-pg -e POSTGRES_PASSWORD=gcn -p 55432:5432 postgres:15-alpine');
  console.log('  TEST_DATABASE_URL=postgresql://postgres:gcn@localhost:55432/postgres npx tsx tests/persistence/run.ts');
  console.log('    (creates gcn_test_' + RUN_ID + ', migrates, imports JSON, tests, drops)');
  console.log('');
  console.log('Everything else in Phase 6B (typecheck, driver selector, import');
  console.log('script validation/dry-run, export, deploy docs) runs without PG.');
  console.log('================================================================');
  process.exit(0);
}

// ── Disposable DB lifecycle ────────────────────────────────────────────────
const url = new URL(TEST_DATABASE_URL);
const serverUrl = `${url.protocol}//${encodeURIComponent(url.username)}:${url.password}@${url.host}${url.pathname.endsWith('/') ? url.pathname : url.pathname + '/'}`;
const TEST_DB = `gcn_test_${RUN_ID}`;

let adminClient = new PrismaClient({ datasourceUrl: serverUrl + 'postgres' });
let client: PrismaClient;
let failures = 0;

function pass(label: string, detail = '') { console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`); }
function fail(label: string, detail: string) { failures++; console.error(`  ✗ ${label} — ${detail}`); }

function assert(cond: unknown, label: string, detail = '') {
  if (cond) pass(label);
  else fail(label, detail || 'assertion failed');
}

function resolveServerDbUrl(): URL {
  const u = new URL(TEST_DATABASE_URL!);
  const pathParts = u.pathname.split('/').filter(Boolean);
  // last path part is the admin database for CREATE DATABASE (usually 'postgres')
  u.pathname = '/' + (pathParts[pathParts.length - 1] || 'postgres');
  return u;
}

async function createTestDatabase(): Promise<string> {
  const adminDb = resolveServerDbUrl();
  const connString = adminDb.toString();
  const admin = new PrismaClient({ datasourceUrl: connString });
  try {
    const exists = await admin.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT COUNT(*)::int AS n FROM pg_database WHERE datname = $1`, TEST_DB
    );
    if (Number(exists[0]?.n) > 0) {
      await admin.$executeRawUnsafe(`DROP DATABASE "${TEST_DB}" WITH (FORCE)`);
    }
    await admin.$executeRawUnsafe(`CREATE DATABASE "${TEST_DB}"`);
  } finally {
    await admin.$disconnect();
  }
  return new URL(TEST_DATABASE_URL!).origin + '/' + TEST_DB + (new URL(TEST_DATABASE_URL!).search || '');
}

async function applyMigrations(targetUrl: string) {
  console.log('\n[setup] prisma validate + migrate deploy …');
  execSync('npx prisma validate', {
    env: { ...process.env, DATABASE_URL: targetUrl },
    stdio: 'pipe',
    cwd: process.cwd(),
  });
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: targetUrl },
    stdio: 'pipe',
    cwd: process.cwd(),
  });
  console.log('[setup] migrations applied to disposable DB');
}

async function runImport(targetUrl: string): Promise<{ stdout: string; code: number }> {
  console.log('\n[setup] JSON → PG import (idempotent, --fix-orphans for disposable test data) …');
  try {
    const stdout = execSync(
      'npx tsx src/db-migration/import-json-to-pg.ts --fix-orphans',
      { env: { ...process.env, DATABASE_URL: targetUrl }, stdio: 'pipe', cwd: process.cwd() }
    ).toString();
    return { stdout, code: 0 };
  } catch (err: any) {
    return { stdout: String(err.stdout || '') + String(err.stderr || ''), code: err.status ?? 1 };
  }
}

async function dropTestDatabase() {
  const admin = new PrismaClient({ datasourceUrl: resolveServerDbUrl().toString() });
  try {
    await admin.$executeRawUnsafe(`DROP DATABASE "${TEST_DB}" WITH (FORCE)`);
    console.log(`[teardown] dropped ${TEST_DB}`);
  } catch (err: any) {
    console.warn(`[teardown] could not drop ${TEST_DB}: ${err.message} (drop manually)`);
  } finally {
    await admin.$disconnect();
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────
async function t1_migrations(db: PrismaClient) {
  console.log('\n[T1] migration ledger');
  const rows = await db.$queryRawUnsafe<Array<{ migration_name: string }>>(
    'SELECT migration_name FROM _prisma_migrations'
  );
  const names = rows.map((r) => r.migration_name);
  assert(names.some((n) => n.includes('initial_schema')), 'initial schema migration applied');
  assert(names.some((n) => n.includes('phase6b_step1_enums')), 'phase6b_step1_enums applied');
  assert(names.some((n) => n.includes('phase6b_step2_schema')), 'phase6b_step2_schema applied');
}

async function t2_unique_slug(db: PrismaClient) {
  console.log('\n[T2] unique article slug');
  const cat = await db.category.create({ data: { id: 'cat-t2', name: 'T2 Cat', slug: 't2-cat' } });
  const usr = await db.user.create({
    data: { id: 'usr-t2', email: 't2@gcn.test', passwordHash: '$2b$10$abcdefghijklmnopqrstuv00000000000000000000000000', name: 'T2 Author' },
  });
  const base = {
    slug: 't2-unique-slug', excerpt: 'x', content: 'x',
    categoryId: cat.id, authorId: usr.id, status: 'PUBLISHED' as const,
  };
  await db.article.create({ data: { ...base, id: 'art-t2-1', title: 'First' } });

  let rejected = false;
  try {
    await db.article.create({ data: { ...base, id: 'art-t2-2', title: 'Second' } });
  } catch (err: any) {
    rejected = err.code === 'P2002';
  }
  assert(rejected, 'duplicate slug rejected with Prisma P2002');
  const count = await db.article.count();
  assert(count === 1, 'no partial write (article count stays 1)', `count=${count}`);
  assert(!rejected || (await db.article.count({ where: { slug: base.slug } })) === 1,
    'single row for the unique slug');
}

async function t3_transaction_rollback(db: PrismaClient) {
  console.log('\n[T3] transaction rollback');
  const beforeArticles = await db.article.count();
  const beforeRevisions = await db.articleRevision.count();
  let rollBackError: unknown = null;
  try {
    await db.$transaction(async (tx: any) => {
      await tx.article.create({
        data: { id: 'art-t3', title: 'T3', slug: 't3-rollback', excerpt: 'x', content: 'x',
                categoryId: 'cat-t2', authorId: 'usr-t2', status: 'DRAFT' },
      });
      throw new Error('intentional rollback');
    });
  } catch (err) {
    rollBackError = err;
  }
  assert(!!rollBackError && /intentional rollback/.test(String((rollBackError as Error).message)),
    'transaction threw the expected error');
  const afterArticles = await db.article.count();
  const afterRevisions = await db.articleRevision.count();
  assert(afterArticles === beforeArticles, 'article not persisted after rollback',
    `${beforeArticles}→${afterArticles}`);
  assert(afterRevisions === beforeRevisions, 'revision not persisted after rollback',
    `${beforeRevisions}→${afterRevisions}`);
}

async function t4_concurrent_writes(db: PrismaClient) {
  console.log('\n[T4] concurrent writes');
  const art = await db.article.create({
    data: { id: 'art-t4', title: 'T4', slug: 't4-concurrent', excerpt: 'x', content: 'x',
            categoryId: 'cat-t2', authorId: 'usr-t2', status: 'PUBLISHED', publishedAt: new Date(), views: 0 },
  });

  // 25 simultaneous view increments on the same row — all must land atomically
  const N = 25;
  await Promise.all(
    Array.from({ length: N }, () => db.article.update({ where: { id: art.id }, data: { views: { increment: 1 } } }))
  );
  await db.$disconnect();
  const fresh = new PrismaClient({ datasourceUrl: new URL(TEST_DATABASE_URL!).origin + '/' + TEST_DB });
  try {
    const reloaded = await fresh.article.findUnique({ where: { id: art.id } });
    assert(reloaded!.views === N, `${N} concurrent increments all landed`, `views=${reloaded!.views}`);

    // Slug race: two concurrent creates with the SAME slug — exactly one wins
    const slugRace = 't4-race-slug';
    const results = await Promise.allSettled([
      fresh.article.create({ data: { id: 'art-t4-r1', title: 'R1', slug: slugRace, excerpt: 'x', content: 'x',
                                      categoryId: 'cat-t2', authorId: 'usr-t2', status: 'DRAFT' } }),
      fresh.article.create({ data: { id: 'art-t4-r2', title: 'R2', slug: slugRace, excerpt: 'x', content: 'x',
                                      categoryId: 'cat-t2', authorId: 'usr-t2', status: 'DRAFT' } }),
    ]);
    const winners = results.filter((r) => r.status === 'fulfilled').length;
    const losers = results.filter((r) => r.status === 'rejected').length;
    assert(winners === 1 && losers === 1, 'slug race: exactly one create succeeded',
      `winners=${winners} losers=${losers}`);
  } finally {
    await fresh.$disconnect();
  }
}

async function t5_restart_persistence(db: PrismaClient) {
  console.log('\n[T5] restart persistence');
  await db.article.update({
    where: { id: 'art-t2-1' },
    data: { title: 'Renamed before restart', views: 77 },
  });
  await db.$disconnect();
  // Full reconnect — the process "restarted"
  const reconnected = new PrismaClient({ datasourceUrl: new URL(TEST_DATABASE_URL!).origin + '/' + TEST_DB });
  try {
    const row = await reconnected.article.findUnique({ where: { id: 'art-t2-1' } });
    assert(!!row && row.title === 'Renamed before restart' && row.views === 77,
      'writes survived full disconnect/reconnect cycle',
      `title=${row?.title} views=${row?.views}`);
  } finally {
    await reconnected.$disconnect();
  }
}

async function t6_data_migration(targetUrl: string, importStdout: string, importCode: number) {
  console.log('\n[T6] data migration (JSON → PG, idempotent)');
  assert(importCode === 0, 'import script completed successfully on disposable DB',
    `exit=${importCode}\n${importStdout.slice(-400)}`);

  const db = new PrismaClient({ datasourceUrl: targetUrl });
  try {
    const counts = {
      users: await db.user.count(),
      articles: await db.article.count(),
      articleRevisions: await db.articleRevision.count(),
      mediaAssets: await db.mediaAsset.count(),
      articleMedia: await db.articleMedia.count(),
      categories: await db.category.count(),
      editorialEvents: await db.editorialEvent.count(),
    };
    const jsonCounts = {
      users: 18, articles: 30, articleRevisions: 35, mediaAssets: 16,
      articleMedia: 16, categories: 12, editorialEvents: 8,
    };
    assert(counts.categories === jsonCounts.categories, `all ${jsonCounts.categories} categories imported`, `got ${counts.categories}`);
    assert(counts.articles === jsonCounts.articles, `all ${jsonCounts.articles} articles imported`, `got ${counts.articles}`);
    assert(counts.articleRevisions === jsonCounts.articleRevisions, 'all 35 revisions imported', `got ${counts.articleRevisions}`);
    assert(counts.mediaAssets === jsonCounts.mediaAssets, 'all 16 media assets imported', `got ${counts.mediaAssets}`);
    assert(counts.articleMedia === jsonCounts.articleMedia, 'all 16 article-media joins imported', `got ${counts.articleMedia}`);
    assert(counts.users === 6, '5 valid-bcrypt users + system daemon imported (13 placeholder-hash rows skipped)',
      `got ${counts.users}`);
    assert(counts.editorialEvents === 0,
      '8 orphaned editorial events NOT imported (fail-closed skip reporting)', `got ${counts.editorialEvents}`);

    // Idempotency: re-run the import; nothing may change
    const viewsBefore = (await db.article.findUnique({ where: { id: 'art-1' } }))?.views;
    const second = await runImport(targetUrl);
    assert(second.code === 0, 'second import run succeeds (idempotent)', `exit=${second.code}`);
    const countsAgain = await db.article.count();
    assert(countsAgain === counts.articles, 'second import inserted nothing new', `articles ${counts.articles}→${countsAgain}`);
    const viewsAfter = (await db.article.findUnique({ where: { id: 'art-1' } }))?.views;
    assert(viewsAfter === viewsBefore, 'existing row CONTENT not overwritten by second import',
      `views ${viewsBefore}→${viewsAfter}`);

    // Report file exists with skip/conflict evidence
    const reportPath = path.resolve(process.cwd(), 'data/migration/import.report.json');
    if (fs.existsSync(reportPath)) {
      const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
      const invalidUsers = (report.skippedInvalid?.users || []).length;
      const orphanEvents = (report.orphans?.editorialEvents || []).length;
      assert(invalidUsers === 13, 'report lists the 13 invalid passwordHash users', `got ${invalidUsers}`);
      assert(orphanEvents === 8, 'report lists the 8 orphaned editorial events', `got ${orphanEvents}`);
    } else {
      fail('import report', 'data/migration/import.report.json was not written');
    }
  } finally {
    await db.$disconnect();
  }
}

// ── Orchestration ──────────────────────────────────────────────────────────
async function main() {
  console.log(`[persistence] creating disposable database ${TEST_DB} …`);
  const targetUrl = await createTestDatabase();
  try {
    await applyMigrations(targetUrl);
    client = new PrismaClient({ datasourceUrl: targetUrl });

    await t1_migrations(client);
    await t2_unique_slug(client);
    await t3_transaction_rollback(client);
    await t4_concurrent_writes(client);
    await t5_restart_persistence(client);

    // T6 mutates the DB via import; run last so earlier invariants stay stable
    await client.$disconnect();
    const { stdout, code } = await runImport(targetUrl);
    await t6_data_migration(targetUrl, stdout, code);
  } finally {
    await dropTestDatabase();
    await adminClient.$disconnect();
  }

  console.log(`\n[persistence] ${failures === 0 ? 'ALL PASSED' : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[persistence] FATAL:', err);
  dropTestDatabase()
    .catch(() => undefined)
    .then(() => adminClient.$disconnect())
    .then(() => process.exit(1));
});

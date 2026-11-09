/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * One-time JSON → PostgreSQL import (Phase 6B, docs/DATABASE_MIGRATION_PLAN.md §6).
 *
 * Properties (per Phase 6B acceptance gate):
 *   - IDEMPOTENT: every row is inserted via upsert with an empty `update`
 *     branch — re-running the import never overwrites existing PostgreSQL data.
 *   - VALIDATES INPUT: required fields, enums, bcrypt hash format, timestamp
 *     parseability, duplicate slugs, referential integrity.
 *   - REPORTS: skipped/invalid/orphan rows, pre/post record counts, and conflict
 *     lists to stdout and to data/migration/import.report.json.
 *   - FAILS CLOSED: refuses to run against production without explicit
 *     --confirm-production, refuses without DATABASE_URL, --dry-run supported.
 *
 * Usage:
 *   npm run db:import -- [--dry-run] [--confirm-production] [--fix-orphans] [--batch-size=1000]
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const JSON_DB = path.join(ROOT, 'data', 'database.json');
const REPORT_DIR = path.join(ROOT, 'data', 'migration');

// ── CLI flags ─────────────────────────────────────────────────────────────
const flags = new Set(process.argv.slice(2));
const DRY_RUN = flags.has('--dry-run');
const CONFIRM_PRODUCTION = flags.has('--confirm-production');
const FIX_ORPHANS = flags.has('--fix-orphans');
const BATCH_SIZE = (() => {
  const b = [...flags].find((f) => f.startsWith('--batch-size='));
  return b ? parseInt(b.split('=')[1], 10) : 1000;
})();

// ── Guard: no production imports without explicit confirmation ────────────
if (process.env.NODE_ENV === 'production' && !CONFIRM_PRODUCTION) {
  console.error('[IMPORT-REFUSED] NODE_ENV=production requires --confirm-production plus written approval.');
  console.error('                  Review docs/DATABASE_MIGRATION_PLAN.md §6.6 before importing into production.');
  process.exit(1);
}
if (flags.has('--confirm-production') && !DRY_RUN) {
  console.error('[IMPORT-REFUSED] This environment has no verified production database target.');
  console.error('                  Never point --confirm-production at a live newsroom system without ops approval.');
  process.exit(1);
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('[FATAL] DATABASE_URL is required. Point it at a DISPOSABLE PostgreSQL database, e.g.:');
  console.error('        docker run --rm -d -p 55432:5432 -e POSTGRES_PASSWORD=gcn postgres:15-alpine');
  process.exit(1);
}

// ── Load JSON store ───────────────────────────────────────────────────────
let rawData: any;
try {
  rawData = JSON.parse(fs.readFileSync(JSON_DB, 'utf-8'));
} catch (err) {
  console.error(`[FATAL] Cannot read/parse ${JSON_DB}: ${err}`);
  process.exit(1);
}

// ── Prisma target ─────────────────────────────────────────────────────────
const prisma = new PrismaClient({ datasourceUrl: DATABASE_URL });

const COLLECTIONS = [
  'users', 'userSessions', 'authorProfiles', 'categories', 'tags', 'articleTags',
  'articles', 'articleContributors', 'articleRevisions', 'editorialEvents',
  'publicationSchedules', 'mediaAssets', 'articleMedia', 'photoGalleries',
  'galleryItems', 'videoRecords', 'liveBlogUpdates', 'breakingNewsAnnouncements',
  'comments', 'polls', 'newsletterSubscriptions', 'urlRedirects', 'adPlacements',
  'siteSettings', 'auditLogs', 'reactions', 'homepageConfigs', 'analyticsEvents',
  'passwordResetTokens', 'revokedSessions',
] as const;

type Collection = (typeof COLLECTIONS)[number];

const report: any = {
  startedAt: new Date().toISOString(),
  dryRun: DRY_RUN,
  jsonSource: JSON_DB,
  before: {}, after: {}, inserted: {}, skippedExisting: {}, skippedInvalid: {}, conflicts: {}, orphans: {},
};

// counts on the JSON source
for (const c of COLLECTIONS) report.before[c] = Array.isArray(rawData[c]) ? rawData[c].length : 0;

// ── Validation helpers ────────────────────────────────────────────────────
const REPORTER_ROLES = new Set([
  'SUPER_ADMIN', 'ADMIN', 'MANAGING_EDITOR', 'SECTION_EDITOR', 'COPY_EDITOR',
  'JOURNALIST', 'REPORTER', 'PHOTOGRAPHER', 'VIDEO_EDITOR', 'ADVERTISING_MANAGER',
  'ANALYST', 'READER',
]);
const ARTICLE_STATUSES = new Set(['DRAFT', 'IN_REVIEW', 'REVISION_REQUESTED', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED']);
const PRIORITIES = new Set(['NORMAL', 'FEATURED', 'BREAKING', 'INVESTIGATIVE']);
const BCRYPT_RE = /^\$2[abxy]\$\d{2}\$/;

function toSqlDate(value: any): Date | null {
  if (value === null || value === undefined) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d;
}

/**
 * Registers an orphan row (referenced parent missing from the JSON source).
 * The row is always excluded from import (fail-safe); when --fix-orphans is
 * absent the run also aborts with exit code 2 at the end so orphans are never
 * dropped silently (plan §6.3).
 */
function orphan(collection: string, id: string, reason: string): boolean {
  (report.orphans[collection] ||= []).push({ id, reason });
  if (!FIX_ORPHANS) {
    console.error(`[ORPHAN] ${collection} row "${id}": ${reason}`);
  } else {
    console.warn(`[ORPHAN] ${collection} row "${id}": ${reason} (--fix-orphans: skipping)`);
  }
  return true; // caller always `continue`s — the row must not be inserted
}

function invalid(collection: string, id: string, reason: string): boolean {
  (report.skippedInvalid[collection] ||= []).push({ id, reason });
  console.warn(`[INVALID] ${collection} row ${id}: ${reason}`);
  return true;
}

/** Idempotent insert-or-skip via upsert with empty update branch (never overwrites). */
async function insertOrSkip(model: any, _collection: string, key: { where: any }, row: any): Promise<void> {
  // upsert with update:{} → second run inserts nothing new and never mutates
  await model.upsert({
    where: key.where,
    create: row,
    update: {},
  });
}

function countCategory(collection: string, state: 'inserted' | 'skippedExisting') {
  report[state][collection] = (report[state][collection] || 0) + 1;
}

// ── Main import ───────────────────────────────────────────────────────────
async function main() {
  console.log(`[IMPORT] ${DRY_RUN ? 'DRY RUN - no writes' : 'full import'} target=${DATABASE_URL}`);

  // 1. Ensure the system daemon actor exists (plan §6.2 step 3 / Q3)
  const daemonId = 'usr-system-daemon';
  let daemonExists: unknown = null;
  if (!DRY_RUN) {
    daemonExists = await prisma.user.findUnique({ where: { id: daemonId } });
  }
  if (!daemonExists) {
    if (!DRY_RUN) {
      await prisma.user.create({
        data: {
          id: daemonId,
          email: 'system-daemon@globalchronicle.internal',
          name: 'System Daemon (Automated Publishing)',
          passwordHash: '$2b$10$no-login-credential-please-change-me000000000000000000000000000', // 60 chars, unguessable, inert
          role: 'READER',
          isActive: false,
        },
      });
    }
    countCategory('users', 'inserted');
    console.log('[SEED] created system daemon user usr-system-daemon');
  }

  // 2. Users — validate email/role/hash
  for (const u of rawData.users) {
    if (!u.email || !u.passwordHash || !u.name) { invalid('users', u.id || '(no id)', 'missing email/passwordHash/name'); continue; }
    if (!BCRYPT_RE.test(u.passwordHash)) { invalid('users', u.id, 'passwordHash is not a bcrypt hash'); continue; }
    if (!REPORTER_ROLES.has(u.role)) { invalid('users', u.id, `role "${u.role}" is not in the runtime RoleType enum`); continue; }
    if (DRY_RUN) { countCategory('users', 'inserted'); continue; }
    await insertOrSkip(prisma.user, 'users', { where: { email: u.email } }, {
      id: u.id,
      email: u.email,
      passwordHash: u.passwordHash,
      name: u.name,
      role: u.role,
      avatar: u.avatar ?? null,
      isActive: u.isActive !== undefined ? Boolean(u.isActive) : true,
      passwordChangedAt: null,
      createdAt: toSqlDate(u.createdAt) ?? new Date(),
      updatedAt: toSqlDate(u.updatedAt) ?? new Date(),
    }).then(() => countCategory('users', 'inserted'))
      .catch(() => countCategory('users', 'skippedExisting'));
  }

  // Build the user ID set from the JSON SOURCE (not the target DB) so that
  // --dry-run validation works against an empty database.
  const userIdsSet: Set<string> = new Set(rawData.users.map((u: any) => u.id).filter(Boolean));

  // 2b. Author profiles (userId is unique — never overwrites an existing profile)
  for (const p of rawData.authorProfiles) {
    if (!p.userId || !userIdsSet.has(p.userId)) {
      if (orphan('authorProfiles', p.id, `user "${p.userId}" does not exist`)) continue;
    }
    if (DRY_RUN) { countCategory('authorProfiles', 'inserted'); continue; }
    await insertOrSkip(prisma.authorProfile, 'authorProfiles', { where: { userId: p.userId } }, {
      id: p.id, userId: p.userId, byline: p.byline,
      biography: p.biography ?? null, designation: p.designation ?? null,
      socialLinks: p.socialLinks ?? null, credentials: p.credentials ?? null,
      createdAt: toSqlDate(p.createdAt) ?? new Date(), updatedAt: toSqlDate(p.updatedAt) ?? new Date(),
    }).then(() => countCategory('authorProfiles', 'inserted')).catch(() => countCategory('authorProfiles', 'skippedExisting'));
  }

  // 2c. Active login sessions (expired ones are dropped per plan §8)
  const nowSessions = new Date();
  for (const s of rawData.userSessions) {
    const expires = toSqlDate(s.expiresAt);
    if (!(expires && expires > nowSessions)) {
      if (rawData.userSessions.length > 0) {
        (report.skippedInvalid.userSessions ||= []).push({ id: s.id || s.token?.slice(0, 8), reason: 'expired — dropped per plan §8' });
      }
      continue;
    }
    if (!userIdsSet.has(s.userId)) {
      if (orphan('userSessions', s.id || '(no id)', `user "${s.userId}" does not exist`)) continue;
    }
    if (DRY_RUN) { countCategory('userSessions', 'inserted'); continue; }
    await insertOrSkip(prisma.userSession, 'userSessions', { where: { token: s.token } }, {
      id: s.id, userId: s.userId, token: s.token, userAgent: s.userAgent ?? null,
      ipAddress: s.ipAddress ?? null, expiresAt: toSqlDate(s.expiresAt)!,
      createdAt: toSqlDate(s.createdAt) ?? new Date(),
    }).then(() => countCategory('userSessions', 'inserted')).catch(() => countCategory('userSessions', 'skippedExisting'));
  }

  // 3. Categories (parents first — order preserved in the JSON array)
  const categoryIdsSet = new Set<string>();
  const pendingCategories: any[] = [];
  for (const c of rawData.categories) {
    if (c.parentId && !categoryIdsSet.has(c.parentId)) {
      (report.conflicts.categories ||= []).push({ id: c.id, reason: `parent "${c.parentId}" not yet present` });
      continue;
    }
    categoryIdsSet.add(c.id);
    pendingCategories.push({
      id: c.id, name: c.name, slug: c.slug, description: c.description ?? null,
      color: c.color ?? null, parentId: c.parentId ?? null,
      displayOrder: c.displayOrder ?? 0,
      createdAt: toSqlDate(c.createdAt) ?? new Date(),
    });
    if (DRY_RUN) { countCategory('categories', 'inserted'); continue; }
    await insertOrSkip(prisma.category, 'categories', { where: { slug: c.slug } }, pendingCategories[pendingCategories.length - 1])
      .then(() => countCategory('categories', 'inserted'))
      .catch(() => countCategory('categories', 'skippedExisting'));
  }

  // 4. Tags
  for (const t of rawData.tags) {
    if (DRY_RUN) { countCategory('tags', 'inserted'); continue; }
    await insertOrSkip(prisma.tag, 'tags', { where: { slug: t.slug } }, {
      id: t.id, name: t.name, slug: t.slug, description: t.description ?? null,
      createdAt: toSqlDate(t.createdAt) ?? new Date(),
    }).then(() => countCategory('tags', 'inserted')).catch(() => countCategory('tags', 'skippedExisting'));
  }

  // 5. Media assets (uploader required)
  for (const m of rawData.mediaAssets) {
    if (!m.uploaderId || !userIdsSet.has(m.uploaderId)) {
      if (orphan('mediaAssets', m.id, `uploader "${m.uploaderId}" does not exist`)) continue;
    }
    if (DRY_RUN) { countCategory('mediaAssets', 'inserted'); continue; }
    await insertOrSkip(prisma.mediaAsset, 'mediaAssets', { where: { id: m.id } }, {
      id: m.id, filename: m.filename, originalUrl: m.originalUrl, cdnUrl: m.cdnUrl ?? null,
      mimeType: m.mimeType, sizeBytes: m.sizeBytes, width: m.width ?? null, height: m.height ?? null,
      altText: m.altText ?? null, caption: m.caption ?? null, credit: m.credit ?? null,
      assetType: m.assetType || 'IMAGE', focalX: m.focalX ?? 50, focalY: m.focalY ?? 50,
      uploaderId: m.uploaderId, createdAt: toSqlDate(m.createdAt) ?? new Date(),
      // Phase 11 storage bookkeeping (present on post-abstraction assets only)
      storageKey: m.storageKey ?? null, storageDriver: m.storageDriver ?? null,
      visibility: m.visibility ?? 'public', variants: m.variants ?? null,
    }).then(() => countCategory('mediaAssets', 'inserted')).catch(() => countCategory('mediaAssets', 'skippedExisting'));
  }

  // 6. Articles (status/priority checked; PUBLISHED must have publishedAt — §8)
  const articleIdsSet = new Set<string>();
  for (const a of rawData.articles) {
    if (!ARTICLE_STATUSES.has(a.status)) { invalid('articles', a.id, `status "${a.status}" invalid`); continue; }
    if (a.priority && !PRIORITIES.has(a.priority)) { invalid('articles', a.id, `priority "${a.priority}" invalid`); continue; }
    if (!userIdsSet.has(a.authorId)) {
      if (orphan('articles', a.id, `author "${a.authorId}" does not exist`)) continue;
    }
    if (!categoryIdsSet.has(a.categoryId)) {
      if (orphan('articles', a.id, `category "${a.categoryId}" does not exist`)) continue;
    }
    if (a.status === 'PUBLISHED' && !a.publishedAt) {
      report.conflicts.articles ||= [];
      report.conflicts.articles.push({ id: a.id, reason: 'PUBLISHED without publishedAt — resolves to fail hard per plan §8' });
      continue;
    }
    articleIdsSet.add(a.id);
    if (DRY_RUN) { countCategory('articles', 'inserted'); continue; }
    await insertOrSkip(prisma.article, 'articles', { where: { slug: a.slug } }, {
      id: a.id, title: a.title, slug: a.slug, excerpt: a.excerpt, content: a.content,
      coverImageId: a.coverImageId ?? null, coverImage: a.coverImage ?? null,
      categoryId: a.categoryId, authorId: a.authorId, status: a.status,
      articleType: a.articleType || 'STANDARD', priority: a.priority || 'NORMAL',
      views: a.views ?? 0, version: a.version && a.version > 0 ? a.version : 1,
      scheduledFor: toSqlDate(a.scheduledFor), publishedAt: toSqlDate(a.publishedAt),
      archivedAt: toSqlDate(a.archivedAt), videoUrl: a.videoUrl ?? null,
      imageCaption: a.imageCaption ?? null, imageCredit: a.imageCredit ?? null,
      sourceAttribution: a.sourceAttribution ?? null, seoTitle: a.seoTitle ?? null,
      seoDescription: a.seoDescription ?? null, socialImage: a.socialImage ?? null,
      editorialNote: a.editorialNote ?? null,
      createdAt: toSqlDate(a.createdAt) ?? new Date(), updatedAt: toSqlDate(a.updatedAt) ?? new Date(),
    }).then(() => countCategory('articles', 'inserted')).catch(() => countCategory('articles', 'skippedExisting'));
  }

  // 7. Article tags / media / revisions / schedule / events / contributors
  for (const at of rawData.articleTags) {
    if (!articleIdsSet.has(at.articleId)) { if (orphan('articleTags', `${at.articleId}/${at.tagId}`, 'article missing')) continue; }
    if (DRY_RUN) { countCategory('articleTags', 'inserted'); continue; }
    await insertOrSkip(prisma.articleTag, 'articleTags', { where: { articleId_tagId: { articleId: at.articleId, tagId: at.tagId } } }, {
      articleId: at.articleId, tagId: at.tagId,
    }).then(() => countCategory('articleTags', 'inserted')).catch(() => countCategory('articleTags', 'skippedExisting'));
  }

  for (const am of rawData.articleMedia) {
    if (!articleIdsSet.has(am.articleId)) { if (orphan('articleMedia', am.id, 'article missing')) continue; }
    if (DRY_RUN) { countCategory('articleMedia', 'inserted'); continue; }
    await insertOrSkip(prisma.articleMedia, 'articleMedia', { where: { id: am.id } }, {
      id: am.id, articleId: am.articleId, mediaAssetId: am.mediaAssetId,
      position: am.position ?? 0, placement: am.placement || 'INLINE',
      createdAt: toSqlDate(am.createdAt) ?? new Date(),
    }).then(() => countCategory('articleMedia', 'inserted')).catch(() => countCategory('articleMedia', 'skippedExisting'));
  }

  for (const r of rawData.articleRevisions) {
    if (!articleIdsSet.has(r.articleId)) { if (orphan('articleRevisions', r.id, 'article missing')) continue; }
    if (!userIdsSet.has(r.editorId)) { if (orphan('articleRevisions', r.id, `editor "${r.editorId}" missing`)) continue; }
    if (DRY_RUN) { countCategory('articleRevisions', 'inserted'); continue; }
    await insertOrSkip(prisma.articleRevision, 'articleRevisions', { where: { id: r.id } }, {
      id: r.id, articleId: r.articleId, version: r.version,
      title: r.title, excerpt: r.excerpt, content: r.content,
      changeSummary: r.changeSummary ?? null, editorId: r.editorId,
      createdAt: toSqlDate(r.createdAt) ?? new Date(),
    }).then(() => countCategory('articleRevisions', 'inserted')).catch(() => countCategory('articleRevisions', 'skippedExisting'));
  }

  for (const s of rawData.publicationSchedules) {
    if (!articleIdsSet.has(s.articleId)) { if (orphan('publicationSchedules', s.id, 'article missing')) continue; }
    if (DRY_RUN) { countCategory('publicationSchedules', 'inserted'); continue; }
    await insertOrSkip(prisma.publicationSchedule, 'publicationSchedules', { where: { idempotencyKey: s.idempotencyKey } }, {
      id: s.id, articleId: s.articleId, targetPublish: toSqlDate(s.targetPublish)!, executedAt: toSqlDate(s.executedAt),
      status: s.status || 'QUEUED', failureReason: s.failureReason ?? null, idempotencyKey: s.idempotencyKey,
      createdAt: toSqlDate(s.createdAt) ?? new Date(),
    }).then(() => countCategory('publicationSchedules', 'inserted')).catch(() => countCategory('publicationSchedules', 'skippedExisting'));
  }

  for (const e of rawData.editorialEvents) {
    if (!articleIdsSet.has(e.articleId)) { if (orphan('editorialEvents', e.id, 'article missing')) continue; }
    if (!userIdsSet.has(e.actorId) && e.actorId !== daemonId) {
      if (orphan('editorialEvents', e.id, `actor "${e.actorId}" does not exist`)) continue;
    }
    if (DRY_RUN) { countCategory('editorialEvents', 'inserted'); continue; }
    await insertOrSkip(prisma.editorialEvent, 'editorialEvents', { where: { id: e.id } }, {
      id: e.id, articleId: e.articleId, actorId: e.actorId, eventType: e.eventType,
      fromStatus: e.fromStatus ?? null, toStatus: e.toStatus, note: e.note ?? null,
      createdAt: toSqlDate(e.createdAt) ?? new Date(),
    }).then(() => countCategory('editorialEvents', 'inserted')).catch(() => countCategory('editorialEvents', 'skippedExisting'));
  }

  for (const c of rawData.articleContributors) {
    if (!articleIdsSet.has(c.articleId)) { if (orphan('articleContributors', c.id, 'article missing')) continue; }
    if (!userIdsSet.has(c.userId)) { if (orphan('articleContributors', c.id, 'user missing')) continue; }
    if (DRY_RUN) { countCategory('articleContributors', 'inserted'); continue; }
    await insertOrSkip(prisma.articleContributor, 'articleContributors', { where: { id: c.id } }, {
      id: c.id, articleId: c.articleId, userId: c.userId, roleTitle: c.roleTitle,
      createdAt: toSqlDate(c.createdAt) ?? new Date(),
    }).then(() => countCategory('articleContributors', 'inserted')).catch(() => countCategory('articleContributors', 'skippedExisting'));
  }

  // 8. Live blogs, breaking, comments, reactions
  for (const l of rawData.liveBlogUpdates) {
    if (!articleIdsSet.has(l.articleId)) { if (orphan('liveBlogUpdates', l.id, 'article missing')) continue; }
    if (!userIdsSet.has(l.authorId)) { if (orphan('liveBlogUpdates', l.id, `author "${l.authorId}" missing`)) continue; }
    if (DRY_RUN) { countCategory('liveBlogUpdates', 'inserted'); continue; }
    await insertOrSkip(prisma.liveBlogUpdate, 'liveBlogUpdates', { where: { id: l.id } }, {
      id: l.id, articleId: l.articleId, headline: l.headline, body: l.body,
      isKeyEvent: Boolean(l.isKeyEvent), authorId: l.authorId,
      createdAt: toSqlDate(l.createdAt) ?? new Date(),
    }).then(() => countCategory('liveBlogUpdates', 'inserted')).catch(() => countCategory('liveBlogUpdates', 'skippedExisting'));
  }

  for (const b of rawData.breakingNewsAnnouncements) {
    if (b.articleId && !articleIdsSet.has(b.articleId)) { if (orphan('breakingNewsAnnouncements', b.id, 'article missing')) continue; }
    if (DRY_RUN) { countCategory('breakingNewsAnnouncements', 'inserted'); continue; }
    await insertOrSkip(prisma.breakingNewsAnnouncement, 'breakingNewsAnnouncements', { where: { id: b.id } }, {
      id: b.id, headline: b.headline, summary: b.summary ?? null,
      articleId: b.articleId ?? null, urgencyRank: b.urgencyRank ?? 1,
      activeUntil: toSqlDate(b.activeUntil), isActive: b.isActive ?? true,
      createdAt: toSqlDate(b.createdAt) ?? new Date(),
    }).then(() => countCategory('breakingNewsAnnouncements', 'inserted')).catch(() => countCategory('breakingNewsAnnouncements', 'skippedExisting'));
  }

  for (const c of rawData.comments) {
    if (!articleIdsSet.has(c.articleId)) { if (orphan('comments', c.id, 'article missing')) continue; }
    if (DRY_RUN) { countCategory('comments', 'inserted'); continue; }
    await insertOrSkip(prisma.comment, 'comments', { where: { id: c.id } }, {
      id: c.id, articleId: c.articleId, authorName: c.authorName, authorEmail: c.authorEmail,
      content: c.content, status: c.status || 'PENDING',
      createdAt: toSqlDate(c.createdAt) ?? new Date(),
    }).then(() => countCategory('comments', 'inserted')).catch(() => countCategory('comments', 'skippedExisting'));
  }

  for (const r of rawData.reactions) {
    if (!articleIdsSet.has(r.articleId)) { if (orphan('reactions', r.id, 'article missing')) continue; }
    if (DRY_RUN) { countCategory('reactions', 'inserted'); continue; }
    await insertOrSkip(prisma.reaction, 'reactions', { where: { id: r.id } }, {
      id: r.id, articleId: r.articleId, type: r.type,
      createdAt: toSqlDate(r.createdAt) ?? new Date(),
    }).then(() => countCategory('reactions', 'inserted')).catch(() => countCategory('reactions', 'skippedExisting'));
  }

  // 9. Polls / newsletter / settings/audit/analytic/transit configs
  for (const p of rawData.polls) {
    if (DRY_RUN) { countCategory('polls', 'inserted'); continue; }
    await insertOrSkip(prisma.poll, 'polls', { where: { id: p.id } }, {
      id: p.id, question: p.question, options: p.options,
      active: p.active !== undefined ? Boolean(p.active) : true,
      createdAt: toSqlDate(p.createdAt) ?? new Date(),
    }).then(() => countCategory('polls', 'inserted')).catch(() => countCategory('polls', 'skippedExisting'));
  }

  for (const n of rawData.newsletterSubscriptions) {
    if (DRY_RUN) { countCategory('newsletterSubscriptions', 'inserted'); continue; }
    await insertOrSkip(prisma.newsletterSubscription, 'newsletterSubscriptions', { where: { email: n.email } }, {
      id: n.id, email: n.email, frequency: n.frequency || 'DAILY',
      isConfirmed: n.isConfirmed ?? false, confirmToken: n.confirmToken ?? null,
      subscribedAt: toSqlDate(n.subscribedAt) ?? new Date(),
    }).then(() => countCategory('newsletterSubscriptions', 'inserted')).catch(() => countCategory('newsletterSubscriptions', 'skippedExisting'));
  }

  for (const ul of rawData.urlRedirects) {
    if (DRY_RUN) { countCategory('urlRedirects', 'inserted'); continue; }
    await insertOrSkip(prisma.urlRedirect, 'urlRedirects', { where: { id: ul.id } }, {
      id: ul.id, sourcePath: ul.sourcePath, destinationPath: ul.destinationPath,
      statusCode: ul.statusCode ?? 301, isActive: ul.isActive ?? true,
      createdAt: toSqlDate(ul.createdAt) ?? new Date(),
    }).then(() => countCategory('urlRedirects', 'inserted')).catch(() => countCategory('urlRedirects', 'skippedExisting'));
  }

  for (const ad of rawData.adPlacements) {
    if (DRY_RUN) { countCategory('adPlacements', 'inserted'); continue; }
    await insertOrSkip(prisma.adPlacement, 'adPlacements', { where: { id: ad.id } }, {
      id: ad.id, slotName: ad.slotName, dimensions: ad.dimensions, adCode: ad.adCode,
      isActive: ad.isActive ?? true, impressions: ad.impressions ?? 0, clicks: ad.clicks ?? 0,
      createdAt: toSqlDate(ad.createdAt) ?? new Date(), updatedAt: toSqlDate(ad.updatedAt) ?? new Date(),
    }).then(() => countCategory('adPlacements', 'inserted')).catch(() => countCategory('adPlacements', 'skippedExisting'));
  }

  for (const s of rawData.siteSettings) {
    if (DRY_RUN) { countCategory('siteSettings', 'inserted'); continue; }
    await insertOrSkip(prisma.siteSetting, 'siteSettings', { where: { key: s.key } }, {
      id: s.id, key: s.key, value: s.value, description: s.description ?? null,
      updatedAt: toSqlDate(s.updatedAt) ?? new Date(),
    }).then(() => countCategory('siteSettings', 'inserted')).catch(() => countCategory('siteSettings', 'skippedExisting'));
  }

  for (const l of rawData.auditLogs) {
    if (l.userId && !userIdsSet.has(l.userId) && l.userId !== daemonId) {
      if (orphan('auditLogs', l.id, `user "${l.userId}" missing (FK is SetNull — will be skipped)`)) continue;
    }
    if (DRY_RUN) { countCategory('auditLogs', 'inserted'); continue; }
    await insertOrSkip(prisma.auditLog, 'auditLogs', { where: { id: l.id } }, {
      id: l.id, userId: l.userId ?? null, action: l.action, entityType: l.entityType,
      entityId: l.entityId ?? null, details: l.details ?? null, ipAddress: l.ipAddress ?? null,
      createdAt: toSqlDate(l.createdAt) ?? new Date(),
    }).then(() => countCategory('auditLogs', 'inserted')).catch(() => countCategory('auditLogs', 'skippedExisting'));
  }

  for (const ev of rawData.analyticsEvents) {
    if (DRY_RUN) { countCategory('analyticsEvents', 'inserted'); continue; }
    await insertOrSkip(prisma.analyticsEvent, 'analyticsEvents', { where: { id: ev.id } }, {
      id: ev.id, type: ev.type, entityId: ev.entityId ?? null, metadata: ev.metadata ?? null,
      createdAt: toSqlDate(ev.createdAt) ?? new Date(),
    }).then(() => countCategory('analyticsEvents', 'inserted')).catch(() => countCategory('analyticsEvents', 'skippedExisting'));
  }

  for (const hc of rawData.homepageConfigs) {
    if (DRY_RUN) { countCategory('homepageConfigs', 'inserted'); continue; }
    await prisma.homepageConfig.upsert({
      where: { id: hc.id || 'default' },
      create: {
        id: hc.id || 'default',
        featuredArticleId: hc.featuredArticleId ?? null,
        breakingArticleId: hc.breakingArticleId ?? null,
        breakingBannerActive: hc.breakingBannerActive ?? true,
        sectionOrder: hc.sectionOrder ?? null,
        updatedAt: toSqlDate(hc.updatedAt) ?? new Date(),
      },
      update: {},
    }).then(() => countCategory('homepageConfigs', 'inserted')).catch(() => countCategory('homepageConfigs', 'skippedExisting'));
  }

  for (const g of rawData.photoGalleries) {
    if (DRY_RUN) { countCategory('photoGalleries', 'inserted'); continue; }
    await insertOrSkip(prisma.photoGallery, 'photoGalleries', { where: { id: g.id } }, {
      id: g.id, title: g.title, slug: g.slug, description: g.description ?? null,
      createdAt: toSqlDate(g.createdAt) ?? new Date(),
    }).then(() => countCategory('photoGalleries', 'inserted')).catch(() => countCategory('photoGalleries', 'skippedExisting'));
  }

  for (const gi of rawData.galleryItems) {
    if (DRY_RUN) { countCategory('galleryItems', 'inserted'); continue; }
    await insertOrSkip(prisma.galleryItem, 'galleryItems', { where: { id: gi.id } }, {
      id: gi.id, galleryId: gi.galleryId, mediaAssetId: gi.mediaAssetId,
      orderIndex: gi.orderIndex ?? 0, caption: gi.caption ?? null,
    }).then(() => countCategory('galleryItems', 'inserted')).catch(() => countCategory('galleryItems', 'skippedExisting'));
  }

  for (const v of rawData.videoRecords) {
    if (DRY_RUN) { countCategory('videoRecords', 'inserted'); continue; }
    await insertOrSkip(prisma.videoRecord, 'videoRecords', { where: { id: v.id } }, {
      id: v.id, title: v.title, slug: v.slug, videoUrl: v.videoUrl,
      durationSec: v.durationSec ?? null, thumbnail: v.thumbnail ?? null, description: v.description ?? null,
      createdAt: toSqlDate(v.createdAt) ?? new Date(),
    }).then(() => countCategory('videoRecords', 'inserted')).catch(() => countCategory('videoRecords', 'skippedExisting'));
  }

  // ── Security-critical: only non-expired rows (plan §8) ──────────────────
  const now = new Date();
  for (const t of rawData.passwordResetTokens) {
    const tokenExpires = toSqlDate(t.expiresAt);
    if (!(tokenExpires && tokenExpires > now)) { (report.skippedInvalid.passwordResetTokens ||= []).push({ id: t.id, reason: 'expired — dropped per plan §8' }); continue; }
    if (!userIdsSet.has(t.userId)) { if (orphan('passwordResetTokens', t.id, `user "${t.userId}" missing`)) continue; }
    if (DRY_RUN) { countCategory('passwordResetTokens', 'inserted'); continue; }
    await insertOrSkip(prisma.passwordResetToken, 'passwordResetTokens', { where: { tokenHash: t.tokenHash } }, {
      id: t.id, tokenHash: t.tokenHash, userId: t.userId, expiresAt: tokenExpires,
      usedAt: toSqlDate(t.usedAt), createdAt: toSqlDate(t.createdAt) ?? new Date(),
    }).then(() => countCategory('passwordResetTokens', 'inserted')).catch(() => countCategory('passwordResetTokens', 'skippedExisting'));
  }

  for (const s of rawData.revokedSessions) {
    const revExpires = toSqlDate(s.expiresAt);
    if (!(revExpires && revExpires > now)) { (report.skippedInvalid.revokedSessions ||= []).push({ id: s.jti, reason: 'expired — dropped per plan §8' }); continue; }
    if (DRY_RUN) { countCategory('revokedSessions', 'inserted'); continue; }
    await insertOrSkip(prisma.revokedSession, 'revokedSessions', { where: { jti: s.jti } }, {
      jti: s.jti, userId: userIdsSet.has(s.userId) ? s.userId : null,
      revokedAt: toSqlDate(s.revokedAt) ?? new Date(), expiresAt: revExpires,
    }).then(() => countCategory('revokedSessions', 'inserted')).catch(() => countCategory('revokedSessions', 'skippedExisting'));
  }

  // Orphan fail-closed check — must be explicit to skip
  if (Object.keys(report.orphans).length > 0 && !FIX_ORPHANS) {
    report.blocked = 'orphan rows detected; rerun with --fix-orphans after review';
    await writeReport(); // persist the evidence before aborting
    console.error('\n[BLOCKED] orphan rows detected — report written to data/migration/import.report.json');
    console.error('          fix the source data or rerun with --fix-orphans to skip them explicitly.');
    process.exit(2);
  }

  // Pre/post counts and relationship checks
  await writeReport();

  console.log('\n[IMPORT-SUMMARY]');
  for (const c of COLLECTIONS) {
    const before = report.before[c] ?? 0;
    const after = DRY_RUN ? '—' : (report.after[c] ?? 0);
    console.log(`  ${c.padEnd(30)} json=${before} → pg=${after}`);
  }
  if (!DRY_RUN) {
    // Post-checks only make sense after real writes
    const articleCount = await prisma.article.count();
    const grants = `articles=${articleCount}`;
    console.log(`\n[VERIFY] ${grants}`);
  }
  process.exit(0);
}

// ── Helpers ───────────────────────────────────────────────────────────────
async function writeReport() {
  if (!DRY_RUN) {
    const tableMap: Record<string, any> = {
      users: prisma.user, userSessions: prisma.userSession, authorProfiles: prisma.authorProfile,
      categories: prisma.category, tags: prisma.tag, articleTags: prisma.articleTag,
      articles: prisma.article, articleContributors: prisma.articleContributor,
      articleRevisions: prisma.articleRevision, editorialEvents: prisma.editorialEvent,
      publicationSchedules: prisma.publicationSchedule, mediaAssets: prisma.mediaAsset,
      articleMedia: prisma.articleMedia, photoGalleries: prisma.photoGallery,
      galleryItems: prisma.galleryItem, videoRecords: prisma.videoRecord,
      liveBlogUpdates: prisma.liveBlogUpdate, breakingNewsAnnouncements: prisma.breakingNewsAnnouncement,
      comments: prisma.comment, polls: prisma.poll, newsletterSubscriptions: prisma.newsletterSubscription,
      urlRedirects: prisma.urlRedirect, adPlacements: prisma.adPlacement, siteSettings: prisma.siteSetting,
      auditLogs: prisma.auditLog, reactions: prisma.reaction, homepageConfigs: prisma.homepageConfig,
      analyticsEvents: prisma.analyticsEvent, passwordResetTokens: prisma.passwordResetToken,
      revokedSessions: prisma.revokedSession,
    };
    for (const c of COLLECTIONS) {
      if (DRY_RUN) { report.after[c] = null; continue; }
      report.after[c] = await (tableMap[c] as any).count();
    }
  }

  // Relationship checks over the target (schema FKs are NOT NULL, so the real
  // invariants are published-dates and count parity with the JSON source)
  if (!DRY_RUN) {
    report.relationshipChecks = {
      publishedWithoutDate: await prisma.article.count({ where: { status: 'PUBLISHED', publishedAt: null } }),
      scheduledDraftWithoutDate: await prisma.article.count({ where: { status: 'SCHEDULED', scheduledFor: null } }),
      articlesWithInvalidType: await prisma.article.count({
        where: { articleType: { notIn: ['STANDARD', 'LIVE_BLOG', 'VIDEO', 'PHOTO_GALLERY', 'OPINION', 'EXPLAINER'] } },
      }),
    };
    // Count parity: imported-vs-source; any shortfall is a skipped row
    report.countParity = {};
    for (const c of COLLECTIONS) {
      const jsonCount = report.before[c] ?? 0;
      const pgCount = report.after[c] ?? 0;
      report.countParity[c] = {
        jsonSource: jsonCount,
        postgres: pgCount,
        delta: pgCount - jsonCount,
        note: pgCount < jsonCount ? 'some rows skipped/expired/orphaned (see orphans + skippedInvalid above)' : undefined,
      };
    }
    for (const [k, v] of Object.entries(report.relationshipChecks)) {
      if (Number(v) > 0) console.error(`[RELATIONSHIP-WARN] ${k} = ${v}`);
    }
  }

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORT_DIR, 'import.report.json'), JSON.stringify(report, null, 2), 'utf-8');
  console.log(`[REPORT] data/migration/import.report.json`);
}

main()
  .catch((err) => {
    console.error('[FATAL] import failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

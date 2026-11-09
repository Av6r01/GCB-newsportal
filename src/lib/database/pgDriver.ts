/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Prisma/PostgreSQL persistence driver — Phase 6B.
 *
 * Implements the same method surface as the JSON driver (src/lib/db.ts) so that
 * route handlers in server.ts can be migrated incrementally (plan §1.3 / §4).
 *
 * Key differences from the JSON driver (all intentional, per plan §5):
 *   - $transaction() is a REAL PostgreSQL transaction, not Promise.all.
 *   - Article create/update/transition chains write atomically:
 *     article + revision + tags/media + editorial/audit rows commit together.
 *   - Unique/FK violations surface as IntegrityError with the historical
 *     messages where the JSON layer produced them.
 *   - Deleting a tag removes its join rows (no dangling references, plan Q4).
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { IntegrityError } from '../db';
import { genId, toDate } from './ids';

/** Whitelists keep Prisma strict (unknown JSON keys never reach the DB). */
const ARTICLE_FIELDS = [
  'id', 'title', 'slug', 'excerpt', 'content', 'structuredBody',
  'coverImageId', 'categoryId', 'authorId', 'status', 'articleType',
  'priority', 'views', 'scheduledFor', 'publishedAt', 'archivedAt',
  'version', 'videoUrl', 'coverImage', 'imageCaption', 'imageCredit',
  'sourceAttribution', 'seoTitle', 'seoDescription', 'socialImage',
  'editorialNote',
] as const;
const ARTICLE_DATETIME_FIELDS = new Set(['scheduledFor', 'publishedAt', 'archivedAt']);

const AUTHORPROFILE_FIELDS = [
  'id', 'userId', 'byline', 'biography', 'designation', 'socialLinks', 'credentials',
] as const;
const CATEGORY_FIELDS = ['id', 'name', 'slug', 'description', 'color', 'parentId', 'displayOrder'] as const;
const USER_FIELDS = ['id', 'email', 'passwordHash', 'name', 'role', 'avatar', 'isActive'] as const;
const TAG_FIELDS = ['id', 'name', 'slug', 'description'] as const;
const MEDIA_FIELDS = [
  'id', 'filename', 'originalUrl', 'cdnUrl', 'mimeType', 'sizeBytes', 'width', 'height',
  'altText', 'caption', 'credit', 'assetType', 'uploaderId', 'focalX', 'focalY',
  // Phase 11: storage abstraction bookkeeping (variants arrive as JSON)
  'storageKey', 'storageDriver', 'visibility', 'variants',
] as const;
const REVISION_FIELDS = ['id', 'articleId', 'version', 'title', 'excerpt', 'content', 'changeSummary', 'editorId'] as const;
const EDITORIALEVENT_FIELDS = ['id', 'articleId', 'actorId', 'eventType', 'fromStatus', 'toStatus', 'note'] as const;
const SCHEDULE_FIELDS = ['id', 'articleId', 'targetPublish', 'executedAt', 'status', 'failureReason', 'idempotencyKey'] as const;
const SCHEDULE_DATETIME_FIELDS = new Set(['targetPublish', 'executedAt']);
const LIVEBLOG_FIELDS = ['id', 'articleId', 'headline', 'body', 'isKeyEvent', 'authorId'] as const;
const BREAKING_FIELDS = ['id', 'headline', 'summary', 'articleId', 'urgencyRank', 'activeUntil', 'isActive'] as const;
const BREAKING_DATETIME_FIELDS = new Set(['activeUntil']);
const COMMENT_FIELDS = ['id', 'articleId', 'authorName', 'authorEmail', 'content', 'status'] as const;
const NEWSLETTER_FIELDS = ['id', 'email', 'frequency', 'isConfirmed', 'confirmToken', 'subscribedAt'] as const;
const HOMEPAGE_FIELDS = ['featuredArticleId', 'breakingArticleId', 'breakingBannerActive', 'sectionOrder'] as const;
// Phase 10: ad slots/campaigns
const AD_FIELDS = ['id', 'slotName', 'dimensions', 'adCode', 'isActive', 'impressions', 'clicks'] as const;

function pick(source: any, fields: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (source[f] !== undefined) out[f] = source[f];
  }
  return out;
}

function pickDatetimes(source: any, fields: readonly string[], datetimeFields: ReadonlySet<string>) {
  const out = pick(source, fields);
  for (const f of datetimeFields) {
    if (out[f] !== undefined) out[f] = toDate(out[f]);
  }
  return out;
}

/** Translate Prisma errors into the historical error contract (IntegrityError / plain Error). */
export function mapPrismaError(err: unknown): unknown {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      throw new IntegrityError('Integrity violation: duplicate value for a unique constraint.');
    }
    if (err.code === 'P2003') {
      throw new IntegrityError('Foreign key violation: a referenced record does not exist or is still in use.');
    }
    if (err.code === 'P2025') {
      throw new Error('Record not found');
    }
  }
  throw err;
}

/**
 * The PostgreSQL driver. Exposed through src/lib/database.ts behind the
 * DB_DRIVER selector — route code never imports this file directly.
 */
export class PgDatabase {
  private client: PrismaClient;

  constructor() {
    this.client = new PrismaClient();
  }

  /** REAL PostgreSQL transaction (plan §5): all writes succeed or fail together. */
  $transaction(promises: Array<Promise<any>>) {
    return (this.client.$transaction as any)(promises);
  }

  /** Interactive transaction helper for multi-step operations. */
  private runTx<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.client.$transaction(fn).catch(mapPrismaError) as Promise<T>;
  }

  // ── User ────────────────────────────────────────────────────────────────
  user = {
    count: async () => this.client.user.count(),
    create: async ({ data }: { data: any }) => {
      const existing = await this.client.user.findFirst({
        where: { email: { equals: data.email, mode: 'insensitive' } },
      });
      if (existing) {
        throw new IntegrityError(`User with email "${data.email}" already exists.`);
      }
      const payload = { ...pick(data, USER_FIELDS) } as any;
      payload.id = data.id || genId('usr');
      payload.isActive = data.isActive !== undefined ? data.isActive : true;
      try {
        return await this.client.user.create({ data: payload });
      } catch (err) {
        throw mapPrismaError(err);
      }
    },
    findUnique: async ({ where }: { where: { email?: string; id?: string } }) => {
      if (where.email) {
        return this.client.user.findFirst({
          where: { email: { equals: where.email, mode: 'insensitive' } },
        });
      }
      if (where.id) {
        return this.client.user.findUnique({ where: { id: where.id } });
      }
      return null;
    },
    findMany: async () => this.client.user.findMany({ orderBy: { createdAt: 'asc' } }),
    update: async ({ where, data }: { where: { id?: string; email?: string }; data: any }) => {
      const row = where.id
        ? await this.client.user.findUnique({ where: { id: where.id } })
        : await this.client.user.findFirst({
            where: { email: { equals: where.email!, mode: 'insensitive' } },
          });
      if (!row) throw new Error(`User not found: ${JSON.stringify(where)}`);
      const payload = pick(data, USER_FIELDS) as any;
      try {
        return await this.client.user.update({
          where: { id: row.id },
          data: { ...payload, updatedAt: new Date() },
        });
      } catch (err) {
        throw mapPrismaError(err);
      }
    },
    delete: async ({ where }: { where: { id: string } }) => {
      const authoredCount = await this.client.article.count({ where: { authorId: where.id } });
      if (authoredCount > 0) {
        throw new IntegrityError(
          `Cannot delete user "${where.id}": user has ${authoredCount} historical authored article(s). Deactivate the user instead of deleting.`
        );
      }
      await this.client.user.delete({ where: { id: where.id } });
      return { success: true };
    },
  };

  // ── Category ────────────────────────────────────────────────────────────
  category = {
    count: async () => this.client.category.count(),
    create: async ({ data }: { data: any }) => {
      const slugExists = await this.client.category.findUnique({ where: { slug: data.slug } });
      if (slugExists) {
        throw new IntegrityError(`Category with slug "${data.slug}" already exists.`);
      }
      if (data.parentId) {
        const parentExists = await this.client.category.findUnique({ where: { id: data.parentId } });
        if (!parentExists) {
          throw new IntegrityError(`Parent category with ID "${data.parentId}" does not exist.`);
        }
      }
      const payload = { ...pick(data, CATEGORY_FIELDS) } as any;
      payload.id = data.id || genId('cat');
      payload.displayOrder = data.displayOrder || 0;
      try {
        return await this.client.category.create({ data: payload });
      } catch (err) {
        throw mapPrismaError(err);
      }
    },
    findMany: async () => {
      const rows = await this.client.category.findMany({ orderBy: { createdAt: 'asc' } });
      const articleCounts = await this.client.article.groupBy({
        by: ['categoryId'],
        _count: { _all: true },
      });
      const countByCategory = new Map(articleCounts.map((g) => [g.categoryId, Number(g._count._all)]));
      return rows.map((c) => ({
        ...c,
        children: rows.filter((child) => child.parentId === c.id),
        _count: { articles: countByCategory.get(c.id) || 0 },
      }));
    },
    findUnique: async ({ where }: { where: { id?: string; slug?: string } }) => {
      const cat = where.id
        ? await this.client.category.findUnique({ where: { id: where.id } })
        : await this.client.category.findUnique({ where: { slug: where.slug! } });
      if (!cat) return null;
      const children = await this.client.category.findMany({
        where: { parentId: cat.id },
        orderBy: { createdAt: 'asc' },
      });
      return { ...cat, children };
    },
    delete: async ({ where }: { where: { id: string } }) => {
      const articleCount = await this.client.article.count({ where: { categoryId: where.id } });
      if (articleCount > 0) {
        throw new IntegrityError(
          `Cannot delete category "${where.id}": it is referenced by ${articleCount} existing article(s). Historical stories must not be broken.`
        );
      }
      const childCount = await this.client.category.count({ where: { parentId: where.id } });
      if (childCount > 0) {
        throw new IntegrityError(`Cannot delete category "${where.id}": it has ${childCount} nested child sub-category(ies).`);
      }
      await this.client.category.delete({ where: { id: where.id } });
      return { success: true };
    },
    update: async ({ where, data }: { where: { id: string }; data: any }) => {
      const row = await this.client.category.findUnique({ where: { id: where.id } });
      if (!row) throw new Error('Category not found');

      if (data.parentId) {
        if (data.parentId === where.id) {
          throw new IntegrityError('Circular reference: Category cannot be its own parent.');
        }
        const parentExists = await this.client.category.findUnique({ where: { id: data.parentId } });
        if (!parentExists) {
          throw new IntegrityError(`Parent category with ID "${data.parentId}" does not exist.`);
        }
        // Walk the ancestor chain exactly like the JSON driver (plan §1.3)
        let currId: string | null = data.parentId;
        while (currId) {
          if (currId === where.id) {
            throw new IntegrityError('Circular reference detected in category hierarchy.');
          }
          const parentCat = await this.client.category.findUnique({ where: { id: currId } });
          if (!parentCat) break;
          currId = parentCat.parentId;
        }
      }

      try {
        return await this.client.category.update({ where: { id: where.id }, data: pick(data, CATEGORY_FIELDS) });
      } catch (err) {
        throw mapPrismaError(err);
      }
    },
  };

  // ── AuthorProfile (upsert semantics — plan §1.3 row 2.18) ───────────────
  authorProfile = {
    create: async ({ data }: { data: any }) => {
      const payload = { ...pick(data, AUTHORPROFILE_FIELDS) } as any;
      payload.id = genId('prof');
      payload.createdAt = new Date();
      payload.updatedAt = new Date();
      try {
        return await this.client.authorProfile.create({ data: payload });
      } catch (err) {
        throw mapPrismaError(err);
      }
    },
    findMany: async () => this.client.authorProfile.findMany({ orderBy: { createdAt: 'asc' } }),
    findUnique: async ({ where }: { where: { userId?: string; id?: string } }) => {
      return this.client.authorProfile.findFirst({
        where: where.userId ? { userId: where.userId } : { id: where.id },
      });
    },
    update: async ({ where, data }: { where: { userId?: string; id?: string }; data: any }) => {
      const existing = await this.client.authorProfile.findFirst({
        where: where.userId ? { userId: where.userId } : { id: where.id },
      });
      const fullData: any = { ...pick(data, AUTHORPROFILE_FIELDS) };
      fullData.userId = data.userId || where.userId || existing?.userId;
      if (!existing) {
        return this.authorProfile.create({ data: fullData });
      }
      try {
        return await this.client.authorProfile.update({
          where: { id: existing.id },
          data: { ...fullData, updatedAt: new Date() },
        });
      } catch (err) {
        throw mapPrismaError(err);
      }
    },
  };

  // ── Tag ─────────────────────────────────────────────────────────────────
  tag = {
    create: async ({ data }: { data: any }) => {
      const slugExists = await this.client.tag.findUnique({ where: { slug: data.slug } });
      if (slugExists) {
        throw new IntegrityError(`Tag slug "${data.slug}" already exists.`);
      }
      const payload = { ...pick(data, TAG_FIELDS) } as any;
      payload.id = genId('tag');
      try {
        return await this.client.tag.create({ data: payload });
      } catch (err) {
        throw mapPrismaError(err);
      }
    },
    findMany: async () => this.client.tag.findMany({ orderBy: { createdAt: 'asc' } }),
    delete: async ({ where }: { where: { id: string } }) => {
      // Plan Q4: remove join rows first so no dangling references remain.
      return this.runTx(async (tx) => {
        await tx.articleTag.deleteMany({ where: { tagId: where.id } });
        await tx.tag.delete({ where: { id: where.id } });
        return { success: true };
      });
    },
  };

  // ── Durable password-reset tokens ───────────────────────────────────────
  passwordResetToken = {
    create: async ({ data }: { data: { tokenHash: string; userId: string; expiresAt: string } }) => {
      return this.runTx(async (tx) => {
        // Purge the user's expired tokens in the same tx (plan §5.5)
        await tx.passwordResetToken.deleteMany({
          where: { userId: data.userId, expiresAt: { lte: new Date() } },
        });
        const entry = {
          id: genId('prt'),
          tokenHash: data.tokenHash,
          userId: data.userId,
          expiresAt: toDate(data.expiresAt)!,
          usedAt: null,
          createdAt: new Date(),
        };
        await tx.passwordResetToken.create({ data: entry });
        return entry;
      });
    },
    findByHash: async (tokenHash: string) => {
      return this.client.passwordResetToken.findFirst({
        where: { tokenHash, usedAt: null },
      });
    },
    markUsed: async (id: string) => {
      try {
        return await this.client.passwordResetToken.update({
          where: { id },
          data: { usedAt: new Date() },
        });
      } catch (err) {
        throw mapPrismaError(err);
      }
    },
    purgeExpired: async () => {
      await this.client.passwordResetToken.deleteMany({ where: { expiresAt: { lte: new Date() } } });
    },
  };

  // ── Durable JWT session revocation ──────────────────────────────────────
  revokedSession = {
    revoke: async (jti: string, userId: string, expiresAt: string) => {
      // Idempotent: the same jti may be revoked twice (double logout). The JSON
      // layer appended duplicates harmlessly; the unique key turns that into a no-op.
      return this.runTx(async (tx) => {
        await tx.revokedSession.upsert({
          where: { jti },
          create: { jti, userId, revokedAt: new Date(), expiresAt: toDate(expiresAt)! },
          update: {},
        });
      });
    },
    isRevoked: async (jti: string): Promise<boolean> => {
      const count = await this.client.revokedSession.count({
        where: { jti, expiresAt: { gt: new Date() } },
      });
      return count > 0;
    },
    revokeAllForUser: async (_userId: string, _newExpiresAt: string) => {
      // Intentionally a no-op — matches the JSON driver (plan §1.3): tokens
      // issued before a password change are rejected via passwordChangedAt.
    },
    purgeExpired: async () => {
      await this.client.revokedSession.deleteMany({ where: { expiresAt: { lte: new Date() } } });
    },
  };

  // ── ArticleTag join table ───────────────────────────────────────────────
  articleTag = {
    createMany: async ({ data }: { data: Array<{ articleId: string; tagId: string }> }) => {
      return this.runTx(async (tx) => {
        const existing = await tx.articleTag.findMany({
          where: { articleId: { in: data.map((i) => i.articleId) } },
        });
        const existingKeys = new Set(existing.map((e) => `${e.articleId}:${e.tagId}`));
        const missing = data.filter((i) => !existingKeys.has(`${i.articleId}:${i.tagId}`));
        if (missing.length > 0) {
          await tx.articleTag.createMany({ data: missing, skipDuplicates: true });
        }
        return { count: missing.length };
      });
    },
    deleteMany: async ({ where }: { where: { articleId: string } }) => {
      const result = await this.client.articleTag.deleteMany({ where: { articleId: where.articleId } });
      return { count: result.count };
    },
    findMany: async ({ where }: { where: { articleId: string } }) => {
      return this.client.articleTag.findMany({
        where: { articleId: where.articleId },
        orderBy: { tagId: 'asc' },
      });
    },
  };

  // ── Media assets ────────────────────────────────────────────────────────
  mediaAsset = {
    create: async ({ data }: { data: any }) => {
      const payload = { ...pick(data, MEDIA_FIELDS) } as any;
      payload.id = data.id || genId('med');
      payload.assetType = data.assetType || 'IMAGE';
      payload.focalX = data.focalX !== undefined ? data.focalX : 50;
      payload.focalY = data.focalY !== undefined ? data.focalY : 50;
      try {
        return await this.client.mediaAsset.create({ data: payload });
      } catch (err) {
        throw mapPrismaError(err);
      }
    },
    findMany: async (args?: { where?: { uploaderId?: string; assetType?: string; search?: string } }) => {
      const where: Prisma.MediaAssetWhereInput = {};
      if (args?.where?.uploaderId) where.uploaderId = args.where.uploaderId;
      if (args?.where?.assetType) where.assetType = args.where.assetType as any;
      if (args?.where?.search) {
        const q = args.where.search;
        where.OR = [
          { filename: { contains: q, mode: 'insensitive' } },
          { caption: { contains: q, mode: 'insensitive' } },
          { credit: { contains: q, mode: 'insensitive' } },
          { altText: { contains: q, mode: 'insensitive' } },
        ];
      }
      const rows = await this.client.mediaAsset.findMany({ where, orderBy: { createdAt: 'desc' } });
      const ids = rows.map((r) => r.id);
      const usageCounts = ids.length
        ? await this.client.article.groupBy({
            by: ['coverImageId'],
            where: { coverImageId: { in: ids } },
            _count: { _all: true },
          })
        : [];
      const countByAsset = new Map<string, number>();
      for (const g of usageCounts) {
        if (g.coverImageId) countByAsset.set(g.coverImageId, Number(g._count._all));
      }
      return rows.map((m) => ({ ...m, usagesCount: countByAsset.get(m.id) || 0 }));
    },
    findUnique: async ({ where }: { where: { id: string } }) => {
      const asset = await this.client.mediaAsset.findUnique({ where: { id: where.id } });
      if (!asset) return null;
      const usages = await this.client.article.findMany({
        where: { coverImageId: asset.id },
        select: { id: true, title: true, slug: true, status: true },
      });
      return { ...asset, usages };
    },
    update: async ({ where, data }: { where: { id: string }; data: any }) => {
      const existing = await this.client.mediaAsset.findUnique({ where: { id: where.id } });
      if (!existing) throw new Error('Media asset not found');
      try {
        return await this.client.mediaAsset.update({ where: { id: where.id }, data: pick(data, MEDIA_FIELDS) });
      } catch (err) {
        throw mapPrismaError(err);
      }
    },
    delete: async ({ where }: { where: { id: string } }) => {
      // JSON parity: block while used as a cover image (plan §1.3). Inline
      // usage (articleMedia FK) is additionally protected by ON DELETE RESTRICT.
      const isCover = await this.client.article.count({ where: { coverImageId: where.id } });
      if (isCover > 0) {
        throw new IntegrityError(
          `Cannot delete media asset "${where.id}": it is currently assigned as cover image for existing articles.`
        );
      }
      return this.runTx(async (tx) => {
        await tx.mediaAsset.delete({ where: { id: where.id } });
        return { success: true };
      });
    },
  };

  // ── Core articles ───────────────────────────────────────────────────────
  private async decorateArticle(article: any): Promise<any> {
    if (!article) return article;
    const category = await this.client.category.findUnique({ where: { id: article.categoryId } });
    const author = await this.client.user.findUnique({
      where: { id: article.authorId },
      select: { name: true, avatar: true },
    });
    return {
      ...article,
      category,
      author: author ? { name: author.name, avatar: author.avatar } : undefined,
    };
  }

  private normalizeArticleCreate(data: any, now: Date) {
    const normalized = { ...pick(data, ARTICLE_FIELDS) } as any;
    for (const f of ARTICLE_DATETIME_FIELDS) {
      if (normalized[f] !== undefined) normalized[f] = toDate(normalized[f]);
    }
    normalized.id = data.id || genId('art');
    normalized.status = data.status || 'DRAFT';
    normalized.articleType = data.articleType || 'STANDARD';
    normalized.priority = data.priority || 'NORMAL';
    normalized.views = data.views || 0;
    normalized.version = data.version || 1;
    normalized.scheduledFor = normalized.scheduledFor ?? null;
    normalized.archivedAt = normalized.archivedAt ?? null;
    normalized.publishedAt = normalized.publishedAt ??
      (data.status === 'PUBLISHED' ? now : null);
    normalized.structuredBody = data.structuredBody ?? null;
    normalized.createdAt = toDate(data.createdAt) ?? now;
    normalized.updatedAt = toDate(data.updatedAt) ?? now;
    return normalized;
  }

  article = {
    count: async (args?: { where?: { status?: string } }) => {
      return this.client.article.count({
        where: args?.where?.status ? { status: args.where.status as any } : undefined,
      });
    },
    aggregate: async (_args?: { _sum?: { views?: boolean } }) => {
      const res = await this.client.article.aggregate({ _sum: { views: true } });
      return { _sum: { views: res._sum.views || 0 } };
    },
    create: async ({ data }: { data: any; include?: any }) => {
      const now = new Date();
      return this.runTx(async (tx) => {
        // Historical referential-protection messages (plan §1.3)
        const category = await tx.category.findUnique({ where: { id: data.categoryId } });
        if (!category) {
          throw new IntegrityError(`Foreign key violation: Category ID "${data.categoryId}" does not exist.`);
        }
        const authorExists = await tx.user.findUnique({ where: { id: data.authorId } });
        if (!authorExists) {
          throw new IntegrityError(`Foreign key violation: Author User ID "${data.authorId}" does not exist.`);
        }
        const slugExists = await tx.article.findUnique({ where: { slug: data.slug } });
        if (slugExists) {
          throw new IntegrityError(`Article slug "${data.slug}" must be unique.`);
        }

        const created = await tx.article.create({ data: this.normalizeArticleCreate(data, now) });

        // Initial immutable revision snapshot — same tx (plan §5.1)
        await tx.articleRevision.create({
          data: {
            id: genId('rev'),
            articleId: created.id,
            version: 1,
            title: created.title,
            excerpt: created.excerpt,
            content: created.content,
            changeSummary: 'Initial article creation',
            editorId: created.authorId,
            createdAt: now,
          },
        });

        const author = await tx.user.findUnique({
          where: { id: created.authorId },
          select: { name: true, avatar: true },
        });
        return {
          ...created,
          category,
          author: author ? { name: author.name, avatar: author.avatar } : undefined,
        };
      });
    },
    findMany: async (args?: {
      where?: any;
      include?: any;
      select?: any;
      orderBy?: any;
      take?: number;
      skip?: number;
    }) => {
      const inputWhere: Prisma.ArticleWhereInput = {};
      const w = args?.where || {};
      if (w.category?.slug) {
        const cat = await this.client.category.findUnique({ where: { slug: w.category.slug } });
        if (!cat) return this.emptyPagedResponse(args);
        inputWhere.categoryId = cat.id;
      }
      if (w.tag?.slug) {
        const tagEnt = await this.client.tag.findUnique({ where: { slug: w.tag.slug } });
        if (!tagEnt) return this.emptyPagedResponse(args);
        inputWhere.tags = { some: { tagId: tagEnt.id } };
      }
      if (w.authorId) inputWhere.authorId = w.authorId;
      if (w.status) inputWhere.status = w.status as any;
      if (w.priority) inputWhere.priority = w.priority as any;
      if (w.publishedAt && typeof w.publishedAt === 'object') {
        // Range filter (e.g. sitemap-news.xml `gte`) — JSON layer silently ignored
        // it; PostgreSQL honors it as documented in plan §2 row 2.17.
        const publishedFilter: any = {};
        if (w.publishedAt.gte) publishedFilter.gte = toDate(w.publishedAt.gte);
        if (w.publishedAt.lt) publishedFilter.lt = toDate(w.publishedAt.lt);
        if (w.publishedAt.lte) publishedFilter.lte = toDate(w.publishedAt.lte);
        if (w.publishedAt.gt) publishedFilter.gt = toDate(w.publishedAt.gt);
        (inputWhere as any).publishedAt = publishedFilter;
      }
      if (w.OR && Array.isArray(w.OR)) {
        // JSON semantics: each term matches title OR excerpt OR content, case-insensitive (plan §2 row 2.9)
        inputWhere.OR = w.OR.flatMap((condition: any) => {
          if (!condition.title?.contains) return [];
          const term = condition.title.contains;
          return [{
            OR: [
              { title: { contains: term, mode: 'insensitive' } },
              { excerpt: { contains: term, mode: 'insensitive' } },
              { content: { contains: term, mode: 'insensitive' } },
            ],
          }];
        });
      }

      let rows = await this.client.article.findMany({
        where: inputWhere,
        orderBy: [
          { publishedAt: { sort: 'desc', nulls: 'last' } },
          { createdAt: 'desc' },
        ],
      });

      // year/month filter on COALESCE(publishedAt, createdAt) — JSON parity (plan §2 row 2.10)
      if (w.year !== undefined) {
        rows = rows.filter((a) => new Date(a.publishedAt || a.createdAt).getFullYear() === parseInt(w.year));
      }
      if (w.month !== undefined) {
        rows = rows.filter((a) => new Date(a.publishedAt || a.createdAt).getMonth() + 1 === parseInt(w.month));
      }

      // Decorate like the JSON layer: category, author {name, avatar}, _count.comments
      const allCategories = await this.client.category.findMany();
      const categoryById = new Map(allCategories.map((c) => [c.id, c]));
      const activeIds = [...new Set(rows.map((r) => r.authorId))];
      const authors = activeIds.length
        ? await this.client.user.findMany({ where: { id: { in: activeIds } }, select: { id: true, name: true, avatar: true } })
        : [];
      const authorById = new Map(authors.map((u) => [u.id, u]));
      const rowIds = rows.map((r) => r.id);
      const commentCounts = rowIds.length
        ? await this.client.comment.groupBy({
            by: ['articleId'],
            where: { articleId: { in: rowIds }, status: 'APPROVED' },
            _count: { _all: true },
          })
        : [];
      const countByArticle = new Map(commentCounts.map((g) => [g.articleId, Number(g._count._all)]));

      const decorated: any[] = rows.map((art) => ({
        ...art,
        category: categoryById.get(art.categoryId) || null,
        author: authorById.has(art.authorId)
          ? { name: authorById.get(art.authorId)!.name, avatar: authorById.get(art.authorId)!.avatar }
          : { name: 'Staff Reporter' },
        _count: { comments: countByArticle.get(art.id) || 0 },
      }));

      // Pagination AFTER decoration — JSON parity (total counts pre-pagination)
      if (args?.take === undefined && args?.skip === undefined) {
        return decorated;
      }
      let sliced = decorated;
      if (args?.skip !== undefined) sliced = sliced.slice(args.skip);
      if (args?.take !== undefined) sliced = sliced.slice(0, args.take);
      (sliced as any).total = decorated.length;
      return sliced;
    },
    findUnique: async ({ where }: { where: { slug?: string; id?: string }; include?: any; select?: any }) => {
      const art = where.slug
        ? await this.client.article.findUnique({ where: { slug: where.slug } })
        : where.id
          ? await this.client.article.findUnique({ where: { id: where.id } })
          : null;
      if (!art) return null;

      const [category, author, comments, revisions, liveUpdates, mediaRows] = await Promise.all([
        this.client.category.findUnique({ where: { id: art.categoryId } }),
        this.client.user.findUnique({ where: { id: art.authorId }, select: { name: true, avatar: true } }),
        this.client.comment.findMany({
          where: { articleId: art.id, status: 'APPROVED' },
          orderBy: { createdAt: 'desc' },
        }),
        this.client.articleRevision.findMany({ where: { articleId: art.id }, orderBy: { createdAt: 'asc' } }),
        this.client.liveBlogUpdate.findMany({ where: { articleId: art.id }, orderBy: { createdAt: 'asc' } }),
        this.client.articleMedia.findMany({
          where: { articleId: art.id },
          orderBy: { position: 'asc' },
          include: { mediaAsset: true },
        }),
      ]);
      return {
        ...art,
        category,
        author: author ? { name: author.name, avatar: author.avatar } : { name: 'Staff Reporter' },
        comments,
        revisions,
        liveBlogUpdates: liveUpdates,
        mediaAssets: mediaRows,
      };
    },
    update: async ({ where, data }: { where: { id: string }; data: any; include?: any }) => {
      return this.runTx(async (tx) => {
        const prev = await tx.article.findUnique({ where: { id: where.id } });
        if (!prev) throw new Error('Article not found');

        // Views increments: atomic counter, no version bump, no revision, no updatedAt churn (plan §2 row 2.3)
        if (data.views && typeof data.views === 'object' && data.views.increment) {
          return tx.article.update({
            where: { id: where.id },
            data: { views: { increment: data.views.increment }, updatedAt: prev.updatedAt },
          });
        }

        const newVersion = (prev.version || 1) + 1;
        const now = new Date();

        // Immutable revision snapshot when content changed (plan §5.2)
        if (data.content && data.content !== prev.content) {
          await tx.articleRevision.create({
            data: {
              id: genId('rev'),
              articleId: prev.id,
              version: newVersion,
              title: data.title || prev.title,
              excerpt: data.excerpt || prev.excerpt,
              content: data.content,
              changeSummary: data.changeSummary || 'Editorial update',
              editorId: data.authorId || prev.authorId,
              createdAt: now,
            },
          });
        }

        if (data.status === 'PUBLISHED' && prev.status !== 'PUBLISHED') {
          data.publishedAt = now;
        }

        const patch: any = { ...pick({ ...data, ...pickDatetimes(data, ARTICLE_FIELDS, ARTICLE_DATETIME_FIELDS) }, ARTICLE_FIELDS) };
        patch.version = newVersion;
        patch.updatedAt = now;

        const updated = await tx.article.update({ where: { id: where.id }, data: patch });
        const category = await tx.category.findUnique({ where: { id: updated.categoryId } });
        const author = await tx.user.findUnique({
          where: { id: updated.authorId },
          select: { name: true, avatar: true },
        });
        return {
          ...updated,
          category,
          author: author ? { name: author.name, avatar: author.avatar } : undefined,
        };
      });
    },
    delete: async ({ where }: { where: { id: string } }) => {
      // Schema-level ON DELETE CASCADE covers comments, revisions, liveBlogUpdates,
      // articleMedia, articleTags, events, schedules, reactions (plan §5.6).
      return this.runTx(async (tx) => {
        await tx.article.delete({ where: { id: where.id } });
        return { success: true };
      });
    },
  };

  private emptyPagedResponse(args?: any) {
    const items: any[] = [];
    (items as any).total = 0;
    return items;
  }

  // ── ArticleMedia ────────────────────────────────────────────────────────
  articleMedia = {
    create: async ({ data }: { data: any }) => {
      const am = {
        id: genId('am'),
        createdAt: new Date(),
        ...data,
      };
      return this.runTx(async (tx) => {
        await tx.articleMedia.create({ data: am as any });
        return am;
      });
    },
    findMany: async (args?: { where?: { articleId?: string } }) => {
      return this.client.articleMedia.findMany({
        where: args?.where?.articleId ? { articleId: args.where.articleId } : undefined,
        orderBy: { createdAt: 'asc' },
        include: { mediaAsset: true },
      });
    },
    deleteMany: async ({ where }: { where: { articleId: string } }) => {
      const result = await this.client.articleMedia.deleteMany({ where: { articleId: where.articleId } });
      return { count: result.count };
    },
  };

  // ── ArticleRevisions (immutable history) ────────────────────────────────
  articleRevision = {
    create: async ({ data }: { data: any }) => {
      const rev = { id: genId('rev'), createdAt: new Date(), ...data };
      return this.runTx(async (tx) => {
        await tx.articleRevision.create({ data: rev as any });
        return rev;
      });
    },
    findMany: async ({ where }: { where: { articleId: string } }) => {
      return this.client.articleRevision.findMany({
        where: { articleId: where.articleId },
        orderBy: { createdAt: 'asc' },
      });
    },
  };

  // ── PublicationSchedule ─────────────────────────────────────────────────
  publicationSchedule = {
    create: async ({ data }: { data: any }) => {
      const schedule = {
        id: genId('sched'),
        createdAt: new Date(),
        ...pickDatetimes(data, SCHEDULE_FIELDS, SCHEDULE_DATETIME_FIELDS),
      } as any;
      schedule.status = data.status || 'QUEUED';
      return this.runTx(async (tx) => {
        await tx.publicationSchedule.create({ data: schedule as any });
        return schedule;
      });
    },
    findMany: async () => this.client.publicationSchedule.findMany({ orderBy: { createdAt: 'asc' } }),
    findUnique: async ({ where }: { where: { idempotencyKey?: string; id?: string } }) => {
      return this.client.publicationSchedule.findUnique({
        where: where.idempotencyKey ? { idempotencyKey: where.idempotencyKey } : { id: where.id! },
      });
    },
    /** Phase 10: observable failure recording + safe-retry state moves */
    update: async ({ where, data }: { where: { id: string }; data: any }) => {
      return this.runTx(async (tx) => {
        return tx.publicationSchedule.update({
          where: { id: where.id },
          data: pickDatetimes(data, SCHEDULE_FIELDS, SCHEDULE_DATETIME_FIELDS) as any,
        });
      });
    },
  };

  /**
   * Phase 7 domain operation: atomically promote a SCHEDULED article to
   * PUBLISHED and record the executed schedule row with real atomicity —
   * article update + editorial event + audit log + EXECUTED schedule row all
   * live in one interactive Prisma transaction; the unique idempotencyKey
   * index makes double-sweeps race-safe.
   */
  async publishScheduledArticle(args: {
    articleId: string;
    idempotencyKey: string;
    scheduledFor?: string | null;
    actorId: string;
    isOverdue?: boolean;
  }) {
    return this.runTx(async (tx) => {
      const existing = await tx.publicationSchedule.findUnique({ where: { idempotencyKey: args.idempotencyKey } });
      if (existing && existing.status === 'EXECUTED') {
        return { executed: false, reason: 'ALREADY_EXECUTED', article: null };
      }

      const current = await tx.article.findUnique({ where: { id: args.articleId } });
      if (!current) return { executed: false, reason: 'ARTICLE_NOT_FOUND', article: null };
      if (current.status === 'PUBLISHED') {
        return { executed: false, reason: 'ALREADY_PUBLISHED', article: current };
      }

      const publishedAt = args.scheduledFor || new Date();
      const eventType = args.isOverdue ? 'RECONCILED_PUBLISH' : 'AUTOMATED_PUBLISH';

      const article = await tx.article.update({
        where: { id: args.articleId },
        data: { status: 'PUBLISHED', publishedAt },
      });

      await tx.editorialEvent.create({
        data: {
          articleId: args.articleId,
          actorId: args.actorId,
          eventType,
          fromStatus: 'SCHEDULED',
          toStatus: 'PUBLISHED',
          note: args.isOverdue
            ? `System downtime reconciliation: Published overdue article scheduled for ${args.scheduledFor}`
            : `Automated daemon publication at scheduled target time`,
        } as any,
      });

      await tx.auditLog.create({
        data: {
          userId: args.actorId,
          action: eventType,
          entityType: 'ARTICLE',
          entityId: args.articleId,
          details: `Article "${article.title}" published automatically by background scheduler.`,
        } as any,
      });

      const schedule = await tx.publicationSchedule.create({
        data: {
          articleId: args.articleId,
          targetPublish: args.scheduledFor || null,
          executedAt: new Date(),
          status: 'EXECUTED',
          idempotencyKey: args.idempotencyKey,
        } as any,
      });

      return { executed: true, article, schedule };
    });
  }

  // ── URL redirects (slug changes must preserve deep links) ───────────────
  urlRedirect = {
    create: async ({ data }: { data: any }) => {
      const redirect = {
        id: genId('redir'),
        sourcePath: String(data.sourcePath || ''),
        destinationPath: String(data.destinationPath || ''),
        statusCode: data.statusCode || 301,
        isActive: data.isActive !== undefined ? data.isActive : true,
        createdAt: new Date(),
      };
      return this.runTx(async (tx) => {
        await tx.urlRedirect.create({ data: redirect as any });
        return redirect;
      }).catch(mapPrismaError);
    },
    update: async ({ where, data }: { where: { sourcePath: string; id?: string }; data: any }) => {
      return this.client.urlRedirect
        .update({ where: where.sourcePath ? { sourcePath: where.sourcePath } : { id: where.id! }, data })
        .catch(mapPrismaError);
    },
    /** Upsert-by-sourcePath semantics used by the slug-change flow. */
    ensureRoute: async ({ data }: { data: any }) => {
      const sourcePath = String(data.sourcePath || '');
      return this.runTx(async (tx) => {
        return tx.urlRedirect.upsert({
          where: { sourcePath },
          create: {
            sourcePath,
            destinationPath: String(data.destinationPath || ''),
            statusCode: data.statusCode || 301,
            isActive: data.isActive !== undefined ? data.isActive : true,
          } as any,
          update: {
            destinationPath: String(data.destinationPath || ''),
            isActive: data.isActive !== undefined ? data.isActive : true,
          } as any,
        });
      });
    },
    findUnique: async ({ where }: { where: { sourcePath: string; id?: string } }) => {
      return this.client.urlRedirect
        .findUnique({ where: where.sourcePath ? { sourcePath: where.sourcePath } : { id: where.id! } });
    },
    findMany: async () => this.client.urlRedirect.findMany({ orderBy: { createdAt: 'asc' } }),
    delete: async ({ where }: { where: { id: string } }) => {
      return this.runTx(async (tx) => {
        await tx.urlRedirect.delete({ where: { id: where.id } });
        return { success: true };
      }).catch(mapPrismaError);
    },
  };

  // ── EditorialEvent ──────────────────────────────────────────────────────
  editorialEvent = {
    create: async ({ data }: { data: any }) => {
      const event = { id: genId('event'), createdAt: new Date(), ...pick(data, EDITORIALEVENT_FIELDS) };
      return this.runTx(async (tx) => {
        await tx.editorialEvent.create({ data: event as any });
        return event;
      });
    },
    findMany: async ({ where }: { where?: { articleId?: string } } = {}) => {
      return this.client.editorialEvent.findMany({
        where: where?.articleId ? { articleId: where.articleId } : undefined,
        orderBy: { createdAt: 'asc' },
      });
    },
  };

  // ── ArticleContributor ──────────────────────────────────────────────────
  articleContributor = {
    create: async ({ data }: { data: any }) => {
      const contrib = { id: genId('contrib'), createdAt: new Date(), ...data };
      return this.runTx(async (tx) => {
        await tx.articleContributor.create({ data: contrib as any });
        return contrib;
      });
    },
  };

  // ── Live blog updates ───────────────────────────────────────────────────
  liveBlogUpdate = {
    create: async ({ data }: { data: any }) => {
      const update = { id: genId('live'), createdAt: new Date(), ...pick(data, LIVEBLOG_FIELDS) };
      return this.runTx(async (tx) => {
        await tx.liveBlogUpdate.create({ data: update as any });
        return update;
      });
    },
    findMany: async ({ where }: { where: { articleId: string } }) => {
      return this.client.liveBlogUpdate.findMany({
        where: { articleId: where.articleId },
        orderBy: { createdAt: 'desc' },
      });
    },
    findUnique: async ({ where }: { where: { id: string } }) => {
      return this.client.liveBlogUpdate.findUnique({ where: { id: where.id } });
    },
    delete: async ({ where }: { where: { id: string } }) => {
      await this.client.liveBlogUpdate.delete({ where: { id: where.id } });
      return { success: true };
    },
  };

  // ── Breaking news announcements ─────────────────────────────────────────
  breakingNewsAnnouncement = {
    create: async ({ data }: { data: any }) => {
      const announcement = { id: genId('brk'), createdAt: new Date(), ...pickDatetimes(data, BREAKING_FIELDS, BREAKING_DATETIME_FIELDS) };
      return this.runTx(async (tx) => {
        await tx.breakingNewsAnnouncement.create({ data: announcement as any });
        return announcement;
      });
    },
    findMany: async (args?: { where?: { isActive?: boolean } }) => {
      return this.client.breakingNewsAnnouncement.findMany({
        where: args?.where?.isActive !== undefined ? { isActive: args.where.isActive } : undefined,
        orderBy: { createdAt: 'desc' },
      });
    },
    findUnique: async ({ where }: { where: { id: string } }) => {
      return this.client.breakingNewsAnnouncement.findUnique({ where: { id: where.id } });
    },
    update: async ({ where, data }: { where: { id: string }; data: any }) => {
      const existing = await this.client.breakingNewsAnnouncement.findUnique({ where: { id: where.id } });
      if (!existing) throw new Error('Announcement not found');
      try {
        return await this.client.breakingNewsAnnouncement.update({
          where: { id: where.id },
          data: pickDatetimes(data, BREAKING_FIELDS, BREAKING_DATETIME_FIELDS),
        });
      } catch (err) {
        throw mapPrismaError(err);
      }
    },
    delete: async ({ where }: { where: { id: string } }) => {
      await this.client.breakingNewsAnnouncement.delete({ where: { id: where.id } });
      return { success: true };
    },
  };

  // ── Reader reactions ────────────────────────────────────────────────────
  reaction = {
    create: async ({ data }: { data: any }) => {
      const reaction = { id: genId('rxt'), createdAt: new Date(), ...data };
      return this.runTx(async (tx) => {
        await tx.reaction.create({ data: reaction as any });
        return reaction;
      });
    },
    findMany: async ({ where }: { where: { articleId: string } }) => {
      return this.client.reaction.findMany({
        where: { articleId: where.articleId },
        orderBy: { createdAt: 'asc' },
      });
    },
    getCounts: async (articleId: string) => {
      const grouped = await this.client.reaction.groupBy({
        by: ['type'],
        where: { articleId },
        _count: { _all: true },
      });
      const counts: Record<string, number> = {
        INSIGHTFUL: 0,
        URGENT: 0,
        ESSENTIAL: 0,
        BALANCED: 0,
      };
      for (const g of grouped) {
        counts[g.type] = Number(g._count._all);
      }
      return counts;
    },
  };

  // ── Comments ────────────────────────────────────────────────────────────
  comment = {
    count: async (args?: { where?: { status?: string } }) => {
      return this.client.comment.count({
        where: args?.where?.status ? { status: args.where.status as any } : undefined,
      });
    },
    create: async ({ data }: { data: any }) => {
      const newComment = { id: genId('cmt'), createdAt: new Date(), status: data.status || 'PENDING', ...pick(data, COMMENT_FIELDS) };
      return this.runTx(async (tx) => {
        await tx.comment.create({ data: newComment as any });
        return newComment;
      });
    },
    findMany: async (args?: { where?: { status?: string }; include?: any; orderBy?: any }) => {
      const rows = await this.client.comment.findMany({
        where: args?.where?.status ? { status: args.where.status as any } : undefined,
        orderBy: { createdAt: 'desc' }, // JSON layer always sorted desc (plan §1.3)
      });
      const articles = await this.client.article.findMany({
        where: { id: { in: [...new Set(rows.map((c) => c.articleId))] } },
        select: { id: true, title: true, slug: true },
      });
      const articleById = new Map(articles.map((a) => [a.id, a]));
      return rows.map((c) => ({
        ...c,
        article: articleById.has(c.articleId)
          ? { title: articleById.get(c.articleId)!.title, slug: articleById.get(c.articleId)!.slug }
          : undefined,
      }));
    },
    update: async ({ where, data }: { where: { id: string }; data: any }) => {
      const existing = await this.client.comment.findUnique({ where: { id: where.id } });
      if (!existing) throw new Error('Comment not found');
      try {
        return await this.client.comment.update({ where: { id: where.id }, data: pick(data, COMMENT_FIELDS) });
      } catch (err) {
        throw mapPrismaError(err);
      }
    },
  };

  // ── Polls ───────────────────────────────────────────────────────────────
  poll = {
    create: async ({ data }: { data: any }) => {
      const newPoll = { id: genId('pol'), createdAt: new Date(), ...data } as any;
      newPoll.active = data.active !== undefined ? data.active : true;
      return this.runTx(async (tx) => {
        await tx.poll.create({ data: newPoll as any });
        return newPoll;
      });
    },
    findFirst: async (args?: { where?: { active?: boolean }; orderBy?: any }) => {
      return this.client.poll.findFirst({
        where: args?.where?.active !== undefined ? { active: args.where.active } : undefined,
        orderBy: { createdAt: 'asc' }, // JSON layer returns the first-created match
      });
    },
    findUnique: async ({ where }: { where: { id: string } }) => {
      return this.client.poll.findUnique({ where: { id: where.id } });
    },
    update: async ({ where, data }: { where: { id: string }; data: any }) => {
      const existing = await this.client.poll.findUnique({ where: { id: where.id } });
      if (!existing) throw new Error('Poll not found');
      return this.runTx(async (tx) => {
        return tx.poll.update({ where: { id: where.id }, data });
      });
    },
  };

  // ── Site settings ───────────────────────────────────────────────────────
  siteSetting = {
    create: async ({ data }: { data: any }) => {
      const setting = { id: genId('set'), updatedAt: new Date(), ...data };
      return this.runTx(async (tx) => {
        await tx.siteSetting.create({ data: setting as any });
        return setting;
      });
    },
    findUnique: async ({ where }: { where: { key: string } }) => {
      return this.client.siteSetting.findUnique({ where: { key: where.key } });
    },
    /** Phase 10: upsert-by-key semantics (create when the key is new) */
    update: async ({ where, data }: { where: { key: string }; data: any }) => {
      const value = data.value !== undefined ? data.value : undefined;
      const description = data.description !== undefined ? data.description : undefined;
      return this.runTx(async (tx) => {
        return tx.siteSetting.upsert({
          where: { key: where.key },
          create: { key: where.key, value: value as any, description: description as any },
          update: {
            ...(value !== undefined ? { value: value as any } : {}),
            ...(description !== undefined ? { description: description as any } : {}),
            updatedAt: new Date(),
          },
        });
      });
    },
    /** Upsert-by-key used by the settings endpoint (parity with JSON driver) */
    upsert: async ({ where, data }: { where: { key: string }; data: any }) => {
      return this.siteSetting.update({ where, data });
    },
  };

  // ── Audit log (append-only) ─────────────────────────────────────────────
  auditLog = {
    create: async ({ data }: { data: any }) => {
      const log = { id: genId('log'), createdAt: new Date(), ...data };
      return this.runTx(async (tx) => {
        await tx.auditLog.create({ data: log as any });
        return log;
      });
    },
    findMany: async () => this.client.auditLog.findMany({ orderBy: { createdAt: 'asc' } }),
  };

  // ── Homepage config (singleton) ─────────────────────────────────────────
  homepageConfig = {
    findFirst: async () => {
      return this.client.homepageConfig.findFirst({ orderBy: { createdAt: 'asc' } });
    },
    upsert: async ({ data }: { data: any }) => {
      // JSON semantics: full replace of the singleton (plan §1.3)
      const payload = { ...pick(data, HOMEPAGE_FIELDS), updatedAt: new Date() };
      return this.runTx(async (tx) => {
        return tx.homepageConfig.upsert({
          where: { id: 'default' },
          create: { id: 'default', ...payload },
          update: {
            featuredArticleId: data.featuredArticleId ?? null,
            breakingArticleId: data.breakingArticleId ?? null,
            breakingBannerActive: data.breakingBannerActive ?? true,
            sectionOrder: data.sectionOrder ?? null,
            updatedAt: new Date(),
          },
        });
      });
    },
    update: async ({ data }: { data: any }) => {
      // JSON semantics: merge onto the existing singleton (create if absent)
      return this.runTx(async (tx) => {
        const current = await tx.homepageConfig.findFirst();
        return tx.homepageConfig.upsert({
          where: { id: 'default' },
          create: { id: 'default', ...pick(data, HOMEPAGE_FIELDS) },
          update: { ...pick(data, HOMEPAGE_FIELDS), updatedAt: new Date() },
        });
      });
    },
  };

  // ── Newsletter ──────────────────────────────────────────────────────────
  newsletterSubscription = {
    upsert: async ({ where, create }: { where: { email: string }; update: any; create: any }) => {
      // JSON parity: existing subscribers are returned untouched (update ignored)
      const existing = await this.client.newsletterSubscription.findUnique({ where: { email: where.email } });
      if (existing) return existing;
      const sub = { id: genId('sub'), subscribedAt: new Date(), ...pick(create, NEWSLETTER_FIELDS) };
      return this.runTx(async (tx) => {
        await tx.newsletterSubscription.create({ data: sub as any });
        return sub;
      });
    },
    findUnique: async ({ where }: { where: { email?: string; id?: string } }) => {
      if (where.email) {
        return this.client.newsletterSubscription.findUnique({ where: { email: where.email } });
      }
      if (where.id) {
        return this.client.newsletterSubscription.findUnique({ where: { id: where.id } });
      }
      return null;
    },
    findMany: async (args?: { orderBy?: any }) => {
      return this.client.newsletterSubscription.findMany({
        orderBy: args?.orderBy || { subscribedAt: 'desc' },
      });
    },
    update: async ({ where, data }: { where: { id: string }; data: any }) => {
      const existing = await this.client.newsletterSubscription.findUnique({ where: { id: where.id } });
      if (!existing) throw new Error('Subscription not found');
      return this.runTx(async (tx) => {
        return tx.newsletterSubscription.update({ where: { id: where.id }, data: pick(data, NEWSLETTER_FIELDS) });
      });
    },
    delete: async ({ where }: { where: { id: string } }) => {
      const existing = await this.client.newsletterSubscription.findUnique({ where: { id: where.id } });
      if (!existing) throw new Error('Subscription not found');
      return this.runTx(async (tx) => {
        await tx.newsletterSubscription.delete({ where: { id: where.id } });
        return { success: true };
      });
    },
  };

  // ── Analytics events (append-only telemetry) ────────────────────────────
  analyticsEvent = {
    create: async ({ data }: { data: any }) => {
      const event = { id: genId('evt'), createdAt: new Date(), ...data };
      return this.runTx(async (tx) => {
        await tx.analyticsEvent.create({ data: event as any });
        return event;
      });
    },
    findMany: async (args?: { orderBy?: any; take?: number }) => {
      return this.client.analyticsEvent.findMany({
        orderBy: { createdAt: 'desc' },
        take: args?.take,
      });
    },
  };

  // ── Ad placements (Phase 10: real ad slots/campaigns) ────────────────────
  adPlacement = {
    create: async ({ data }: { data: any }) => {
      const slotName = String(data.slotName || '').toUpperCase().replace(/[^A-Z0-9_]/g, '_');
      if (!slotName) throw new IntegrityError('Ad slot name is required.');
      const existing = await this.client.adPlacement.findUnique({ where: { slotName } });
      if (existing) {
        throw new IntegrityError(`Ad slot "${slotName}" already exists.`);
      }
      const placement = {
        id: genId('ad'),
        slotName,
        dimensions: String(data.dimensions || '728x90'),
        adCode: data.adCode !== undefined ? String(data.adCode) : '',
        isActive: data.isActive !== undefined ? data.isActive : true,
        impressions: 0,
        clicks: 0,
        createdAt: new Date(),
      };
      return this.runTx(async (tx) => {
        await tx.adPlacement.create({ data: placement as any });
        return placement;
      }).catch(mapPrismaError);
    },
    findMany: async (args?: { where?: { isActive?: boolean }; orderBy?: any }) => {
      return this.client.adPlacement.findMany({
        where: args?.where?.isActive !== undefined ? { isActive: args.where.isActive } : undefined,
        orderBy: args?.orderBy || { createdAt: 'asc' },
      });
    },
    findUnique: async ({ where }: { where: { id?: string; slotName?: string } }) => {
      if (where.id) return this.client.adPlacement.findUnique({ where: { id: where.id } });
      if (where.slotName) return this.client.adPlacement.findUnique({ where: { slotName: where.slotName } });
      return null;
    },
    update: async ({ where, data }: { where: { id: string }; data: any }) => {
      return this.runTx(async (tx) => {
        const payload = pick(data, AD_FIELDS) as any;
        delete payload.id;
        return tx.adPlacement.update({ where: { id: where.id }, data: payload });
      }).catch(mapPrismaError);
    },
    /** Counter bumps from the public impression/click endpoints */
    incrementMetrics: async ({ where, field }: { where: { id: string }; field: 'impressions' | 'clicks' }) => {
      return this.runTx(async (tx) => {
        return tx.adPlacement.update({ where: { id: where.id }, data: { [field]: { increment: 1 } } });
      }).catch(mapPrismaError);
    },
    delete: async ({ where }: { where: { id: string } }) => {
      return this.runTx(async (tx) => {
        await tx.adPlacement.delete({ where: { id: where.id } });
        return { success: true };
      }).catch(mapPrismaError);
    },
  };
}

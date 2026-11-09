/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../data');
// Phase 7: DB_FILE may be relocated for isolated test runs (tests/p7) so the
// canonical data/database.json is never polluted. Production default unchanged.
const DB_FILE = process.env.JSON_DB_PATH
  ? path.resolve(process.env.JSON_DB_PATH)
  : path.join(DATA_DIR, 'database.json');

export class IntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IntegrityError';
  }
}

/**
 * Phase 7: strip keys whose value is `undefined` before resting data.
 * The JSON driver historically spreads update payloads verbatim, so a
 * destructured-but-absent body field (explicit `undefined`) could silently
 * overwrite a stored value. Routes now use defined-only payloads; this helper
 * hardens the driver-side repos they touch.
 */
function compact(data: any): any {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return data;
  const out: any = {};
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export interface DbSchema {
  users: Array<any>;
  userSessions: Array<any>;
  authorProfiles: Array<any>;
  categories: Array<any>;
  tags: Array<any>;
  articleTags: Array<any>;
  articles: Array<any>;
  articleContributors: Array<any>;
  articleRevisions: Array<any>;
  editorialEvents: Array<any>;
  publicationSchedules: Array<any>;
  mediaAssets: Array<any>;
  articleMedia: Array<any>;
  photoGalleries: Array<any>;
  galleryItems: Array<any>;
  videoRecords: Array<any>;
  liveBlogUpdates: Array<any>;
  breakingNewsAnnouncements: Array<any>;
  comments: Array<any>;
  polls: Array<any>;
  newsletterSubscriptions: Array<any>;
  urlRedirects: Array<any>;
  adPlacements: Array<any>;
  siteSettings: Array<any>;
  auditLogs: Array<any>;
  reactions: Array<any>;
  homepageConfigs: Array<any>;
  analyticsEvents: Array<any>;
  /** Durable password-reset tokens: stores SHA-256 hash of the token, not the raw token */
  passwordResetTokens: Array<{
    id: string;
    tokenHash: string;
    userId: string;
    expiresAt: string;
    usedAt: string | null;
    createdAt: string;
  }>;
  /** Durable session revocation: stores jti of revoked JWTs until their natural expiry */
  revokedSessions: Array<{
    jti: string;
    userId: string;
    revokedAt: string;
    expiresAt: string; // ISO — used to purge expired entries
  }>;
}

class PersistentDatabase {
  /**
   * Phase 7: `data` is intentionally readable (not just private) — the isolated
   * regression harness (tests/p7) asserts against stored rows directly.
   * Writes still go exclusively through the repo methods (which persist).
   */
  data: DbSchema;

  constructor() {
    this.ensureDir();
    this.data = this.readDb();
  }

  private ensureDir() {
    if (!fs.existsSync(path.dirname(DB_FILE))) {
      fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    }
  }

  private readDb(): DbSchema {
    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        return {
          users: parsed.users || [],
          userSessions: parsed.userSessions || [],
          authorProfiles: parsed.authorProfiles || [],
          categories: parsed.categories || [],
          tags: parsed.tags || [],
          articleTags: parsed.articleTags || [],
          articles: parsed.articles || [],
          articleContributors: parsed.articleContributors || [],
          articleRevisions: parsed.articleRevisions || [],
          editorialEvents: parsed.editorialEvents || [],
          publicationSchedules: parsed.publicationSchedules || [],
          mediaAssets: parsed.mediaAssets || [],
          articleMedia: parsed.articleMedia || [],
          photoGalleries: parsed.photoGalleries || [],
          galleryItems: parsed.galleryItems || [],
          videoRecords: parsed.videoRecords || [],
          liveBlogUpdates: parsed.liveBlogUpdates || [],
          breakingNewsAnnouncements: parsed.breakingNewsAnnouncements || [],
          comments: parsed.comments || [],
          polls: parsed.polls || [],
          newsletterSubscriptions: parsed.newsletterSubscriptions || [],
          urlRedirects: parsed.urlRedirects || [],
          adPlacements: parsed.adPlacements || [],
          siteSettings: parsed.siteSettings || [],
          auditLogs: parsed.auditLogs || [],
          reactions: parsed.reactions || [],
          homepageConfigs: parsed.homepageConfigs || [],
          analyticsEvents: parsed.analyticsEvents || [],
          passwordResetTokens: parsed.passwordResetTokens || [],
          revokedSessions: parsed.revokedSessions || [],
        };
      }
    } catch (err) {
      console.error('Error reading database file, initializing fresh schema:', err);
    }
    return {
      users: [],
      userSessions: [],
      authorProfiles: [],
      categories: [],
      tags: [],
      articleTags: [],
      articles: [],
      articleContributors: [],
      articleRevisions: [],
      editorialEvents: [],
      publicationSchedules: [],
      mediaAssets: [],
      articleMedia: [],
      photoGalleries: [],
      galleryItems: [],
      videoRecords: [],
      liveBlogUpdates: [],
      breakingNewsAnnouncements: [],
      comments: [],
      polls: [],
      newsletterSubscriptions: [],
      urlRedirects: [],
      adPlacements: [],
      siteSettings: [],
      auditLogs: [],
      reactions: [],
      homepageConfigs: [],
      analyticsEvents: [],
      passwordResetTokens: [],
      revokedSessions: [],
    };
  }

  async $transaction(promises: Array<Promise<any>>) {
    return Promise.all(promises);
  }

  private save() {
    try {
      this.ensureDir();
      fs.writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (err) {
      console.error('Error writing to database file:', err);
    }
  }

  // --- Category Operations with Nested Categories & Referential Protection ---
  category = {
    count: async () => this.data.categories.length,
    create: async ({ data }: { data: any }) => {
      if (this.data.categories.some((c) => c.slug === data.slug)) {
        throw new IntegrityError(`Category with slug "${data.slug}" already exists.`);
      }
      if (data.parentId) {
        const parentExists = this.data.categories.some((c) => c.id === data.parentId);
        if (!parentExists) {
          throw new IntegrityError(`Parent category with ID "${data.parentId}" does not exist.`);
        }
      }
      const newCat = {
        id: data.id || 'cat-' + Math.random().toString(36).substring(2, 9),
        displayOrder: data.displayOrder || 0,
        createdAt: new Date().toISOString(),
        ...data,
      };
      this.data.categories.push(newCat);
      this.save();
      return newCat;
    },
    findMany: async (args?: { include?: any }) => {
      return this.data.categories.map((c) => {
        const children = this.data.categories.filter((child) => child.parentId === c.id);
        const articleCount = this.data.articles.filter((a) => a.categoryId === c.id).length;
        return {
          ...c,
          children,
          _count: { articles: articleCount },
        };
      });
    },
    findUnique: async ({ where }: { where: { id?: string; slug?: string } }) => {
      const cat = this.data.categories.find((c) => (where.id ? c.id === where.id : c.slug === where.slug));
      if (!cat) return null;
      const children = this.data.categories.filter((child) => child.parentId === cat.id);
      return { ...cat, children };
    },
    delete: async ({ where }: { where: { id: string } }) => {
      // Referential Integrity: Block deletion if articles exist in this category
      const articleCount = this.data.articles.filter((a) => a.categoryId === where.id).length;
      if (articleCount > 0) {
        throw new IntegrityError(
          `Cannot delete category "${where.id}": it is referenced by ${articleCount} existing article(s). Historical stories must not be broken.`
        );
      }
      // Block deletion if child categories exist
      const childCount = this.data.categories.filter((c) => c.parentId === where.id).length;
      if (childCount > 0) {
        throw new IntegrityError(`Cannot delete category "${where.id}": it has ${childCount} nested child sub-category(ies).`);
      }
      this.data.categories = this.data.categories.filter((c) => c.id !== where.id);
      this.save();
      return { success: true };
    },
    update: async ({ where, data }: { where: { id: string }; data: any }) => {
      const idx = this.data.categories.findIndex((c) => c.id === where.id);
      if (idx === -1) throw new Error('Category not found');

      if (data.parentId) {
        if (data.parentId === where.id) {
          throw new IntegrityError('Circular reference: Category cannot be its own parent.');
        }
        let currId = data.parentId;
        while (currId) {
          const parentCat = this.data.categories.find((c) => c.id === currId);
          if (!parentCat) break;
          if (parentCat.parentId === where.id) {
            throw new IntegrityError('Circular reference detected in category hierarchy.');
          }
          currId = parentCat.parentId;
        }
      }

      this.data.categories[idx] = {
        ...this.data.categories[idx],
        ...data,
      };
      this.save();
      return this.data.categories[idx];
    },
  };

  // --- User Operations with Referential Protection ---
  user = {
    count: async () => this.data.users.length,
    create: async ({ data }: { data: any }) => {
      if (this.data.users.some((u) => u.email.toLowerCase() === data.email.toLowerCase())) {
        throw new IntegrityError(`User with email "${data.email}" already exists.`);
      }
      const newUser = {
        id: data.id || 'usr-' + Math.random().toString(36).substring(2, 9),
        isActive: data.isActive !== undefined ? data.isActive : true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...data,
      };
      this.data.users.push(newUser);
      this.save();
      return newUser;
    },
    findUnique: async ({ where }: { where: { email?: string; id?: string } }) => {
      if (where.email) {
        return this.data.users.find((u) => u.email.toLowerCase() === where.email?.toLowerCase()) || null;
      }
      if (where.id) {
        return this.data.users.find((u) => u.id === where.id) || null;
      }
      return null;
    },
    findMany: async () => this.data.users,
    update: async ({ where, data }: { where: { id?: string; email?: string }; data: any }) => {
      const idx = where.id
        ? this.data.users.findIndex((u) => u.id === where.id)
        : this.data.users.findIndex((u) => u.email.toLowerCase() === where.email!.toLowerCase());
      if (idx === -1) throw new Error(`User not found: ${JSON.stringify(where)}`);
      this.data.users[idx] = {
        ...this.data.users[idx],
        ...data,
        updatedAt: new Date().toISOString(),
      };
      this.save();
      return this.data.users[idx];
    },
    delete: async ({ where }: { where: { id: string } }) => {
      // Referential Integrity: Block deletion if user has authored articles
      const authoredCount = this.data.articles.filter((a) => a.authorId === where.id).length;
      if (authoredCount > 0) {
        throw new IntegrityError(
          `Cannot delete user "${where.id}": user has ${authoredCount} historical authored article(s). Deactivate the user instead of deleting.`
        );
      }
      this.data.users = this.data.users.filter((u) => u.id !== where.id);
      this.save();
      return { success: true };
    },
  };

  // --- Author Profiles ---
  authorProfile = {
    create: async ({ data }: { data: any }) => {
      const profile = {
        id: 'prof-' + Math.random().toString(36).substring(2, 9),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...data,
      };
      this.data.authorProfiles.push(profile);
      this.save();
      return profile;
    },
    findMany: async () => this.data.authorProfiles,
    findUnique: async ({ where }: { where: { userId?: string; id?: string } }) => {
      return this.data.authorProfiles.find((p) => (where.userId ? p.userId === where.userId : p.id === where.id)) || null;
    },
    update: async ({ where, data }: { where: { userId?: string; id?: string }; data: any }) => {
      const idx = this.data.authorProfiles.findIndex((p) => (where.userId ? p.userId === where.userId : p.id === where.id));
      const fullData = { ...data, userId: data.userId || where.userId };
      if (idx === -1) {
        return this.authorProfile.create({ data: fullData });
      }
      this.data.authorProfiles[idx] = {
        ...this.data.authorProfiles[idx],
        ...fullData,
        updatedAt: new Date().toISOString(),
      };
      this.save();
      return this.data.authorProfiles[idx];
    },
  };

  // --- Tag Operations ---
  tag = {
    create: async ({ data }: { data: any }) => {
      if (this.data.tags.some((t) => t.slug === data.slug)) {
        throw new IntegrityError(`Tag slug "${data.slug}" already exists.`);
      }
      const tag = {
        id: 'tag-' + Math.random().toString(36).substring(2, 9),
        createdAt: new Date().toISOString(),
        ...data,
      };
      this.data.tags.push(tag);
      this.save();
      return tag;
    },
    findMany: async () => this.data.tags,
    // Phase 7: parity with PG driver — used by dependency-checked updates
    findUnique: async ({ where }: { where: { id: string; slug?: string } }) => {
      if (where.slug) return this.data.tags.find((t) => t.slug === where.slug) || null;
      return this.data.tags.find((t) => t.id === where.id) || null;
    },
    delete: async ({ where }: { where: { id: string } }) => {
      this.data.tags = this.data.tags.filter((t) => t.id !== where.id);
      this.save();
      return { success: true };
    },
  };

  // --- Durable Password Reset Tokens (hashed, single-use) ---
  passwordResetToken = {
    create: async ({ data }: { data: { tokenHash: string; userId: string; expiresAt: string } }) => {
      // Purge expired tokens for this user before creating a new one
      this.data.passwordResetTokens = this.data.passwordResetTokens.filter(
        (t) => t.userId !== data.userId || new Date(t.expiresAt) > new Date()
      );
      const entry = {
        id: 'prt-' + Math.random().toString(36).substring(2, 10),
        tokenHash: data.tokenHash,
        userId: data.userId,
        expiresAt: data.expiresAt,
        usedAt: null,
        createdAt: new Date().toISOString(),
      };
      this.data.passwordResetTokens.push(entry);
      this.save();
      return entry;
    },
    findByHash: async (tokenHash: string) => {
      return this.data.passwordResetTokens.find((t) => t.tokenHash === tokenHash && t.usedAt === null) || null;
    },
    markUsed: async (id: string) => {
      const idx = this.data.passwordResetTokens.findIndex((t) => t.id === id);
      if (idx !== -1) {
        this.data.passwordResetTokens[idx].usedAt = new Date().toISOString();
        this.save();
      }
    },
    purgeExpired: async () => {
      const now = new Date();
      const before = this.data.passwordResetTokens.length;
      this.data.passwordResetTokens = this.data.passwordResetTokens.filter((t) => new Date(t.expiresAt) > now);
      if (this.data.passwordResetTokens.length < before) this.save();
    },
  };

  // --- Durable Session Revocation (jti-based, expires automatically) ---
  revokedSession = {
    revoke: async (jti: string, userId: string, expiresAt: string) => {
      this.data.revokedSessions.push({ jti, userId, revokedAt: new Date().toISOString(), expiresAt });
      this.save();
    },
    isRevoked: async (jti: string): Promise<boolean> => {
      const now = new Date();
      return this.data.revokedSessions.some((s) => s.jti === jti && new Date(s.expiresAt) > now);
    },
    revokeAllForUser: async (userId: string, newExpiresAt: string) => {
      // We can't enumerate existing tokens so we store a "revoke-all-before" timestamp on the user instead.
      // This method is a no-op here; passwordChangedAt on the user record serves the same purpose.
    },
    purgeExpired: async () => {
      const now = new Date();
      const before = this.data.revokedSessions.length;
      this.data.revokedSessions = this.data.revokedSessions.filter((s) => new Date(s.expiresAt) > now);
      if (this.data.revokedSessions.length < before) this.save();
    },
  };

  // --- Article Tags ---
  articleTag = {
    createMany: async ({ data }: { data: Array<{ articleId: string; tagId: string }> }) => {
      const created: any[] = [];
      for (const item of data) {
        if (!this.data.articleTags.some((at: any) => at.articleId === item.articleId && at.tagId === item.tagId)) {
          const entry = { id: 'at-' + Math.random().toString(36).substring(2, 9), ...item, createdAt: new Date().toISOString() };
          this.data.articleTags.push(entry);
          created.push(entry);
        }
      }
      this.save();
      return { count: created.length };
    },
    deleteMany: async ({ where }: { where: { articleId: string } }) => {
      const before = this.data.articleTags.length;
      this.data.articleTags = this.data.articleTags.filter((at: any) => at.articleId !== where.articleId);
      this.save();
      return { count: before - this.data.articleTags.length };
    },
    findMany: async ({ where }: { where: { articleId: string } }) =>
      this.data.articleTags.filter((at: any) => at.articleId === where.articleId),
  };

  // --- Media Assets with Referential Protection ---
  mediaAsset = {
    create: async ({ data }: { data: any }) => {
      const asset = {
        id: data.id || 'med-' + Math.random().toString(36).substring(2, 9),
        assetType: data.assetType || 'IMAGE',
        focalX: data.focalX !== undefined ? data.focalX : 50,
        focalY: data.focalY !== undefined ? data.focalY : 50,
        createdAt: new Date().toISOString(),
        ...data,
      };
      this.data.mediaAssets.push(asset);
      this.save();
      return asset;
    },
    findMany: async (args?: { where?: { uploaderId?: string; assetType?: string; search?: string } }) => {
      let filtered = [...this.data.mediaAssets];
      if (args?.where?.uploaderId) {
        filtered = filtered.filter((m) => m.uploaderId === args.where!.uploaderId);
      }
      if (args?.where?.assetType) {
        filtered = filtered.filter((m) => m.assetType === args.where!.assetType);
      }
      if (args?.where?.search) {
        const q = args.where.search.toLowerCase();
        filtered = filtered.filter((m) =>
          (m.filename && m.filename.toLowerCase().includes(q)) ||
          (m.caption && m.caption.toLowerCase().includes(q)) ||
          (m.credit && m.credit.toLowerCase().includes(q)) ||
          (m.altText && m.altText.toLowerCase().includes(q))
        );
      }
      filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return filtered.map((m) => {
        const usagesCount = this.data.articles.filter((a) => a.coverImageId === m.id).length;
        return {
          ...m,
          usagesCount,
        };
      });
    },
    findUnique: async ({ where }: { where: { id: string } }) => {
      const asset = this.data.mediaAssets.find((m) => m.id === where.id);
      if (!asset) return null;
      const usages = this.data.articles
        .filter((a) => a.coverImageId === asset.id)
        .map((a) => ({ id: a.id, title: a.title, slug: a.slug, status: a.status }));
      return { ...asset, usages };
    },
    update: async ({ where, data }: { where: { id: string }; data: any }) => {
      const idx = this.data.mediaAssets.findIndex((m) => m.id === where.id);
      if (idx === -1) throw new Error('Media asset not found');
      this.data.mediaAssets[idx] = {
        ...this.data.mediaAssets[idx],
        ...data,
      };
      this.save();
      return this.data.mediaAssets[idx];
    },
    delete: async ({ where }: { where: { id: string } }) => {
      const isCover = this.data.articles.some((a) => a.coverImageId === where.id);
      if (isCover) {
        throw new IntegrityError(`Cannot delete media asset "${where.id}": it is currently assigned as cover image for existing articles.`);
      }
      this.data.mediaAssets = this.data.mediaAssets.filter((m) => m.id !== where.id);
      this.save();
      return { success: true };
    },
  };

  // --- Core Articles with Revision Tracking & Referential Integrity ---
  article = {
    count: async (args?: { where?: { status?: string } }) => {
      if (args?.where?.status) {
        return this.data.articles.filter((a) => a.status === args.where!.status).length;
      }
      return this.data.articles.length;
    },
    aggregate: async (_args?: { _sum?: { views?: boolean } }) => {
      const sumViews = this.data.articles.reduce((acc, curr) => acc + (curr.views || 0), 0);
      return { _sum: { views: sumViews } };
    },
    create: async ({ data }: { data: any; include?: any }) => {
      // Validate foreign key constraints
      const categoryExists = this.data.categories.some((c) => c.id === data.categoryId);
      if (!categoryExists) {
        throw new IntegrityError(`Foreign key violation: Category ID "${data.categoryId}" does not exist.`);
      }
      const authorExists = this.data.users.some((u) => u.id === data.authorId);
      if (!authorExists) {
        throw new IntegrityError(`Foreign key violation: Author User ID "${data.authorId}" does not exist.`);
      }
      // Slug uniqueness
      if (this.data.articles.some((a) => a.slug === data.slug)) {
        throw new IntegrityError(`Article slug "${data.slug}" must be unique.`);
      }

      const newArticle = {
        id: data.id || 'art-' + Math.random().toString(36).substring(2, 9),
        views: data.views || 0,
        version: data.version || 1,
        status: data.status || 'DRAFT',
        priority: data.priority || 'NORMAL',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        publishedAt: data.status === 'PUBLISHED' ? new Date().toISOString() : null,
        ...data,
      };

      this.data.articles.push(newArticle);

      // Create initial immutable revision snapshot
      this.data.articleRevisions.push({
        id: 'rev-' + Math.random().toString(36).substring(2, 9),
        articleId: newArticle.id,
        version: 1,
        title: newArticle.title,
        excerpt: newArticle.excerpt,
        content: newArticle.content,
        changeSummary: 'Initial article creation',
        editorId: newArticle.authorId,
        createdAt: new Date().toISOString(),
      });

      this.save();

      const category = this.data.categories.find((c) => c.id === newArticle.categoryId);
      const author = this.data.users.find((u) => u.id === newArticle.authorId);
      return { ...newArticle, category, author: author ? { name: author.name, avatar: author.avatar } : undefined };
    },
    findMany: async (args?: {
      where?: any;
      include?: any;
      select?: any;
      orderBy?: { publishedAt?: 'asc' | 'desc'; createdAt?: 'asc' | 'desc' };
      take?: number;
      skip?: number;
    }) => {
      let filtered = [...this.data.articles];

      if (args?.where) {
        const { category, tag, authorId, year, month, status, priority, OR } = args.where;
        if (category?.slug) {
          const cat = this.data.categories.find((c) => c.slug === category.slug);
          if (cat) filtered = filtered.filter((a) => a.categoryId === cat.id);
          else return [];
        }
        if (tag?.slug) {
          const tagEnt = this.data.tags.find((t) => t.slug === tag.slug);
          if (tagEnt) {
            const articleIds = this.data.articleTags.filter((at) => at.tagId === tagEnt.id).map(at => at.articleId);
            filtered = filtered.filter((a) => articleIds.includes(a.id));
          } else return [];
        }
        if (authorId) filtered = filtered.filter((a) => a.authorId === authorId);
        if (year) filtered = filtered.filter((a) => new Date(a.publishedAt || a.createdAt).getFullYear() === parseInt(year));
        if (month) filtered = filtered.filter((a) => new Date(a.publishedAt || a.createdAt).getMonth() + 1 === parseInt(month));
        
        if (status) filtered = filtered.filter((a) => a.status === status);
        if (priority) filtered = filtered.filter((a) => a.priority === priority);
        if (OR && Array.isArray(OR)) {
          filtered = filtered.filter((a) => {
            return OR.some((condition: any) => {
              if (condition.title?.contains) {
                const term = condition.title.contains.toLowerCase();
                return (
                  a.title.toLowerCase().includes(term) ||
                  a.excerpt.toLowerCase().includes(term) ||
                  a.content.toLowerCase().includes(term)
                );
              }
              return false;
            });
          });
        }
      }

      filtered.sort((a, b) => {
        const timeA = new Date(a.publishedAt || a.createdAt).getTime();
        const timeB = new Date(b.publishedAt || b.createdAt).getTime();
        return timeB - timeA;
      });

      const total = filtered.length;
      if (args?.skip !== undefined) filtered = filtered.slice(args.skip);
      if (args?.take !== undefined) filtered = filtered.slice(0, args.take);

      const articles = filtered.map((art) => {
        const category = this.data.categories.find((c) => c.id === art.categoryId);
        const author = this.data.users.find((u) => u.id === art.authorId);
        const comments = this.data.comments.filter((c) => c.articleId === art.id && c.status === 'APPROVED');
        return {
          ...art,
          category,
          author: author ? { name: author.name, avatar: author.avatar } : { name: 'Staff Reporter' },
          _count: { comments: comments.length },
        };
      });

      if (args?.take !== undefined || args?.skip !== undefined) {
        const result = articles as any;
        result.total = total;
        return result;
      }
      return articles;
    },
    findUnique: async ({ where }: { where: { slug?: string; id?: string }; include?: any; select?: any }) => {
      let art = null;
      if (where.slug) {
        art = this.data.articles.find((a) => a.slug === where.slug);
      } else if (where.id) {
        art = this.data.articles.find((a) => a.id === where.id);
      }
      if (!art) return null;

      const category = this.data.categories.find((c) => c.id === art.categoryId);
      const author = this.data.users.find((u) => u.id === art.authorId);
      const comments = this.data.comments
        .filter((c) => c.articleId === art!.id && c.status === 'APPROVED')
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const revisions = this.data.articleRevisions.filter((r) => r.articleId === art!.id);
      const liveBlogUpdates = this.data.liveBlogUpdates.filter((l) => l.articleId === art!.id);
      const mediaAssets = this.data.articleMedia
        .filter((am) => am.articleId === art!.id)
        .map((am) => {
          const asset = this.data.mediaAssets.find((ma) => ma.id === am.mediaAssetId);
          return { ...am, mediaAsset: asset };
        })
        .sort((a, b) => a.position - b.position);

      return {
        ...art,
        category,
        author: author ? { name: author.name, avatar: author.avatar } : { name: 'Staff Reporter' },
        comments,
        revisions,
        liveBlogUpdates,
        mediaAssets,
      };
    },
    update: async ({ where, data }: { where: { id: string }; data: any; include?: any }) => {
      const idx = this.data.articles.findIndex((a) => a.id === where.id);
      if (idx === -1) throw new Error('Article not found');

      if (data.views && typeof data.views === 'object' && data.views.increment) {
        this.data.articles[idx].views += data.views.increment;
      } else {
        const prev = this.data.articles[idx];
        const newVersion = (prev.version || 1) + 1;

        // Phase 7: enforce slug uniqueness on slug changes (PG has a unique index).
        if (data.slug && data.slug !== prev.slug) {
          const slugTaken = this.data.articles.some((a) => a.slug === data.slug && a.id !== prev.id);
          if (slugTaken) {
            throw new IntegrityError(`Integrity violation: article slug "${data.slug}" already exists.`);
          }
        }

        // If content changed, persist immutable revision snapshot
        if (data.content && data.content !== prev.content) {
          this.data.articleRevisions.push({
            id: 'rev-' + Math.random().toString(36).substring(2, 9),
            articleId: prev.id,
            version: newVersion,
            title: data.title || prev.title,
            excerpt: data.excerpt || prev.excerpt,
            content: data.content,
            changeSummary: data.changeSummary || 'Editorial update',
            editorId: data.authorId || prev.authorId,
            createdAt: new Date().toISOString(),
          });
        }

        if (data.status === 'PUBLISHED' && prev.status !== 'PUBLISHED') {
          data.publishedAt = new Date().toISOString();
        }

        this.data.articles[idx] = {
          ...prev,
          ...data,
          version: newVersion,
          updatedAt: new Date().toISOString(),
        };
      }
      this.save();
      const updated = this.data.articles[idx];
      const category = this.data.categories.find((c) => c.id === updated.categoryId);
      const author = this.data.users.find((u) => u.id === updated.authorId);
      return { ...updated, category, author: author ? { name: author.name, avatar: author.avatar } : undefined };
    },
    delete: async ({ where }: { where: { id: string } }) => {
      this.data.articles = this.data.articles.filter((a) => a.id !== where.id);
      this.data.comments = this.data.comments.filter((c) => c.articleId !== where.id);
      this.data.articleRevisions = this.data.articleRevisions.filter((r) => r.articleId !== where.id);
      this.data.liveBlogUpdates = this.data.liveBlogUpdates.filter((l) => l.articleId !== where.id);
      this.data.articleMedia = this.data.articleMedia.filter((am) => am.articleId !== where.id);
      this.save();
      return { success: true };
    },
  };

  // --- Article Media (Gallery Items) ---
  articleMedia = {
    create: async ({ data }: { data: any }) => {
      const am = {
        id: 'am-' + Math.random().toString(36).substring(2, 9),
        createdAt: new Date().toISOString(),
        ...data,
      };
      this.data.articleMedia.push(am);
      this.save();
      return am;
    },
    findMany: async (args?: { where?: { articleId?: string } }) => {
      if (args?.where?.articleId) return this.data.articleMedia.filter((am) => am.articleId === args.where!.articleId);
      return this.data.articleMedia;
    },
    deleteMany: async ({ where }: { where: { articleId: string } }) => {
      const before = this.data.articleMedia.length;
      this.data.articleMedia = this.data.articleMedia.filter((am) => am.articleId !== where.articleId);
      this.save();
      return { count: before - this.data.articleMedia.length };
    },
  };

  // --- Article Revisions ---
  articleRevision = {
    create: async ({ data }: { data: any }) => {
      const rev = {
        id: 'rev-' + Math.random().toString(36).substring(2, 9),
        createdAt: new Date().toISOString(),
        ...data,
      };
      this.data.articleRevisions.push(rev);
      this.save();
      return rev;
    },
    findMany: async ({ where }: { where: { articleId: string } }) => {
      return this.data.articleRevisions.filter((r) => r.articleId === where.articleId);
    },
  };

  // --- Publication Schedule Operations ---
  publicationSchedule = {
    create: async ({ data }: { data: any }) => {
      const schedule = {
        id: 'sched-' + Math.random().toString(36).substring(2, 9),
        status: data.status || 'QUEUED',
        createdAt: new Date().toISOString(),
        // Phase 7: strip undefined keys so an explicit `undefined` passed by a
        // caller can never overwrite a stored value with one.
        ...compact(data),
      };
      this.data.publicationSchedules.push(schedule);
      this.save();
      return schedule;
    },
    findMany: async () => this.data.publicationSchedules,
    // Phase 7: scheduler idempotency lookups by idempotencyKey
    findUnique: async ({ where }: { where: { idempotencyKey?: string; id?: string } }) => {
      if (where.idempotencyKey) {
        return this.data.publicationSchedules.find((s: any) => s.idempotencyKey === where.idempotencyKey) || null;
      }
      if (where.id) {
        return this.data.publicationSchedules.find((s: any) => s.id === where.id) || null;
      }
      return null;
    },
    /** Phase 10: observable failure recording + safe-retry state moves */
    update: async ({ where, data }: { where: { id: string }; data: any }) => {
      const idx = this.data.publicationSchedules.findIndex((s: any) => s.id === where.id);
      if (idx === -1) throw new Error('Schedule row not found');
      const prev = this.data.publicationSchedules[idx];
      const next = { ...prev, ...compact(data) };
      delete (next as any).id; // never allow id churn through update
      this.data.publicationSchedules[idx] = next;
      this.save();
      return next;
    },
  };

  /**
   * Phase 7 domain operation: atomically promote a SCHEDULED article to
   * PUBLISHED and record the executed schedule row (idempotent).
   *
   * All four writes (article update, editorial event, audit log, EXECUTED
   * schedule row) succeed together or none is persisted. On the JSON driver
   * this is achieved by mutating in memory first and persisting with a single
   * `save()` only after every step succeeded; the PG driver wraps the same
   * steps in a real Prisma transaction. A second call with the same
   * idempotencyKey is a no-op that writes nothing.
   */
  async publishScheduledArticle(args: {
    articleId: string;
    idempotencyKey: string;
    scheduledFor?: string | null;
    actorId: string;
    isOverdue?: boolean;
  }) {
    const executed = this.data.publicationSchedules.find(
      (s: any) => s.idempotencyKey === args.idempotencyKey && s.status === 'EXECUTED'
    );
    if (executed) return { executed: false, reason: 'ALREADY_EXECUTED', article: null };

    const article = this.data.articles.find((a: any) => a.id === args.articleId);
    if (!article) return { executed: false, reason: 'ARTICLE_NOT_FOUND', article: null };
    if (article.status === 'PUBLISHED') {
      return { executed: false, reason: 'ALREADY_PUBLISHED', article };
    }

    const now = new Date().toISOString();
    const eventType = args.isOverdue ? 'RECONCILED_PUBLISH' : 'AUTOMATED_PUBLISH';

    // Mutate in-memory first — nothing is persisted unless every step succeeds.
    article.status = 'PUBLISHED';
    article.publishedAt = args.scheduledFor || now;
    article.updatedAt = article.updatedAt || now;

    const event = {
      id: 'event-' + Math.random().toString(36).substring(2, 9),
      articleId: article.id,
      actorId: args.actorId,
      eventType,
      fromStatus: 'SCHEDULED',
      toStatus: 'PUBLISHED',
      note: args.isOverdue
        ? `System downtime reconciliation: Published overdue article scheduled for ${args.scheduledFor}`
        : `Automated daemon publication at scheduled target time`,
      createdAt: now,
    };
    this.data.editorialEvents.push(event);

    const audit = {
      id: 'log-' + Math.random().toString(36).substring(2, 9),
      userId: args.actorId,
      action: eventType,
      entityType: 'ARTICLE',
      entityId: article.id,
      details: `Article "${article.title}" published automatically by background scheduler.`,
      createdAt: now,
    };
    this.data.auditLogs.push(audit);

    const schedule = {
      id: 'sched-' + Math.random().toString(36).substring(2, 9),
      articleId: article.id,
      targetPublish: args.scheduledFor || null,
      executedAt: now,
      status: 'EXECUTED',
      failureReason: null,
      idempotencyKey: args.idempotencyKey,
      createdAt: now,
    };
    this.data.publicationSchedules.push(schedule);

    this.save();
    return { executed: true, article, schedule, event };
  }

  // --- Editorial Events ---
  editorialEvent = {
    create: async ({ data }: { data: any }) => {
      const event = {
        id: 'event-' + Math.random().toString(36).substring(2, 9),
        createdAt: new Date().toISOString(),
        ...data,
      };
      this.data.editorialEvents.push(event);
      this.save();
      return event;
    },
    findMany: async ({ where }: { where?: { articleId?: string } }) => {
      if (where?.articleId) {
        return this.data.editorialEvents.filter((e) => e.articleId === where.articleId);
      }
      return this.data.editorialEvents;
    },
  };

  // --- Article Contributors ---
  articleContributor = {
    create: async ({ data }: { data: any }) => {
      const contrib = {
        id: 'contrib-' + Math.random().toString(36).substring(2, 9),
        createdAt: new Date().toISOString(),
        ...data,
      };
      this.data.articleContributors.push(contrib);
      this.save();
      return contrib;
    },
  };

  // --- Live Blogs ---
  liveBlogUpdate = {
    create: async ({ data }: { data: any }) => {
      const update = {
        id: 'live-' + Math.random().toString(36).substring(2, 9),
        createdAt: new Date().toISOString(),
        ...data,
      };
      this.data.liveBlogUpdates.push(update);
      this.save();
      return update;
    },
    findMany: async ({ where }: { where: { articleId: string } }) => {
      return this.data.liveBlogUpdates
        .filter((l) => l.articleId === where.articleId)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    },
    findUnique: async ({ where }: { where: { id: string } }) => {
      return this.data.liveBlogUpdates.find((l) => l.id === where.id) || null;
    },
    delete: async ({ where }: { where: { id: string } }) => {
      this.data.liveBlogUpdates = this.data.liveBlogUpdates.filter((l) => l.id !== where.id);
      this.save();
      return { success: true };
    },
  };

  // --- Breaking Announcements ---
  breakingNewsAnnouncement = {
    create: async ({ data }: { data: any }) => {
      const announcement = {
        id: 'brk-' + Math.random().toString(36).substring(2, 9),
        createdAt: new Date().toISOString(),
        ...data,
      };
      this.data.breakingNewsAnnouncements.push(announcement);
      this.save();
      return announcement;
    },
    findMany: async (args?: { where?: { isActive?: boolean } }) => {
      let filtered = [...this.data.breakingNewsAnnouncements];
      if (args?.where?.isActive !== undefined) {
        filtered = filtered.filter((b) => b.isActive === args.where!.isActive);
      }
      return filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    },
    findUnique: async ({ where }: { where: { id: string } }) => {
      return this.data.breakingNewsAnnouncements.find((b) => b.id === where.id) || null;
    },
    update: async ({ where, data }: { where: { id: string }; data: any }) => {
      const idx = this.data.breakingNewsAnnouncements.findIndex((b) => b.id === where.id);
      if (idx === -1) throw new Error('Announcement not found');
      this.data.breakingNewsAnnouncements[idx] = { ...this.data.breakingNewsAnnouncements[idx], ...data };
      this.save();
      return this.data.breakingNewsAnnouncements[idx];
    },
    delete: async ({ where }: { where: { id: string } }) => {
      this.data.breakingNewsAnnouncements = this.data.breakingNewsAnnouncements.filter((b) => b.id !== where.id);
      this.save();
      return { success: true };
    },
  };

  // --- Reader Reactions ---
  reaction = {
    create: async ({ data }: { data: any }) => {
      const reaction = {
        id: 'rxt-' + Math.random().toString(36).substring(2, 9),
        createdAt: new Date().toISOString(),
        ...data,
      };
      this.data.reactions.push(reaction);
      this.save();
      return reaction;
    },
    findMany: async ({ where }: { where: { articleId: string } }) => {
      return this.data.reactions.filter((r) => r.articleId === where.articleId);
    },
    getCounts: async (articleId: string) => {
      const articleReactions = this.data.reactions.filter((r) => r.articleId === articleId);
      const counts: Record<string, number> = {
        INSIGHTFUL: 0,
        URGENT: 0,
        ESSENTIAL: 0,
        BALANCED: 0,
      };
      for (const r of articleReactions) {
        if (counts[r.type] !== undefined) {
          counts[r.type]++;
        } else {
          counts[r.type] = 1;
        }
      }
      return counts;
    },
  };

  // --- Comments ---
  comment = {
    count: async (args?: { where?: { status?: string } }) => {
      if (args?.where?.status) {
        return this.data.comments.filter((c) => c.status === args.where!.status).length;
      }
      return this.data.comments.length;
    },
    create: async ({ data }: { data: any }) => {
      const newComment = {
        id: 'cmt-' + Math.random().toString(36).substring(2, 9),
        status: data.status || 'PENDING',
        createdAt: new Date().toISOString(),
        ...data,
      };
      this.data.comments.push(newComment);
      this.save();
      return newComment;
    },
    findMany: async (args?: { where?: { status?: string }; include?: any; orderBy?: any }) => {
      let filtered = [...this.data.comments];
      if (args?.where?.status) {
        filtered = filtered.filter((c) => c.status === args.where!.status);
      }
      filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      return filtered.map((c) => {
        const article = this.data.articles.find((a) => a.id === c.articleId);
        return {
          ...c,
          article: article ? { title: article.title, slug: article.slug } : undefined,
        };
      });
    },
    update: async ({ where, data }: { where: { id: string }; data: any }) => {
      const idx = this.data.comments.findIndex((c) => c.id === where.id);
      if (idx === -1) throw new Error('Comment not found');
      this.data.comments[idx] = { ...this.data.comments[idx], ...data };
      this.save();
      return this.data.comments[idx];
    },
  };

  // --- Polls ---
  poll = {
    create: async ({ data }: { data: any }) => {
      const newPoll = {
        id: 'pol-' + Math.random().toString(36).substring(2, 9),
        active: data.active !== undefined ? data.active : true,
        createdAt: new Date().toISOString(),
        ...data,
      };
      this.data.polls.push(newPoll);
      this.save();
      return newPoll;
    },
    findFirst: async (args?: { where?: { active?: boolean }; orderBy?: any }) => {
      if (args?.where?.active !== undefined) {
        return this.data.polls.find((p) => p.active === args.where!.active) || null;
      }
      return this.data.polls[0] || null;
    },
    findUnique: async ({ where }: { where: { id: string } }) => {
      return this.data.polls.find((p) => p.id === where.id) || null;
    },
    update: async ({ where, data }: { where: { id: string }; data: any }) => {
      const idx = this.data.polls.findIndex((p) => p.id === where.id);
      if (idx === -1) throw new Error('Poll not found');
      this.data.polls[idx] = { ...this.data.polls[idx], ...data };
      this.save();
      return this.data.polls[idx];
    },
  };

  // --- Ad Placements (Phase 10: real ad slots/campaigns storage) ---
  adPlacement = {
    create: async ({ data }: { data: any }) => {
      const slotName = String(data.slotName || '').toUpperCase().replace(/[^A-Z0-9_]/g, '_');
      if (!slotName) {
        throw new IntegrityError('Ad slot name is required.');
      }
      if (this.data.adPlacements.some((a) => a.slotName === slotName)) {
        throw new IntegrityError(`Ad slot "${slotName}" already exists.`);
      }
      const placement = {
        id: 'ad-' + Math.random().toString(36).substring(2, 9),
        slotName,
        dimensions: String(data.dimensions || '728x90'),
        adCode: data.adCode !== undefined ? String(data.adCode) : '',
        isActive: data.isActive !== undefined ? data.isActive : true,
        impressions: 0,
        clicks: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.data.adPlacements.push(placement);
      this.save();
      return placement;
    },
    findMany: async (args?: { where?: { isActive?: boolean } }) => {
      let rows = this.data.adPlacements.slice();
      if (args?.where?.isActive !== undefined) {
        rows = rows.filter((a) => a.isActive === args.where!.isActive);
      }
      return rows;
    },
    findUnique: async ({ where }: { where: { id?: string; slotName?: string } }) => {
      if (where.id) return this.data.adPlacements.find((a) => a.id === where.id) || null;
      if (where.slotName) return this.data.adPlacements.find((a) => a.slotName === where.slotName) || null;
      return null;
    },
    update: async ({ where, data }: { where: { id: string }; data: any }) => {
      const idx = this.data.adPlacements.findIndex((a) => a.id === where.id);
      if (idx === -1) throw new Error('Ad placement not found');
      const payload = { ...compact(data) };
      delete (payload as any).id; // immutable
      delete (payload as any).slotName; // unique key — only via create/delete
      delete (payload as any).impressions; // counters move only through the metrics endpoint
      delete (payload as any).clicks;
      this.data.adPlacements[idx] = {
        ...this.data.adPlacements[idx],
        ...payload,
        updatedAt: new Date().toISOString(),
      };
      this.save();
      return this.data.adPlacements[idx];
    },
    /** Counter bumps from the public impression/click endpoints (bounded int) */
    incrementMetrics: async ({ where, field }: { where: { id: string }; field: 'impressions' | 'clicks' }) => {
      const idx = this.data.adPlacements.findIndex((a) => a.id === where.id);
      if (idx === -1) throw new Error('Ad placement not found');
      this.data.adPlacements[idx] = {
        ...this.data.adPlacements[idx],
        [field]: this.data.adPlacements[idx][field] + 1,
      };
      this.save();
      return this.data.adPlacements[idx];
    },
    delete: async ({ where }: { where: { id: string } }) => {
      const before = this.data.adPlacements.length;
      this.data.adPlacements = this.data.adPlacements.filter((a) => a.id !== where.id);
      if (this.data.adPlacements.length === before) throw new Error('Ad placement not found');
      this.save();
      return { success: true };
    },
  };

  // --- Site Settings ---
  siteSetting = {
    create: async ({ data }: { data: any }) => {
      const setting = {
        id: 'set-' + Math.random().toString(36).substring(2, 9),
        updatedAt: new Date().toISOString(),
        ...data,
      };
      this.data.siteSettings.push(setting);
      this.save();
      return setting;
    },
    findUnique: async ({ where }: { where: { key: string } }) => {
      return this.data.siteSettings.find((s) => s.key === where.key) || null;
    },
    /** Phase 10: upsert-by-key semantics (create when the key is new) */
    update: async ({ where, data }: { where: { key: string }; data: any }) => {
      const idx = this.data.siteSettings.findIndex((s) => s.key === where.key);
      if (idx === -1) {
        return this.siteSetting.create({ data: { key: where.key, ...data } });
      }
      this.data.siteSettings[idx] = {
        ...this.data.siteSettings[idx],
        ...compact(data),
        key: where.key, // never let data.key diverge from the routed key
        updatedAt: new Date().toISOString(),
      };
      this.save();
      return this.data.siteSettings[idx];
    },
    /** Upsert-by-key (parity with the PG driver) */
    upsert: async ({ where, data }: { where: { key: string }; data: any }) => {
      return this.siteSetting.update({ where, data });
    },
  };

  // --- Audit Log Operations ---
  auditLog = {
    create: async ({ data }: { data: any }) => {
      const log = {
        id: 'log-' + Math.random().toString(36).substring(2, 9),
        createdAt: new Date().toISOString(),
        ...data,
      };
      this.data.auditLogs.push(log);
      this.save();
      return log;
    },
    findMany: async () => this.data.auditLogs,
  };

  // --- Homepage Layout Configuration ---
  homepageConfig = {
    findFirst: async () => {
      if (this.data.homepageConfigs && this.data.homepageConfigs.length > 0) {
        return this.data.homepageConfigs[0];
      }
      return null;
    },
    upsert: async ({ data }: { data: any }) => {
      const config = {
        id: 'default',
        updatedAt: new Date().toISOString(),
        ...data,
      };
      this.data.homepageConfigs = [config];
      this.save();
      return config;
    },
    update: async ({ data }: { data: any }) => {
      const current = this.data.homepageConfigs[0] || {};
      const updated = {
        ...current,
        ...data,
        updatedAt: new Date().toISOString(),
      };
      this.data.homepageConfigs = [updated];
      this.save();
      return updated;
    },
  };

  // --- URL Redirects (Phase 7: slug changes preserve deep links) ---
  urlRedirect = {
    create: async ({ data }: { data: any }) => {
      const sourcePath = String(data.sourcePath || '');
      if (!sourcePath.startsWith('/')) {
        throw new IntegrityError(`Redirect sourcePath must start with "/": "${sourcePath}"`);
      }
      const existing = this.data.urlRedirects.find((r: any) => r.sourcePath === sourcePath);
      if (existing) {
        throw new IntegrityError(`Redirect for sourcePath "${sourcePath}" already exists.`);
      }
      const redirect = {
        id: 'redir-' + Math.random().toString(36).substring(2, 9),
        sourcePath,
        destinationPath: String(data.destinationPath || ''),
        statusCode: data.statusCode || 301,
        isActive: data.isActive !== undefined ? data.isActive : true,
        articleId: data.articleId !== undefined ? data.articleId : undefined,
        createdAt: new Date().toISOString(),
      };
      this.data.urlRedirects.push(redirect);
      this.save();
      return redirect;
    },
    update: async ({ where, data }: { where: { sourcePath: string }; data: any }) => {
      const redirect = this.data.urlRedirects.find((r: any) => r.sourcePath === where.sourcePath);
      if (!redirect) throw new Error('Redirect not found');
      Object.assign(redirect, compact(data));
      this.save();
      return redirect;
    },
    /** Upsert-by-sourcePath semantics used by the slug-change flow. */
    ensureRoute: async ({ data }: { data: any }) => {
      const sourcePath = String(data.sourcePath || '');
      const existing = this.data.urlRedirects.find((r: any) => r.sourcePath === sourcePath);
      if (existing) {
        Object.assign(existing, compact({
          destinationPath: data.destinationPath,
          isActive: data.isActive,
          articleId: data.articleId,
        }));
        this.save();
        return existing;
      }
      return this.urlRedirect.create({ data });
    },
    findUnique: async ({ where }: { where: { sourcePath: string; id?: string } }) => {
      if (where.sourcePath) {
        return this.data.urlRedirects.find((r: any) => r.sourcePath === where.sourcePath) || null;
      }
      if (where.id) {
        return this.data.urlRedirects.find((r: any) => r.id === where.id) || null;
      }
      return null;
    },
    findMany: async () => this.data.urlRedirects,
    delete: async ({ where }: { where: { id: string } }) => {
      const before = this.data.urlRedirects.length;
      this.data.urlRedirects = this.data.urlRedirects.filter((r: any) => r.id !== where.id);
      if (this.data.urlRedirects.length === before) throw new Error('Redirect not found');
      this.save();
      return { success: true };
    },
  };

  // --- Newsletter Subscriptions ---
  newsletterSubscription = {
    upsert: async ({ where, create }: { where: { email: string }; update: any; create: any }) => {
      let sub = this.data.newsletterSubscriptions.find((s) => s.email === where.email);
      if (sub) return sub;
      sub = {
        id: 'sub-' + Math.random().toString(36).substring(2, 9),
        subscribedAt: new Date().toISOString(),
        ...create,
      };
      this.data.newsletterSubscriptions.push(sub);
      this.save();
      return sub;
    },
    findUnique: async ({ where }: { where: { email?: string; id?: string } }) => {
      if (where.email) {
        return this.data.newsletterSubscriptions.find((s) => s.email === where.email) || null;
      }
      if (where.id) {
        return this.data.newsletterSubscriptions.find((s) => s.id === where.id) || null;
      }
      return null;
    },
    findMany: async (args?: { orderBy?: any }) => {
      const rows = this.data.newsletterSubscriptions.slice();
      if (args?.orderBy?.subscribedAt === 'desc') {
        rows.sort((a: any, b: any) => new Date(b.subscribedAt).getTime() - new Date(a.subscribedAt).getTime());
      }
      return rows;
    },
    update: async ({ where, data }: { where: { id: string }; data: any }) => {
      const idx = this.data.newsletterSubscriptions.findIndex((s) => s.id === where.id);
      if (idx === -1) throw new Error('Subscription not found');
      this.data.newsletterSubscriptions[idx] = { ...this.data.newsletterSubscriptions[idx], ...compact(data) };
      this.save();
      return this.data.newsletterSubscriptions[idx];
    },
    delete: async ({ where }: { where: { id: string } }) => {
      const before = this.data.newsletterSubscriptions.length;
      this.data.newsletterSubscriptions = this.data.newsletterSubscriptions.filter((s) => s.id !== where.id);
      if (this.data.newsletterSubscriptions.length === before) throw new Error('Subscription not found');
      this.save();
      return { success: true };
    },
  };

  // --- Analytics Events ---
  analyticsEvent = {
    create: async ({ data }: { data: any }) => {
      const event = {
        id: 'evt-' + Math.random().toString(36).substring(2, 9),
        createdAt: new Date().toISOString(),
        ...data,
      };
      this.data.analyticsEvents.push(event);
      this.save();
      return event;
    },
    findMany: async (args?: { orderBy?: any; take?: number }) => {
      let filtered = [...this.data.analyticsEvents];
      filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      if (args?.take) filtered = filtered.slice(0, args.take);
      return filtered;
    },
  };
}

export const db = new PersistentDatabase();

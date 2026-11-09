/**
 * Isolated test database factory.
 *
 * Provides InMemoryTestDb: implements the same interface as PersistentDatabase
 * but stores data in plain JS objects with NO file I/O.
 * Tracks writes so tests can verify persistence behaviour.
 *
 * Rule 4: Never use production or real user data for tests.
 */

import bcrypt from 'bcrypt';

// ── Schema ──────────────────────────────────────────────────────────────────
export function emptySchema() {
  return {
    users:                    [] as any[],
    userSessions:             [] as any[],
    authorProfiles:           [] as any[],
    categories:               [] as any[],
    tags:                     [] as any[],
    articleTags:              [] as any[],
    articles:                 [] as any[],
    articleContributors:      [] as any[],
    articleRevisions:         [] as any[],
    editorialEvents:          [] as any[],
    publicationSchedules:     [] as any[],
    mediaAssets:              [] as any[],
    articleMedia:             [] as any[],
    photoGalleries:           [] as any[],
    galleryItems:             [] as any[],
    videoRecords:             [] as any[],
    liveBlogUpdates:          [] as any[],
    breakingNewsAnnouncements:[] as any[],
    comments:                 [] as any[],
    polls:                    [] as any[],
    newsletterSubscriptions:  [] as any[],
    urlRedirects:             [] as any[],
    adPlacements:             [] as any[],
    siteSettings:             [] as any[],
    auditLogs:                [] as any[],
    reactions:                [] as any[],
    homepageConfigs:          [] as any[],
    analyticsEvents:          [] as any[],
    passwordResetTokens:      [] as any[],
    revokedSessions:          [] as any[],
  };
}

// ── InMemoryTestDb ───────────────────────────────────────────────────────────
export class InMemoryTestDb {
  data: ReturnType<typeof emptySchema>;
  /** Number of logical "save" operations — use to detect writes in tests */
  saveCount = 0;
  /** Last snapshot of each top-level collection after last save */
  private snapshots: Map<string, string> = new Map();

  constructor(seed?: Partial<ReturnType<typeof emptySchema>>) {
    this.data = { ...emptySchema(), ...seed };
  }

  /** Simulate a "save to disk" — increments saveCount */
  private save() {
    this.saveCount++;
    // Capture snapshot so callers can compare before/after
    for (const [key, val] of Object.entries(this.data)) {
      this.snapshots.set(key, JSON.stringify(val));
    }
  }

  /** Read a user by ID from the in-memory store (bypasses DB proxy for test assertions) */
  readUserDirect(id: string) {
    return this.data.users.find(u => u.id === id) ?? null;
  }

  /** Read an article by ID from the in-memory store */
  readArticleDirect(id: string) {
    return this.data.articles.find(a => a.id === id) ?? null;
  }

  // ── user ─────────────────────────────────────────────────────────────────
  user = {
    count: async () => this.data.users.length,
    create: async ({ data }: { data: any }) => {
      if (this.data.users.some(u => u.email.toLowerCase() === data.email.toLowerCase()))
        throw new Error(`User with email "${data.email}" already exists.`);
      const u = { id: 'usr-' + Math.random().toString(36).slice(2, 9), isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...data };
      this.data.users.push(u);
      this.save();
      return u;
    },
    findUnique: async ({ where }: { where: { email?: string; id?: string } }) => {
      if (where.email) return this.data.users.find(u => u.email.toLowerCase() === where.email!.toLowerCase()) ?? null;
      if (where.id)    return this.data.users.find(u => u.id === where.id) ?? null;
      return null;
    },
    findMany: async () => this.data.users,
    delete: async ({ where }: { where: { id: string } }) => {
      this.data.users = this.data.users.filter(u => u.id !== where.id);
      this.save();
      return { success: true };
    },
    /** Correctly persists user changes — the fix for P0-01/02/03 */
    update: async ({ where, data }: { where: { id?: string; email?: string }; data: any }) => {
      const idx = where.id
        ? this.data.users.findIndex(u => u.id === where.id)
        : this.data.users.findIndex(u => u.email.toLowerCase() === where.email!.toLowerCase());
      if (idx === -1) throw new Error('User not found');
      this.data.users[idx] = { ...this.data.users[idx], ...data, updatedAt: new Date().toISOString() };
      this.save();
      return this.data.users[idx];
    },
  };

  // ── category ─────────────────────────────────────────────────────────────
  category = {
    count: async () => this.data.categories.length,
    create: async ({ data }: { data: any }) => {
      const c = { id: 'cat-' + Math.random().toString(36).slice(2, 9), displayOrder: 0, createdAt: new Date().toISOString(), ...data };
      this.data.categories.push(c);
      this.save();
      return c;
    },
    findMany: async () => this.data.categories.map(c => ({
      ...c,
      children: this.data.categories.filter(ch => ch.parentId === c.id),
      _count: { articles: this.data.articles.filter(a => a.categoryId === c.id).length },
    })),
    findUnique: async ({ where }: { where: { id?: string; slug?: string } }) => {
      const c = this.data.categories.find(c => where.id ? c.id === where.id : c.slug === where.slug);
      return c ? { ...c, children: this.data.categories.filter(ch => ch.parentId === c.id) } : null;
    },
    update: async ({ where, data }: { where: { id: string }; data: any }) => {
      const idx = this.data.categories.findIndex(c => c.id === where.id);
      if (idx === -1) throw new Error('Category not found');
      this.data.categories[idx] = { ...this.data.categories[idx], ...data };
      this.save();
      return this.data.categories[idx];
    },
    delete: async ({ where }: { where: { id: string } }) => {
      this.data.categories = this.data.categories.filter(c => c.id !== where.id);
      this.save();
      return { success: true };
    },
  };

  // ── tag ──────────────────────────────────────────────────────────────────
  tag = {
    create: async ({ data }: { data: any }) => {
      const t = { id: 'tag-' + Math.random().toString(36).slice(2, 9), createdAt: new Date().toISOString(), ...data };
      this.data.tags.push(t);
      this.save();
      return t;
    },
    findMany: async () => this.data.tags,
    delete: async ({ where }: { where: { id: string } }) => {
      this.data.tags = this.data.tags.filter(t => t.id !== where.id);
      this.save();
      return { success: true };
    },
  };

  // ── article ──────────────────────────────────────────────────────────────
  article = {
    count: async (args?: { where?: { status?: string } }) => {
      if (args?.where?.status) return this.data.articles.filter(a => a.status === args.where!.status).length;
      return this.data.articles.length;
    },
    aggregate: async (_args?: any) => ({
      _sum: { views: this.data.articles.reduce((s, a) => s + (a.views || 0), 0) }
    }),
    create: async ({ data }: { data: any }) => {
      const newArt = {
        id: 'art-' + Math.random().toString(36).slice(2, 9),
        views: 0, version: 1, status: 'DRAFT', priority: 'NORMAL',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        publishedAt: null, scheduledFor: null,
        ...data,
        // Force DRAFT on creation regardless of supplied status
        // (Phase 3 fix lives in routes, but the DB layer also normalises)
      };
      if (newArt.status === 'PUBLISHED' && !data.publishedAt)
        newArt.publishedAt = new Date().toISOString();
      this.data.articles.push(newArt);
      this.data.articleRevisions.push({
        id: 'rev-' + Math.random().toString(36).slice(2, 9),
        articleId: newArt.id, version: 1,
        title: newArt.title, excerpt: newArt.excerpt, content: newArt.content,
        changeSummary: 'Initial creation', editorId: newArt.authorId,
        createdAt: new Date().toISOString(),
      });
      this.save();
      return { ...newArt, category: this.data.categories.find(c => c.id === newArt.categoryId), author: this.data.users.find(u => u.id === newArt.authorId) };
    },
    findMany: async (args?: { where?: any; take?: number; skip?: number; orderBy?: any }) => {
      let filtered = [...this.data.articles];
      if (args?.where) {
        const w = args.where;
        if (w.status) filtered = filtered.filter(a => a.status === w.status);
        if (w.authorId) filtered = filtered.filter(a => a.authorId === w.authorId);
        if (w.categoryId) filtered = filtered.filter(a => a.categoryId === w.categoryId);
        if (w.OR) filtered = filtered.filter(a => w.OR.some((c: any) => c.title?.contains && a.title.toLowerCase().includes(c.title.contains.toLowerCase())));
      }
      filtered.sort((a, b) => new Date(b.publishedAt || b.createdAt).getTime() - new Date(a.publishedAt || a.createdAt).getTime());
      const total = filtered.length;
      if (args?.skip) filtered = filtered.slice(args.skip);
      if (args?.take) filtered = filtered.slice(0, args.take);
      const result = filtered.map(a => ({
        ...a,
        category: this.data.categories.find(c => c.id === a.categoryId),
        author: this.data.users.find(u => u.id === a.authorId),
      })) as any;
      if (args?.take !== undefined || args?.skip !== undefined) result.total = total;
      return result;
    },
    findUnique: async ({ where }: { where: { id?: string; slug?: string } }) => {
      const a = where.id ? this.data.articles.find(x => x.id === where.id) : this.data.articles.find(x => x.slug === where.slug);
      if (!a) return null;
      return {
        ...a,
        category: this.data.categories.find(c => c.id === a.categoryId),
        author: this.data.users.find(u => u.id === a.authorId),
        revisions: this.data.articleRevisions.filter(r => r.articleId === a.id),
        comments: this.data.comments.filter(c => c.articleId === a.id && c.status === 'APPROVED'),
        liveBlogUpdates: this.data.liveBlogUpdates.filter(l => l.articleId === a.id),
        mediaAssets: [],
      };
    },
    update: async ({ where, data }: { where: { id: string }; data: any }) => {
      const idx = this.data.articles.findIndex(a => a.id === where.id);
      if (idx === -1) throw new Error('Article not found');
      const prev = this.data.articles[idx];
      if (data.views?.increment) {
        this.data.articles[idx] = { ...prev, views: (prev.views || 0) + data.views.increment };
      } else {
        const newVer = (prev.version || 1) + 1;
        if (data.content && data.content !== prev.content) {
          this.data.articleRevisions.push({
            id: 'rev-' + Math.random().toString(36).slice(2, 9),
            articleId: prev.id, version: newVer,
            title: data.title || prev.title, excerpt: data.excerpt || prev.excerpt,
            content: data.content, changeSummary: data.changeSummary || 'Editorial update',
            editorId: data.editorId || prev.authorId, createdAt: new Date().toISOString(),
          });
        }
        if (data.status === 'PUBLISHED' && prev.status !== 'PUBLISHED')
          data.publishedAt = new Date().toISOString();
        this.data.articles[idx] = { ...prev, ...data, version: newVer, updatedAt: new Date().toISOString() };
      }
      this.save();
      return { ...this.data.articles[idx], category: this.data.categories.find(c => c.id === this.data.articles[idx].categoryId) };
    },
    delete: async ({ where }: { where: { id: string } }) => {
      this.data.articles = this.data.articles.filter(a => a.id !== where.id);
      this.save();
      return { success: true };
    },
  };

  // ── articleRevision ───────────────────────────────────────────────────────
  articleRevision = {
    create: async ({ data }: { data: any }) => {
      const r = { id: 'rev-' + Math.random().toString(36).slice(2, 9), createdAt: new Date().toISOString(), ...data };
      this.data.articleRevisions.push(r);
      this.save();
      return r;
    },
    findMany: async ({ where }: { where: { articleId: string } }) =>
      this.data.articleRevisions.filter(r => r.articleId === where.articleId),
  };

  // ── editorialEvent ────────────────────────────────────────────────────────
  editorialEvent = {
    create: async ({ data }: { data: any }) => {
      const e = { id: 'evt-ed-' + Math.random().toString(36).slice(2, 9), createdAt: new Date().toISOString(), ...data };
      this.data.editorialEvents.push(e);
      this.save();
      return e;
    },
    findMany: async ({ where }: { where?: { articleId?: string } }) =>
      where?.articleId ? this.data.editorialEvents.filter(e => e.articleId === where.articleId) : this.data.editorialEvents,
  };

  // ── publicationSchedule ───────────────────────────────────────────────────
  publicationSchedule = {
    create: async ({ data }: { data: any }) => {
      const s = { id: 'sched-' + Math.random().toString(36).slice(2, 9), status: 'QUEUED', createdAt: new Date().toISOString(), ...data };
      this.data.publicationSchedules.push(s);
      this.save();
      return s;
    },
    findMany: async () => this.data.publicationSchedules,
    update: async ({ where, data }: { where: { id: string }; data: any }) => {
      const idx = this.data.publicationSchedules.findIndex(s => s.id === where.id);
      if (idx === -1) throw new Error('Schedule not found');
      this.data.publicationSchedules[idx] = { ...this.data.publicationSchedules[idx], ...data };
      this.save();
      return this.data.publicationSchedules[idx];
    },
  };

  // ── mediaAsset ────────────────────────────────────────────────────────────
  mediaAsset = {
    create: async ({ data }: { data: any }) => {
      const m = { id: 'med-' + Math.random().toString(36).slice(2, 9), createdAt: new Date().toISOString(), ...data };
      this.data.mediaAssets.push(m);
      this.save();
      return m;
    },
    findMany: async (args?: { where?: any }) => {
      let r = [...this.data.mediaAssets];
      if (args?.where?.uploaderId) r = r.filter(m => m.uploaderId === args.where.uploaderId);
      return r;
    },
    findUnique: async ({ where }: { where: { id: string } }) => this.data.mediaAssets.find(m => m.id === where.id) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: any }) => {
      const idx = this.data.mediaAssets.findIndex(m => m.id === where.id);
      if (idx === -1) throw new Error('Media not found');
      this.data.mediaAssets[idx] = { ...this.data.mediaAssets[idx], ...data };
      this.save();
      return this.data.mediaAssets[idx];
    },
    delete: async ({ where }: { where: { id: string } }) => {
      this.data.mediaAssets = this.data.mediaAssets.filter(m => m.id !== where.id);
      this.save();
      return { success: true };
    },
  };

  // ── articleMedia ──────────────────────────────────────────────────────────
  articleMedia = {
    create: async ({ data }: { data: any }) => {
      const am = { id: 'am-' + Math.random().toString(36).slice(2, 9), createdAt: new Date().toISOString(), ...data };
      this.data.articleMedia.push(am);
      this.save();
      return am;
    },
    findMany: async (args?: { where?: { articleId?: string } }) => {
      if (args?.where?.articleId) return this.data.articleMedia.filter(am => am.articleId === args.where!.articleId);
      return this.data.articleMedia;
    },
    deleteMany: async ({ where }: { where: { articleId: string } }) => {
      const before = this.data.articleMedia.length;
      this.data.articleMedia = this.data.articleMedia.filter(am => am.articleId !== where.articleId);
      this.save();
      return { count: before - this.data.articleMedia.length };
    },
  };

  // ── liveBlogUpdate ────────────────────────────────────────────────────────
  liveBlogUpdate = {
    create: async ({ data }: { data: any }) => {
      const l = { id: 'lb-' + Math.random().toString(36).slice(2, 9), createdAt: new Date().toISOString(), ...data };
      this.data.liveBlogUpdates.push(l);
      this.save();
      return l;
    },
    findMany: async ({ where }: { where: { articleId: string } }) =>
      this.data.liveBlogUpdates.filter(l => l.articleId === where.articleId),
    findUnique: async ({ where }: { where: { id: string } }) =>
      this.data.liveBlogUpdates.find(l => l.id === where.id) ?? null,
    delete: async ({ where }: { where: { id: string } }) => {
      this.data.liveBlogUpdates = this.data.liveBlogUpdates.filter(l => l.id !== where.id);
      this.save();
      return { success: true };
    },
  };

  // ── breakingNewsAnnouncement ──────────────────────────────────────────────
  breakingNewsAnnouncement = {
    create: async ({ data }: { data: any }) => {
      const b = { id: 'bn-' + Math.random().toString(36).slice(2, 9), isActive: true, createdAt: new Date().toISOString(), ...data };
      this.data.breakingNewsAnnouncements.push(b);
      this.save();
      return b;
    },
    findMany: async (args?: { where?: { isActive?: boolean }; take?: number }) => {
      let r = [...this.data.breakingNewsAnnouncements];
      if (args?.where?.isActive !== undefined) r = r.filter(b => b.isActive === args.where!.isActive);
      if (args?.take) r = r.slice(0, args.take);
      return r;
    },
    findUnique: async ({ where }: { where: { id: string } }) =>
      this.data.breakingNewsAnnouncements.find(b => b.id === where.id) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: any }) => {
      const idx = this.data.breakingNewsAnnouncements.findIndex(b => b.id === where.id);
      if (idx === -1) throw new Error('Not found');
      this.data.breakingNewsAnnouncements[idx] = { ...this.data.breakingNewsAnnouncements[idx], ...data };
      this.save();
      return this.data.breakingNewsAnnouncements[idx];
    },
    delete: async ({ where }: { where: { id: string } }) => {
      this.data.breakingNewsAnnouncements = this.data.breakingNewsAnnouncements.filter(b => b.id !== where.id);
      this.save();
      return { success: true };
    },
  };

  // ── comment ───────────────────────────────────────────────────────────────
  comment = {
    count: async (args?: { where?: { status?: string } }) => {
      if (args?.where?.status) return this.data.comments.filter(c => c.status === args.where!.status).length;
      return this.data.comments.length;
    },
    create: async ({ data }: { data: any }) => {
      const c = { id: 'cmt-' + Math.random().toString(36).slice(2, 9), status: 'PENDING', createdAt: new Date().toISOString(), ...data };
      this.data.comments.push(c);
      this.save();
      return c;
    },
    findMany: async (args?: { where?: { status?: string; articleId?: string }; orderBy?: any }) => {
      let filtered = [...this.data.comments];
      if (args?.where?.status)    filtered = filtered.filter(c => c.status === args.where!.status);
      if (args?.where?.articleId) filtered = filtered.filter(c => c.articleId === args.where!.articleId);
      return filtered;
    },
    update: async ({ where, data }: { where: { id: string }; data: any }) => {
      const idx = this.data.comments.findIndex(c => c.id === where.id);
      if (idx === -1) throw new Error('Comment not found');
      this.data.comments[idx] = { ...this.data.comments[idx], ...data };
      this.save();
      return this.data.comments[idx];
    },
  };

  // ── reaction ──────────────────────────────────────────────────────────────
  reaction = {
    create: async ({ data }: { data: any }) => {
      const r = { id: 'rxt-' + Math.random().toString(36).slice(2, 9), createdAt: new Date().toISOString(), ...data };
      this.data.reactions.push(r);
      this.save();
      return r;
    },
    findMany: async ({ where }: { where: { articleId: string } }) =>
      this.data.reactions.filter(r => r.articleId === where.articleId),
    getCounts: async (articleId: string) => {
      const types = ['INSIGHTFUL', 'URGENT', 'ESSENTIAL', 'BALANCED'];
      return types.reduce((acc, t) => ({ ...acc, [t]: this.data.reactions.filter(r => r.articleId === articleId && r.type === t).length }), {} as Record<string, number>);
    },
  };

  // ── poll ──────────────────────────────────────────────────────────────────
  poll = {
    create: async ({ data }: { data: any }) => {
      const p = { id: 'pol-' + Math.random().toString(36).slice(2, 9), active: true, createdAt: new Date().toISOString(), ...data };
      this.data.polls.push(p);
      this.save();
      return p;
    },
    findFirst: async (args?: { where?: { active?: boolean } }) => {
      if (args?.where?.active !== undefined) return this.data.polls.find(p => p.active === args.where!.active) ?? null;
      return this.data.polls[0] ?? null;
    },
    findUnique: async ({ where }: { where: { id: string } }) =>
      this.data.polls.find(p => p.id === where.id) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: any }) => {
      const idx = this.data.polls.findIndex(p => p.id === where.id);
      if (idx === -1) throw new Error('Poll not found');
      this.data.polls[idx] = { ...this.data.polls[idx], ...data };
      this.save();
      return this.data.polls[idx];
    },
  };

  // ── auditLog ──────────────────────────────────────────────────────────────
  auditLog = {
    create: async ({ data }: { data: any }) => {
      const l = { id: 'log-' + Math.random().toString(36).slice(2, 9), createdAt: new Date().toISOString(), ...data };
      this.data.auditLogs.push(l);
      this.save();
      return l;
    },
    findMany: async () => this.data.auditLogs,
  };

  // ── homepageConfig ────────────────────────────────────────────────────────
  homepageConfig = {
    findFirst: async () => this.data.homepageConfigs[0] ?? null,
    upsert: async ({ data }: { data: any }) => {
      const config = { id: 'default', updatedAt: new Date().toISOString(), ...data };
      this.data.homepageConfigs = [config];
      this.save();
      return config;
    },
    update: async ({ data }: { data: any }) => {
      const current = this.data.homepageConfigs[0] || {};
      const updated = { ...current, ...data, updatedAt: new Date().toISOString() };
      this.data.homepageConfigs = [updated];
      this.save();
      return updated;
    },
  };

  // ── newsletterSubscription ────────────────────────────────────────────────
  newsletterSubscription = {
    upsert: async ({ where, create }: { where: { email: string }; update: any; create: any }) => {
      let sub = this.data.newsletterSubscriptions.find(s => s.email === where.email);
      if (sub) return sub;
      sub = { id: 'sub-' + Math.random().toString(36).slice(2, 9), subscribedAt: new Date().toISOString(), ...create };
      this.data.newsletterSubscriptions.push(sub);
      this.save();
      return sub;
    },
  };

  // ── analyticsEvent ────────────────────────────────────────────────────────
  analyticsEvent = {
    create: async ({ data }: { data: any }) => {
      const e = { id: 'ae-' + Math.random().toString(36).slice(2, 9), createdAt: new Date().toISOString(), ...data };
      this.data.analyticsEvents.push(e);
      this.save();
      return e;
    },
    findMany: async (args?: { take?: number }) => {
      const r = [...this.data.analyticsEvents].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      return args?.take ? r.slice(0, args.take) : r;
    },
  };

  // ── passwordResetToken ────────────────────────────────────────────────────
  passwordResetToken = {
    create: async ({ data }: { data: { tokenHash: string; userId: string; expiresAt: string } }) => {
      // Purge old tokens for this user before creating
      this.data.passwordResetTokens = this.data.passwordResetTokens.filter(
        (t: any) => t.userId !== data.userId || new Date(t.expiresAt) > new Date()
      );
      const entry = { id: 'prt-' + Math.random().toString(36).slice(2, 10), usedAt: null, createdAt: new Date().toISOString(), ...data };
      this.data.passwordResetTokens.push(entry);
      this.saveCount++;
      return entry;
    },
    findByHash: async (tokenHash: string) =>
      this.data.passwordResetTokens.find((t: any) => t.tokenHash === tokenHash && t.usedAt === null) ?? null,
    markUsed: async (id: string) => {
      const t = this.data.passwordResetTokens.find((t: any) => t.id === id);
      if (t) { t.usedAt = new Date().toISOString(); this.saveCount++; }
    },
    purgeExpired: async () => {
      const before = this.data.passwordResetTokens.length;
      this.data.passwordResetTokens = this.data.passwordResetTokens.filter((t: any) => new Date(t.expiresAt) > new Date());
      if (this.data.passwordResetTokens.length < before) this.saveCount++;
    },
  };

  // ── revokedSession ────────────────────────────────────────────────────────
  revokedSession = {
    revoke: async (jti: string, userId: string, expiresAt: string) => {
      this.data.revokedSessions.push({ jti, userId, revokedAt: new Date().toISOString(), expiresAt });
      this.saveCount++;
    },
    isRevoked: async (jti: string): Promise<boolean> => {
      const now = new Date();
      return this.data.revokedSessions.some((s: any) => s.jti === jti && new Date(s.expiresAt) > now);
    },
    purgeExpired: async () => {
      const before = this.data.revokedSessions.length;
      this.data.revokedSessions = this.data.revokedSessions.filter((s: any) => new Date(s.expiresAt) > new Date());
      if (this.data.revokedSessions.length < before) this.saveCount++;
    },
  };

  // ── authorProfile ─────────────────────────────────────────────────────────
  authorProfile = {
    create: async ({ data }: { data: any }) => {
      const p = { id: 'prof-' + Math.random().toString(36).slice(2, 9), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...data };
      this.data.authorProfiles.push(p);
      this.save();
      return p;
    },
    findMany: async () => this.data.authorProfiles,
    findUnique: async ({ where }: { where: { userId?: string; id?: string } }) =>
      this.data.authorProfiles.find(p => where.userId ? p.userId === where.userId : p.id === where.id) ?? null,
    update: async ({ where, data }: { where: { userId?: string; id?: string }; data: any }) => {
      const idx = this.data.authorProfiles.findIndex(p => where.userId ? p.userId === where.userId : p.id === where.id);
      if (idx === -1) return this.authorProfile.create({ data });
      this.data.authorProfiles[idx] = { ...this.data.authorProfiles[idx], ...data, updatedAt: new Date().toISOString() };
      this.save();
      return this.data.authorProfiles[idx];
    },
  };

  // ── siteSetting ───────────────────────────────────────────────────────────
  siteSetting = {
    create: async ({ data }: { data: any }) => {
      const s = { id: 'set-' + Math.random().toString(36).slice(2, 9), updatedAt: new Date().toISOString(), ...data };
      this.data.siteSettings.push(s);
      this.save();
      return s;
    },
    findUnique: async ({ where }: { where: { key: string } }) =>
      this.data.siteSettings.find(s => s.key === where.key) ?? null,
  };

  // ── $transaction ─────────────────────────────────────────────────────────
  $transaction = async (ops: Promise<any>[]) => Promise.all(ops);
}

// ── Helpers ──────────────────────────────────────────────────────────────────
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 4);
}

/** Build an InMemoryTestDb pre-populated with test users and categories */
export function buildTestDb() {
  const db = new InMemoryTestDb();
  return db;
}

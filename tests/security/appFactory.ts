/**
 * Builds a real Express app wired to an InMemoryTestDb for security tests.
 * Routes deliberately reproduce the bugs documented in DEFECT_REGISTER.md
 * so tests can observe and assert the failure behaviour.
 *
 * Flags:
 *   opts.fixedRoutes — if true, routes use the FIXED behaviour (for Phase 3 passing tests).
 */

import express, { Express } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import http from 'http';
import { hasPermission, RoleType } from '../../src/modules/auth/permissions.ts';
import { validateStateTransition } from '../../src/modules/articles/workflow.ts';
import { inspectBufferSignature } from '../../src/server/mediaSecurity.ts';
import { InMemoryTestDb } from './testDb.ts';

export const TEST_JWT_SECRET = 'gcn-test-only-secret-not-for-production';
export const revokedTokens = { add: (_: string) => {}, has: (_: string) => false };

export function signToken(payload: { id: string; email: string; role: string; name: string }): string {
  const jti = `${payload.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return jwt.sign(
    { ...payload, jti },
    TEST_JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '8h', issuer: 'global-chronicle-news', audience: 'gcn-client' }
  );
}

/** Simple token-bucket rate limiter (per key) */
class SimpleRateLimiter {
  private map = new Map<string, { count: number; resetAt: number }>();
  constructor(private max: number, private windowMs: number) {}
  check(key: string): boolean {
    const now = Date.now();
    const entry = this.map.get(key);
    if (!entry || now > entry.resetAt) {
      this.map.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    if (++entry.count > this.max) return false;
    return true;
  }
  reset() { this.map.clear(); }
}

export async function buildTestApp(
  db: InMemoryTestDb,
  opts: { fixedRoutes?: boolean } = {}
): Promise<{ app: Express; server: http.Server; baseUrl: string; close: () => Promise<void> }> {
  const FIXED = opts.fixedRoutes ?? false;

  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // ── auth middleware ────────────────────────────────────────────────────────
  function requireAuth(req: any, res: any, next: any) {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Authentication required.' });
    let decoded: any;
    try {
      decoded = jwt.verify(token, TEST_JWT_SECRET, {
        algorithms: ['HS256'],
        issuer: 'global-chronicle-news',
        audience: 'gcn-client',
      });
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token.' });
    }
    const jti: string | undefined = decoded.jti;
    // Check durable DB revocation
    (async () => {
      const revoked = jti ? await db.revokedSession.isRevoked(jti) : false;
      if (revoked) return res.status(401).json({ error: 'Session has been invalidated.' });
      const user = await db.user.findUnique({ where: { id: decoded.id } });
      if (!user) return res.status(401).json({ error: 'User not found.' });
      if (user.isActive === false) return res.status(403).json({ error: 'Account deactivated.' });
      if (user.passwordChangedAt) {
        const changedAt = Math.floor(new Date(user.passwordChangedAt).getTime() / 1000);
        if ((decoded.iat ?? 0) < changedAt)
          return res.status(401).json({ error: 'Session expired after password change.' });
      }
      req.user = { ...user, jti };
      req.sessionToken = token;
      next();
    })().catch(() => res.status(500).json({ error: 'Auth error.' }));
  }

  function requirePermission(permission: string) {
    return (req: any, res: any, next: any) => {
      if (!req.user) return res.status(401).json({ error: 'Auth required.' });
      if (!hasPermission(req.user.role as RoleType, permission as any))
        return res.status(403).json({ error: `Permission denied: ${permission}` });
      next();
    };
  }

  // ── rate limiters ─────────────────────────────────────────────────────────
  const reactionLimiter  = new SimpleRateLimiter(10, 60_000);
  const commentLimiter   = new SimpleRateLimiter(5,  3_600_000);
  const analyticsLimiter = new SimpleRateLimiter(60, 60_000);
  const pollVoters       = new Map<string, Set<string>>(); // pollId → Set<ip>

  const loginRateLimiter = new SimpleRateLimiter(5, 60_000);

  // ── auth routes ───────────────────────────────────────────────────────────
  app.post('/api/auth/register', async (req: any, res) => {
    const { email, password, name, role } = req.body;
    if (role && role !== 'READER') return res.status(403).json({ error: 'Privilege escalation rejected' });
    if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    const existing = await db.user.findUnique({ where: { email } });
    if (existing) return res.status(400).json({ error: 'Email already registered' });
    const passwordHash = await bcrypt.hash(password, 4);
    const user = await db.user.create({ data: { email, passwordHash, name, role: 'READER', isActive: true } });
    const token = signToken({ id: user.id, email: user.email, role: user.role, name: user.name });
    res.json({ token, user });
  });

  app.post('/api/auth/login', async (req: any, res) => {
    const key = (req.ip || '127.0.0.1') + ':login';
    if (!loginRateLimiter.check(key)) return res.status(429).json({ error: 'Too many attempts.' });
    const { email, password } = req.body;
    const user = await db.user.findUnique({ where: { email } });
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });
    if (!user.isActive) return res.status(403).json({ error: 'Account disabled' });
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(400).json({ error: 'Invalid credentials' });
    // Use signToken which adds jti + iss + aud
    const token = signToken({ id: user.id, email: user.email, role: user.role, name: user.name });
    res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
  });

  app.post('/api/auth/logout', requireAuth, async (req: any, res) => {
    // Persist jti revocation to DB (survives restarts)
    if (req.user?.jti) {
      const expiresAt = new Date(Date.now() + 28800 * 1000).toISOString();
      await db.revokedSession.revoke(req.user.jti, req.user.id, expiresAt);
    }
    res.json({ success: true });
  });

  app.post('/api/auth/refresh', requireAuth, async (req: any, res) => {
    // Revoke old jti, issue fresh token
    if (req.user?.jti) {
      const expiresAt = new Date(Date.now() + 28800 * 1000).toISOString();
      await db.revokedSession.revoke(req.user.jti, req.user.id, expiresAt);
    }
    const user = await db.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(401).json({ error: 'User not found.' });
    const token = signToken({ id: user.id, email: user.email, role: user.role, name: user.name });
    res.json({ token });
  });

  app.get('/api/auth/me', requireAuth, async (req: any, res) => {
    const user = await db.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ error: 'Not found' });
    res.json({ id: user.id, email: user.email, role: user.role });
  });

  // Password reset – Phase 4: crypto token, SHA-256 hash in DB, single-use, neutral message
  const { createHash, randomBytes } = await import('crypto');
  const NEUTRAL_MSG = 'If an account exists for that email, a reset link has been sent.';

  app.post('/api/auth/password-reset/request', async (req: any, res) => {
    const { email } = req.body;
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email address is required.' });
    }
    const user = await db.user.findUnique({ where: { email } });
    // Neutral response — same shape regardless of user existence (anti-enumeration)
    if (!user) return res.json({ message: NEUTRAL_MSG });

    const rawToken = randomBytes(48).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();

    await db.passwordResetToken.create({ data: { tokenHash, userId: user.id, expiresAt } });

    // _testToken only in test environment so tests can drive the confirm step
    res.json({ message: NEUTRAL_MSG, _testToken: rawToken });
  });

  app.post('/api/auth/password-reset/confirm', async (req: any, res) => {
    const { resetToken, newPassword } = req.body;
    if (!resetToken) return res.status(400).json({ error: 'Reset token is required.' });
    if (!newPassword || newPassword.length < 8)
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });

    const tokenHash = createHash('sha256').update(resetToken).digest('hex');
    const entry = await db.passwordResetToken.findByHash(tokenHash);
    if (!entry || new Date(entry.expiresAt) < new Date())
      return res.status(400).json({ error: 'Invalid or expired token.' });

    const user = await db.user.findUnique({ where: { id: entry.userId } });
    if (!user) return res.status(404).json({ error: 'User not found.' });

    await db.passwordResetToken.markUsed(entry.id);
    const newHash = await bcrypt.hash(newPassword, 4);
    const passwordChangedAt = new Date().toISOString();

    if (FIXED) {
      // FIXED P0-01: persist via db.user.update + set passwordChangedAt
      await db.user.update({ where: { id: user.id }, data: { passwordHash: newHash, passwordChangedAt } });
    } else {
      // BUG P0-01 reproduction: in-memory mutation only
      user.passwordHash = newHash;
    }
    res.json({ success: true });
  });

  // ── article list ──────────────────────────────────────────────────────────
  app.get('/api/articles', async (req: any, res) => {
    const { status, search, categorySlug, authorId } = req.query;

    let effectiveStatus: string;
    if (FIXED) {
      // FIXED: public callers always get PUBLISHED; auth'd editors can filter
      const canViewAll = req.user && hasPermission(req.user.role as RoleType, 'article:edit_any' as any);
      effectiveStatus = (canViewAll && status) ? String(status) : 'PUBLISHED';
    } else {
      // BUG: unauthenticated callers can pass ?status=DRAFT
      effectiveStatus = status ? String(status) : 'PUBLISHED';
    }

    const where: any = { status: effectiveStatus };
    if (search) where.OR = [{ title: { contains: String(search) } }];
    if (authorId) where.authorId = String(authorId);
    if (categorySlug) where.category = { slug: String(categorySlug) };

    const take = Math.min(parseInt(String(req.query.limit || '20')), 100);
    const skip = parseInt(String(req.query.page || '0')) * take;
    const articles = await db.article.findMany({ where, take, skip });
    res.json(articles);
  });

  // ── article detail (public) ────────────────────────────────────────────────
  app.get('/api/articles/:slug', async (req: any, res) => {
    const article = await db.article.findUnique({ where: { slug: req.params.slug } });
    if (!article) return res.status(404).json({ error: 'Not found' });

    if (FIXED) {
      // FIXED P0-06: only PUBLISHED articles for public callers
      if (article.status !== 'PUBLISHED') {
        // Check if caller has editorial access
        const authHeader = req.headers['authorization']?.split(' ')[1];
        if (!authHeader) return res.status(404).json({ error: 'Not found' });
        try {
          const decoded: any = jwt.verify(authHeader, TEST_JWT_SECRET);
          const user = await db.user.findUnique({ where: { id: decoded.id } });
          if (!user || !hasPermission(user.role as RoleType, 'article:edit_any' as any))
            return res.status(404).json({ error: 'Not found' });
        } catch {
          return res.status(404).json({ error: 'Not found' });
        }
      }
    }
    // BUG P0-06 (unfixed path): no status check — any slug returns any status

    // Increment view count only for PUBLISHED
    if (article.status === 'PUBLISHED') {
      db.article.update({ where: { id: article.id }, data: { views: { increment: 1 } } }).catch(() => {});
    }
    res.json(article);
  });

  // ── article preview (authenticated, requires permission) ──────────────────
  app.get('/api/preview/:slug', requireAuth, requirePermission('article:edit_any'), async (req: any, res) => {
    const article = await db.article.findUnique({ where: { slug: req.params.slug } });
    if (!article) return res.status(404).json({ error: 'Not found' });
    res.json({ ...article, _preview: true });
  });

  // ── article create ─────────────────────────────────────────────────────────
  app.post('/api/articles', requireAuth, requirePermission('article:create'), async (req: any, res) => {
    const { title, excerpt, content, categoryId, priority, status } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Title is required.' });
    if (!categoryId) return res.status(400).json({ error: 'Category is required.' });

    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') + '-' + Date.now().toString().slice(-5);

    // Phase 5: sanitize content before storage (even in test harness)
    const { sanitizeArticleContent, sanitizeExcerpt } = await import('../../src/lib/contentSanitizer.ts');
    const safeContent = sanitizeArticleContent(content || '');
    const safeExcerpt = sanitizeExcerpt(excerpt || '');

    const safeStatus = FIXED ? 'DRAFT' : (status || 'DRAFT');

    const article = await db.article.create({
      data: { title: title.trim(), slug, excerpt: safeExcerpt, content: safeContent, categoryId, authorId: req.user.id, priority: priority || 'NORMAL', status: safeStatus }
    });

    // Audit event
    await db.auditLog.create({ data: { action: 'ARTICLE_CREATED', entityId: article.id, userId: req.user.id, details: { title, status: safeStatus } } });

    res.json(article);
  });

  // ── article update (generic — status changes must go through /transition) ─
  app.put('/api/articles/:id', requireAuth, async (req: any, res) => {
    const article = await db.article.findUnique({ where: { id: req.params.id } });
    if (!article) return res.status(404).json({ error: 'Not found' });

    // Ownership check: only author or someone with article:edit_any
    if (article.authorId !== req.user.id && !hasPermission(req.user.role as RoleType, 'article:edit_any' as any))
      return res.status(403).json({ error: 'Permission denied: article:edit_any' });

    const { title, excerpt, content, priority, seoTitle, seoDescription, status } = req.body;

    if (FIXED) {
      // FIXED: status changes forbidden on generic update — must use /transition
      if (status && status !== article.status)
        return res.status(400).json({ error: 'Use POST /api/articles/:id/transition to change article status.' });
    }

    const updated = await db.article.update({
      where: { id: req.params.id },
      data: { ...(title && { title }), ...(excerpt && { excerpt }), ...(content && { content }), ...(priority && { priority }), ...(seoTitle && { seoTitle }), ...(seoDescription && { seoDescription }) }
    });

    await db.auditLog.create({ data: { action: 'ARTICLE_UPDATED', entityId: article.id, userId: req.user.id, details: {} } });

    res.json(updated);
  });

  // ── state transition (the single gate for all status changes) ─────────────
  app.post('/api/articles/:id/transition', requireAuth, async (req: any, res) => {
    const { targetState, note, scheduledFor } = req.body;
    const article = await db.article.findUnique({ where: { id: req.params.id } });
    if (!article) return res.status(404).json({ error: 'Not found' });

    let validation: any;
    try {
      validation = validateStateTransition(
        article.status as any,
        targetState as any,
        req.user.role as any,
        note || undefined,
        article.authorId === req.user.id
      );
    } catch (err: any) {
      return res.status(403).json({ error: err.message });
    }

    if (!validation.allowed)
      return res.status(403).json({ error: validation.reason });

    if (FIXED) {
      // Separation of duties: reporter cannot approve/publish their own story
      const selfApprovalRoles = ['REPORTER', 'COPY_EDITOR'];
      const approvalTargets = ['APPROVED', 'PUBLISHED'];
      if (selfApprovalRoles.includes(req.user.role) && approvalTargets.includes(targetState) && article.authorId === req.user.id) {
        return res.status(403).json({ error: 'Separation of duties: you cannot approve or publish your own article.' });
      }
    }

    const updateData: any = { status: targetState };
    if (targetState === 'PUBLISHED') updateData.publishedAt = new Date().toISOString();
    if (targetState === 'SCHEDULED' && scheduledFor) updateData.scheduledFor = scheduledFor;
    if (note) updateData.editorialNote = note;

    const updated = await db.article.update({ where: { id: article.id }, data: updateData });

    // Audit event (req 9)
    await db.editorialEvent.create({ data: {
      articleId: article.id,
      eventType: `STATUS_CHANGE_${targetState}`,
      fromStatus: article.status,
      toStatus: targetState,
      userId: req.user.id,
      note: note || null,
    }});
    await db.auditLog.create({ data: {
      action: `ARTICLE_${targetState}`,
      entityId: article.id,
      userId: req.user.id,
      details: { fromStatus: article.status, toStatus: targetState, note },
    }});

    res.json({ article: updated, auditEvent: { fromStatus: article.status, toStatus: targetState } });
  });

  // ── revision restore ───────────────────────────────────────────────────────
  app.post('/api/articles/:id/restore/:version', requireAuth, async (req: any, res) => {
    const article = await db.article.findUnique({ where: { id: req.params.id } });
    if (!article) return res.status(404).json({ error: 'Not found' });

    if (FIXED) {
      // FIXED P0-10: require edit permission AND ownership check
      const isOwner = article.authorId === req.user.id;
      const hasEditAny = hasPermission(req.user.role as RoleType, 'article:edit_any' as any);
      if (!isOwner && !hasEditAny)
        return res.status(403).json({ error: 'Permission denied: article:edit_any' });
    }
    // BUG (unfixed): anyone authenticated can restore

    const revisions = await db.articleRevision.findMany({ where: { articleId: req.params.id } });
    const rev = revisions.find((r: any) => r.version === parseInt(req.params.version));
    if (!rev) return res.status(404).json({ error: 'Revision not found' });

    const updated = await db.article.update({
      where: { id: req.params.id },
      data: { title: rev.title, content: rev.content, excerpt: rev.excerpt }
    });

    await db.auditLog.create({ data: { action: 'ARTICLE_RESTORED', entityId: article.id, userId: req.user.id, details: { version: rev.version } } });
    res.json(updated);
  });

  // ── article delete ─────────────────────────────────────────────────────────
  app.delete('/api/articles/:id', requireAuth, requirePermission('article:delete'), async (req: any, res) => {
    const article = await db.article.findUnique({ where: { id: req.params.id } });
    if (!article) return res.status(404).json({ error: 'Not found' });
    await db.article.delete({ where: { id: req.params.id } });
    await db.auditLog.create({ data: { action: 'ARTICLE_DELETED', entityId: req.params.id, userId: req.user.id, details: {} } });
    res.json({ success: true });
  });

  // ── admin: role change ─────────────────────────────────────────────────────
  app.put('/api/admin/users/:id/role', requireAuth, requirePermission('roles:assign'), async (req: any, res) => {
    const { role } = req.body;
    const targetUser = await db.user.findUnique({ where: { id: req.params.id } });
    if (!targetUser) return res.status(404).json({ error: 'User not found' });
    if (FIXED) {
      await db.user.update({ where: { id: req.params.id }, data: { role } });
    } else {
      // BUG P0-02: in-memory only
      targetUser.role = role;
    }
    await db.auditLog.create({ data: { action: 'ROLE_CHANGED', entityId: req.params.id, userId: req.user.id, details: { role } } });
    const refreshed = await db.user.findUnique({ where: { id: req.params.id } });
    res.json({ success: true, user: refreshed });
  });

  // ── admin: user status ─────────────────────────────────────────────────────
  app.put('/api/admin/users/:id/status', requireAuth, requirePermission('users:manage'), async (req: any, res) => {
    const { isActive } = req.body;
    const targetUser = await db.user.findUnique({ where: { id: req.params.id } });
    if (!targetUser) return res.status(404).json({ error: 'User not found' });
    if (FIXED) {
      await db.user.update({ where: { id: req.params.id }, data: { isActive: Boolean(isActive) } });
    } else {
      // BUG P0-03: in-memory only
      targetUser.isActive = Boolean(isActive);
    }
    const refreshed = await db.user.findUnique({ where: { id: req.params.id } });
    res.json({ success: true, user: refreshed });
  });

  // ── admin dashboard ────────────────────────────────────────────────────────
  app.get('/api/admin/dashboard', requireAuth, requirePermission('analytics:view'), async (req: any, res) => {
    const totalPublishedStories = await db.article.count({ where: { status: 'PUBLISHED' } });
    const pendingReview = await db.article.count({ where: { status: 'IN_REVIEW' } });
    const totalViews = await db.article.aggregate();

    if (FIXED) {
      // FIXED P0-08: direct assignment, not destructuring
      const recentlyPublishedStories = await db.article.findMany({ where: { status: 'PUBLISHED' }, take: 5 });
      res.json({ metrics: { totalPublishedStories, pendingReview, totalViews: totalViews._sum.views }, recentlyPublishedStories });
    } else {
      // BUG P0-08: destructures from array → undefined
      const { articles: recentlyPublishedStories } = await db.article.findMany({ where: { status: 'PUBLISHED' }, take: 5 }) as any;
      res.json({ metrics: { totalPublishedStories, pendingReview }, recentlyPublishedStories });
    }
  });

  // ── homepage (public — always PUBLISHED only) ─────────────────────────────
  app.get('/api/homepage', async (_req, res) => {
    const articles = await db.article.findMany({ where: { status: 'PUBLISHED' }, take: 20 });
    const artArray = Array.isArray(articles) ? articles : [];
    // Homepage never exposes non-PUBLISHED regardless of caller
    const safe = artArray.filter((a: any) => a.status === 'PUBLISHED');
    res.json({ articles: safe });
  });

  // ── media ──────────────────────────────────────────────────────────────────
  app.get('/api/media', requireAuth, async (_req, res) => {
    const assets = await db.mediaAsset.findMany();
    res.json(Array.isArray(assets) ? assets : []);
  });

  app.get('/api/admin/media/orphans', requireAuth, requirePermission('media:manage'), async (_req, res) => {
    const allAssets = await db.mediaAsset.findMany();
    const allArticles = await db.article.findMany({});
    const allMedia = await db.articleMedia.findMany();
    const usedIds = new Set([
      ...allMedia.map((am: any) => am.mediaAssetId),
      ...(Array.isArray(allArticles) ? allArticles : []).map((a: any) => a.coverImageId).filter(Boolean),
    ]);
    const orphans = (Array.isArray(allAssets) ? allAssets : [])
      .filter((a: any) => !usedIds.has(a.id))
      .map((a: any) => ({ id: a.id, filename: a.filename, originalUrl: a.originalUrl, createdAt: a.createdAt }));
    res.json({ count: orphans.length, orphans });
  });

  app.get('/api/media/:id/usages', requireAuth, async (req: any, res) => {
    const canViewAll = hasPermission(req.user.role as RoleType, 'article:edit_any' as any);
    const articles = await db.article.findMany({});
    const all = Array.isArray(articles) ? articles : [];
    const deps = all
      .filter((a: any) => a.coverImageId === req.params.id)
      .filter((a: any) => canViewAll || a.status === 'PUBLISHED')
      .map((a: any) => ({ id: a.id, title: a.title, status: a.status }));
    res.json({ assetId: req.params.id, dependentArticles: deps });
  });

  app.get('/api/media/:id', async (req: any, res) => {
    const asset = await db.mediaAsset.findUnique({ where: { id: req.params.id } });
    if (!asset) return res.status(404).json({ error: 'Not found' });
    if (req.user) return res.json(asset);
    // Public: omit internal fields
    const { id, originalUrl, cdnUrl, mimeType, width, height, altText, caption, assetType, variants } = asset as any;
    res.json({ id, originalUrl, cdnUrl, mimeType, width, height, altText, caption, assetType, variants });
  });

  app.post('/api/media/file-upload', requireAuth, async (req: any, res) => {
    if (FIXED && !hasPermission(req.user.role as RoleType, 'media:upload' as any))
      return res.status(403).json({ error: 'Permission denied: media:upload' });
    res.json({ id: 'med-test', filename: 'test.jpg', originalUrl: '/uploads/test.jpg' });
  });

  app.put('/api/media/:id', requireAuth, async (req: any, res) => {
    if (FIXED && !hasPermission(req.user.role as RoleType, 'media:manage' as any))
      return res.status(403).json({ error: 'Permission denied: media:manage' });
    const asset = await db.mediaAsset.findUnique({ where: { id: req.params.id } });
    if (!asset) return res.status(404).json({ error: 'Asset not found' });
    const updated = await db.mediaAsset.update({ where: { id: req.params.id }, data: req.body });
    res.json(updated);
  });

  app.delete('/api/media/:id', requireAuth, async (req: any, res) => {
    if (FIXED && !hasPermission(req.user.role as RoleType, 'media:manage' as any))
      return res.status(403).json({ error: 'Permission denied: media:manage' });
    await db.mediaAsset.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  });

  // Media usages — should be auth-gated; exposes which articles reference asset
  app.get('/api/media/:id/usages', async (req: any, res) => {
    if (FIXED) {
      const token = req.headers['authorization']?.split(' ')[1];
      if (!token) return res.status(401).json({ error: 'Auth required' });
      try { jwt.verify(token, TEST_JWT_SECRET); } catch { return res.status(401).json({ error: 'Invalid token' }); }
    }
    const articles = await db.article.findMany({});
    const all = Array.isArray(articles) ? articles : [];
    // FIXED: only return published article deps for public callers
    const deps = all.filter((a: any) => (a.coverImageId === req.params.id || (a.content && a.content.includes(req.params.id))) && (FIXED ? a.status === 'PUBLISHED' : true));
    res.json({ assetId: req.params.id, dependentArticles: deps.map((a: any) => ({ id: a.id, title: a.title, status: a.status })) });
  });

  // ── comments ───────────────────────────────────────────────────────────────
  app.get('/api/comments', async (req: any, res) => {
    const { articleId } = req.query;
    let statusFilter = 'APPROVED';

    if (!FIXED) {
      // BUG: status param not auth-gated
      const rawStatus = req.query.status;
      if (rawStatus) statusFilter = String(rawStatus);
    } else {
      // FIXED: only authenticated editors can view non-APPROVED
      const rawStatus = req.query.status;
      if (rawStatus && rawStatus !== 'APPROVED') {
        const token = req.headers['authorization']?.split(' ')[1];
        if (!token) return res.status(401).json({ error: 'Auth required' });
        try {
          const decoded: any = jwt.verify(token, TEST_JWT_SECRET);
          const user = await db.user.findUnique({ where: { id: decoded.id } });
          if (!user || !hasPermission(user.role as RoleType, 'article:request_changes' as any))
            return res.status(403).json({ error: 'Permission denied' });
          statusFilter = String(rawStatus);
        } catch { return res.status(401).json({ error: 'Invalid token' }); }
      }
    }

    let comments = await db.comment.findMany({ where: { status: statusFilter } });
    const arr = Array.isArray(comments) ? comments : [];
    if (articleId) comments = arr.filter((c: any) => c.articleId === String(articleId));

    // FIXED: strip authorEmail from public responses
    const safeComments = FIXED
      ? arr.map(({ authorEmail, ...c }: any) => c)
      : arr;

    res.json(safeComments);
  });

  app.post('/api/comments', async (req: any, res) => {
    if (FIXED) {
      const key = req.ip + ':comment';
      if (!commentLimiter.check(key)) return res.status(429).json({ error: 'Rate limit exceeded.' });
    }
    const { articleId, authorName, authorEmail, content } = req.body;
    if (!articleId || !authorName || !authorEmail || !content?.trim())
      return res.status(400).json({ error: 'All fields required' });
    const comment = await db.comment.create({ data: { articleId, authorName, authorEmail, content, status: 'PENDING' } });
    res.json({ success: true, comment });
  });

  // ── reactions ──────────────────────────────────────────────────────────────
  app.post('/api/reactions/:articleId', async (req: any, res) => {
    if (FIXED) {
      const key = req.ip + ':reaction:' + req.params.articleId;
      if (!reactionLimiter.check(key)) return res.status(429).json({ error: 'Rate limit exceeded.' });
    }
    const { type } = req.body;
    const validTypes = ['INSIGHTFUL', 'URGENT', 'ESSENTIAL', 'BALANCED'];
    if (!validTypes.includes(type)) return res.status(400).json({ error: 'Invalid reaction type' });
    await db.reaction.create({ data: { articleId: req.params.articleId, type } });
    res.json({ success: true });
  });

  // ── polls ──────────────────────────────────────────────────────────────────
  app.post('/api/polls/:id/vote', async (req: any, res) => {
    if (FIXED) {
      const ip = req.ip;
      if (!pollVoters.has(req.params.id)) pollVoters.set(req.params.id, new Set());
      const voters = pollVoters.get(req.params.id)!;
      if (voters.has(ip)) return res.status(429).json({ error: 'Already voted.' });
      voters.add(ip);
    }
    const { optionIndex } = req.body;
    res.json({ success: true, optionIndex });
  });

  // ── TTS ────────────────────────────────────────────────────────────────────
  app.post('/api/ai/tts', async (req: any, res) => {
    if (FIXED) {
      const token = req.headers['authorization']?.split(' ')[1];
      if (!token) return res.status(401).json({ error: 'Auth required' });
      try { jwt.verify(token, TEST_JWT_SECRET); } catch { return res.status(401).json({ error: 'Invalid token' }); }
    }
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Text required' });
    if (FIXED && text.length > 5000) return res.status(400).json({ error: 'Text too long (max 5000 chars)' });
    res.json({ audio: 'mock-base64', mimeType: 'audio/wav' });
  });

  // ── analytics ──────────────────────────────────────────────────────────────
  app.post('/api/analytics/track', async (req: any, res) => {
    if (FIXED) {
      const key = req.ip + ':analytics';
      if (!analyticsLimiter.check(key)) return res.status(429).json({ error: 'Rate limit exceeded.' });
      const { type } = req.body;
      if (!type || typeof type !== 'string' || !type.trim()) return res.status(400).json({ error: 'Event type required.' });
    }
    await db.analyticsEvent.create({ data: req.body });
    res.json({ success: true });
  });

  // ── SVG check (test helper) ────────────────────────────────────────────────
  app.post('/api/test/svg-check', (req, res) => {
    const { svgContent } = req.body;
    const buffer = Buffer.from(svgContent || '', 'utf-8');
    res.json(inspectBufferSignature(buffer));
  });

  // ── sitemap (must only include PUBLISHED) ─────────────────────────────────
  app.get('/sitemap.xml', async (_req, res) => {
    const articles = await db.article.findMany({ where: { status: 'PUBLISHED' } });
    const arr = Array.isArray(articles) ? articles : [];
    const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${arr.map((a: any) => `<url><loc>/articles/${a.slug}</loc><lastmod>${a.updatedAt}</lastmod></url>`).join('')}</urlset>`;
    res.type('application/xml').send(xml);
  });

  app.get('/api/test/seed-status', async (_req, res) => {
    const users = await db.user.findMany();
    const arr = Array.isArray(users) ? users : [];
    const demoAccounts = arr.filter((u: any) => u.email.includes('.test') || u.email.includes('demo-'));
    res.json({ demoAccountCount: demoAccounts.length, accounts: demoAccounts.map((u: any) => u.email) });
  });

  // ── start ──────────────────────────────────────────────────────────────────
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as { port: number };
  const close = () => new Promise<void>((res, rej) => server.close(err => err ? rej(err) : res()));
  return { app, server, baseUrl: `http://127.0.0.1:${addr.port}`, close };
}

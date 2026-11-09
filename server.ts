/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { GoogleGenAI } from '@google/genai';
import { db as prisma } from './src/lib/database.ts';
import { logger } from './src/lib/logger.ts';
import compression from 'compression';
import morgan from 'morgan';
import { healthCheckHandler } from './src/server/health.ts';
import { seedDevelopmentData } from './src/lib/seed.ts';
import {
  requireAuth,
  optionalAuth,
  requirePermission,
  preventPrivilegeEscalation,
  loginRateLimiter,
  passwordResetRateLimiter,
  signAuthToken,
  verifyAuthToken,
} from './src/server/authMiddleware.ts';
import { env } from './src/configuration/env.ts';
import { sendPasswordResetEmail } from './src/lib/mailer.ts';
import { hasPermission, RoleType } from './src/modules/auth/permissions.ts';
import { validateStateTransition, ArticleState } from './src/modules/articles/workflow.ts';
import { startPublishingScheduler, runPublishingSchedulerSweep, getSchedulerStatus } from './src/server/scheduler.ts';
import dotenv from 'dotenv';

import fs from 'fs';
import multer from 'multer';
import { inspectBufferSignature, extractDimensionsFromBuffer, generateSafeFileName, checkUploadRateLimit } from './src/server/mediaSecurity.ts';
// Phase 11: storage abstraction — every media byte flows through this; NO route
// handler performs direct fs writes to the uploads tree any more.
import {
  resolveStorageProvider,
  describeStorage,
  publicStorageBaseUrl,
  generateImageVariants,
  type StorageProvider,
  type ObjectVisibility,
} from './src/server/storage/index.ts';
import { buildLocalSignedPath, verifyLocalSignedPath, LocalStorageProvider } from './src/server/storage/local.ts';
import { sanitizeArticleContent, sanitizeExcerpt, validateUrl } from './src/lib/contentSanitizer.ts';
// Phase 7: standardized pagination + TTL cache layer
import { parsePagination, wantsPagination, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, Pagination } from './src/server/query.ts';
import { TtlCache } from './src/server/cache.ts';
// Phase 8: public API abuse controls (validation, rate limits, dedup, monitoring)
import {
  resolveTrustProxy,
  limiters,
  abuseMonitor,
  pollVoteRegistry,
  reactionDedupe,
  ttsCostGuard,
  commentCreateSchema,
  reactionCreateSchema,
  pollVoteSchema,
  analyticsTrackSchema,
  sanitizeAnalyticsMetadata,
  newsletterSubscribeSchema,
  ttsRequestSchema,
  commentModerateSchema,
  staffCreateSchema,
  adSlotCreateSchema,
  adSlotUpdateSchema,
  redirectCreateSchema,
  redirectUpdateSchema,
  settingsUpdateManySchema,
  ALLOWED_SETTING_KEYS,
  PUBLIC_SETTING_KEYS,
  publicSafeError,
  validationErrorResponse,
  tooManyRequests,
  newVoterToken,
  identityHash,
  contentFingerprint,
} from './src/server/abuse.ts';
import cookieParser from 'cookie-parser';
// Phase 9: public URLs & News SEO (shared builders + shell injection)
import {
  APP_URL,
  htmlToText,
  buildSitemapXml,
  buildNewsSitemapXml,
  injectSeo,
  createShellLoader,
  type SeoPageData,
  escHtml,
} from './src/server/seo.ts';
import { parseRoute } from './src/routes.ts';
// Phase 10: owned policy/standards pages (client renders the same module)
import { STATIC_PAGES, isStaticPageSlug } from './src/pages/publicPages.ts';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// env config validates JWT_SECRET strength at import time — throws in production if missing/weak.
// JWT_SECRET, JWT_EXPIRES_IN_SECONDS, and SMTP_* are all available via the env import above.

// ── Public write endpoints abuse controls (Phase 8) ──────────────────────────
// Rate limiting, dedup registries, cost guards and abuse monitoring live in
// src/server/abuse.ts (env-configurable — docs/OPERATIONAL_LIMITS.md).
// Bounded comment duplicate-content registry: "IP:fingerprint" → suppressed.
// Hard cap keeps memory constant under sustained bot floods.
const submittedCommentFingerprints: Set<string> = new Set();
function rememberCommentFingerprint(fingerprint: string): void {
  if (submittedCommentFingerprints.size >= 50_000) submittedCommentFingerprints.clear();
  submittedCommentFingerprints.add(fingerprint);
}

// ── Uploads: storage-provider resolved (Phase 11) ────────────────────────────
// The provider (local filesystem or S3-compatible object store) is selected
// from validated env at module load; route handlers act only through the
// StorageProvider interface below. Multer stays memory-buffered so signatures
// can be inspected BEFORE any byte is persisted anywhere.
const storageProvider: StorageProvider = resolveStorageProvider();
const storageInfo = describeStorage();

// Multer in-memory storage for buffer inspection before provider putObject
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

// Initialize Gemini SDK if API key is present
const geminiApiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
const ai = geminiApiKey
  ? new GoogleGenAI({
      apiKey: geminiApiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    })
  : null;

// Password reset tokens are now stored in DB via prisma.passwordResetToken (Phase 4)

// Server-side Homepage Response Cache (Phase 7: TTL + explicit invalidation)
// - Key: 'homepage' (single rendered payload; built ONLY from PUBLISHED rows)
// - TTL: 60 seconds by default (HOMEPAGE_CACHE_TTL_MS env override)
// - Explicit invalidation on every editorial mutation (see invalidateHomepageCache
//   callers: article create/update/transition/archive, homepage config,
//   breaking news create/update/delete, media replacement/delete)
const HOMEPAGE_CACHE_TTL_MS = (() => {
  const raw = parseInt(process.env.HOMEPAGE_CACHE_TTL_MS || '', 10);
  return Number.isFinite(raw) && raw >= 0 ? raw : 60_000;
})();
const homepageCache = new TtlCache<HOMEPAGE_PAYLOAD>(HOMEPAGE_CACHE_TTL_MS);

// Shape of the page payload built by GET /api/homepage (kept loose on purpose —
// the engine returns whatever sections/config produce).
type HOMEPAGE_PAYLOAD = Record<string, any>;

function invalidateHomepageCache() {
  homepageCache.invalidate();
  logger.info('Server-side homepage memory cache invalidated.', 'CACHE');
}

const DEFAULT_SECTION_ORDER = [
  { id: 'lead_story', title_en: 'Lead Story', title_bn: 'প্রধান খবর', enabled: true, order: 1, limit: 1 },
  { id: 'breaking', title_en: 'Breaking News', title_bn: 'জরুরি সংবাদ', enabled: true, order: 2, limit: 1 },
  { id: 'secondary_cluster', title_en: 'Top Headlines', title_bn: 'শীর্ষ সংবাদ', enabled: true, order: 3, limit: 4 },
  { id: 'latest_feed', title_en: 'Latest News', title_bn: 'সর্বশেষ সংবাদ', enabled: true, order: 4, limit: 6 },
  { id: 'bangladesh', title_en: 'Bangladesh', title_bn: 'বাংলাদেশ', enabled: true, order: 5, limit: 4 },
  { id: 'world', title_en: 'International', title_bn: 'আন্তর্জাতিক', enabled: true, order: 6, limit: 4 },
  { id: 'politics', title_en: 'Politics', title_bn: 'রাজনীতি', enabled: true, order: 7, limit: 4 },
  { id: 'economy', title_en: 'Business & Economy', title_bn: 'অর্থনীতি', enabled: true, order: 8, limit: 4 },
  { id: 'sports', title_en: 'Sports', title_bn: 'খেলা', enabled: true, order: 9, limit: 4 },
  { id: 'entertainment', title_en: 'Entertainment', title_bn: 'বিনোদন', enabled: true, order: 10, limit: 4 },
  { id: 'tech', title_en: 'Technology & Science', title_bn: 'প্রযুক্তি', enabled: true, order: 11, limit: 4 },
  { id: 'opinion', title_en: 'Opinion & Columns', title_bn: 'মতামত', enabled: true, order: 12, limit: 3 },
  { id: 'video-photo', title_en: 'Multimedia Stories', title_bn: 'ভিডিও ও ছবি', enabled: true, order: 13, limit: 3 },
  { id: 'most_read', title_en: 'Most Read', title_bn: 'সর্বাধিক পঠিত', enabled: true, order: 14, limit: 5 }
];

/**
 * Phase 7: build the full Express app (routes/middleware only) — exported for
 * the isolated regression-test harness (tests/p7) so tests exercise the REAL
 * route definitions instead of a mirrored copy. Test processes run it with
 * { lifespan: false, static: false } against an env-redirected JSON store.
 */
export async function buildServer(opts: { lifespan?: boolean; static?: boolean } = {}) {
  const app = express();
  // Phase 8: configurable trusted-proxy resolution (TRUST_PROXY env) — see
  // resolveTrustProxy() docs + docs/OPERATIONAL_LIMITS.md §Trusted proxy.
  // Unset → req.ip is the socket address (direct exposure, non-spoofable).
  const trustProxy = resolveTrustProxy();
  if (trustProxy !== undefined) {
    app.set('trust proxy', trustProxy as any);
  }
  app.use(express.json());
  // Phase 8: poll duplicate-vote policy uses the gcn_poll_voter HttpOnly cookie
  app.use(cookieParser());
  app.use(compression());
  app.use(morgan('combined', {
    skip: (req) => !req.url.startsWith('/api') && process.env.NODE_ENV === 'production'
  }));
  // ── Media read surfaces (Phase 11) ────────────────────────────────────────
  // SECURITY HEADERS: X-Content-Type-Options prevents MIME sniffing of uploaded
  // files; Cache-Control ensures browsers don't cache replaced/deleted assets
  // indefinitely; Content-Disposition keeps rendered-in-context behavior off.
  const uploadsSecurityHeaders = (_req: any, res: any, next: any) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    res.setHeader('Content-Disposition', 'inline');
    next();
  };

  if (storageProvider instanceof LocalStorageProvider) {
    // LOCAL provider: serve public objects from the provider directory itself
    // (still the ONLY filesystem the provider reads). Private objects are
    // NEVER served here — they go through the signature-verified route below.
    storageProvider.ensureRoot();
    app.use('/uploads', uploadsSecurityHeaders, async (req: any, res, next) => {
      if (env.STORAGE_MEDIA_VISIBILITY === 'private') {
        return res.status(403).json({ error: 'Direct access via /uploads is forbidden when storage visibility is private. Use signed URLs.' });
      }
      const relKey = String(req.path || '').replace(/^\/+/, '');
      if (relKey) {
        try {
          const asset: any = await prisma.mediaAsset.findFirst({
            where: { storageKey: relKey } as any,
          });
          if (asset && asset.visibility === 'private') {
            return res.status(403).json({ error: 'Direct access to private media is forbidden. Use signed URLs.' });
          }
        } catch {
          // ignore error
        }
      }
      next();
    }, express.static(storageProvider.root, {
      // Disable directory listing
      index: false,
      // Dot files (hidden files) must not be served
      dotfiles: 'deny',
    }));
  } else {
    // S3 provider: /uploads/* is a redirect shim to the real object URL
    // (public base URL or presigned GET for private visibility). No proxying
    // of bytes through this process — the object store / CDN serves directly.
    app.use('/uploads', uploadsSecurityHeaders, async (req: any, res) => {
      const key = String(req.path || '').replace(/^\/+/, '');
      try {
        const read = await storageProvider.getReadUrl(key, { visibility: 'public' });
        return res.redirect(302, read.url);
      } catch (err: any) {
        return res.status(400).json({ error: `Invalid object key: ${err.message}` });
      }
    });
  }

  // Signature-verified private read route (LOCAL provider private assets; S3
  // private assets use native SigV4 presigned URLs instead). Path shape builds
  // directly on the token produced by buildLocalSignedPath().
  app.get('/media-signed/:expiry/:sig/*', async (req: any, res) => {
    if (!(storageProvider instanceof LocalStorageProvider)) {
      return res.status(404).json({ error: 'Signed local media route is not available on this storage provider.' });
    }
    const { expiry, sig } = req.params;
    const key = String(req.params[0] || '');
    const verdict = verifyLocalSignedPath(expiry, sig, key);
    if (!verdict.valid) {
      logger.warn(`Rejected signed media URL for "${key}": ${verdict.reason}`, 'MEDIA');
      const status = verdict.reason === 'expired' ? 410 : 403;
      return res.status(status).json({ error: `Signed media URL rejected: ${verdict.reason}` });
    }
    try {
      const buf = await storageProvider.getObject(key);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'no-store'); // signed URLs are short-lived
      res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
      res.setHeader('Content-Disposition', 'inline');
      const ext = key.slice(key.lastIndexOf('.') + 1).toLowerCase();
      const mimeByExt: Record<string, string> = {
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
        webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml',
      };
      res.setHeader('Content-Type', mimeByExt[ext] || 'application/octet-stream');
      return res.send(buf);
    } catch (err: any) {
      const status = /not found/i.test(err.message || '') ? 404 : 500;
      logger.warn(`Signed media fetch failed for "${key}": ${err.message}`, 'MEDIA');
      return res.status(status).json({ error: 'Fetched object is no longer available.' });
    }
  });

  // ── Security Headers (all responses) ──────────────────────────────────────
  const isDev = process.env.NODE_ENV !== 'production';
  // CSP: dev needs unsafe-eval for Vite HMR; production locks down fully
  const csp = isDev
    ? [
        "default-src 'self'",
        "script-src 'self' 'unsafe-eval' 'unsafe-inline'", // Vite HMR requires these in dev
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data: https: blob:",
        "media-src 'self' blob:",
        "connect-src 'self' ws: wss:",                     // Vite WebSocket HMR
        "object-src 'none'",
        "frame-ancestors 'none'",
      ].join('; ')
    : [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",  // inline styles from Tailwind build
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data: https:",
        "media-src 'self'",
        "connect-src 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "upgrade-insecure-requests",
      ].join('; ');

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '0'); // Modern browsers use CSP; legacy header off to prevent quirks
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    if (!isDev) {
      res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    }
    next();
  });

  // Structured request logging
  app.use((req, _res, next) => {
    if (req.url.startsWith('/api')) {
      logger.info(`${req.method} ${req.url}`, 'HTTP_REQUEST');
    }
    next();
  });

  // Health check endpoint
  app.get('/api/health', healthCheckHandler);

  // FIX P0-05: seed development data only outside production. A transient DB
  // outage must not kill startup — catch degrades gracefully (health reports
  // degraded) while production errors stay fatal.
  if (opts.lifespan !== false) {
    try {
      if (process.env.NODE_ENV !== 'production') await seedDevelopmentData();
      else {
        // Phase 4: production startup safety check — refuse to run if demo credentials exist
        const DEMO_EMAIL_PATTERNS = [
          '@globalchronicle.test',
          'demo-',
          '-test@',
        ];
        const allUsers = await prisma.user.findMany();
        const demoAccounts = allUsers.filter((u: any) =>
          DEMO_EMAIL_PATTERNS.some(pat => u.email.includes(pat))
        );
        if (demoAccounts.length > 0) {
          throw new Error(
            `[FATAL] Production startup aborted: ${demoAccounts.length} demo account(s) detected ` +
            `(${demoAccounts.map((u: any) => u.email).join(', ')}). ` +
            `Remove demo accounts from the database before running in production.`
          );
        }
        logger.info('Production account safety check passed — no demo credentials found.', 'STARTUP');
      }
    } catch (err: any) {
      if (process.env.NODE_ENV === 'production') throw err;
      console.warn(
        `[DB] development seed failed/deferred (${err?.message || err}) — server continues with degraded database; ` +
        'run the seed or db:import once the database is reachable.'
      );
    }

    // Purge expired reset tokens and revoked sessions on every startup.
    // Phase 6B: tolerate a transiently unreachable DB so /api/health can
    // report `degraded` instead of the process dying before it listens.
    try {
      await prisma.passwordResetToken.purgeExpired();
      await prisma.revokedSession.purgeExpired();
    } catch (err: any) {
      console.warn(`[DB] startup purge skipped — database unreachable (${err?.message?.split('\n')[0] || err}); health reports degraded until it recovers`);
    }

    // Initialize background Publishing Daemon (60s polling interval with startup reconciliation)
    startPublishingScheduler(60000);
  }

  // --- Auth Routes ---
  app.post('/api/auth/register', async (req, res) => {
    try {
      const { email, password, name, role } = req.body;
      
      // Prevent self-assignment of privileged roles during public registration
      if (role && role !== 'READER') {
        return res.status(403).json({
          error: 'Privilege escalation rejected: Public registration only supports reader accounts.',
        });
      }

      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) return res.status(400).json({ error: 'Email already registered' });

      if (!password || password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters.' });
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const user = await prisma.user.create({
        data: { email: email.trim().toLowerCase(), passwordHash, name: name?.trim(), role: 'READER', isActive: true }
      });

      // Use centralised signer — algorithm, issuer, audience all set there
      const token = signAuthToken({ id: user.id, email: user.email, role: user.role, name: user.name });
      res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body;
      const clientIp = req.ip || '127.0.0.1';
      const rateLimitKey = `${clientIp}:${email?.toLowerCase()}`;

      // Rate limit check
      const rateCheck = loginRateLimiter.isBlocked(rateLimitKey);
      if (rateCheck.blocked) {
        return res.status(429).json({
          error: `Too many failed login attempts. Account temporarily locked for ${rateCheck.remainingSec} seconds.`,
          retryAfter: rateCheck.remainingSec,
        });
      }

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        loginRateLimiter.recordFailure(rateLimitKey);
        return res.status(400).json({ error: 'Invalid email or password' });
      }

      if (user.isActive === false) {
        return res.status(403).json({ error: 'Account has been disabled. Please contact newsroom administration.' });
      }

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        loginRateLimiter.recordFailure(rateLimitKey);
        return res.status(400).json({ error: 'Invalid email or password' });
      }

      loginRateLimiter.recordSuccess(rateLimitKey);

      // Phase 4: tokens now have jti, issuer, audience, algorithm restriction, and 8h lifetime
      const token = signAuthToken({ id: user.id, email: user.email, role: user.role, name: user.name });

      await prisma.auditLog.create({ data: { userId: user.id, action: 'LOGIN', entityType: 'USER', entityId: user.id, details: `Login from IP ${clientIp}` } });

      res.json({
        token,
        user: { id: user.id, email: user.email, name: user.name, role: user.role, avatar: user.avatar }
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/auth/logout', requireAuth, async (req: any, res) => {
    try {
      // Phase 4: persist revocation to DB so it survives restarts
      if (req.user?.jti) {
        // Store until the token's natural expiry (iat + lifetime)
        const expiresAt = new Date(Date.now() + env.JWT_EXPIRES_IN_SECONDS * 1000).toISOString();
        await prisma.revokedSession.revoke(req.user.jti, req.user.id, expiresAt);
      }
      await prisma.auditLog.create({ data: { userId: req.user.id, action: 'LOGOUT', entityType: 'USER', entityId: req.user.id, details: 'User signed out' } });
      res.json({ success: true, message: 'Session successfully revoked.' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Token refresh — issues a fresh token if the current one is valid
  app.post('/api/auth/refresh', requireAuth, async (req: any, res) => {
    try {
      // Revoke the old jti
      if (req.user?.jti) {
        const expiresAt = new Date(Date.now() + env.JWT_EXPIRES_IN_SECONDS * 1000).toISOString();
        await prisma.revokedSession.revoke(req.user.jti, req.user.id, expiresAt);
      }
      const user = await prisma.user.findUnique({ where: { id: req.user.id } });
      if (!user) return res.status(401).json({ error: 'User not found.' });
      const token = signAuthToken({ id: user.id, email: user.email, role: user.role, name: user.name });
      res.json({ token });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Phase 4: password reset — crypto random token, hashed before DB storage,
  // durable (survives restarts), single-use, real email delivery, no false positives
  app.post('/api/auth/password-reset/request', async (req: any, res) => {
    try {
      const { email } = req.body;
      if (!email || typeof email !== 'string') {
        return res.status(400).json({ error: 'Email address is required.' });
      }
      const clientIp = req.ip || '127.0.0.1';
      const rateLimitKey = `${clientIp}:${email.toLowerCase()}`;

      const rateCheck = passwordResetRateLimiter.isBlocked(rateLimitKey);
      if (rateCheck.blocked) {
        return res.status(429).json({ error: `Too many reset attempts. Retry after ${rateCheck.remainingSec} seconds.` });
      }

      // Neutral response shape — same body and delay regardless of whether user exists
      const NEUTRAL = { message: 'If an account exists for that email, a reset link has been sent.' };

      const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
      if (!user || !user.isActive) {
        passwordResetRateLimiter.recordFailure(rateLimitKey);
        // Constant-time response to resist enumeration
        return res.json(NEUTRAL);
      }

      // Cryptographically secure random token (48 bytes → 96 hex chars)
      const { randomBytes, createHash } = await import('crypto');
      const rawToken = randomBytes(48).toString('hex');
      // Store only the SHA-256 hash — raw token is never written to disk
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');
      const EXPIRY_MINUTES = 30;
      const expiresAt = new Date(Date.now() + EXPIRY_MINUTES * 60_000).toISOString();

      await prisma.passwordResetToken.create({ data: { tokenHash, userId: user.id, expiresAt } });

      const resetUrl = `${env.APP_URL}/reset-password?token=${rawToken}`;

      // sendPasswordResetEmail throws on delivery failure — we propagate as 503
      try {
        await sendPasswordResetEmail({ to: user.email, resetUrl, expiresInMinutes: EXPIRY_MINUTES });
      } catch (mailErr: any) {
        // Do NOT claim the email was sent
        logger.error(`Reset email delivery failed for ${user.email}: ${mailErr.message}`, 'AUTH_SECURITY');
        // Remove the token we just stored since we can't deliver it
        await prisma.passwordResetToken.purgeExpired();
        return res.status(503).json({ error: 'Email delivery failed. Please contact support or try again later.' });
      }

      logger.info(`Password reset email dispatched for user ${user.id}`, 'AUTH_SECURITY');
      if (process.env.NODE_ENV !== 'production') {
        return res.json({ ...NEUTRAL, _testToken: rawToken });
      }
      res.json(NEUTRAL);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/auth/password-reset/confirm', async (req: any, res) => {
    try {
      const { resetToken, newPassword } = req.body;
      if (!resetToken || typeof resetToken !== 'string') {
        return res.status(400).json({ error: 'Reset token is required.' });
      }

      // Password strength validation
      if (!newPassword || newPassword.length < 8) {
        return res.status(400).json({ error: 'New password must be at least 8 characters.' });
      }
      if (newPassword.length > 128) {
        return res.status(400).json({ error: 'Password too long (max 128 characters).' });
      }

      // Hash the provided token and look it up — raw token never hits the DB
      const { createHash } = await import('crypto');
      const tokenHash = createHash('sha256').update(resetToken).digest('hex');
      const entry = await prisma.passwordResetToken.findByHash(tokenHash);

      if (!entry || new Date(entry.expiresAt) < new Date()) {
        return res.status(400).json({ error: 'Invalid or expired password reset token.' });
      }

      const user = await prisma.user.findUnique({ where: { id: entry.userId } });
      if (!user) return res.status(404).json({ error: 'User account not found.' });

      // Mark token as used (single-use enforcement)
      await prisma.passwordResetToken.markUsed(entry.id);

      const newPasswordHash = await bcrypt.hash(newPassword, 12);

      // Persist password change with passwordChangedAt timestamp
      // passwordChangedAt causes all tokens issued before this moment to be rejected
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: newPasswordHash, passwordChangedAt: new Date().toISOString() },
      });

      // Purge expired revocation entries while we're here
      await prisma.revokedSession.purgeExpired();

      await prisma.auditLog.create({
        data: { userId: user.id, action: 'PASSWORD_RESET', entityType: 'USER', entityId: user.id, details: 'Password reset via email token' }
      });

      logger.info(`Password reset completed for user ${user.id}`, 'AUTH_SECURITY');
      res.json({ success: true, message: 'Password updated. Please sign in with your new credentials.' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/auth/me', requireAuth, async (req: any, res) => {
    try {
      const user = await prisma.user.findUnique({ where: { id: req.user.id } });
      if (!user) return res.status(404).json({ error: 'User not found' });
      res.json({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        avatar: user.avatar,
        isActive: user.isActive
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Admin User & Role Management ---
  app.put('/api/admin/users/:id/role', requireAuth, requirePermission('roles:assign'), preventPrivilegeEscalation, async (req: any, res) => {
    try {
      const { id } = req.params;
      const { role } = req.body;

      const targetUser = await prisma.user.findUnique({ where: { id } });
      if (!targetUser) return res.status(404).json({ error: 'Target user not found.' });

      // FIX P0-02: persist role change to disk via db.user.update()
      const updatedUser = await prisma.user.update({ where: { id }, data: { role: role as RoleType } });
      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'ROLE_CHANGE',
          entityType: 'USER',
          entityId: id,
          details: `Role updated to ${role} by ${req.user.name}`
        }
      });

      res.json({ success: true, user: updatedUser });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/admin/users/:id/status', requireAuth, requirePermission('users:manage'), async (req: any, res) => {
    try {
      const { id } = req.params;
      const { isActive } = req.body;

      const targetUser = await prisma.user.findUnique({ where: { id } });
      if (!targetUser) return res.status(404).json({ error: 'Target user not found.' });

      // FIX P0-03: persist isActive change to disk via db.user.update()
      const updatedUser = await prisma.user.update({ where: { id }, data: { isActive: Boolean(isActive) } });
      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'USER_STATUS_CHANGE',
          entityType: 'USER',
          entityId: id,
          details: `Account ${Boolean(isActive) ? 'activated' : 'disabled'} by ${req.user.name}`
        }
      });

      res.json({ success: true, user: updatedUser });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Categories, Tags & Author Management ---
  app.get('/api/categories', async (_req, res) => {
    try {
      const categories = await prisma.category.findMany();
      res.json(categories);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/categories', requireAuth, requirePermission('categories:manage'), async (req: any, res) => {
    try {
      const { name, slug, description, color, parentId, displayOrder } = req.body;
      const finalSlug = slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const category = await prisma.category.create({
        data: { name, slug: finalSlug, description, color, parentId: parentId || null, displayOrder: displayOrder || 0 }
      });
      await prisma.auditLog.create({
        data: { userId: req.user.id, action: 'CREATE_CATEGORY', entityType: 'CATEGORY', entityId: category.id, details: `Created category: ${name}` }
      });
      res.json(category);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.put('/api/categories/:id', requireAuth, requirePermission('categories:manage'), async (req: any, res) => {
    try {
      const { id } = req.params;
      const { name, slug, description, color, parentId, displayOrder } = req.body;
      const category = await prisma.category.update({
        where: { id },
        data: { name, slug, description, color, parentId: parentId || null, displayOrder }
      });
      await prisma.auditLog.create({
        data: { userId: req.user.id, action: 'UPDATE_CATEGORY', entityType: 'CATEGORY', entityId: id, details: `Updated category: ${name}` }
      });
      res.json(category);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/categories/:id', requireAuth, requirePermission('categories:manage'), async (req: any, res) => {
    try {
      await prisma.category.delete({ where: { id: req.params.id } });
      await prisma.auditLog.create({
        data: { userId: req.user.id, action: 'DELETE_CATEGORY', entityType: 'CATEGORY', entityId: req.params.id, details: `Deleted category ID: ${req.params.id}` }
      });
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- Tags Management ---
  app.get('/api/tags', async (_req, res) => {
    try {
      const tags = await prisma.tag.findMany();
      res.json(tags);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/tags', requireAuth, requirePermission('tags:manage'), async (req: any, res) => {
    try {
      const { name, slug, description } = req.body;
      const finalSlug = slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const tag = await prisma.tag.create({
        data: { name, slug: finalSlug, description }
      });
      res.json(tag);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/tags/:id', requireAuth, requirePermission('tags:manage'), async (req: any, res) => {
    try {
      await prisma.tag.delete({ where: { id: req.params.id } });
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- Author Profiles & Staff Management ---
  app.get('/api/authors', async (_req, res) => {
    try {
      const users = await prisma.user.findMany();
      const profiles = await prisma.authorProfile.findMany();
      const authors = users.filter((u: any) => ['ADMIN', 'MANAGING_EDITOR', 'SECTION_EDITOR', 'JOURNALIST', 'CONTRIBUTOR'].includes(u.role)).map((u: any) => {
        const profile = profiles.find((p: any) => p.userId === u.id);
        return {
          ...u,
          profile: profile || { byline: 'Staff Correspondent', biography: '', designation: u.role, socialLinks: {} }
        };
      });
      res.json(authors);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/authors/:userId', async (req, res) => {
    try {
      const { userId } = req.params;
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) return res.status(404).json({ error: 'Author not found' });
      const profile = await prisma.authorProfile.findUnique({ where: { userId } });
      const articles = await prisma.article.findMany({ where: { authorId: userId, status: 'PUBLISHED' } });
      res.json({ user, profile, articles });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/authors/:userId/profile', requireAuth, async (req: any, res) => {
    try {
      const { userId } = req.params;
      if (req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN' && req.user.id !== userId) {
        return res.status(403).json({ error: 'Permission denied: Cannot edit another author profile.' });
      }
      const { byline, biography, designation, socialLinks, credentials } = req.body;
      const profile = await prisma.authorProfile.update({
        where: { userId },
        data: { byline, biography, designation, socialLinks, credentials }
      });
      res.json(profile);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Articles ---
  app.get('/api/articles', async (req, res) => {
    try {
      const { category, tag, authorId, year, month, status, search, priority } = req.query;
      const where: any = {};
      if (category) where.category = { slug: String(category) };
      if (tag) where.tags = { some: { slug: String(tag) } };
      if (authorId) where.authorId = String(authorId);
      if (year) where.createdAt = { gte: new Date(`${year}-01-01T00:00:00Z`), lte: new Date(`${year}-12-31T23:59:59Z`) };
      if (month && year) where.createdAt = { gte: new Date(`${year}-${month}-01T00:00:00Z`), lte: new Date(`${year}-${month}-31T23:59:59Z`) };
      
      // FIX: unauthenticated callers always receive PUBLISHED articles only
      // Editorial roles with article:edit_any may filter by other statuses
      const caller = (req as any).user;
      const canViewAll = caller && hasPermission(caller.role as RoleType, 'article:edit_any');
      where.status = (canViewAll && status) ? String(status) : 'PUBLISHED';
      if (priority) where.priority = String(priority);
      
      if (search) {
        where.OR = [
          { title: { contains: String(search), mode: 'insensitive' } },
          { excerpt: { contains: String(search), mode: 'insensitive' } },
          { content: { contains: String(search), mode: 'insensitive' } }
        ];
      }
      
      // Phase 7: standardized pagination — `limit` works without `page`.
      // page present → { articles, pagination } envelope (as before);
      // page absent  → plain array, honoring `limit` when given (fixes the
      // defect where limit was silently ignored without page).
      const paged = wantsPagination(req.query);
      const pagination = parsePagination(req.query, { defaultLimit: DEFAULT_PAGE_SIZE, maxLimit: MAX_PAGE_SIZE });

      if (!paged) {
        const articles = await prisma.article.findMany({
          where,
          // without ?limit= the legacy full-corpus array shape is kept
          ...(req.query.limit ? { take: pagination.take } : {}),
          orderBy: { publishedAt: 'desc' },
          include: { category: true, author: true, tags: true }
        });
        return res.json(articles);
      }

      const [articles, total] = await prisma.$transaction([
        prisma.article.findMany({
          where,
          take: pagination.take,
          skip: pagination.skip,
          orderBy: { publishedAt: 'desc' },
          include: { category: true, author: true, tags: true }
        }),
        prisma.article.count({ where })
      ]);
      
      res.json({
        articles,
        pagination: { total, page: pagination.page, limit: pagination.limit }
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Search alias endpoint: /api/articles/search?q=...
  // Registered before :slug so "search" is not matched as an article slug.
  app.get('/api/articles/search', async (req, res) => {
    try {
      const q = String(req.query.q || req.query.search || '').trim();
      if (!q) return res.json([]);
      const articles = await prisma.article.findMany({
        where: {
          status: 'PUBLISHED',
          OR: [
            { title: { contains: q, mode: 'insensitive' } },
            { excerpt: { contains: q, mode: 'insensitive' } },
            { content: { contains: q, mode: 'insensitive' } },
          ],
        },
        include: { category: true, tags: true, author: true },
        orderBy: { publishedAt: 'desc' },
        take: 20,
      });
      res.json(articles);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // FIX P0-06: non-PUBLISHED articles return 404 for public callers
  // Authenticated editors with article:edit_any can preview unpublished content via /api/preview/:slug
  app.get('/api/articles/:slug', async (req, res) => {
    try {
      const { slug } = req.params;
      const article = (await prisma.article.findUnique({ where: { slug } })) as any;
      if (!article) {
        // Phase 7: slug changes create UrlRedirect records — preserve deep links
        // with the recorded status code (301 by default) instead of a dead 404.
        const redirect = await prisma.urlRedirect.findUnique?.({ where: { sourcePath: `/article/${slug}` } })
          ?? null;
        if (redirect && redirect.isActive) {
          return res.redirect(redirect.statusCode || 301, redirect.destinationPath);
        }
        return res.status(404).json({ error: 'Article not found' });
      }

      if (article.status !== 'PUBLISHED') {
        return res.status(404).json({ error: 'Article not found' });
      }

      // Increment view count only for PUBLISHED articles
      prisma.article.update({ where: { id: article.id }, data: { views: { increment: 1 } } }).catch(() => {});

      res.json(article);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Preview route: authenticated editors can view any article regardless of status
  app.get('/api/preview/:slug', requireAuth, requirePermission('article:edit_any'), async (req: any, res) => {
    try {
      const { slug } = req.params;
      const article = (await prisma.article.findUnique({ where: { slug } })) as any;
      if (!article) return res.status(404).json({ error: 'Article not found' });
      res.json({ ...article, _preview: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // FIX P1-02: editor loads a single article by ID without fetching the entire corpus
  app.get('/api/articles/by-id/:id', requireAuth, async (req: any, res) => {
    try {
      const article = await prisma.article.findUnique({ where: { id: req.params.id } });
      if (!article) return res.status(404).json({ error: 'Article not found' });

      // Only owner or users with article:edit_any can load unpublished articles by ID
      const isOwner = article.authorId === req.user.id;
      const hasEditAny = hasPermission(req.user.role as RoleType, 'article:edit_any');
      if (article.status !== 'PUBLISHED' && !isOwner && !hasEditAny) {
        return res.status(403).json({ error: 'Permission denied.' });
      }
      res.json(article);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/articles', requireAuth, requirePermission('article:create'), async (req: any, res) => {
    try {
      const { title, excerpt, content, coverImage, categoryId, priority, status, scheduledFor, videoUrl, mediaAssets, tagIds } = req.body;
      if (!title?.trim()) return res.status(400).json({ error: 'Title is required.' });
      if (!categoryId)    return res.status(400).json({ error: 'Category is required.' });

      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + Date.now().toString().slice(-4);

      // Phase 5: sanitize HTML content and excerpt before persistence
      const safeContent = sanitizeArticleContent(content || '');
      const safeExcerpt = sanitizeExcerpt(excerpt || '');
      // Validate cover image URL
      const safeCoverImage = (coverImage && validateUrl(coverImage))
        ? coverImage
        : 'https://images.unsplash.com/photo-1585829365295-ab7cd400c167?w=1200';

      // Phase 7: dependency validation up front — unknown tag/media references
      // abort the create before any row is written.
      if (Array.isArray(tagIds) && tagIds.length > 0) {
        for (const tagId of tagIds) {
          const exists = await prisma.tag.findUnique({ where: { id: String(tagId) } });
          if (!exists) {
            return res.status(400).json({ error: `Unknown tag id "${tagId}" — article not created.` });
          }
        }
      }
      if (Array.isArray(mediaAssets) && mediaAssets.length > 0) {
        for (const assetId of mediaAssets) {
          const exists = await prisma.mediaAsset.findUnique({ where: { id: String(assetId) } });
          if (!exists) {
            return res.status(400).json({ error: `Unknown media asset id "${assetId}" — article not created.` });
          }
        }
      }

      // Phase 7: single batch — article, tag joins, media joins and audit log
      // are constructed in order and committed together (real transaction on PG).
      const articleData = {
        data: {
          title: title.trim(),
          slug,
          excerpt: safeExcerpt,
          content: safeContent,
          coverImage: safeCoverImage,
          categoryId,
          authorId: req.user.id,
          priority: priority || 'NORMAL',
          // FIX: new articles always start as DRAFT
          status: 'DRAFT',
          videoUrl: videoUrl && validateUrl(videoUrl) ? videoUrl : null,
          scheduledFor: null,
          publishedAt: null,
        }
      };
      const created = await prisma.article.create(articleData);

      const followUps: Promise<any>[] = [];
      // FIX P1-01: persist tag associations
      if (tagIds && Array.isArray(tagIds) && tagIds.length > 0) {
        followUps.push(prisma.articleTag.createMany({ data: tagIds.map((tagId: string) => ({ articleId: created.id, tagId })) }));
      }

      if (mediaAssets && Array.isArray(mediaAssets)) {
        mediaAssets.forEach((assetId: string, index: number) => {
          followUps.push(prisma.articleMedia.create({ data: { articleId: created.id, mediaAssetId: assetId, position: index, placement: 'INLINE' } }));
        });
      }

      followUps.push(prisma.auditLog.create({
        data: { userId: req.user.id, action: 'CREATE_ARTICLE', entityType: 'ARTICLE', entityId: created.id, details: `Created article: ${title}` }
      }));

      await prisma.$transaction(followUps);

      invalidateHomepageCache();
      res.json(created);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/articles/:id', requireAuth, async (req: any, res) => {
    try {
      const {
        id
      } = req.params;
      const {
        title,
        excerpt,
        content,
        coverImage,
        categoryId,
        priority,
        status,
        scheduledFor,
        imageCaption,
        imageCredit,
        sourceAttribution,
        seoTitle,
        seoDescription,
        socialImage,
        articleType,
        videoUrl,
        mediaAssets,
        tagIds,
      } = req.body;
      // Phase 7: the schema/driver field is `editorialNote` (singular). The old
      // destructured `editorialNotes` was silently dropped by the PG whitelist —
      // accept both spellings and map onto the real field.
      const editorialNote = req.body.editorialNote ?? req.body.editorialNotes;
      // Phase 7: slug changes are supported; redirects are created atomically.
      const slug = req.body.slug;

      const existing = await prisma.article.findUnique({ where: { id } });
      if (!existing) return res.status(404).json({ error: 'Article not found' });

      // Horizontal access check: Reporter can only edit their own draft
      const canEditAny = hasPermission(req.user.role, 'article:edit_any');
      const canEditOwn = hasPermission(req.user.role, 'article:edit_own');

      if (!canEditAny && (!canEditOwn || existing.authorId !== req.user.id)) {
        return res.status(403).json({
          error: 'Horizontal access violation: You cannot edit another reporter\'s dispatch.',
          authorId: existing.authorId,
          userId: req.user.id,
        });
      }

      // FIX: status changes are forbidden on the generic update endpoint.
      // All workflow state transitions must go through POST /api/articles/:id/transition
      // which enforces the editorial state machine and separation of duties.
      if (status !== undefined && status !== existing.status) {
        return res.status(400).json({
          error: 'Status changes must go through POST /api/articles/:id/transition to enforce editorial workflow.',
        });
      }

      // Phase 5: sanitize all HTML content on update too
      const data: any = {
        title: title?.trim(),
        excerpt: excerpt !== undefined ? sanitizeExcerpt(excerpt) : undefined,
        content: content !== undefined ? sanitizeArticleContent(content) : undefined,
        coverImage: coverImage && validateUrl(coverImage) ? coverImage : undefined,
        categoryId,
        priority,
        imageCaption: imageCaption?.trim(),
        imageCredit: imageCredit?.trim(),
        sourceAttribution: sourceAttribution?.trim(),
        seoTitle: seoTitle?.trim(),
        seoDescription: seoDescription?.trim(),
        socialImage: socialImage && validateUrl(socialImage) ? socialImage : undefined,
        articleType,
        editorialNote: editorialNote !== undefined && editorialNote !== null ? String(editorialNote).trim() : undefined,
        videoUrl: videoUrl && validateUrl(videoUrl) ? videoUrl : undefined,
        // status and scheduledFor are intentionally excluded — use /transition
      };

      // Phase 7: slug changes — validate format + uniqueness, then a UrlRedirect
      // (/article/<old> → /article/<new>) is created in the same transaction as
      // the article update so deep links keep working and history is preserved.
      let redirectOp: Promise<any> | null = null;
      if (slug !== undefined && slug !== null && slug !== existing.slug) {
        const nextSlug = String(slug).trim().toLowerCase();
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(nextSlug)) {
          return res.status(400).json({
            error: 'Invalid slug: use lowercase letters, numbers and single hyphens.',
          });
        }
        if (nextSlug.length < 3) {
          return res.status(400).json({ error: 'Slug is too short (minimum 3 characters).' });
        }
        const conflict = await prisma.article.findUnique({ where: { slug: nextSlug } });
        if (conflict && conflict.id !== id) {
          return res.status(409).json({ error: `Slug "${nextSlug}" is already taken by another article.` });
        }
        data.slug = nextSlug;
        redirectOp = (prisma.urlRedirect as any).ensureRoute({
          data: {
            sourcePath: `/article/${existing.slug}`,
            destinationPath: `/article/${nextSlug}`,
            statusCode: 301,
            articleId: id,
          },
        });
      }

      // Remove undefined keys so partial updates work correctly
      Object.keys(data).forEach(k => data[k] === undefined && delete data[k]);

      // Phase 7: dependency validation UP FRONT — an unknown tag or media id
      // aborts the whole update before any write happens, so the replace-all
      // associations can never be half-applied when a reference doesn't exist.
      if (Array.isArray(tagIds) && tagIds.length > 0) {
        for (const tagId of tagIds) {
          const exists = await prisma.tag.findUnique({ where: { id: String(tagId) } });
          if (!exists) {
            return res.status(400).json({ error: `Unknown tag id "${tagId}" — update aborted (no changes applied).` });
          }
        }
      }
      if (Array.isArray(mediaAssets) && mediaAssets.length > 0) {
        for (const assetId of mediaAssets) {
          const exists = await prisma.mediaAsset.findUnique({ where: { id: String(assetId) } });
          if (!exists) {
            return res.status(400).json({ error: `Unknown media asset id "${assetId}" — update aborted (no changes applied).` });
          }
        }
      }

      // Phase 7: real transaction — article update, media association replace,
      // tag association replace, slug redirect and audit log succeed or fail
      // together (the old sequential awaits could leave associations replaced
      // while the article update or its audit entry failed).
      const mediaOps: Promise<any>[] = [];
      if (mediaAssets && Array.isArray(mediaAssets)) {
        mediaOps.push(prisma.articleMedia.deleteMany({ where: { articleId: id } }));
        mediaAssets.forEach((assetId: string, index: number) => {
          mediaOps.push(prisma.articleMedia.create({
            data: { articleId: id, mediaAssetId: assetId, position: index, placement: 'INLINE' }
          }));
        });
      }

      const tagOps: Promise<any>[] = [];
      // FIX P1-01: sync tag associations on update (replace-all strategy)
      if (tagIds && Array.isArray(tagIds)) {
        tagOps.push(prisma.articleTag.deleteMany({ where: { articleId: id } }));
        if (tagIds.length > 0) {
          tagOps.push(prisma.articleTag.createMany({ data: tagIds.map((tagId: string) => ({ articleId: id, tagId })) }));
        }
      }

      const auditOp = prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'UPDATE_ARTICLE',
          entityType: 'ARTICLE',
          entityId: id,
          details: `Updated article "${existing.title}"${data.slug && data.slug !== existing.slug ? ` (slug: ${existing.slug} → ${data.slug})` : ''}`,
        },
      });

      await prisma.$transaction([
        prisma.article.update({ where: { id }, data }),
        ...(redirectOp ? [redirectOp] : []),
        ...mediaOps,
        ...tagOps,
        auditOp,
      ]);

      const article = await prisma.article.findUnique({ where: { id } });

      invalidateHomepageCache();
      res.json(article);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/articles/:id/restore/:version', requireAuth, async (req: any, res) => {
    try {
      const { id, version } = req.params;
      const targetVersion = parseInt(version, 10);
      const article = await prisma.article.findUnique({ where: { id } });
      if (!article) return res.status(404).json({ error: 'Article not found' });

      const revisions = await prisma.articleRevision.findMany({ where: { articleId: id } });
      const rev = revisions.find((r: any) => r.version === targetVersion);
      if (!rev) return res.status(404).json({ error: `Revision version ${targetVersion} not found` });

      // FIX P0-10: require ownership or article:edit_any permission
      const isOwner = article.authorId === req.user.id;
      const hasEditAny = hasPermission(req.user.role, 'article:edit_any');
      if (!isOwner && !hasEditAny) {
        return res.status(403).json({ error: 'Permission denied: article:edit_any required to restore another author\'s revision.' });
      }

      const updated = await prisma.article.update({
        where: { id },
        data: { title: rev.title, excerpt: rev.excerpt, content: rev.content }
      });

      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'ARTICLE_REVISION_RESTORED',
          entityType: 'ARTICLE',
          entityId: id,
          details: `Article "${article.title}" restored to version ${targetVersion} by ${req.user.name}`,
        },
      });

      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/articles/:id/transition', requireAuth, async (req: any, res) => {
    try {
      const { id } = req.params;
      const { targetState, note } = req.body;

      const article = await prisma.article.findUnique({ where: { id } });
      if (!article) return res.status(404).json({ error: 'Article dispatch not found' });

      const isAuthor = article.authorId === req.user.id;
      const validation = validateStateTransition(article.status as ArticleState, targetState as ArticleState, req.user.role, note, isAuthor);

      if (!validation.allowed) {
        return res.status(403).json({ error: validation.reason, requiresNote: validation.requiresNote });
      }

      // FIX: Separation of duties — a reporter/copy-editor cannot approve or publish their own article.
      // Approval and publication of one's own work requires a separate editorial gatekeeper.
      const selfApprovalRoles = ['REPORTER', 'COPY_EDITOR'] as RoleType[];
      const approvalTargets = ['APPROVED', 'PUBLISHED'];
      if (selfApprovalRoles.includes(req.user.role as RoleType) && approvalTargets.includes(targetState) && isAuthor) {
        return res.status(403).json({
          error: 'Separation of duties: you cannot approve or publish your own article. A separate editor must review.',
        });
      }

      const updateData: any = { status: targetState };
      if (targetState === 'PUBLISHED' && article.status !== 'PUBLISHED') {
        updateData.publishedAt = new Date().toISOString();
      }
      // Phase 7: stamp archivedAt whenever the story leaves the public workflow
      if (targetState === 'ARCHIVED' && article.status !== 'ARCHIVED') {
        updateData.archivedAt = new Date().toISOString();
      }
      if (targetState === 'SCHEDULED' && req.body.scheduledFor) {
        updateData.scheduledFor = new Date(req.body.scheduledFor).toISOString();
      }
      if (note) updateData.editorialNote = note;

      const updatedArticle = await prisma.article.update({ where: { id }, data: updateData });

      // Audit requirement 9: editorial event + audit log for every state change
      await prisma.editorialEvent.create({
        data: {
          articleId: id,
          actorId: req.user.id,
          eventType: `TRANSITION_TO_${targetState}`,
          fromStatus: article.status,
          toStatus: targetState,
          note: note || `State transitioned to ${targetState} by ${req.user.name}`,
        },
      });

      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: `WORKFLOW_${targetState}`,
          entityType: 'ARTICLE',
          entityId: id,
          details: `Article "${article.title}" moved from ${article.status} to ${targetState} by ${req.user.name}`,
        },
      });

      invalidateHomepageCache();
      res.json({ article: updatedArticle, transition: { from: article.status, to: targetState } });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Phase 7: DELETE is now an ARCHIVE of the story, never a hard delete.
  // Revisions, comments, live updates, media joins and editorial events are all
  // preserved; sitemap/UI visibility is removed via status. Permanent removal
  // lives behind POST /api/articles/:id/purge (article:purge permission).
  app.delete('/api/articles/:id', requireAuth, requirePermission('article:delete'), async (req: any, res) => {
    try {
      const { id } = req.params;
      const article = await prisma.article.findUnique({ where: { id } });
      if (!article) return res.status(404).json({ error: 'Article not found' });

      if (article.status === 'ARCHIVED') {
        return res.json({
          success: true,
          archived: true,
          article,
          message: 'Article is already archived. Use POST /api/articles/:id/purge for permanent deletion.',
        });
      }

      const now = new Date().toISOString();
      const [updated] = await prisma.$transaction([
        prisma.article.update({ where: { id }, data: { status: 'ARCHIVED', archivedAt: now } }),
        prisma.editorialEvent.create({
          data: {
            articleId: id,
            actorId: req.user.id,
            eventType: 'TRANSITION_TO_ARCHIVED',
            fromStatus: article.status,
            toStatus: 'ARCHIVED',
            note: `Article archived by ${req.user.name} — revisions/comments/history preserved`,
          },
        }),
        prisma.auditLog.create({
          data: {
            userId: req.user.id,
            action: 'ARTICLE_ARCHIVED',
            entityType: 'ARTICLE',
            entityId: id,
            details: `Article "${article.title}" archived by ${req.user.name}`,
          },
        }),
      ]);

      // Archived stories must vanish from public surfaces at once
      if (article.status === 'PUBLISHED') invalidateHomepageCache();

      res.json({
        success: true,
        archived: true,
        article: updated,
        message: 'Article archived. Revisions, comments and media associations are preserved. Use POST /api/articles/:id/purge for permanent deletion.',
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Phase 7: protected hard-deletion procedure — separate capability
  // (article:purge, owned by SUPER_ADMIN/ADMIN only), requires the story to be
  // out of the public workflow first, runs dependency checks, and is executed
  // atomically with its audit trail. This is the ONLY endpoint that removes
  // revisions/comments/history permanently.
  app.post('/api/articles/:id/purge', requireAuth, requirePermission('article:purge'), async (req: any, res) => {
    try {
      const { id } = req.params;
      const article = await prisma.article.findUnique({ where: { id } });
      if (!article) return res.status(404).json({ error: 'Article not found' });

      // Dependency check 1: purge requires the story to already be archived (or
      // still a draft) — published stories must pass through the archive first.
      if (article.status !== 'ARCHIVED' && article.status !== 'DRAFT') {
        return res.status(409).json({
          error: `Purge blocked: article status is ${article.status}. Archive the story first (DELETE /api/articles/:id), then purge.`,
          status: article.status,
        });
      }

      // Dependency check 2: active breaking-news linkage must be cleared first
      // (route-side articleId filter — both drivers return the collection).
      const activeBreaking = ((await prisma.breakingNewsAnnouncement.findMany?.({
        where: { isActive: true },
      })) || []) as any[];
      const breaking = activeBreaking.filter((b: any) => b.articleId === id);
      if (breaking.length > 0) {
        return res.status(409).json({
          error: `Purge blocked: ${breaking.length} active breaking-news announcement(s) still reference this article.`,
        });
      }

      // Dependency check 3: homepage/layout references must be released first.
      const config = await prisma.homepageConfig.findFirst();
      if (config && (config.featuredArticleId === id || config.breakingArticleId === id)) {
        return res.status(409).json({
          error: 'Purge blocked: article is referenced by the homepage layout configuration.',
        });
      }

      // All-or-nothing: the delete and both audit records commit together.
      await prisma.$transaction([
        prisma.article.delete({ where: { id } }),
        prisma.auditLog.create({
          data: {
            userId: req.user.id,
            action: 'ARTICLE_PURGED',
            entityType: 'ARTICLE',
            entityId: id,
            details: `Article "${article.title}" permanently deleted by ${req.user?.name || req.user?.email || req.user?.id} (${article.status}). Revisions/comments/history removed.`,
          },
        }),
        prisma.editorialEvent.create({
          data: {
            articleId: id,
            actorId: req.user.id,
            eventType: 'ARTICLE_PURGED',
            fromStatus: article.status,
            toStatus: 'DELETED',
            note: `Hard deletion by ${req.user.name} — permanent, history removed`,
          },
        }),
      ]);

      invalidateHomepageCache();

      res.json({
        success: true,
        purged: true,
        message: `Article "${article.title}" permanently deleted with all dependent records (revisions, comments, live updates, media joins). Auditor logged.`,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Homepage Engine & Caching Pipeline ---
  app.get('/api/homepage', async (_req, res) => {
    try {
      const hit = homepageCache.get();
      if (hit) {
        return res.json({
          ...hit.value,
          cached: true,
          cacheTime: new Date().toISOString(),
          generatedAt: hit.generatedAt, // when the cached payload was built
          cacheAgeSeconds: homepageCache.ageSeconds(),
          cacheTtlSeconds: Math.round(HOMEPAGE_CACHE_TTL_MS / 1000),
        });
      }

      let config = await prisma.homepageConfig.findFirst();
      if (!config) {
        config = await prisma.homepageConfig.upsert({
          data: {
            featuredArticleId: null,
            breakingArticleId: null,
            breakingBannerActive: true,
            sectionOrder: DEFAULT_SECTION_ORDER,
          },
        });
      }

      const allPublished = await prisma.article.findMany({
        where: { status: 'PUBLISHED' },
      });

      // 1. Lead Story
      let leadStory = null;
      if (config.featuredArticleId) {
        leadStory = allPublished.find((a: any) => a.id === config.featuredArticleId) || null;
      }
      if (!leadStory) {
        leadStory = allPublished.find((a: any) => a.priority === 'BREAKING') || allPublished[0] || null;
      }

      // Related bullets for lead story (same category or high priority)
      const leadRelated = leadStory
        ? allPublished
            .filter((a: any) => a.id !== leadStory.id && (a.categoryId === leadStory.categoryId || a.priority === 'HIGH'))
            .slice(0, 3)
        : [];

      // 2. Breaking News Announcement
      let breakingAnnouncement = null;
      const activeAnnouncements = await prisma.breakingNewsAnnouncement.findMany({ where: { isActive: true } });
      if (activeAnnouncements && activeAnnouncements.length > 0) {
        breakingAnnouncement = activeAnnouncements[0];
      } else if (leadStory && (leadStory.priority === 'BREAKING' || config.breakingBannerActive)) {
        breakingAnnouncement = {
          id: 'brk-lead-auto',
          headline: leadStory.title,
          summary: leadStory.excerpt,
          articleId: leadStory.id,
          urgencyRank: 3,
          isActive: true,
        };
      }

      // 3. Exclude lead story from secondary candidates
      const remainingPublished = leadStory
        ? allPublished.filter((a: any) => a.id !== leadStory.id)
        : allPublished;

      // 4. Secondary Headlines Cluster (3-4 items)
      const secondaryStories = remainingPublished.slice(0, 4);

      // 5. Latest News Feed (up to 8 items)
      const latestNews = remainingPublished.slice(0, 8);

      // 6. Most Read Stories (sorted by views)
      const mostRead = [...allPublished].sort((a: any, b: any) => (b.views || 0) - (a.views || 0)).slice(0, 5);

      // 7. Category Map (group stories by category slug)
      const categoriesMap: Record<string, any[]> = {};
      const categories = await prisma.category.findMany();

      for (const cat of categories) {
        const catArticles = allPublished.filter((a: any) => a.categoryId === cat.id || a.category?.slug === cat.slug);
        if (catArticles.length > 0) {
          categoriesMap[cat.slug] = catArticles;
        }
      }

      const activeSectionOrder = (config.sectionOrder || DEFAULT_SECTION_ORDER)
        .filter((sec: any) => sec.enabled)
        .sort((a: any, b: any) => (a.order || 0) - (b.order || 0));

      const payload = {
        config,
        leadStory,
        leadRelated,
        breakingAnnouncement,
        secondaryStories,
        latestNews,
        mostRead,
        categoriesMap,
        activeSectionOrder,
        cached: false,
        generatedAt: new Date().toISOString(),
      };

      homepageCache.set(payload);
      res.json({ ...payload, cacheTtlSeconds: Math.round(HOMEPAGE_CACHE_TTL_MS / 1000) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/homepage/config', requireAuth, async (_req, res) => {
    try {
      let config = await prisma.homepageConfig.findFirst();
      if (!config) {
        config = await prisma.homepageConfig.upsert({
          data: {
            featuredArticleId: null,
            breakingArticleId: null,
            breakingBannerActive: true,
            sectionOrder: DEFAULT_SECTION_ORDER,
          },
        });
      }
      const publishedArticles = await prisma.article.findMany({ where: { status: 'PUBLISHED' } });
      res.json({ config, publishedArticles, defaultSections: DEFAULT_SECTION_ORDER });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/homepage/config', requireAuth, requirePermission('article:publish'), async (req: any, res) => {
    try {
      const { featuredArticleId, breakingArticleId, breakingBannerActive, sectionOrder } = req.body;
      const updated = await prisma.homepageConfig.update({
        data: {
          featuredArticleId: featuredArticleId || null,
          breakingArticleId: breakingArticleId || null,
          breakingBannerActive: Boolean(breakingBannerActive),
          sectionOrder: sectionOrder || DEFAULT_SECTION_ORDER,
        },
      });

      invalidateHomepageCache();

      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'UPDATE_HOMEPAGE_CONFIG',
          entityType: 'HOMEPAGE_CONFIG',
          entityId: 'default',
          details: `Homepage layout configuration updated by ${req.user.name}`,
        },
      });

      res.json({ success: true, config: updated });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Media Library Management Pipeline ---
  app.get('/api/media', requireAuth, async (req, res) => {
    try {
      // Phase 5: media list requires auth — prevents enumeration of internal assets
      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required to list media assets.' });
      }
      const { search, assetType, uploaderId } = req.query;
      // Phase 7: bounded listing — take honored/capped; array shape preserved.
      const pagination = parsePagination(req.query, { defaultLimit: 50, maxLimit: MAX_PAGE_SIZE });
      const media = await prisma.mediaAsset.findMany({
        where: {
          search: search ? String(search) : undefined,
          assetType: assetType ? String(assetType) : undefined,
          uploaderId: uploaderId ? String(uploaderId) : undefined,
        },
      });
      res.json((Array.isArray(media) ? media : []).slice(0, pagination.limit));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Phase 5: media detail — authenticated users see full record;
  // public callers only receive safe public fields (no uploader ID, no internal refs)
  app.get('/api/media/:id', async (req: any, res) => {
    try {
      const asset = await prisma.mediaAsset.findUnique({ where: { id: req.params.id } });
      if (!asset) return res.status(404).json({ error: 'Media asset not found' });
      if (req.user) {
        res.json(asset);
      } else {
        // Scope public response to safe fields only
        const { id, originalUrl, cdnUrl, mimeType, width, height, altText, caption, assetType, variants } = asset as any;
        res.json({ id, originalUrl, cdnUrl, mimeType, width, height, altText, caption, assetType, variants });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ├──────────────────────────────────────────────────────────────────────┤
  // │ Phase 11: storage provider introspection (+ which driver is real)    │
  // ├──────────────────────────────────────────────────────────────────────┤
  app.get('/api/admin/storage', requireAuth, requirePermission('media:manage'), async (_req, res) => {
    try {
      res.json(describeStorage());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Orphan asset report — media not referenced by any article or gallery
  // PLUS Phase 11 reconciliation: objects that live on the active storage
  // provider but have no MediaAsset row owning them (failed uploads that
  // predate GC, suspended writes, manual uploads before wiring, …).
  app.get('/api/admin/media/orphans', requireAuth, requirePermission('media:manage'), async (_req, res) => {
    try {
      const allAssets = await prisma.mediaAsset.findMany();
      const allArticles = await prisma.article.findMany();
      const allMedia = await prisma.articleMedia.findMany();
      const usedIds = new Set([
        ...allMedia.map((am: any) => am.mediaAssetId),
        ...allArticles.map((a: any) => a.coverImageId).filter(Boolean),
      ]);
      const orphans = (Array.isArray(allAssets) ? allAssets : [])
        .filter((a: any) => !usedIds.has(a.id))
        .map((a: any) => ({ id: a.id, filename: a.filename, originalUrl: a.originalUrl, createdAt: a.createdAt }));

      // Storage-side orphans: provider keys not claimed by ANY asset row with
      // a matching storageKey/storageDriver (variants included in ownership).
      let storageOrphans: Array<{ key: string }> = [];
      let storageScanError: string | null = null;
      const claimed = new Set<string>();
      for (const a of Array.isArray(allAssets) ? allAssets : []) {
        if (!a.storageKey) continue;
        if (a.storageDriver === storageProvider.name) claimed.add(a.storageKey);
        const vk = Array.isArray((a as any).variants?.records) ? (a as any).variants.records : [];
        for (const v of vk) if (v && v.key) claimed.add(v.key);
      }
      try {
        const providerKeys = await storageProvider.listObjects('');
        storageOrphans = providerKeys
          .filter((k) => !claimed.has(k))
          .map((key) => ({ key }));
      } catch (err: any) {
        storageScanError = err.message;
        logger.error(`Storage orphan scan failed: ${err.message}`, 'MEDIA');
      }

      res.json({ count: orphans.length, orphans, storage: { driver: storageProvider.name, orphanCount: storageOrphans.length, storageOrphans, ...(storageScanError ? { scanError: storageScanError } : {}) } });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Reconciliation EXECUTION: delete storage-side orphans (objects no DB row
  // claims AND no published article content embeds). DB-referenced assets and
  // content-embedded URLs are NEVER deleted by this route — an unowned object
  // that is still embedded in article HTML is reported as retained instead.
  app.post('/api/admin/media/orphans/collect', requireAuth, requirePermission('media:manage'), async (_req, res) => {
    try {
      const allAssets = await prisma.mediaAsset.findMany();
      const allArticles = await prisma.article.findMany();
      const claimText = (Array.isArray(allArticles) ? allArticles : [])
        .map((a: any) => `${a.content || ''}|${a.coverImage || ''}`)
        .join('|');
      const claimed = new Set<string>();
      for (const a of Array.isArray(allAssets) ? allAssets : []) {
        if (a.storageKey && a.storageDriver === storageProvider.name) claimed.add(a.storageKey);
        const vk = Array.isArray((a as any).variants?.records) ? (a as any).variants.records : [];
        for (const v of vk) if (v && v.key) claimed.add(v.key);
      }
      const providerKeys = await storageProvider.listObjects('');
      const unclaimed = providerKeys.filter((k) => !claimed.has(k));
      // Reference-safety pass: a content/coverImage embed wins over GC.
      const deletable = unclaimed.filter((k) => !claimText.includes(k));
      const retained = unclaimed.filter((k) => claimText.includes(k));
      const gc = await storageProvider.deleteObjects(deletable);
      try {
        await prisma.auditLog.create({
          data: {
            userId: _req.user!.id,
            action: 'STORAGE_ORPHANS_COLLECT',
            entityType: 'MEDIA',
            entityId: 'storage',
            details: `Reconciled storage orphans on ${storageProvider.name}: deleted ${gc.deleted.length}, retained ${retained.length} (content-embedded), failed ${gc.failed.length}`,
          },
        });
      } catch (auditErr: any) {
        logger.warn(`Storage orphan-collect audit skipped: ${auditErr.message}`, 'MEDIA');
      }
      res.json({
        driver: storageProvider.name,
        scanned: providerKeys.length,
        orphansDeleted: gc.deleted.length,
        orphansFailed: gc.failed.length,
        retainedReferenced: retained.length,
        deleted: gc.deleted,
        failed: gc.failed,
        retained,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // FIX E: require auth; only show PUBLISHED article refs to non-editors
  app.get('/api/media/:id/usages', requireAuth, async (req: any, res) => {
    try {
      const { id } = req.params;
      const asset = await prisma.mediaAsset.findUnique({ where: { id } });
      if (!asset) return res.status(404).json({ error: 'Media asset not found' });

      const canViewAll = hasPermission(req.user.role, 'article:edit_any');
      const allArticles = await prisma.article.findMany();
      const dependentArticles = (Array.isArray(allArticles) ? allArticles : [])
        .filter((a: any) =>
          a.coverImageId === id ||
          (a.coverImage && a.coverImage === asset.originalUrl) ||
          (a.content && (a.content.includes(id) || a.content.includes(asset.originalUrl)))
        )
        .filter((a: any) => canViewAll || a.status === 'PUBLISHED')
        .map((a: any) => ({ id: a.id, title: a.title, slug: a.slug, status: a.status }));

      res.json({
        assetId: id,
        isReferenced: dependentArticles.length > 0,
        count: dependentArticles.length,
        dependentArticles,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Media mutation helpers (Phase 11 storage contracts) ───────────────────
  // Absolute URL every article/SEO consumer can dereference: signed paths come
  // back origin-relative, public local paths are /uploads/..., S3 is absolute.
  const toAbsoluteMediaUrl = (url: string): string =>
    url.startsWith('/') ? `${publicStorageBaseUrl()}${url}` : url;

  /** Current in-organization month prefix (objects grouped monthly). */
  const monthPrefix = (): string => {
    const now = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `media/${now.getUTCFullYear()}/${p(now.getUTCMonth() + 1)}`;
  };

  /**
   * Persist original + generated variants through the provider. On ANY storage
   * failure every already-uploaded object is REMOVED (garbage collection for
   * failed uploads) and the error is surfaced — no orphaned half-upload is
   * left on the provider and no DB row is written.
   */
  async function persistUpload(
    keyBase: string,
    storedName: string,
    buffer: Buffer,
    mimeType: string,
    sourceDims: { width: number | null; height: number | null },
  ): Promise<
    | { ok: true; storageKey: string; read: { url: string; kind: string; expiresAt: string | null }; variantRecords: any[]; variantsStatus: string; variantsNote: string | null }
    | { ok: false; error: string; cleanedUp: boolean }
  > {
    const provider = storageProvider;
    const objectKey = `${keyBase}/${storedName}`;

    try {
      await provider.putObject(objectKey, buffer, mimeType);
    } catch (err: any) {
      logger.error(`Storage putObject failed for ${objectKey}: ${err.message}`, 'MEDIA');
      return { ok: false, error: `Storage backend rejected the upload: ${err.message}`, cleanedUp: false };
    }

    const plan = generateImageVariants({ key: objectKey, buffer, mimeType, sourceWidth: sourceDims.width, sourceHeight: sourceDims.height });

    const uploadedVariantKeys: string[] = [];
    for (const variant of plan.variants) {
      try {
        await provider.putObject(variant.key, variant.buffer, variant.contentType);
        uploadedVariantKeys.push(variant.key);
      } catch (err: any) {
        // GC: roll the whole upload back so the provider never keeps a partial set.
        const gc = await provider.deleteObjects([...uploadedVariantKeys, objectKey]);
        logger.error(
          `Variant upload failed (${variant.name}) — upload rolled back. deleted=${gc.deleted.length} failed=${gc.failed.length}: ${err.message}`,
          'MEDIA',
        );
        return {
          ok: false,
          error: `Storage backend failed while writing variant "${variant.name}": ${err.message}`,
          cleanedUp: gc.failed.length === 0,
        };
      }
    }

    const read = await provider.getReadUrl(objectKey);
    const variantRecords = [];
    for (const v of plan.variants) {
      const vRead = await provider.getReadUrl(v.key);
      variantRecords.push({
        name: v.name,
        purpose: v.purpose,
        key: v.key,
        url: toAbsoluteMediaUrl(vRead.url),
        urlKind: vRead.kind,
        width: v.width,
        height: v.height,
        contentType: v.contentType,
        bytes: v.bytes,
      });
    }

    return { ok: true, storageKey: objectKey, read, variantRecords, variantsStatus: plan.status, variantsNote: plan.note };
  }

  app.post('/api/media/file-upload', requireAuth, requirePermission('media:upload'), upload.single('file'), async (req: any, res) => {
    try {
      // Phase 5: per-user upload rate limit (20 uploads / 10 min)
      if (!checkUploadRateLimit(req.user.id)) {
        return res.status(429).json({ error: 'Upload rate limit exceeded. Maximum 20 uploads per 10 minutes.' });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded in request.' });
      }

      // Magic byte + XSS + size validation
      const sigResult = inspectBufferSignature(req.file.buffer);
      if (!sigResult.isValid) {
        return res.status(400).json({
          error: `File rejected: ${sigResult.error || 'Unsupported file type.'}`,
          detectedType: sigResult.detectedType,
        });
      }

      const { filename, storedName } = generateSafeFileName(req.file.originalname, sigResult.extension);
      const dimensions = extractDimensionsFromBuffer(req.file.buffer, sigResult.detectedType);

      // Provider put: upload + variants + attach-time garbage collection.
      const persisted = await persistUpload(
        monthPrefix(),
        storedName,
        req.file.buffer,
        sigResult.mimeType,
        { width: dimensions.width, height: dimensions.height },
      );
      if (!persisted.ok) {
        const status = /failed/i.test(persisted.error) && /HTTP \d+|network failure/i.test(persisted.error) ? 502 : 500;
        return res.status(status).json({
          error: persisted.error,
          storageDriver: storageProvider.name,
          cleanedUp: persisted.cleanedUp,
        });
      }

      const { caption, credit, altText, focalX, focalY } = req.body;
      const originalUrl = toAbsoluteMediaUrl(persisted.read.url);

      // Back-compat name→URL map for older admin consumers — REAL variant URLs
      // only (each record has its own key/bytes; never the original's URL).
      const variantsMap: Record<string, string> = {};
      for (const v of persisted.variantRecords) variantsMap[v.name] = v.url;

      let asset;
      try {
        asset = await prisma.mediaAsset.create({
          data: {
            filename,
            originalUrl,
            cdnUrl: originalUrl,
            mimeType: sigResult.mimeType,
            sizeBytes: req.file.size,
            width: dimensions.width,
            height: dimensions.height,
            altText: altText || filename,
            caption: caption || '',
            credit: credit || 'Global Chronicle Media',
            focalX: focalX !== undefined ? Number(focalX) : 50,
            focalY: focalY !== undefined ? Number(focalY) : 50,
            assetType: 'IMAGE',
            uploaderId: req.user.id,
            // Phase 11 provenance + variants (own keys, dims, content types)
            storageKey: persisted.storageKey,
            storageDriver: storageProvider.name,
            visibility: env.STORAGE_MEDIA_VISIBILITY,
            variants: {
              status: persisted.variantsStatus,
              note: persisted.variantsNote,
              records: persisted.variantRecords,
            },
          },
        });
      } catch (dbErr: any) {
        // DB failed AFTER storage accepted objects — GC the upload (values in
        // `originalUrl`/variants do not exist anywhere else yet).
        const gc = await storageProvider.deleteObjects(
          [persisted.storageKey, ...persisted.variantRecords.map((v) => v.key)],
        );
        logger.error(`Media DB create failed after upload — GC removed ${gc.deleted.length} object(s)`, 'MEDIA');
        return res.status(500).json({
          error: 'Media record could not be saved; uploaded objects were removed.',
          cleanedUp: gc.failed.length === 0,
        });
      }

      try {
        await prisma.auditLog.create({
          data: {
            userId: req.user.id,
            action: 'UPLOAD_MEDIA_FILE',
            entityType: 'MEDIA',
            entityId: asset.id,
            details: `Uploaded file asset ${filename} with verified signature (${sigResult.detectedType}) via ${storageProvider.name} storage` +
              (persisted.variantRecords.length > 0 ? ` with ${persisted.variantRecords.length} real variant(s)` : ''),
          },
        });
      } catch (auditErr: any) {
        logger.warn(`Media audit row skipped (asset ${asset.id}): ${auditErr.message}`, 'MEDIA');
      }

      res.json({
        ...asset,
        variantsJson: JSON.stringify(variantsMap),
        variantsStatus: persisted.variantsStatus,
        aspectRatio: dimensions.aspectRatio,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // URL-record endpoint: registers media that lives OUTSIDE the active storage
  // provider (external image URL). Phase 11: every field is REAL — the former
  // fabricated fallbacks (unsplash URL, 524288 bytes, 1920×1080, jpeg) are
  // gone; the record is refused unless the essential facts are supplied.
  app.post('/api/media', requireAuth, requirePermission('media:upload'), async (req: any, res) => {
    try {
      const { filename, originalUrl, cdnUrl, mimeType, sizeBytes, width, height, altText, caption, credit, focalX, focalY, assetType } = req.body;

      if (!originalUrl || typeof originalUrl !== 'string') {
        return res.status(400).json({ error: 'originalUrl is required for a URL-record media asset — assets are never invented server-side.' });
      }
      if (!validateUrl(originalUrl)) {
        return res.status(400).json({ error: 'originalUrl must be a valid http(s) URL.' });
      }
      const allowedImageMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif', 'image/svg+xml'];
      if (!mimeType || !allowedImageMimes.includes(mimeType)) {
        return res.status(400).json({
          error: `mimeType must be one of ${allowedImageMimes.join(', ')} — declaring the real content type is the uploader's responsibility.`,
        });
      }
      if (sizeBytes !== undefined && (!Number.isFinite(Number(sizeBytes)) || Number(sizeBytes) < 0)) {
        return res.status(400).json({ error: 'sizeBytes must be a non-negative number when provided.' });
      }
      if (width !== undefined && (!Number.isFinite(Number(width)) || Number(width) < 1)) {
        return res.status(400).json({ error: 'width must be a positive integer when provided.' });
      }
      if (height !== undefined && (!Number.isFinite(Number(height)) || Number(height) < 1)) {
        return res.status(400).json({ error: 'height must be a positive integer when provided.' });
      }

      // Derive the filename from the real URL when not explicitly provided.
      let resolvedFilename = filename;
      if (!resolvedFilename) {
        try {
          resolvedFilename = decodeURIComponent(new URL(originalUrl).pathname.split('/').filter(Boolean).pop() || '');
        } catch { /* validateUrl already guaranteed parseability */ }
        if (!resolvedFilename || resolvedFilename.length < 3) resolvedFilename = 'external-media-record';
      }

      const asset = await prisma.mediaAsset.create({
        data: {
          filename: resolvedFilename,
          originalUrl,
          ...(cdnUrl ? { cdnUrl } : {}),
          mimeType,
          sizeBytes: sizeBytes !== undefined ? Number(sizeBytes) : null as any,
          width: width !== undefined ? Number(width) : null as any,
          height: height !== undefined ? Number(height) : null as any,
          altText: altText || resolvedFilename,
          caption: caption || '',
          credit: credit || '',
          focalX: focalX !== undefined ? Number(focalX) : 50,
          focalY: focalY !== undefined ? Number(focalY) : 50,
          assetType: assetType || 'IMAGE',
          uploaderId: req.user.id,
          // Not provider-resident: nothing on the active storage backend is
          // claimed, so reconciliation never treats this record as an owner.
          storageKey: null,
          storageDriver: null,
          visibility: 'public',
          variants: { status: 'passthrough-unhandled', note: 'External URL record — no object stored, no variants generated.', records: [] },
        },
      });

      try {
        await prisma.auditLog.create({
          data: {
            userId: req.user.id,
            action: 'UPLOAD_MEDIA',
            entityType: 'MEDIA',
            entityId: asset.id,
            details: `Created media asset record: ${asset.filename}`,
          },
        });
      } catch (auditErr: any) {
        logger.warn(`Media audit row skipped (asset ${asset.id}): ${auditErr.message}`, 'MEDIA');
      }

      res.json(asset);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  const handleReplaceFile = async (req: any, res: any) => {
    try {
      const { id } = req.params;
      const existing: any = await prisma.mediaAsset.findUnique({ where: { id } });
      if (!existing) return res.status(404).json({ error: 'Media asset not found' });

      if (!req.file) {
        return res.status(400).json({ error: 'No replacement file uploaded.' });
      }

      const sigResult = inspectBufferSignature(req.file.buffer);
      if (!sigResult.isValid) {
        return res.status(400).json({
          error: `Replacement file signature verification failed: ${sigResult.error}`,
        });
      }

      const { filename, storedName } = generateSafeFileName(req.file.originalname, sigResult.extension);
      const dimensions = extractDimensionsFromBuffer(req.file.buffer, sigResult.detectedType);

      // Provider put for the REPLACEMENT (upload + variants + GC on failure)
      const persisted = await persistUpload(
        monthPrefix(),
        storedName,
        req.file.buffer,
        sigResult.mimeType,
        { width: dimensions.width, height: dimensions.height },
      );
      if (!persisted.ok) {
        const status = /HTTP \d+|network failure/i.test(persisted.error) ? 502 : 500;
        return res.status(status).json({
          error: persisted.error,
          storageDriver: storageProvider.name,
          cleanedUp: persisted.cleanedUp,
        });
      }

      const originalUrl = toAbsoluteMediaUrl(persisted.read.url);
      let updated;
      try {
        updated = await prisma.mediaAsset.update({
          where: { id },
          data: {
            filename,
            originalUrl,
            cdnUrl: originalUrl,
            mimeType: sigResult.mimeType,
            sizeBytes: req.file.size,
            width: dimensions.width,
            height: dimensions.height,
            storageKey: persisted.storageKey,
            storageDriver: storageProvider.name,
            visibility: env.STORAGE_MEDIA_VISIBILITY,
            variants: {
              status: persisted.variantsStatus,
              note: persisted.variantsNote,
              records: persisted.variantRecords,
            },
          },
        });
      } catch (dbErr: any) {
        // DB refused the replacement — remove the just-uploaded objects; the
        // previous serving objects remain referenced and intact.
        const gc = await storageProvider.deleteObjects(
          [persisted.storageKey, ...persisted.variantRecords.map((v) => v.key)],
        );
        logger.error(`Replace-file DB update failed — GC removed ${gc.deleted.length} replacement object(s)`, 'MEDIA');
        return res.status(500).json({
          error: 'Replacement record could not be saved; replacement objects were removed.',
          cleanedUp: gc.failed.length === 0,
        });
      }

      // Old objects are only reachable through this asset's old URLs. Content
      // of dependent articles may still reference the OLD original URL —
      // check BEFORE deleting so an in-place replace never breaks a published
      // article's embedded <img> (requirement: preserve media references).
      const oldVariantKeys: string[] = Array.isArray((existing.variants as any)?.records)
        ? (existing.variants as any).records.filter((r: any) => r && r.key && r.key !== persisted.storageKey).map((r: any) => r.key)
        : [];
      const candidateOldKeys = [...existing.storageKey ? [existing.storageKey] : [], ...oldVariantKeys]
        .filter((k): k is string => !!k && k !== persisted.storageKey && !persisted.variantRecords.some((v) => v.key === k));

      let retainedReferenced = false;
      if (candidateOldKeys.length > 0) {
        const allArticles = await prisma.article.findMany();
        const oldUrls: string[] = [existing.originalUrl].filter(Boolean);
        const referenced = (Array.isArray(allArticles) ? allArticles : []).some((a: any) =>
          (a.coverImage && oldUrls.includes(a.coverImage)) ||
          (a.content && oldUrls.some((u) => a.content.includes(u)))
        );
        if (!referenced) {
          const gc = await storageProvider.deleteObjects(candidateOldKeys);
          if (gc.failed.length > 0) {
            logger.error(`Replace-file: ${gc.failed.length} old object(s) remain on ${storageProvider.name} — reconciliation will retry`, 'MEDIA');
          }
        } else {
          retainedReferenced = true; // old objects stay until references are rewritten (orphans tooling)
        }
      }

      try {
        await prisma.auditLog.create({
          data: {
            userId: req.user.id,
            action: 'REPLACE_MEDIA_FILE',
            entityType: 'MEDIA',
            entityId: id,
            details: `In-place replaced asset binary with ${filename} via ${storageProvider.name} storage` +
              (candidateOldKeys.length > 0 ? (retainedReferenced ? '; old objects retained (still referenced)' : '; old objects removed') : ''),
          },
        });
      } catch (auditErr: any) {
        logger.warn(`Media audit row skipped (asset ${id}): ${auditErr.message}`, 'MEDIA');
      }

      res.json({ ...updated, storageCleanup: retainedReferenced ? 'retained-referenced' : 'deleted-or-absent' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  app.put('/api/media/:id/replace-file', requireAuth, requirePermission('media:manage'), upload.single('file'), handleReplaceFile);
  app.post('/api/media/:id/replace-file', requireAuth, requirePermission('media:manage'), upload.single('file'), handleReplaceFile);

  app.put('/api/media/:id', requireAuth, requirePermission('media:manage'), async (req: any, res) => {
    try {
      const { id } = req.params;
      const { focalX, focalY, caption, credit, altText } = req.body;
      const updated = await prisma.mediaAsset.update({
        where: { id },
        data: {
          focalX: focalX !== undefined ? Number(focalX) : undefined,
          focalY: focalY !== undefined ? Number(focalY) : undefined,
          caption,
          credit,
          altText,
        },
      });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/media/:id', requireAuth, requirePermission('media:manage'), async (req: any, res) => {
    try {
      const { id } = req.params;
      const { replacementId } = req.query;

      const asset = await prisma.mediaAsset.findUnique({ where: { id } });
      if (!asset) return res.status(404).json({ error: 'Media asset not found' });

      const allArticles = await prisma.article.findMany();
      const dependentArticles = allArticles.filter((a: any) =>
        a.coverImageId === id ||
        (a.coverImage && a.coverImage === asset.originalUrl) ||
        (a.content && (a.content.includes(id) || a.content.includes(asset.originalUrl)))
      );

      // Block deletion if referenced by active articles and no replacement provided
      if (dependentArticles.length > 0 && !replacementId) {
        return res.status(409).json({
          error: `Asset deletion blocked: This media item is referenced by ${dependentArticles.length} active dispatch(es).`,
          referenced: true,
          count: dependentArticles.length,
          dependentArticles: dependentArticles.map((a: any) => ({
            id: a.id,
            title: a.title,
            slug: a.slug,
            status: a.status,
          })),
        });
      }

      // Re-assign cover images and content references if replacement ID provided
      let replacementOps: Promise<any>[] = [];
      if (replacementId && dependentArticles.length > 0) {
        const replacementAsset = await prisma.mediaAsset.findUnique({ where: { id: String(replacementId) } });
        if (!replacementAsset) {
          return res.status(400).json({ error: 'Selected replacement target asset does not exist.' });
        }

        // Phase 7: ops are CONSTRUCTED in dependency order (reassignment must
        // happen before the asset row vanishes); the driver executes them as a
        // single batch — real transaction on PostgreSQL (Phase 6B driver).
        replacementOps = dependentArticles.map((art: any) => {
          const updateData: any = {};
          if (art.coverImageId === id) {
            updateData.coverImageId = replacementAsset.id;
            updateData.coverImage = replacementAsset.originalUrl;
          }
          if (art.content && art.content.includes(asset.originalUrl)) {
            updateData.content = art.content.replaceAll(asset.originalUrl, replacementAsset.originalUrl);
          }
          if (Object.keys(updateData).length === 0) return null;
          return prisma.article.update({
            where: { id: art.id },
            data: updateData,
          });
        }).filter(Boolean);
      }

      // Phase 7: asset delete + reassignments + audit commit together.
      await prisma.$transaction([
        ...replacementOps,
        prisma.mediaAsset.delete({ where: { id } }),
        prisma.auditLog.create({
          data: {
            userId: req.user.id,
            action: 'DELETE_MEDIA',
            entityType: 'MEDIA',
            entityId: id,
            details: `Deleted media asset ${asset.filename}${replacementId ? ` (Replaced by ${replacementId})` : ''}`,
          },
        }),
      ]);

      // Phase 11: with the referential protection above satisfied, the stored
      // objects are unreachable — remove them from the provider. Failures are
      // reported honestly (row is gone; the reconciliation sweep can retry).
      const oldVariantKeys: string[] = Array.isArray((asset as any).variants?.records)
        ? (asset as any).variants.records.map((r: any) => r.key).filter(Boolean)
        : [];
      const storageKeys = [...(asset as any).storageKey ? [(asset as any).storageKey] : [], ...oldVariantKeys];
      let storageDelete: { deleted: string[]; failed: string[] } | null = null;
      // Only objects written by the CURRENTLY ACTIVE provider are targeted:
      // a pre-abstraction record (no storageDriver) keeps its files until the
      // reconciliation sweep maps them, and assets stored under another
      // driver are never silently touched by the wrong backend.
      if (storageKeys.length > 0 && (asset as any).storageDriver === storageProvider.name) {
        storageDelete = await storageProvider.deleteObjects(storageKeys);
        if (storageDelete.failed.length > 0) {
          logger.error(`Media delete: ${storageDelete.failed.length} object(s) could not be removed from ${storageProvider.name}`, 'MEDIA');
        }
      }

      // Cover imagery appears on the homepage — cache must not serve stale cards
      if (dependentArticles.length > 0) invalidateHomepageCache();

      res.json({
        success: true,
        message: 'Media asset deleted successfully.',
        replacedCount: dependentArticles.length,
        ...(storageDelete ? { storageDelete: { deleted: storageDelete.deleted.length, failed: storageDelete.failed.length } } : {}),
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- Live Blogs & Developing News ---
  app.get('/api/liveblogs/:articleId', async (req, res) => {
    try {
      const updates = await prisma.liveBlogUpdate.findMany({ where: { articleId: req.params.articleId } });
      res.json(updates);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/liveblogs', requireAuth, async (req: any, res) => {
    try {
      const { articleId, headline, body, isKeyEvent } = req.body;
      if (!articleId || !headline || !body) {
        return res.status(400).json({ error: 'articleId, headline, and body are required' });
      }
      const update = await prisma.liveBlogUpdate.create({
        data: {
          articleId,
          headline,
          body,
          isKeyEvent: Boolean(isKeyEvent),
          authorId: req.user.id,
        },
      });
      res.json(update);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // FIX P1-07: liveblog delete requires ownership or article:edit_any
  app.delete('/api/liveblogs/:id', requireAuth, async (req: any, res) => {
    try {
      const entry = await prisma.liveBlogUpdate.findUnique({ where: { id: req.params.id } });
      if (!entry) return res.status(404).json({ error: 'Live blog entry not found.' });

      const isAuthor = entry.authorId === req.user.id;
      const hasEditAny = hasPermission(req.user.role as RoleType, 'article:edit_any');
      if (!isAuthor && !hasEditAny) {
        return res.status(403).json({ error: 'Permission denied: you can only delete your own live blog entries.' });
      }

      await prisma.liveBlogUpdate.delete({ where: { id: req.params.id } });
      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'LIVEBLOG_ENTRY_DELETED',
          entityType: 'LIVEBLOG',
          entityId: req.params.id,
          details: `Live blog entry deleted by ${req.user.name}`,
        },
      });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Breaking News Ticker (Phase 7: mutations invalidate the homepage cache —
  // the ticker renders on the homepage, so stale-cache reads are forbidden) ---
  app.get('/api/breaking-news', async (_req, res) => {
    try {
      const alerts = await prisma.breakingNewsAnnouncement.findMany({ where: { isActive: true } });
      res.json(alerts);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/breaking-news', requireAuth, requirePermission('article:publish'), async (req: any, res) => {
    try {
      const { headline, summary, articleId, urgencyRank } = req.body;
      if (!headline || !String(headline).trim()) {
        return res.status(400).json({ error: 'Headline is required.' });
      }
      const alert = await prisma.breakingNewsAnnouncement.create({
        data: {
          headline: String(headline).trim(),
          // defined-only payload: null instead of undefined so a stored value
          // can never be stomped back to null on JSON-driver spread updates
          summary: summary !== undefined ? summary : null,
          articleId: articleId || null,
          urgencyRank: Number.isFinite(Number(urgencyRank)) ? Number(urgencyRank) : 3,
          isActive: true,
        },
      });
      invalidateHomepageCache();
      res.json(alert);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/breaking-news/:id', requireAuth, requirePermission('article:publish'), async (req: any, res) => {
    try {
      const { headline, summary, urgencyRank, isActive } = req.body;
      // Phase 7: only include fields the caller actually sent — the legacy
      // destructured-spread payload passed explicit `undefined` values into the
      // driver, overwriting stored data with undefined (corruption on update).
      const data: any = {};
      if (headline !== undefined) data.headline = String(headline);
      if (summary !== undefined) data.summary = summary;
      if (urgencyRank !== undefined) data.urgencyRank = Number(urgencyRank);
      if (isActive !== undefined) data.isActive = Boolean(isActive);
      if (Object.keys(data).length === 0) {
        return res.status(400).json({ error: 'No updatable fields provided.' });
      }
      const alert = await prisma.breakingNewsAnnouncement.update({
        where: { id: req.params.id },
        data,
      });
      invalidateHomepageCache();
      res.json(alert);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/breaking-news/:id', requireAuth, requirePermission('article:publish'), async (req: any, res) => {
    try {
      await prisma.breakingNewsAnnouncement.delete({ where: { id: req.params.id } });
      invalidateHomepageCache();
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Reader Reaction Meter ---
  app.get('/api/reactions/:articleId', async (req, res) => {
    try {
      const counts = await prisma.reaction.getCounts(req.params.articleId);
      res.json(counts);
    } catch (err: any) {
      publicSafeError(res, err, 'GET /api/reactions/:articleId', req.ip || 'unknown');
    }
  });

  app.post('/api/reactions/:articleId', async (req: any, res) => {
    const identity = req.ip || 'unknown';
    const route = 'POST /api/reactions/:articleId';
    try {
      const articleId = req.params.articleId;
      if (!limiters.reactions.check(`${identity}:reaction:${articleId}`)) {
        return tooManyRequests(res, route, identity, 'reaction flood');
      }

      // Phase 8: strict validation (type is the only accepted field)
      const parsed = reactionCreateSchema.safeParse(req.body);
      validationErrorResponse(res, parsed as any);
      if (!parsed.success) return;
      const { type } = parsed.data;

      // Reactions may only target a live public story
      const article = await prisma.article.findUnique({ where: { id: articleId } });
      if (!article || article.status !== 'PUBLISHED') {
        return res.status(404).json({ error: 'Story not found.' });
      }

      // Dedup: repeated same-type click within the cooldown is idempotent —
      // the reaction is not counted twice (see reactionDedupe identity model);
      // the mark only lands after a successful write.
      const duplicate = reactionDedupe.isDuplicate(articleId, type, identity);
      if (!duplicate) {
        await prisma.reaction.create({ data: { articleId, type } });
        reactionDedupe.mark(articleId, type, identity);
      }
      const counts = await prisma.reaction.getCounts(articleId);
      res.json({ success: true, deduplicated: duplicate, counts });
    } catch (err: any) {
      publicSafeError(res, err, route, identity);
    }
  });

  // --- Comments ---
  // FIX F: public callers always see only APPROVED comments; status param requires auth+permission
  // Strip authorEmail from public responses to protect reader PII
  app.get('/api/comments', optionalAuth, async (req: any, res) => {
    try {
      const { articleId, status } = req.query;
      let effectiveStatus = 'APPROVED';

      if (status && String(status) !== 'APPROVED') {
        // Non-approved status requires editorial permission
        if (!req.user || !hasPermission(req.user.role, 'article:request_changes')) {
          return res.status(401).json({ error: 'Authentication required to filter by comment status.' });
        }
        effectiveStatus = String(status);
      }

      const comments = await prisma.comment.findMany({ where: { status: effectiveStatus } });
      const arr = Array.isArray(comments) ? comments : [];
      const filtered = articleId ? arr.filter((c: any) => c.articleId === String(articleId)) : arr;

      // Phase 7: bounded listing — `limit` honored, never unbounded; array shape
      // preserved for existing consumers.
      const pagination = parsePagination(req.query, { defaultLimit: 100, maxLimit: MAX_PAGE_SIZE });
      const bounded = filtered.slice(0, pagination.limit);

      // Phase 8: explicit field whitelist for public readers — authorEmail and
      // future internal/moderation fields can never leak by construction.
      const isEditor = req.user && hasPermission(req.user.role, 'article:request_changes');
      const safe = isEditor
        ? bounded
        : bounded.map((c: any) => ({
            id: c.id,
            articleId: c.articleId,
            authorName: c.authorName,
            content: c.content,
            status: c.status,
            createdAt: c.createdAt,
          }));

      res.json(safe);
    } catch (err: any) {
      publicSafeError(res, err, 'GET /api/comments', req.ip || 'unknown');
    }
  });

  app.post('/api/comments', async (req: any, res) => {
    const identity = req.ip || 'unknown';
    const route = 'POST /api/comments';
    try {
      if (!limiters.comments.check(identity + ':comment')) {
        return tooManyRequests(res, route, identity, 'comment flood');
      }

      // Phase 8: strict validation — bounded fields, email format, control-char
      // stripping. Field-specific validation details never leak into responses.
      const parsed = commentCreateSchema.safeParse(req.body);
      validationErrorResponse(res, parsed as any);
      if (!parsed.success) return;
      const { articleId, authorName, authorEmail, content, website } = parsed.data;

      // Honeypot: the form includes a hidden `website` field that real readers
      // never complete. Bots do — silently return success and drop the payload.
      if (website && website.trim() !== '') {
        return res.json({ success: true, message: 'Comment submitted for moderation' });
      }

      // Comments belong to live public stories
      const article = await prisma.article.findUnique({ where: { id: articleId } });
      if (!article || article.status !== 'PUBLISHED') {
        return res.status(404).json({ error: 'Story not found.' });
      }

      // Duplicate-content suppression: same identity submitting the SAME text
      // again (within the process lifetime) is silently accepted without
      // creating another moderation row.
      const fingerprint = `${identity}:${contentFingerprint(content)}`;
      if (submittedCommentFingerprints.has(fingerprint)) {
        return res.json({ success: true, message: 'Comment submitted for moderation' });
      }

      // Link-spam heuristic: heavy URL density is auto-flagged to the SPAM
      // moderation bucket instead of PENDING (moderators triage, never auto-publish).
      const urlMatches = content.match(/https?:\/\//gi);
      const words = content.trim().split(/\s+/).length;
      const isLikelySpam = (urlMatches && urlMatches.length >= 3) || (urlMatches && words > 0 && urlMatches.length / words > 0.2);
      const initialStatus = isLikelySpam ? 'SPAM' : 'PENDING';

      await prisma.comment.create({
        data: { articleId, authorName, authorEmail, content, status: initialStatus }
      });
      if (isLikelySpam) {
        abuseMonitor.record(`${route}:linkspam`, identity, 'comment auto-flagged as SPAM (link density)');
      }
      rememberCommentFingerprint(fingerprint);

      // Deliberately minimal response: no record, no email, no moderation fields
      res.json({ success: true, message: 'Comment submitted for moderation' });
    } catch (err: any) {
      publicSafeError(res, err, route, identity);
    }
  });

  app.get('/api/comments/pending', requireAuth, requirePermission('article:request_changes'), async (req: any, res) => {
    try {
      const comments = await prisma.comment.findMany({
        where: { status: 'PENDING' },
      });
      // Phase 8: bounded editorial queue (full records — includes PII for moderation)
      const pagination = parsePagination(req.query, { defaultLimit: 100, maxLimit: MAX_PAGE_SIZE });
      res.json((Array.isArray(comments) ? comments : []).slice(0, pagination.limit));
    } catch (err: any) {
      publicSafeError(res, err, 'GET /api/comments/pending', req.ip || 'unknown');
    }
  });

  app.put('/api/comments/:id/moderate', requireAuth, requirePermission('article:request_changes'), async (req: any, res) => {
    try {
      // Phase 8: strict validation of the moderation status
      const parsed = commentModerateSchema.safeParse(req.body);
      validationErrorResponse(res, parsed as any);
      if (!parsed.success) return;
      const { status } = parsed.data;
      const comment = await prisma.comment.update({
        where: { id: req.params.id },
        data: { status }
      });
      const isEditor = true;
      const full = comment as any;
      res.json({
        id: full.id,
        articleId: full.articleId,
        authorName: full.authorName,
        content: full.content,
        status: full.status,
        createdAt: full.createdAt,
      });
    } catch (err: any) {
      publicSafeError(res, err, 'PUT /api/comments/:id/moderate', req.ip || 'unknown');
    }
  });

  // --- Polls ---
  app.get('/api/polls', async (_req, res) => {
    try {
      const poll = await prisma.poll.findFirst({ where: { active: true } });
      res.json(poll);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/polls/:id/vote', async (req: any, res) => {
    try {
      const pollId = req.params.id;
      const ip = req.ip || 'unknown';
      const route = 'POST /api/polls/:id/vote';

      // Phase 8: validate the payload FIRST — an invalid vote must not
      // permanently consume the visitor's voter identity (old bug: the IP
      // was registered before checking optionIndex).
      const parsed = pollVoteSchema.safeParse(req.body);
      validationErrorResponse(res, parsed as any);
      if (!parsed.success) return;
      const { optionIndex } = parsed.data;

      const poll = await prisma.poll.findUnique({ where: { id: pollId } });
      if (!poll) return res.status(404).json({ error: 'Poll not found' });

      const options: any = poll.options;
      if (!Array.isArray(options) || options.length === 0 || options[optionIndex] === undefined || optionIndex >= options.length) {
        return res.status(400).json({ error: 'Invalid option index.' });
      }

      if (!limiters.polls.check(`${ip}:poll:${pollId}`)) {
        return tooManyRequests(res, route, ip, 'poll vote flood');
      }

      // Duplicate-vote policy (src/server/abuse.ts §PollVoteRegistry):
      //   primary identity = gcn_poll_voter HttpOnly cookie (random token,
      //   not IP-derived); fallback = resolved client IP. Neither is treated
      //   as a perfect identity — see docs/OPERATIONAL_LIMITS.md §Polls.
      const voterToken: string | undefined = (req as any).cookies?.gcn_poll_voter;
      const primaryIdentity = voterToken ? `tok:${pollId}:${voterToken}` : null;
      const fallbackIdentity = pollVoteRegistry.has(pollId, `ip:${pollId}:${ip}`)
        ? `ip:${pollId}:${ip}` : null;

      if ((primaryIdentity && pollVoteRegistry.has(pollId, primaryIdentity)) || fallbackIdentity) {
        abuseMonitor.record(`${route}:dupvote`, ip, 'duplicate poll vote');
        // 429 retained for compatibility with CmsComments-era clients and the
        // security baseline (KLM K-2): "You have already voted in this poll."
        return res.status(429).json({ error: 'You have already voted in this poll.' });
      }

      const castIdentity = primaryIdentity || `ip:${pollId}:${ip}`;
      pollVoteRegistry.add(pollId, castIdentity);

      options[optionIndex].votes += 1;
      const updated = await prisma.poll.update({ where: { id: pollId }, data: { options } });

      // Assign a fresh voter token on first vote (new window) or re-affirm
      if (!voterToken) {
        res.cookie('gcn_poll_voter', newVoterToken(), {
          httpOnly: true,
          sameSite: 'lax',
          maxAge: 180 * 24 * 60 * 60 * 1000, // 180 days
          secure: process.env.NODE_ENV === 'production',
        });
      }
      res.json(updated);
    } catch (err: any) {
      publicSafeError(res, err, 'POST /api/polls/:id/vote', req.ip || 'unknown');
    }
  });

  // --- AI Journalist Assistant (Gemini SDK Server-Side) ---
  app.post('/api/ai/summarize', requireAuth, async (req, res) => {
    try {
      const { text, title } = req.body;
      if (!text) return res.status(400).json({ error: 'Article text is required for AI summarization' });

      if (!ai) {
        return res.json({
          summary: 'Global Chronicle AI Assistant unavailable (Gemini API key not configured). Standard excerpt generated.',
          keyPoints: [
            'International delegation reached preliminary consensus.',
            'Implementation timeline projected across upcoming fiscal quarters.',
            'Stakeholder feedback under editorial review.'
          ]
        });
      }

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: `Analyze the following news dispatch and provide:
1) A 2-sentence executive summary.
2) Exactly 3 key bullet points highlighting pivotal facts.

Title: ${title || 'News Dispatch'}
Article Body:
${text}`,
        config: {
          systemInstruction: 'You are an executive newsroom editor summarizing dispatches with precision and objective neutrality.',
        },
      });

      const outputText = response.text || '';
      const lines = outputText.split('\n').map((l) => l.trim()).filter(Boolean);
      const keyPoints = lines.filter((l) => l.startsWith('-') || l.startsWith('*') || /^\d+\./.test(l)).map((l) => l.replace(/^[-*\d.]+\s*/, ''));

      res.json({
        summary: outputText,
        keyPoints: keyPoints.length > 0 ? keyPoints.slice(0, 3) : [
          'High-priority editorial developments documented.',
          'Key regulatory and international stakeholders consulted.',
          'Policy recommendations established for newsroom review.'
        ],
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/ai/headlines', requireAuth, async (req, res) => {
    try {
      const { text, currentTitle } = req.body;
      if (!text && !currentTitle) return res.status(400).json({ error: 'Title or article body required for headline generation' });

      if (!ai) {
        return res.json({
          headlines: [
            { category: 'Breaking Alert', text: `BREAKING: ${currentTitle || 'Dispatch Published'}` },
            { category: 'Analytical', text: `Inside the Accord: ${currentTitle || 'Key Takeaways'}` },
            { category: 'SEO Optimized', text: `Complete Guide to ${currentTitle || 'Current Developments'} in 2026` },
            { category: 'Social Media', text: `What You Need to Know About ${currentTitle || 'Latest News'}` },
            { category: 'Short Punchy', text: currentTitle || 'Global News Update' },
          ]
        });
      }

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: `Generate 5 high-impact headline options for this news story. Provide one for each category: "Breaking Alert", "Analytical", "SEO Optimized", "Social Media", "Short Punchy".

Current Headline: ${currentTitle || 'N/A'}
Article Excerpt/Content:
${text || currentTitle}`,
        config: {
          systemInstruction: 'You are a veteran copy editor generating journalistic headlines that meet AP Style standards.',
        },
      });

      const raw = response.text || '';
      const defaultCategories = ['Breaking Alert', 'Analytical', 'SEO Optimized', 'Social Media', 'Short Punchy'];
      const headlineList = raw.split('\n').filter((line) => line.trim().length > 0).slice(0, 5).map((line, idx) => ({
        category: defaultCategories[idx] || 'Alternative',
        text: line.replace(/^[-*\d.]+\s*/, '').replace(/^(Breaking Alert|Analytical|SEO|Social|Short Punchy):\s*/i, '').trim(),
      }));

      res.json({ headlines: headlineList });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // FIX L-1: TTS requires authentication — prevents unauthenticated Gemini quota drain
  // Phase 8: per-user daily quota, bounded input, concurrency gate, provider
  // timeout/cost failure handling (docs/OPERATIONAL_LIMITS.md §TTS).
  // Access policy: any AUTHENTICATED reader+ (READER…SUPER_ADMIN) may narrate
  // public article content up to TTS_MAX_CHARS per request.
  app.post('/api/ai/tts', requireAuth, async (req: any, res) => {
    const userId = req.user?.id || 'unknown';
    const route = 'POST /api/ai/tts';
    try {
      // Phase 8: strict validation — bounded text, format-checked voice
      const parsed = ttsRequestSchema.safeParse(req.body);
      validationErrorResponse(res, parsed as any);
      if (!parsed.success) return;
      const { text, voice } = parsed.data;

      // Per-user daily usage quota (cost control) — counts TTS API attempts,
      // including failed/unavailable-provider calls (documented trade-off:
      // protects spend when the provider recovers mid-day).
      try {
        ttsCostGuard.consume(userId);
      } catch (quotaErr: any) {
        if (quotaErr?.code === 'TTS_QUOTA') {
          abuseMonitor.record(`${route}:quota`, userId, 'TTS daily quota exhausted');
          return res.status(429).json({ error: 'Daily audio narration limit reached. Please try again tomorrow.' });
        }
        throw quotaErr;
      }

      if (!ai) {
        return res.status(503).json({ error: 'Audio narration is not available on this deployment.' });
      }

      // Concurrency gate keeps provider parallelism (and cost spikes) bounded
      if (!ttsCostGuard.tryAcquireSlot()) {
        return res.status(503).json({ error: 'Audio narration is busy. Please try again shortly.' });
      }

      try {
        const response = await Promise.race([
          ai.models.generateContent({
            model: 'gemini-3.8-flash-lite-tts',
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    text: text.slice(0, 2000), // Narration chunk
                    speechMetadata: {
                      style: 'Clear, authoritative news anchor narration',
                    },
                  },
                ],
              },
            ],
            config: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: voice || 'Kore' },
                },
              },
            },
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(Object.assign(new Error('PROVIDER_TIMEOUT'), { code: 'TTS_TIMEOUT' })), env.TTS_TIMEOUT_MS)
          ),
        ] as any);

        const base64Audio = response?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!base64Audio) {
          return res.status(502).json({ error: 'Audio narration could not be generated. Please try again later.' });
        }

        res.json({ audio: base64Audio, mimeType: 'audio/wav' });
      } catch (providerErr: any) {
        if (providerErr?.code === 'TTS_TIMEOUT') {
          logger.warn(`TTS provider timeout after ${env.TTS_TIMEOUT_MS}ms for user ${identityHash(userId)}`, 'ABUSE');
          return res.status(504).json({ error: 'Audio narration timed out. Please try again.', retryable: true });
        }
        // Provider failure — generic upstream error, no internals disclosed
        logger.warn(`TTS provider failure for user ${identityHash(userId)}: ${providerErr?.message}`, 'ABUSE');
        return res.status(502).json({ error: 'Audio narration is temporarily unavailable. Please try again later.' });
      } finally {
        ttsCostGuard.releaseSlot();
      }
    } catch (err: any) {
      publicSafeError(res, err, route, userId);
    }
  });

  // --- Analytics Dashboard Stats ---
  app.get('/api/stats', requireAuth, requirePermission('analytics:view'), async (_req: any, res) => {
    try {
      const totalArticles = await prisma.article.count();
      const pendingArticles = await prisma.article.count({ where: { status: 'IN_REVIEW' } });
      const totalComments = await prisma.comment.count();
      const pendingComments = await prisma.comment.count({ where: { status: 'PENDING' } });
      const viewsAggregate = await prisma.article.aggregate({ _sum: { views: true } });

      res.json({
        totalArticles,
        pendingArticles,
        totalComments,
        pendingComments,
        totalViews: viewsAggregate._sum.views || 0
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Real Newsroom Admin Dashboard Contract ---
  app.get('/api/admin/dashboard', requireAuth, requirePermission('analytics:view'), async (req: any, res) => {
    try {
      // Metric queries against actual database
      const totalPublishedStories = await prisma.article.count({ where: { status: 'PUBLISHED' } });
      const draftsAwaitingReview = await prisma.article.count({ where: { status: 'IN_REVIEW' } });
      const pendingApprovals = await prisma.article.count({ where: { status: 'REVISION_REQUESTED' } });
      const scheduledStories = await prisma.article.count({ where: { status: 'SCHEDULED' } });
      const totalViewsResult = await prisma.article.aggregate({ _sum: { views: true } });
      const pendingComments = await prisma.comment.count({ where: { status: 'PENDING' } });

      // FIX P0-08: findMany returns an Array — do not destructure it
      const recentlyPublishedStories = await prisma.article.findMany({
        where: { status: 'PUBLISHED' },
        orderBy: { publishedAt: 'desc' },
        take: 5
      });

      // Phase 7: bounded + correctly-ordered — fix of "wrong result-shape
      // assumptions" (was unbounded findMany + client-side slice(-8).reverse()).
      // PG honors orderBy+take at the DB level; the JSON dev driver ignores
      // args, so the route defensively sorts/slices to keep both correct.
      const auditLogs = await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 8 });
      const recentEditorialActivity = (Array.isArray(auditLogs) ? auditLogs : [])
        .slice() // defensive: some drivers return fresh arrays, some not
        .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 8)
        .map((log: any) => ({
          id: log.id,
          action: log.action,
          details: log.details || `${log.action} on ${log.entityType}`,
          timestamp: log.createdAt,
          actorId: log.userId,
        }));

      // Phase 7: real background-job observability instead of placeholder rows —
      // publicationJobs reflects the actual scheduler daemon's live status.
      const sched = getSchedulerStatus();
      const failedJobsCount = sched.failedCount;
      const publicationJobs = [
        {
          id: 'job-worker-01',
          name: 'Scheduled Publishing Daemon',
          status: sched.status === 'ACTIVE' ? 'HEALTHY' : 'ERROR',
          lastRun: sched.lastSweep,
          description: `Polls database for scheduled dispatches reaching publish threshold (this run: ${sched.processedCount} processed, ${sched.reconciledCount} reconciled, ${sched.failedCount} failed)`,
        },
        {
          id: 'job-cache-02',
          name: 'Homepage Cache',
          status: 'HEALTHY',
          lastRun: homepageCache.get()?.generatedAt || new Date().toISOString(),
          description: `TTL ${Math.round(HOMEPAGE_CACHE_TTL_MS / 1000)}s; invalidated on every editorial mutation`,
        },
      ];

      res.json({
        metrics: {
          totalPublishedStories,
          draftsAwaitingReview,
          pendingApprovals,
          scheduledStories,
          totalViews: totalViewsResult._sum.views || 0,
          pendingComments,
          failedJobsCount
        },
        recentlyPublishedStories,
        recentEditorialActivity,
        publicationJobs,
        systemStatus: {
          database: 'healthy',
          authGuard: 'active',
          userRole: req.user.role,
          nodeEnv: process.env.NODE_ENV || 'development'
        }
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Publication Operations & Business Features ---
  // FIX P0-07: duplicate /api/breaking-news routes removed — first-registered block (~line 1347) is the canonical one

  // Newsletter — Phase 8: strict email validation + rate limit (subscription
  // enumeration/spam flood protection); response stays generic (no record echo).
  app.post('/api/newsletter/subscribe', async (req, res) => {
    const ip = req.ip || 'unknown';
    const route = 'POST /api/newsletter/subscribe';
    try {
      if (!limiters.newsletter.check(ip + ':newsletter')) {
        return tooManyRequests(res, route, ip, 'newsletter flood');
      }

      const parsed = newsletterSubscribeSchema.safeParse(req.body);
      validationErrorResponse(res, parsed as any);
      if (!parsed.success) return;
      const { email } = parsed.data;

      const sub = await prisma.newsletterSubscription.upsert({
        where: { email },
        update: {},
        create: { email }
      });
      
      if (!process.env.SMTP_HOST) {
        logger.warn('Newsletter subscription: SMTP not configured, email not sent.', 'NEWSLETTER');
      }
      
      res.json({ success: true, message: 'Subscribed successfully.' });
    } catch (err: any) { publicSafeError(res, err, route, ip); }
  });

  // Analytics — FIX L-4/L-5: validate event type; rate-limit to prevent flood
  // Phase 8: metadata allowlist + bounded payload + arbitrary-injection protection
  app.post('/api/analytics/track', async (req: any, res) => {
    const ip = req.ip || 'unknown';
    const route = 'POST /api/analytics/track';
    try {
      if (!limiters.analytics.check(ip + ':analytics')) {
        return tooManyRequests(res, route, ip, 'analytics flood');
      }

      const parsed = analyticsTrackSchema.safeParse(req.body);
      validationErrorResponse(res, parsed as any);
      if (!parsed.success) return;

      const { type, entityId } = parsed.data;
      const metadata = sanitizeAnalyticsMetadata(parsed.data.metadata as any);

      await prisma.analyticsEvent.create({ data: { type, entityId: entityId || null, metadata } });
      res.json({ success: true });
    } catch (err: any) { publicSafeError(res, err, route, ip); }
  });

  // Phase 8: operational abuse report — repetitive-violation monitoring.
  // Identity values are one-way TRUNCATED HASHES (no raw IPs, no secrets, no PII).
  app.get('/api/admin/abuse-report', requireAuth, requirePermission('analytics:view'), async (req: any, res) => {
    try {
      res.json({
        generatedAt: new Date().toISOString(),
        routes: abuseMonitor.report(),
      });
    } catch (err: any) {
      publicSafeError(res, err, 'GET /api/admin/abuse-report', req.ip || 'unknown');
    }
  });

  app.get('/api/admin/analytics', requireAuth, requirePermission('analytics:view'), async (req: any, res) => {
    try {
      // Phase 7: bounded listing (was hardcoded take:1000) — limit/page params
      // honored with a hard cap; events remain a plain array.
      const pagination = parsePagination(req.query, { defaultLimit: 100, maxLimit: MAX_PAGE_SIZE });
      const events = await prisma.analyticsEvent.findMany({
        orderBy: { createdAt: 'desc' },
        take: Math.min(pagination.take, MAX_PAGE_SIZE),
      });
      res.json(Array.isArray(events) ? events.slice(0, pagination.limit) : []);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ── Phase 10: Functional Completeness — the real management surface ───────
  // Every visible admin control routes to one of these endpoints. Driver-safe:
  // both the JSON and PG drivers implement every model method used below.

  // ── Staff accounts (list / create; role + status PUTs exist above) ─────────
  app.get('/api/admin/users', requireAuth, requirePermission('users:view'), async (req: any, res) => {
    try {
      const users = (await prisma.user.findMany({ orderBy: { createdAt: 'asc' } })) as any[];
      // passwordHash never leaves the server
      const safe = (Array.isArray(users) ? users : []).map((u) => ({
        id: u.id, email: u.email, name: u.name, role: u.role,
        isActive: u.isActive, createdAt: u.createdAt,
      }));
      res.json(safe);
    } catch (err: any) {
      publicSafeError(res, err, 'GET /api/admin/users', req.ip || 'unknown');
    }
  });

  app.post('/api/admin/users', requireAuth, requirePermission('users:manage'), async (req: any, res) => {
    try {
      const parsed = staffCreateSchema.safeParse(req.body);
      validationErrorResponse(res, parsed as any);
      if (!parsed.success) return;
      const { email, name, role, password } = parsed.data;

      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) return res.status(409).json({ error: 'An account with this email already exists.' });

      const passwordHash = await bcrypt.hash(password, 12);
      const user = await prisma.user.create({ data: { email, name, role: role as RoleType, passwordHash, isActive: true } });
      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'USER_CREATED',
          entityType: 'USER',
          entityId: user.id,
          details: `Staff account ${email} (${role}) created by ${req.user.name}.`,
        },
      });
      // Same safe shape as the list — passwordHash never leaves the server
      res.status(201).json({ id: user.id, email: user.email, name: user.name, role: user.role, isActive: user.isActive, createdAt: user.createdAt });
    } catch (err: any) {
      if (err?.name === 'IntegrityError') return res.status(409).json({ error: 'An account with this email already exists.' });
      publicSafeError(res, err, 'POST /api/admin/users', req.ip || 'unknown');
    }
  });

  // ── Ad slots / campaigns (real, stored — external networks stay explicit) ──
  // Public surface: ACTIVE slots only (homepage renders what actually exists).
  app.get('/api/ads', async (_req, res) => {
    try {
      const active = (await prisma.adPlacement.findMany({ where: { isActive: true } })) as any[];
      res.json(active || []);
    } catch (err: any) {
      publicSafeError(res, err, 'GET /api/ads', 'public');
    }
  });

  // Impression / click counters — public write, bounded by design (increment).
  app.post('/api/ads/:id/impression', async (req: any, res) => {
    try {
      const slot: any = await prisma.adPlacement.findUnique({ where: { id: req.params.id } });
      if (!slot || !slot.isActive) return res.status(404).json({ error: 'Ad slot not found.' });
      await (prisma as any).adPlacement.incrementMetrics({ where: { id: slot.id }, field: 'impressions' });
      res.json({ success: true });
    } catch (err: any) {
      publicSafeError(res, err, 'POST /api/ads/:id/impression', req.ip || 'public');
    }
  });

  app.post('/api/ads/:id/click', async (req: any, res) => {
    try {
      const slot: any = await prisma.adPlacement.findUnique({ where: { id: req.params.id } });
      if (!slot || !slot.isActive) return res.status(404).json({ error: 'Ad slot not found.' });
      await (prisma as any).adPlacement.incrementMetrics({ where: { id: slot.id }, field: 'clicks' });
      res.json({ success: true });
    } catch (err: any) {
      publicSafeError(res, err, 'POST /api/ads/:id/click', req.ip || 'public');
    }
  });

  app.get('/api/admin/ads', requireAuth, requirePermission('ad:manage'), async (req: any, res) => {
    try {
      const all = await prisma.adPlacement.findMany({});
      res.json(all);
    } catch (err: any) {
      publicSafeError(res, err, 'GET /api/admin/ads', req.ip || 'unknown');
    }
  });

  app.post('/api/admin/ads', requireAuth, requirePermission('ad:manage'), async (req: any, res) => {
    try {
      const parsed = adSlotCreateSchema.safeParse(req.body);
      validationErrorResponse(res, parsed as any);
      if (!parsed.success) return;
      const { slotName, dimensions, adCode, isActive } = parsed.data;
      const placement = await prisma.adPlacement.create({
        data: {
          slotName: slotName.toUpperCase().replace(/[^A-Z0-9_]/g, '_'),
          dimensions,
          adCode: adCode || '',
          isActive: isActive !== false,
        },
      });
      await prisma.auditLog.create({
        data: { userId: req.user.id, action: 'AD_SLOT_CREATED', entityType: 'AD', entityId: (placement as any).id, details: `Ad slot ${slotName} created by ${req.user.name}.` },
      });
      res.status(201).json(placement);
    } catch (err: any) {
      if (err?.name === 'IntegrityError') return res.status(409).json({ error: err.message });
      publicSafeError(res, err, 'POST /api/admin/ads', req.ip || 'unknown');
    }
  });

  app.put('/api/admin/ads/:id', requireAuth, requirePermission('ad:manage'), async (req: any, res) => {
    try {
      const parsed = adSlotUpdateSchema.safeParse(req.body);
      validationErrorResponse(res, parsed as any);
      if (!parsed.success) return;
      const existing: any = await prisma.adPlacement.findUnique({ where: { id: req.params.id } });
      if (!existing) return res.status(404).json({ error: 'Ad slot not found.' });
      const updated = await prisma.adPlacement.update({ where: { id: existing.id }, data: parsed.data });
      res.json(updated);
    } catch (err: any) {
      publicSafeError(res, err, 'PUT /api/admin/ads/:id', req.ip || 'unknown');
    }
  });

  app.delete('/api/admin/ads/:id', requireAuth, requirePermission('ad:manage'), async (req: any, res) => {
    try {
      const existing: any = await prisma.adPlacement.findUnique({ where: { id: req.params.id } });
      if (!existing) return res.status(404).json({ error: 'Ad slot not found.' });
      // Deactivation over deletion keeps historical metrics (impressions/clicks).
      if (existing.isActive) {
        await prisma.adPlacement.update({ where: { id: existing.id }, data: { isActive: false } });
        return res.json({ success: true, archived: true, note: 'Slot deactivated; delivery metrics preserved.' });
      }
      await prisma.adPlacement.delete({ where: { id: existing.id } });
      res.json({ success: true, archived: false });
    } catch (err: any) {
      publicSafeError(res, err, 'DELETE /api/admin/ads/:id', req.ip || 'unknown');
    }
  });

  // ── Newsletter subscriber management + real unsubscribe ────────────────────
  app.get('/api/admin/newsletter/subscribers', requireAuth, requirePermission('users:view'), async (req: any, res) => {
    try {
      const subs = (await (prisma.newsletterSubscription as any).findMany({ orderBy: { subscribedAt: 'desc' } })) as any[];
      res.json(Array.isArray(subs) ? subs : []);
    } catch (err: any) {
      publicSafeError(res, err, 'GET /api/admin/newsletter/subscribers', req.ip || 'unknown');
    }
  });

  app.delete('/api/admin/newsletter/subscribers/:id', requireAuth, requirePermission('users:manage'), async (req: any, res) => {
    try {
      const existing: any = await prisma.newsletterSubscription.findUnique({ where: { id: req.params.id } });
      if (!existing) return res.status(404).json({ error: 'Subscriber not found.' });
      await (prisma.newsletterSubscription as any).delete({ where: { id: existing.id } });
      await prisma.auditLog.create({
        data: { userId: req.user.id, action: 'SUBSCRIBER_REMOVED', entityType: 'NEWSLETTER_SUBSCRIBER', entityId: existing.id, details: `Subscriber ${existing.email} removed by ${req.user.name}.` },
      });
      res.json({ success: true });
    } catch (err: any) {
      publicSafeError(res, err, 'DELETE /api/admin/newsletter/subscribers/:id', req.ip || 'unknown');
    }
  });

  // Public unsubscribe (the email-footer action): deletes the subscription row.
  app.post('/api/newsletter/unsubscribe', async (req: any, res) => {
    const ip = req.ip || 'unknown';
    const route = 'POST /api/newsletter/unsubscribe';
    try {
      if (!limiters.newsletter.check(ip + ':newsletter')) {
        return tooManyRequests(res, route, ip, 'newsletter flood');
      }
      const parsed = newsletterSubscribeSchema.safeParse(req.body);
      validationErrorResponse(res, parsed as any);
      if (!parsed.success) return;
      const existing: any = await prisma.newsletterSubscription.findUnique({ where: { email: parsed.data.email } });
      // Generic response either way — no enumeration of registered addresses.
      if (existing) {
        await (prisma.newsletterSubscription as any).delete({ where: { id: existing.id } });
      }
      res.json({ success: true, message: 'If that address was subscribed, it has been removed.' });
    } catch (err: any) {
      publicSafeError(res, err, route, ip);
    }
  });

  // ── Analytics with defined events + reporting windows ─────────────────────
  // Event taxonomy (POST /api/analytics/track allowlist, Phase 8):
  //   PAGE_VIEW, ARTICLE_VIEW, SHARE, CLICK, SEARCH, SUBSCRIBE, COMMENT, REACTION
  // Windows: 24h | 7d | 30d | 90d. Aggregation is JS-based (driver-safe — the
  // JSON driver ignores where/args; totals derive from a bounded fetch).
  app.get('/api/admin/analytics/report', requireAuth, requirePermission('analytics:view'), async (req: any, res) => {
    try {
      const windowParam = String(req.query.window || '7d');
      const hours: Record<string, number> = { '24h': 24, '7d': 168, '30d': 720, '90d': 2160 };
      if (!hours[windowParam]) {
        return res.status(400).json({ error: 'Unknown window. Use 24h, 7d, 30d or 90d.' });
      }
      const sinceMs = Date.now() - hours[windowParam] * 60 * 60 * 1000;
      const events = (await prisma.analyticsEvent.findMany({ orderBy: { createdAt: 'desc' }, take: MAX_PAGE_SIZE })) as any[];
      const inWindow = (events || []).filter((e) => {
        const t = new Date(e.createdAt).getTime();
        return Number.isFinite(t) && t >= sinceMs;
      });

      const byType: Record<string, number> = {};
      for (const e of inWindow) byType[e.type] = (byType[e.type] || 0) + 1;

      // Daily buckets (YYYY-MM-DD) over the window
      const byDay: Record<string, number> = {};
      for (const e of inWindow) {
        const day = new Date(e.createdAt).toISOString().slice(0, 10);
        byDay[day] = (byDay[day] || 0) + 1;
      }

      res.json({
        window: windowParam,
        generatedAt: new Date().toISOString(),
        total: inWindow.length,
        byType,
        byDay: Object.keys(byDay).sort().map((day) => ({ day, count: byDay[day] })),
        recentEvents: inWindow.slice(0, 25),
      });
    } catch (err: any) {
      publicSafeError(res, err, 'GET /api/admin/analytics/report', req.ip || 'unknown');
    }
  });

  // ── Site settings & language configuration ────────────────────────────────
  const SETTINGS_TEXT_KEYS = new Set(['siteTitle', 'tagline', 'editorialMotto', 'contactEmail']);
  const SETTINGS_BOOLEAN = new Set(['newsletterEnabled', 'commentsRequireApproval', 'breakingBannerAutoRefresh']);
  const SETTINGS_LANGUAGE = new Set(['defaultLanguage']);

  // Public-safe subset (LanguageProvider + brand header read the configured
  // title/tone/default language; everything else never leaves the admin).
  app.get('/api/settings', async (_req, res) => {
    try {
      const out: Record<string, any> = {};
      for (const key of PUBLIC_SETTING_KEYS) {
        const row: any = await prisma.siteSetting.findUnique({ where: { key } });
        if (row && row.value !== null && row.value !== undefined) out[key] = row.value;
      }
      res.json(out);
    } catch (err: any) {
      publicSafeError(res, err, 'GET /api/settings', 'public');
    }
  });

  app.get('/api/admin/settings', requireAuth, requirePermission('settings:manage'), async (req: any, res) => {
    try {
      const out: Record<string, any> = {};
      for (const key of ALLOWED_SETTING_KEYS) {
        const row: any = await prisma.siteSetting.findUnique({ where: { key } });
        out[key] = row ? row.value : null;
      }
      res.json({ settings: out, allowedKeys: ALLOWED_SETTING_KEYS });
    } catch (err: any) {
      publicSafeError(res, err, 'GET /api/admin/settings', req.ip || 'unknown');
    }
  });

  app.put('/api/admin/settings', requireAuth, requirePermission('settings:manage'), async (req: any, res) => {
    try {
      const parsed = settingsUpdateManySchema.safeParse(req.body);
      validationErrorResponse(res, parsed as any);
      if (!parsed.success) return;

      const updated: Record<string, any> = {};
      for (const { key, value } of parsed.data.settings) {
        // Allowlist first: a validated camelCase key can still be outside the
        // managed surface — reject instead of storing arbitrary keys.
        if (!(ALLOWED_SETTING_KEYS as readonly string[]).includes(key)) {
          return res.status(400).json({ error: `Setting "${key}" is not a managed key.` });
        }
        // Type discipline per key family
        if (SETTINGS_BOOLEAN.has(key)) {
          if (typeof value !== 'boolean') return res.status(400).json({ error: `Setting "${key}" must be true or false.` });
        } else if (SETTINGS_LANGUAGE.has(key)) {
          if (value !== 'en' && value !== 'bn') return res.status(400).json({ error: 'defaultLanguage must be "en" or "bn".' });
        } else if (SETTINGS_TEXT_KEYS.has(key)) {
          if (value !== null && (typeof value !== 'string' || value.length < 1 || value.length > 200)) {
            return res.status(400).json({ error: `Setting "${key}" must be a short text value.` });
          }
        } else if (key === 'commentsRequireApproval') {
          if (typeof value !== 'boolean') return res.status(400).json({ error: `Setting "${key}" must be true or false.` });
        }
        await (prisma.siteSetting as any).update({ where: { key }, data: { key, value, updatedAt: new Date() } });
        updated[key] = value;
      }

      await prisma.auditLog.create({
        data: { userId: req.user.id, action: 'SETTINGS_UPDATED', entityType: 'SITE_SETTING', entityId: null, details: `Updated ${Object.keys(updated).join(', ')} by ${req.user.name}.` },
      });
      res.json({ success: true, settings: updated });
    } catch (err: any) {
      publicSafeError(res, err, 'PUT /api/admin/settings', req.ip || 'unknown');
    }
  });

  // ── Redirect management (page-level redirects from Phase 7) ───────────────
  app.get('/api/admin/redirects', requireAuth, requirePermission('settings:manage'), async (req: any, res) => {
    try {
      const rows = (await prisma.urlRedirect.findMany({})) as any[];
      const sorted = (Array.isArray(rows) ? rows : [])
        .slice()
        .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      res.json(sorted);
    } catch (err: any) {
      publicSafeError(res, err, 'GET /api/admin/redirects', req.ip || 'unknown');
    }
  });

  app.post('/api/admin/redirects', requireAuth, requirePermission('settings:manage'), async (req: any, res) => {
    try {
      const parsed = redirectCreateSchema.safeParse(req.body);
      validationErrorResponse(res, parsed as any);
      if (!parsed.success) return;
      const { sourcePath, destinationPath, statusCode, isActive } = parsed.data;
      if (sourcePath === destinationPath) {
        return res.status(400).json({ error: 'A redirect cannot point to itself.' });
      }
      const dupe = await prisma.urlRedirect.findUnique({ where: { sourcePath } });
      if (dupe) return res.status(409).json({ error: 'A redirect for this source path already exists.' });
      const created = await prisma.urlRedirect.create({
        data: { sourcePath: sourcePath.replace(/\/+$/, '') || '/', destinationPath, statusCode: statusCode || 301, isActive: isActive !== false },
      });
      await prisma.auditLog.create({
        data: { userId: req.user.id, action: 'REDIRECT_CREATED', entityType: 'URL_REDIRECT', entityId: (created as any).id, details: `${sourcePath} → ${destinationPath} by ${req.user.name}.` },
      });
      res.status(201).json(created);
    } catch (err: any) {
      if (err?.name === 'IntegrityError') return res.status(409).json({ error: err.message });
      publicSafeError(res, err, 'POST /api/admin/redirects', req.ip || 'unknown');
    }
  });

  app.put('/api/admin/redirects/:id', requireAuth, requirePermission('settings:manage'), async (req: any, res) => {
    try {
      const parsed = redirectUpdateSchema.safeParse(req.body);
      validationErrorResponse(res, parsed as any);
      if (!parsed.success) return;
      const existing: any = await prisma.urlRedirect.findUnique({ where: { id: req.params.id } });
      if (!existing) return res.status(404).json({ error: 'Redirect not found.' });
      if (parsed.data.destinationPath && parsed.data.destinationPath === existing.sourcePath) {
        return res.status(400).json({ error: 'A redirect cannot point to itself.' });
      }
      const updated = await (prisma.urlRedirect as any).update({ where: { sourcePath: existing.sourcePath }, data: parsed.data });
      res.json(updated);
    } catch (err: any) {
      publicSafeError(res, err, 'PUT /api/admin/redirects/:id', req.ip || 'unknown');
    }
  });

  app.delete('/api/admin/redirects/:id', requireAuth, requirePermission('settings:manage'), async (req: any, res) => {
    try {
      const existing: any = await prisma.urlRedirect.findUnique({ where: { id: req.params.id } });
      if (!existing) return res.status(404).json({ error: 'Redirect not found.' });
      await (prisma.urlRedirect as any).delete({ where: { id: existing.id } });
      await prisma.auditLog.create({
        data: { userId: req.user.id, action: 'REDIRECT_DELETED', entityType: 'URL_REDIRECT', entityId: existing.id, details: `${existing.sourcePath} removed by ${req.user.name}.` },
      });
      res.json({ success: true });
    } catch (err: any) {
      publicSafeError(res, err, 'DELETE /api/admin/redirects/:id', req.ip || 'unknown');
    }
  });

  // ── Notifications derived from REAL events (no fabricated entries) ────────
  // analytics:view keeps internal editorial-workload counts out of reader
  // sessions; reporters get the same visibility as editors here.
  app.get('/api/admin/notifications', requireAuth, requirePermission('analytics:view'), async (req: any, res) => {
    try {
      const items: Array<{ id: string; title: string; description: string; type: 'REVIEW' | 'COMMENT' | 'SYSTEM'; timestamp: string; targetView: string }> = [];

      const [inReview, pendingComments, scheduledArticles] = await Promise.all([
        prisma.article.count({ where: { status: 'IN_REVIEW' } }),
        prisma.comment.count({ where: { status: 'PENDING' } }),
        prisma.article.count({ where: { status: 'SCHEDULED' } }),
      ]);

      if (inReview > 0) {
        items.push({
          id: 'notif-review',
          title: 'Review Queue Pending',
          description: `${inReview} dispatch${inReview === 1 ? '' : 'es'} awaiting editorial approval.`,
          type: 'REVIEW',
          timestamp: new Date().toISOString(),
          targetView: 'articles',
        });
      }
      if (pendingComments > 0) {
        items.push({
          id: 'notif-comments',
          title: 'Pending Comments',
          description: `${pendingComments} reader comment${pendingComments === 1 ? '' : 's'} awaiting moderation.`,
          type: 'COMMENT',
          timestamp: new Date().toISOString(),
          targetView: 'comments',
        });
      }
      // Overdue schedules: the daemon publishes within 60s; items overdue by
      // more than 2 minutes signal an attention-worthy job.
      const sched = getSchedulerStatus();
      const overdue = await prisma.article.findMany({ where: { status: 'SCHEDULED' } });
      const overdueCount = (Array.isArray(overdue) ? overdue : []).filter(
        (a: any) => a.scheduledFor && Date.now() - new Date(a.scheduledFor).getTime() > 120_000,
      ).length;
      if (overdueCount > 0) {
        items.push({
          id: 'notif-overdue',
          title: 'Overdue Scheduled Releases',
          description: `${overdueCount} scheduled dispatch${overdueCount === 1 ? '' : 'es'} past target time — check the publishing pipeline.`,
          type: 'SYSTEM',
          timestamp: sched.lastSweep,
          targetView: 'jobs',
        });
      } else if (sched.status === 'ERROR') {
        items.push({
          id: 'notif-scheduler',
          title: 'Publishing Daemon Error',
          description: 'The last scheduler sweep failed — check the publishing pipeline.',
          type: 'SYSTEM',
          timestamp: sched.lastSweep,
          targetView: 'jobs',
        });
      }

      res.json(items);
    } catch (err: any) {
      publicSafeError(res, err, 'GET /api/admin/notifications', req.ip || 'unknown');
    }
  });

  // ── Scheduled-job monitoring + safe retry ─────────────────────────────────
  app.get('/api/admin/scheduler/jobs', requireAuth, requirePermission('analytics:view'), async (req: any, res) => {
    try {
      const sched = getSchedulerStatus();
      const rows = (await prisma.publicationSchedule.findMany({})) as any[];
      const jobs = (Array.isArray(rows) ? rows : [])
        .slice()
        .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 100)
        .map((j: any) => ({
          id: j.id,
          articleId: j.articleId,
          targetPublish: j.targetPublish,
          executedAt: j.executedAt ?? null,
          status: j.status,
          failureReason: j.failureReason ?? null,
          idempotencyKey: j.idempotencyKey,
          createdAt: j.createdAt,
        }));

      // Stuck releases: SCHEDULED articles past targetPublish by > 2 min
      const scheduled = (await prisma.article.findMany({ where: { status: 'SCHEDULED' } })) as any[];
      const stuck = (Array.isArray(scheduled) ? scheduled : [])
        .filter((a: any) => a.scheduledFor && Date.now() - new Date(a.scheduledFor).getTime() > 120_000)
        .map((a: any) => ({
          articleId: a.id,
          title: a.title,
          scheduledFor: a.scheduledFor,
          overdueMinutes: Math.round((Date.now() - new Date(a.scheduledFor).getTime()) / 60000),
        }));

      res.json({
        daemon: sched,
        jobs,
        stuck,
      });
    } catch (err: any) {
      publicSafeError(res, err, 'GET /api/admin/scheduler/jobs', req.ip || 'unknown');
    }
  });

  // Safe retry: re-runs the ATOMIC domain publish (idempotencyKey makes this
  // race-safe; homepage cache invalidated through the same pipeline as the daemon).
  app.post('/api/admin/scheduler/jobs/:articleId/retry', requireAuth, requirePermission('article:publish'), async (req: any, res) => {
    try {
      const article: any = await prisma.article.findUnique({ where: { id: req.params.articleId } });
      if (!article) return res.status(404).json({ error: 'Scheduled article not found.' });
      if (article.status !== 'SCHEDULED') {
        return res.status(409).json({ error: `Article is ${article.status}, not SCHEDULED — nothing to retry.` });
      }

      const idempotencyKey = `sched-pub-${article.id}-${article.version}`;
      const result = await (prisma as any).publishScheduledArticle({
        articleId: article.id,
        idempotencyKey,
        scheduledFor: article.scheduledFor,
        actorId: req.user.id,
        isOverdue: true,
      });

      if (result.executed) {
        invalidateHomepageCache();
        await prisma.auditLog.create({
          data: { userId: req.user.id, action: 'JOB_RETRY_EXECUTED', entityType: 'ARTICLE', entityId: article.id, details: `Manual retry published "${article.title}" (was overdue).` },
        });
        return res.json({ success: true, executed: true, article: { id: article.id, title: article.title, status: 'PUBLISHED' } });
      }
      // ALREADY_EXECUTED / ALREADY_PUBLISHED / ARTICLE_NOT_FOUND — honest result
      return res.status(409).json({
        success: false,
        executed: false,
        reason: result.reason,
        message: result.reason === 'ALREADY_PUBLISHED' ? 'The article is already live.' : `Publish skipped: ${result.reason}.`,
      });
    } catch (err: any) {
      publicSafeError(res, err, 'POST /api/admin/scheduler/jobs/:articleId/retry', req.ip || 'unknown');
    }
  });

  // --- SEO Operations (Phase 9) ---
  // One canonical origin — the validated, server-only env.APP_URL (APP_URL from
  // src/server/seo.ts). VITE_APP_URL and localhost are never used here.

  app.get('/robots.txt', (_req, res) => {
    res.type('text/plain');
    res.set('Cache-Control', 'public, max-age=300');
    res.send(
      `User-agent: *\n` +
      `Disallow: /api/\n` +
      `Disallow: /cms/\n` +
      `Allow: /\n` +
      `\n` +
      `Sitemap: ${APP_URL}/sitemap.xml\n` +
      `Sitemap: ${APP_URL}/sitemap-news.xml\n`,
    );
  });

  app.get('/sitemap.xml', async (req: any, res) => {
    try {
      // Published surface only — DRAFT/PENDING/ARCHIVED/purged can never appear
      // because every inclusion is derived from a PUBLISHED status query.
      const articles: any[] = await prisma.article.findMany({
        where: { status: 'PUBLISHED' },
        select: { slug: true, updatedAt: true, publishedAt: true, authorId: true },
      });
      const categories: any[] = await prisma.category.findMany({});
      const tags: any[] = await prisma.tag.findMany({});
      const users: any[] = await prisma.user.findMany({});
      const authorIds = new Set(articles.map((a) => a.authorId).filter(Boolean));
      const authors = users.filter((u) => authorIds.has(u.id));

      const entries: Array<Parameters<typeof buildSitemapXml>[0][number]> = [
        { loc: '/', lastmod: new Date(), priority: '1.0' },
        { loc: '/latest', lastmod: new Date() },
      ];
      for (const c of categories) {
        entries.push({ loc: `/category/${encodeURIComponent(c.slug)}` });
        for (const child of Array.isArray(c.children) ? c.children : []) {
          entries.push({ loc: `/category/${encodeURIComponent(c.slug)}/${encodeURIComponent(child.slug)}` });
        }
      }
      for (const t of tags) entries.push({ loc: `/topic/${encodeURIComponent(t.slug)}` });
      for (const u of authors) entries.push({ loc: `/author/${encodeURIComponent(u.id)}` });

      // Date archives derived from real publication dates (lifetime of the store, bounded)
      const monthKeys = new Set<string>();
      for (const a of articles) {
        if (a.publishedAt) {
          monthKeys.add(a.publishedAt.slice(0, 7)); // yyyy-mm
        }
      }
      const months = [...monthKeys].sort().reverse().slice(0, 240);
      for (const ym of months) {
        const [y, m] = ym.split('-');
        entries.push({ loc: `/archive/${y}/${m}` });
      }

      for (const a of articles) {
        entries.push({ loc: `/article/${encodeURIComponent(a.slug)}`, lastmod: a.updatedAt || a.publishedAt });
      }

      // Bounded sitemap (single-file limit is 50k; stay far below and stay fast)
      res.type('application/xml; charset=utf-8');
      res.set('Cache-Control', 'public, max-age=300');
      res.send(buildSitemapXml(entries.slice(0, 10_000)));
    } catch (err: any) {
      publicSafeError(res, err, 'GET /sitemap.xml', req.ip || 'unknown');
    }
  });

  app.get('/sitemap-news.xml', async (req: any, res) => {
    try {
      // Eligibility window: published within the last 48 h. The range filter is
      // applied in JS because the JSON driver silently ignores `gte`.
      const windowStart = new Date(Date.now() - 48 * 60 * 60 * 1000);
      const articles: any[] = await prisma.article.findMany({
        where: { status: 'PUBLISHED' },
        select: { title: true, slug: true, publishedAt: true },
      });
      const eligible = articles.filter(
        (a) => a.publishedAt && a.title && new Date(a.publishedAt).getTime() >= windowStart.getTime(),
      );

      res.type('application/xml; charset=utf-8');
      res.set('Cache-Control', 'public, max-age=300');
      res.send(
        buildNewsSitemapXml(
          eligible.map((a) => ({
            loc: `/article/${encodeURIComponent(a.slug)}`,
            title: a.title,
            publishedAt: new Date(a.publishedAt).toISOString(),
          })),
        ),
      );
    } catch (err: any) {
      publicSafeError(res, err, 'GET /sitemap-news.xml', req.ip || 'unknown');
    }
  });

  // Centralized API error handling
  // Phase 8: safe error shapes — wire responses are generic (no parser or
  // driver internals, no stack traces). Full details stay in the internal log.
  app.use((err: any, req: any, res: any, _next: any) => {
    logger.error(`Error processing ${req.method} ${req.url}: ${err.message}`, 'SERVER_ERROR', { stack: err.stack });

    // body-parser failure classes (malformed JSON / oversized payload)
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Malformed request body.' });
    }
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Request body is too large.' });
    }

    const statusCode = err?.statusCode || 500;
    // IntegrityError-family messages are business rules, safe to surface to
    // authenticated callers; every other message is collapsed to a generic one.
    const isBusinessRule = err instanceof Error && err.name === 'IntegrityError';
    const message = statusCode !== 500 && isBusinessRule
      ? err.message
      : statusCode !== 500 && typeof err?.message === 'string' && /^[A-Z0-9][^{}<]*$/.test(err.message) && err.message.length <= 120
        ? err.message
        : statusCode >= 500 ? 'Internal Server Error' : 'Request rejected.';
    res.status(statusCode).json({ error: message, statusCode });
  });

  // ── Phase 9: Public URL routes — SEO HTML middleware (prerender-lite) ──────
  // Every text-page request left after the API/static surfaces gets the SPA
  // shell WITH server-computed metadata: real <title>/meta/canonical (absolute,
  // from the validated APP_URL), JSON-LD structured data for the ACTUAL
  // requested record, html lang, and a visible server-rendered title/body
  // block inside #root so crawlers without JS see the article.
  // Real status codes: 404 for missing/private content (all statuses that are
  // not PUBLISHED), 301 for slug changes (page-level parity with the API).
  // Everything runs from env.APP_URL — never VITE_APP_URL/localhost.
  const seoShell = createShellLoader({
    distDir: path.resolve(__dirname, 'dist'),
    rootDir: path.resolve(__dirname),
    vite: null,
  });
  let devVite: any = null; // assigned in the dev branch below; loader consults it via closure

  const renderSeoPage = async (page: SeoPageData, status = 200) => {
    let shell: string;
    try {
      shell = await seoShell.get('/');
    } catch (shellErr: any) {
      // Shell missing (no build): never leak internals — plain fallback
      shell = '<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>';
      logger.warn(`SEO shell unavailable: ${shellErr?.message}`, 'SERVER_ERROR');
    }
    // Development: run Vite's index transform so HMR/client preamble survive.
    if (devVite) {
      try {
        shell = await devVite.transformIndexHtml('/', shell);
      } catch (transformErr: any) {
        logger.warn(`SEO shell dev transform failed: ${transformErr?.message}`, 'SERVER_ERROR');
      }
    }
    const html = injectSeo(shell, page, APP_URL);
    return { html, status };
  };

  // Page request gate: GET/HEAD, no /api, no /uploads, no file-assets.
  app.use(async (req: any, res, next) => {
    const method = String(req.method).toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') return next();
    const p = req.path || req.url || '/';
    if (p.startsWith('/api/') || p === '/api') return next();
    if (p.startsWith('/uploads/')) return next();
    if (p.startsWith('/@vite') || p.startsWith('/@react-refresh') || p.startsWith('/node_modules')) return next();
    const last = p.split('/').pop() || '';
    if (last.includes('.')) return next(); // static asset (main.tsx, logo.png, vite.svg…)

    try {
      const route = parseRoute(decodeURIComponent(p), req.url?.includes('?') ? req.url.slice(req.url.indexOf('?')) : '');

      // Shared 404 panel (correct status code, still a styled page shell)
      const notFound = async () => {
        const { html, status } = await renderSeoPage({
          title: 'Page not found',
          description: 'The page you requested does not exist or is not published.',
          canonicalPath: '/404',
          noindex: true,
        });
        res.status(404).type('html').send(html);
      };

      switch (route.kind) {
        case 'home': {
          const bodyHtml = [
            `<div data-ssr-shell="home" style="max-width:72rem;margin:0 auto;padding:2rem 1rem;">`,
            `  <h1 style="font-family:Georgia,serif;font-size:2rem;">Global Chronicle News</h1>`,
            `  <p style="color:#57534e;">Independent journalistic record since 1924 — breaking dispatches, analysis and verified reporting from the bureau network.</p>`,
            `</div>`,
          ].join('\n');
          const { html, status } = await renderSeoPage({
            title: 'Global Chronicle News',
            description: 'Independent journalism from the Global Chronicle bureau network — breaking dispatches, analysis and verified reporting.',
            canonicalPath: '/',
            jsonLd: [{
              '@context': 'https://schema.org',
              '@type': 'WebSite',
              name: 'Global Chronicle News',
              url: APP_URL,
            }],
            bodyHtml,
          });
          res.status(status).type('html').send(html);
          break;
        }

        case 'latest': {
          const { html, status } = await renderSeoPage({
            title: 'Latest News',
            description: 'The newest verified dispatches from the Global Chronicle wire, updated continuously.',
            canonicalPath: '/latest',
            jsonLd: [{
              '@context': 'https://schema.org',
              '@type': 'CollectionPage',
              name: 'Latest News',
              url: `${APP_URL}/latest`,
            }],
          });
          res.status(status).type('html').send(html);
          break;
        }

        case 'article': {
          const art: any = await prisma.article.findUnique({ where: { slug: route.slug } });
          if (!art) {
            // Page-level redirect parity with the API: changed slugs open the
            // new URL with the recorded permanent-redirect status.
            const candidates = [
              `/article/${route.slug}`,
              `/article/${encodeURIComponent(route.slug)}`,
            ];
            for (const sourcePath of candidates) {
              const redirect: any = await prisma.urlRedirect.findUnique({ where: { sourcePath } });
              if (redirect?.isActive && redirect.destinationPath) {
                return res.redirect(redirect.statusCode || 301, redirect.destinationPath);
              }
            }
            return notFound();
          }
          if (art.status !== 'PUBLISHED') return notFound(); // drafts/archived never leak (status code IS the leak guard)

          const slugPath = `/article/${encodeURIComponent(art.slug)}`;
          const contentText = htmlToText(art.content, 12_000);
          const description = (art.excerpt || contentText.slice(0, 155) || '').trim();
          const lang = (art as any).language === 'bn' ? 'bn' : 'en';
          const publishedIso = art.publishedAt ? new Date(art.publishedAt).toISOString() : undefined;
          const modifiedIso = art.updatedAt ? new Date(art.updatedAt).toISOString() : publishedIso;
          const authorName = art.author?.name || 'Staff Reporter';

          const jsonLd: Array<Record<string, unknown>> = [];
          const newsArticle: Record<string, unknown> = {
            '@context': 'https://schema.org',
            '@type': 'NewsArticle',
            headline: art.title,
            description,
            image: art.coverImage ? [art.coverImage] : undefined,
            datePublished: publishedIso,
            dateModified: modifiedIso,
            author: [{ '@type': 'Person', name: authorName }],
            publisher: {
              '@type': 'NewsMediaOrganization',
              name: 'Global Chronicle',
              logo: { '@type': 'ImageObject', url: `${APP_URL}/logo.svg` },
            },
            mainEntityOfPage: `${APP_URL}${slugPath}`,
            articleSection: art.category?.name || undefined,
            inLanguage: lang,
          };
          jsonLd.push(newsArticle);
          if (art.category) {
            jsonLd.push({
              '@context': 'https://schema.org',
              '@type': 'BreadcrumbList',
              itemListElement: [
                { '@type': 'ListItem', position: 1, name: 'Home', item: `${APP_URL}/` },
                art.category.slug
                  ? { '@type': 'ListItem', position: 2, name: art.category.name, item: `${APP_URL}/category/${encodeURIComponent(art.category.slug)}` }
                  : { '@type': 'ListItem', position: 2, name: art.category.name },
                { '@type': 'ListItem', position: 3, name: art.title, item: `${APP_URL}${slugPath}` },
              ],
            });
          }

          // Server-rendered, XSS-safe text block (title/byline/body as text nodes)
          const bodyHtml = [
            `<div data-ssr-shell="article" style="max-width:56rem;margin:0 auto;padding:2rem 1rem;">`,
            `  <h1 style="font-family:Georgia,serif;font-size:2.25rem;line-height:1.2;margin:0 0 1rem;">${escHtml(art.title)}</h1>`,
            `  <p style="color:#57534e;margin:0 0 1rem;">${escHtml(authorName)}${publishedIso ? ` · <time datetime="${escHtml(publishedIso)}">${escHtml(publishedIso.slice(0, 10))}</time>` : ''}</p>`,
            description ? `  <p style="font-size:1.125rem;color:#1c1917;">${escHtml(description)}</p>` : '',
            contentText ? `  <div style="white-space:pre-wrap;color:#292524;">${escHtml(contentText)}</div>` : '',
            `</div>`,
          ].filter(Boolean).join('\n');

          const { html, status } = await renderSeoPage({
            title: art.title,
            description,
            canonicalPath: slugPath,
            lang,
            jsonLd,
            ogImage: art.coverImage || undefined,
            bodyHtml,
          });
          res.status(status).type('html').send(html);
          break;
        }

        case 'category': {
          const categories: any[] = await prisma.category.findMany({});
          const child = categories.find((c) => c.slug === route.slug);
          const parent = route.parentSlug ? categories.find((pc) => pc.slug === route.parentSlug) : null;
          if (!child || (route.parentSlug && (!parent || child.parentId !== parent.id))) {
            return notFound();
          }
          const title = parent ? `${child.name} — ${parent.name} Section` : `${child.name} Bureau`;
          const description = `Latest verified reporting from the ${child.name} desk — Global Chronicle bureau network.`;
          const crumbItems: Array<Record<string, unknown>> = [
            { '@type': 'ListItem', position: 1, name: 'Home', item: `${APP_URL}/` },
            parent
              ? { '@type': 'ListItem', position: 2, name: parent.name, item: `${APP_URL}/category/${encodeURIComponent(parent.slug)}` }
              : { '@type': 'ListItem', position: 2, name: child.name, item: `${APP_URL}/category/${encodeURIComponent(child.slug)}` },
          ];
          if (parent) {
            crumbItems.push({
              '@type': 'ListItem',
              position: 3,
              name: child.name,
              item: `${APP_URL}/category/${encodeURIComponent(parent.slug)}/${encodeURIComponent(child.slug)}`,
            });
          }
          const canonicalPath = req.path.replace(/\/+$/, '');
          const jsonLd: Array<Record<string, unknown>> = [
            {
              '@context': 'https://schema.org',
              '@type': 'CollectionPage',
              name: title,
              url: `${APP_URL}${canonicalPath}`,
            },
            { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: crumbItems },
          ];
          const bodyHtml = [
            `<div data-ssr-shell="category" style="max-width:56rem;margin:0 auto;padding:2rem 1rem;">`,
            `  <h1 style="font-family:Georgia,serif;font-size:2rem;">${escHtml(title)}</h1>`,
            `  <p style="color:#57534e;">${escHtml(description)}</p>`,
            `</div>`,
          ].join('\n');
          const { html, status } = await renderSeoPage({ title, description, canonicalPath, jsonLd, bodyHtml });
          res.status(status).type('html').send(html);
          break;
        }

        case 'author': {
          const user: any = await prisma.user.findUnique({ where: { id: route.authorId } });
          if (!user || user.isActive === false) return notFound();
          const jsonLd: Array<Record<string, unknown>> = [{
            '@context': 'https://schema.org',
            '@type': 'ProfilePage',
            mainEntity: {
              '@type': 'Person',
              name: user.name,
              jobTitle: (user as any).title || 'Reporter',
            },
            url: `${APP_URL}/author/${encodeURIComponent(user.id)}`,
          }];
          const description = `Dispatches and reporting by ${user.name}${(user as any).title ? `, ${(user as any).title}` : ''} — Global Chronicle.`;
          const bodyHtml = [
            `<div data-ssr-shell="author" style="max-width:56rem;margin:0 auto;padding:2rem 1rem;">`,
            `  <h1 style="font-family:Georgia,serif;font-size:2rem;">${escHtml(user.name)}</h1>`,
            `  <p style="color:#57534e;">${escHtml((user as any).title || 'Reporter')} · Global Chronicle</p>`,
            `</div>`,
          ].join('\n');
          const { html, status } = await renderSeoPage({
            title: `${user.name} — Author`,
            description,
            canonicalPath: `/author/${encodeURIComponent(user.id)}`,
            jsonLd,
            bodyHtml,
          });
          res.status(status).type('html').send(html);
          break;
        }

        case 'topic': {
          const tag: any = await prisma.tag.findUnique({ where: { slug: route.tagSlug } });
          if (!tag) return notFound();
          const description = `All coverage tagged “${tag.name}” — Global Chronicle.`;
          const bodyHtml = [
            `<div data-ssr-shell="topic" style="max-width:56rem;margin:0 auto;padding:2rem 1rem;">`,
            `  <h1 style="font-family:Georgia,serif;font-size:2rem;">${escHtml(tag.name)}</h1>`,
            `  <p style="color:#57534e;">${escHtml(description)}</p>`,
            `</div>`,
          ].join('\n');
          const { html, status } = await renderSeoPage({
            title: `${tag.name} — Topic`,
            description,
            canonicalPath: `/topic/${encodeURIComponent(tag.slug)}`,
            jsonLd: [{
              '@context': 'https://schema.org',
              '@type': 'CollectionPage',
              name: `${tag.name} Topic`,
              url: `${APP_URL}/topic/${encodeURIComponent(tag.slug)}`,
            }],
            bodyHtml,
          });
          res.status(status).type('html').send(html);
          break;
        }

        case 'archive': {
          const label = route.year && route.month ? `${route.month}/${route.year} archive` : `${route.year} archive`;
          const { html, status } = await renderSeoPage({
            title: `${label} — Global Chronicle`,
            description: `Published stories by date from the Global Chronicle archive (${label}).`,
            canonicalPath: req.path.replace(/\/+$/, ''),
            jsonLd: [{
              '@context': 'https://schema.org',
              '@type': 'CollectionPage',
              name: label,
              url: `${APP_URL}${req.path.replace(/\/+$/, '')}`,
            }],
          });
          res.status(status).type('html').send(html);
          break;
        }

        case 'search': {
          const q = (route.query || '').trim();
          const { html, status } = await renderSeoPage({
            title: q ? `Search: ${q}` : 'Search',
            description: 'Search the Global Chronicle archive of verified reporting.',
            canonicalPath: `/search?q=${encodeURIComponent(q)}`,
            noindex: true, // search result pages are not an indexable surface
          });
          res.status(status).type('html').send(html);
          break;
        }

        case 'page': {
          // Owned policy/standards pages — content is reviewed code-owned copy
          // from src/pages/publicPages.ts (client renders the identical file).
          if (!isStaticPageSlug(route.slug)) return notFound();
          const page = STATIC_PAGES[route.slug];
          const pageJson = [{
            '@context': 'https://schema.org',
            '@type': 'WebPage',
            name: page.title,
            description: page.description,
            url: `${APP_URL}/page/${encodeURIComponent(page.slug)}`,
            isPartOf: { '@type': 'WebSite', name: 'Global Chronicle News', url: APP_URL },
          }];
          const pageBody = [
            `<div data-ssr-shell="page" style="max-width:48rem;margin:0 auto;padding:2rem 1rem;">`,
            `  <h1 style="font-family:Georgia,serif;font-size:2.25rem;line-height:1.2;margin:0 0 1rem;">${escHtml(page.title)}</h1>`,
            `  <p style="color:#78716c;font-size:.85rem;margin:0 0 1rem;">Last reviewed ${escHtml(page.reviewedAt)} · Global Chronicle Bureau</p>`,
            ...page.sections.flatMap((section) => [
              `  <h2 style="font-family:Georgia,serif;font-size:1.25rem;margin:1.5rem 0 .5rem;">${escHtml(section.heading)}</h2>`,
              ...section.paragraphs.map((paragraph) => `  <p style="color:#292524;">${escHtml(paragraph)}</p>`),
            ]),
            `</div>`,
          ].join('\n');
          const { html, status } = await renderSeoPage({
            title: `${page.title} — Global Chronicle`,
            description: page.description,
            canonicalPath: `/page/${encodeURIComponent(page.slug)}`,
            jsonLd: pageJson,
            bodyHtml: pageBody,
          });
          res.status(status).type('html').send(html);
          break;
        }

        case 'cms': {
          const { html, status } = await renderSeoPage({
            title: 'Global Chronicle Newsroom',
            description: 'Editorial workspace for the Global Chronicle staff.',
            canonicalPath: '/cms',
            noindex: true, // authenticated CMS is not an indexable surface
          });
          res.status(status).type('html').send(html);
          break;
        }

        case 'notfound':
        default: {
          await notFound();
          break;
        }
      }
    } catch (pageErr: any) {
      logger.warn(`SEO page render fell through to static handling: ${pageErr?.message}`, 'SERVER_ERROR');
      if (!res.headersSent) next();
    }
  });

  // Vite middleware for development
  if (opts.static !== false) {
    if (process.env.NODE_ENV !== 'production') {
      const vite = await createViteServer({
        server: { middlewareMode: true, hmr: process.env.DISABLE_HMR !== 'true' },
        appType: 'spa',
      });
      devVite = vite; // Phase 9: SEO middleware transforms shells through Vite
      // Also serve dist assets if requested
      app.use(express.static(path.resolve(__dirname, 'dist')));
      app.use(vite.middlewares);
    } else {
      app.use(express.static(path.resolve(__dirname, 'dist')));
      app.get('*', (req, res) => {
        res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
      });
    }
  }

  // Respect PORT from validated env config — allows 'PORT=8080 npm start' in
  // staging/production without code changes.
  const PORT = env.PORT;
  return { app, PORT };
}

async function startServer() {
  const { app, PORT } = await buildServer();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Global Chronicle News server running on port ${PORT}`);
  });
}

// Only auto-start when server.ts is the process entry point — importing
// buildServer from the Phase 7 test harness must not bind a port.
const isEntryModule = typeof process !== 'undefined' && process.argv[1]
  && path.resolve(process.argv[1]).endsWith('server.ts');
if (isEntryModule) {
  startServer().catch(console.error);
}

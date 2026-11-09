/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 8: Public API abuse controls.
 *
 * Centralised safeguards for unauthenticated write / resource-intensive
 * endpoints (comments, reactions, polls, analytics, newsletter, TTS):
 *
 *   - Zod request schemas (strict, payload-size bounded)
 *   - Bounded in-memory rate limiters (configurable via env — docs/OPERATIONAL_LIMITS.md)
 *   - Reaction dedup + poll duplicate-vote controls (documented identity model:
 *     signed cookie tokens; IP fallback is best-effort and NOT a perfect identity)
 *   - Abuse monitoring keyed on hashed IP prefixes only (no secrets, no raw IP)
 *   - Generic public error shapes (no internal identifiers, no private records)
 *
 * All state is in-process. A multi-instance deployment should front these
 * routes with a shared limiter (Redis/edge); see OPERATIONAL_LIMITS.md.
 */

import crypto from 'crypto';
import { z } from 'zod';
import { env } from '../configuration/env.ts';
import { logger } from '../lib/logger.ts';

// ── Trusted proxy handling ───────────────────────────────────────────────────
/**
 * Resolve the Express `trust proxy` setting from the TRUST_PROXY env var.
 *
 * Directions for operators (docs/OPERATIONAL_LIMITS.md §Trusted proxy):
 *   - DIRECT EXPOSURE (no reverse proxy): leave TRUST_PROXY unset — req.ip is
 *     the socket address and cannot be spoofed via X-Forwarded-For.
 *   - BEHIND A TRUSTED PROXY: set TRUST_PROXY to the number of proxy hops
 *     (e.g. "1") or a comma-separated list of trusted IPs/subnets. Express
 *     then resolves req.ip from X-Forwarded-For, discarding untrusted hops.
 *   - NEVER set TRUST_PROXY=true when the service is directly reachable —
 *     attackers could spoof their address via X-Forwarded-For and rotate
 *     rate-limit buckets.
 */
export function resolveTrustProxy(): string | number | boolean | undefined {
  const raw = env.TRUST_PROXY;
  if (raw === undefined || raw === '') return undefined;
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'true') return 1; // one hop — safer than "trust everything"
  if (normalized === 'false') return undefined;
  const asNumber = Number(normalized);
  if (Number.isInteger(asNumber) && asNumber >= 0) return asNumber;
  // comma list of trusted proxy IPs/subnets — pass through to Express
  return raw;
}

// ── Bounded sliding-window limiter ───────────────────────────────────────────
export interface LimiterConfig {
  max: number;
  windowMs: number;
  /** Hard cap on tracked keys — a hostile flood of unique keys must not grow memory without bound. */
  maxKeys?: number;
  name?: string;
}

const DEFAULT_MAX_KEYS = 20_000;

/**
 * Bounded sliding-window rate limiter.
 * The default SimpleIpLimiter grew its Map unboundedly — a flood of spoofed
 * distinct keys (X-Forwarded-For'd requests behind a mis-set trust proxy, or
 * IPv6 privacy addresses) exhausts process memory. New keys beyond maxKeys
 * evict the oldest insertion.
 */
export class BoundedRateLimiter {
  private map = new Map<string, { count: number; resetAt: number }>();
  private readonly maxKeys: number;

  constructor(private cfg: LimiterConfig) {
    this.maxKeys = cfg.maxKeys ?? DEFAULT_MAX_KEYS;
  }

  /** Returns true when allowed; false means the caller should 429. */
  check(key: string): boolean {
    this.evictExpired();
    const now = Date.now();
    const entry = this.map.get(key);
    if (!entry || now > entry.resetAt) {
      if (this.map.size >= this.maxKeys && !this.map.has(key)) {
        // evict the oldest inserted key
        const oldest = this.map.keys().next().value;
        if (oldest !== undefined) this.map.delete(oldest);
      }
      this.map.set(key, { count: 1, resetAt: now + this.cfg.windowMs });
      return true;
    }
    if (++entry.count > this.cfg.max) return false;
    return true;
  }

  /** Remaining allowed requests in the current window (for headers/tests). */
  remaining(key: string): number {
    const entry = this.map.get(key);
    if (!entry || Date.now() > entry.resetAt) return this.cfg.max;
    return Math.max(0, this.cfg.max - entry.count);
  }

  reset(): void {
    this.map.clear();
  }

  private evictExpired(): void {
    // cheap lazy cleanup — only when the map is large
    if (this.map.size < this.maxKeys / 2) return;
    const now = Date.now();
    for (const [k, v] of this.map) {
      if (now > v.resetAt) this.map.delete(k);
      if (this.map.size < this.maxKeys / 2) return;
    }
  }
}

// ── Identity model helpers (hashes, tokens) ──────────────────────────────────
/**
 * One-way, truncated hash of a client identity key for monitoring/abuse
 * records. Raw IP values are PERSONAL DATA — they must not appear in logs.
 * A 12-hex-char SHA-256 prefix is sufficient to correlate repeated abuse
 * bursts from one source while being non-reversible at this length.
 */
export function identityHash(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 12);
}

/** Stable per-request voter token for poll cookies (random, not IP-derived). */
export function newVoterToken(): string {
  return crypto.randomBytes(16).toString('hex');
}

/** SHA-256 content fingerprint (comments spam dedup). */
export function contentFingerprint(text: string): string {
  return crypto.createHash('sha256').update(text.trim().toLowerCase()).digest('hex');
}

// ── Abuse monitoring (no secrets / no unnecessary personal data) ─────────────
interface AbuseEntry { count: number; lastAt: number }

export class AbuseMonitor {
  /** route → identityHash → burst counter. Capped; values hashed, never raw. */
  private byRoute = new Map<string, Map<string, AbuseEntry>>();
  private static MAX_ROUTES = 64;
  private static MAX_IDENTITIES_PER_ROUTE = 5_000;

  /**
   * Record a blocked/limit event. Logs a compact line the first time an
   * identity trips, then every 25th repeat — correlation key is the HASHED
   * identity (no raw IP, no headers, no secrets).
   */
  record(route: string, identityKey: string, reason: string): void {
    let identities = this.byRoute.get(route);
    if (!identities) {
      if (this.byRoute.size >= AbuseMonitor.MAX_ROUTES) {
        // drop the oldest route's map
        const oldest = this.byRoute.keys().next().value;
        if (oldest !== undefined) this.byRoute.delete(oldest);
      }
      identities = new Map();
      this.byRoute.set(route, identities);
    }
    const hash = identityHash(identityKey);
    const entry = identities.get(hash);
    if (!entry) {
      if (identities.size >= AbuseMonitor.MAX_IDENTITIES_PER_ROUTE) {
        const oldest = identities.keys().next().value;
        if (oldest !== undefined) identities.delete(oldest);
      }
      identities.set(hash, { count: 1, lastAt: Date.now() });
      logger.warn(`abuse-monitor: ${route} throttled identity ${hash} (${reason})`, 'ABUSE');
      return;
    }
    entry.count++;
    entry.lastAt = Date.now();
    if (entry.count % 25 === 0) {
      logger.warn(`abuse-monitor: ${route} identity ${hash} repeated limit violations — ${entry.count} in current process lifetime (${reason})`, 'ABUSE');
    }
  }

  /** Operational report (admin endpoint). No raw IPs — hashed identities only. */
  report(): Array<{ route: string; identities: number; topOffenders: Array<{ identityHash: string; count: number }> }> {
    const out: Array<{ route: string; identities: number; topOffenders: Array<{ identityHash: string; count: number }> }> = [];
    for (const [route, identities] of this.byRoute) {
      const top = [...identities.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 5)
        .map(([hash, e]) => ({ identityHash: hash, count: e.count }));
      out.push({ route, identities: identities.size, topOffenders: top });
    }
    return out.sort((a, b) => b.identities - a.identities);
  }

  /** Per-route total violations (for tests + health lines). */
  countFor(route: string): number {
    const identities = this.byRoute.get(route);
    if (!identities) return 0;
    let n = 0;
    for (const e of identities.values()) n += e.count;
    return n;
  }
}

export const abuseMonitor = new AbuseMonitor();

// ── Response limiters (env-configured in env.ts) ────────────────────────────
export const limiters = {
  reactions: new BoundedRateLimiter({ max: env.REACTIONS_RATE_MAX, windowMs: env.REACTIONS_RATE_WINDOW_MS, name: 'reactions' }),
  comments: new BoundedRateLimiter({ max: env.COMMENTS_RATE_MAX, windowMs: env.COMMENTS_RATE_WINDOW_MS, name: 'comments' }),
  polls: new BoundedRateLimiter({ max: env.POLLS_RATE_MAX, windowMs: env.POLLS_RATE_WINDOW_MS, name: 'polls' }),
  analytics: new BoundedRateLimiter({ max: env.ANALYTICS_RATE_MAX, windowMs: env.ANALYTICS_RATE_WINDOW_MS, name: 'analytics' }),
  newsletter: new BoundedRateLimiter({ max: env.NEWSLETTER_RATE_MAX, windowMs: env.NEWSLETTER_RATE_WINDOW_MS, name: 'newsletter' }),
};

// ── Poll duplicate-vote registry ─────────────────────────────────────────────
/**
 * Poll vote policy (docs/OPERATIONAL_LIMITS.md §Polls):
 *
 * Identity model — two layers, neither claimed perfect:
 *   1. VOTER TOKEN (primary): the first successful vote sets the
 *      `gcn_poll_voter` HttpOnly cookie containing a random 32-hex token;
 *      each (pollId, token) pair can vote once, tracked for the process
 *      lifetime. Browser users get reliable single-voting; incognito or
 *      cookie-clearing users get a fresh identity — accepted trade-off of a
 *      public, login-free poll.
 *   2. IP FALLBACK (best-effort): when no cookie is presented (scripts, cookies
 *      disabled) the resolved client IP deduplicates the poll. Behind a proxy
 *      the IP is the whole address-space of the site — deliberately
 *      conservative, and never claimed to be a unique identity.
 *
 * A persistent production deployment would move (pollId, token) pairs into the
 * database; the in-memory registry matches the rest of the abuse controls.
 */
class PollVoteRegistry {
  private votes = new Map<string, number>(); // `${pollId}:${identity}` → firstSeen (cap below)

  has(pollId: string, identity: string): boolean {
    return this.votes.has(`${pollId}:${identity}`);
  }

  add(pollId: string, identity: string): void {
    if (this.votes.size >= 100_000) this.votes.clear(); // crude but bounded
    this.votes.set(`${pollId}:${identity}`, Date.now());
  }
}
export const pollVoteRegistry = new PollVoteRegistry();

// ── Reaction dedup registry ─────────────────────────────────────────────────
/**
 * Reaction identity model (docs/OPERATIONAL_LIMITS.md §Reactions):
 *   - Rate limit: env.REACTIONS_RATE_MAX requests per (IP, article) window.
 *   - Dedup cooldown: the same (IP, article, type) reaction within
 *     env.REACTION_DEDUPE_COOLDOWN_MS returns an idempotent success (HTTP 200,
 *     `deduplicated: true`) instead of counting again — a repeated click is
 *     not a second vote. An IP can still inflate *different* reaction types on
 *     an article up to the rate limit; reactions are deliberately not an
 *     authenticated feature, and this is documented rather than over-claimed.
 */
class ReactionDedupe {
  private seen = new Map<string, number>();

  /** True when this (article, type, identity) was recorded within the cooldown. */
  isDuplicate(articleId: string, type: string, identity: string): boolean {
    const key = `${articleId}:${type}:${identity}`;
    const lastAt = this.seen.get(key);
    return lastAt !== undefined && Date.now() - lastAt < env.REACTION_DEDUPE_COOLDOWN_MS;
  }

  /** Record the identity AFTER a successful write (failed writes don't suppress). */
  mark(articleId: string, type: string, identity: string): void {
    if (this.seen.size >= 100_000) this.seen.clear();
    this.seen.set(`${articleId}:${type}:${identity}`, Date.now());
  }

  /** Test helper. */
  reset(): void { this.seen.clear(); }
}
export const reactionDedupe = new ReactionDedupe();

// ── TTS cost controls ────────────────────────────────────────────────────────
export class TtsCostGuard {
  private dailyUsage = new Map<string, { date: string; count: number }>(); // userId → usage
  private inFlight = 0;

  /** Throws a typed error (quotaDataMessage) when over quota, else counts. */
  consume(userId: string): void {
    const date = new Date().toISOString().slice(0, 10);
    let u = this.dailyUsage.get(userId);
    if (!u || u.date !== date) {
      if (this.dailyUsage.size >= 20_000) this.dailyUsage.clear();
      u = { date, count: 0 };
      this.dailyUsage.set(userId, u);
    }
    if (env.TTS_DAILY_QUOTA_PER_USER > 0 && u.count >= env.TTS_DAILY_QUOTA_PER_USER) {
      const err: any = new Error('TTS quota exceeded');
      err.code = 'TTS_QUOTA';
      throw err;
    }
    u.count++;
  }

  remaining(userId: string): number {
    if (env.TTS_DAILY_QUOTA_PER_USER <= 0) return Infinity;
    const date = new Date().toISOString().slice(0, 10);
    const u = this.dailyUsage.get(userId);
    if (!u || u.date !== date) return env.TTS_DAILY_QUOTA_PER_USER;
    return Math.max(0, env.TTS_DAILY_QUOTA_PER_USER - u.count);
  }

  /** Concurrency gate — returns false when the provider is saturated. */
  tryAcquireSlot(): boolean {
    if (this.inFlight >= env.TTS_MAX_CONCURRENT) return false;
    this.inFlight++;
    return true;
  }

  releaseSlot(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
  }

  reset(): void {
    this.dailyUsage.clear();
    this.inFlight = 0;
  }
}
export const ttsCostGuard = new TtsCostGuard();

// ── Zod schemas (strict, size-bounded) ──────────────────────────────────────
/** Strip ASCII/Unicode control characters (except \n\r\t) — comment/telemetry hygiene. */
const ctrlFree = (max: number) =>
  z.string().max(max).transform(s => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ''));

export const commentCreateSchema = z.object({
  articleId: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, 'articleId format'),
  authorName: ctrlFree(60).refine(s => s.trim().length >= 2, 'authorName too short'),
  authorEmail: z.string().max(120).email().transform(s => s.trim().toLowerCase()),
  content: ctrlFree(env.COMMENT_MAX_CONTENT_CHARS).refine(s => s.trim().length >= 3, 'content too short'),
  /** Honeypot: real readers never fill this; bots do. Presence ⇒ silent discard. */
  website: z.string().max(200).optional(),
});
export type CommentCreateInput = z.infer<typeof commentCreateSchema>;

export const reactionCreateSchema = z.object({
  type: z.enum(['INSIGHTFUL', 'URGENT', 'ESSENTIAL', 'BALANCED']),
});

export const pollVoteSchema = z.object({
  optionIndex: z.coerce.number().int().min(0).max(63),
});

export const analyticsTrackSchema = z.object({
  type: z.enum(['PAGE_VIEW', 'ARTICLE_VIEW', 'SHARE', 'CLICK', 'SEARCH', 'SUBSCRIBE', 'COMMENT', 'REACTION']),
  entityId: z.string().max(64).regex(/^[A-Za-z0-9_-]*$/, 'entityId format').optional(),
  // Allowlist bounded later by sanitizeAnalyticsMetadata — the schema is
  // tolerant on unknown keys (dropped below), but the total record is bounded
  // so a hostile 50k-char metadata blob costs at most a parse, then a drop.
  metadata: z.record(z.string().max(40), z.union([
    z.string().max(2_000),
    z.number().finite(),
    z.boolean(),
    z.null(),
  ])).optional(),
});

/** Metadata keys a track event may carry; everything else is silently dropped. */
export const ANALYTICS_METADATA_ALLOWLIST = new Set([
  'articleId', 'path', 'referrer', 'sessionId', 'queryKey', 'shareChannel',
  'optionIndex', 'searchTerm', 'sectionSlug', 'variant',
]);

export function sanitizeAnalyticsMetadata(
  metadata: Record<string, string | number | boolean | null> | undefined,
): Record<string, string | number | boolean | null> | undefined {
  if (!metadata) return undefined;
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (!ANALYTICS_METADATA_ALLOWLIST.has(k)) continue;
    if (typeof v === 'string') {
      const clean = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').slice(0, 200);
      if (clean) out[k] = clean;
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      out[k] = v;
    }
    // null dropped — an absent key is the correct representation
  }
  let json = JSON.stringify(out);
  if (json.length > env.ANALYTICS_METADATA_MAX_BYTES) {
    // drop entries until within budget
    for (const k of Object.keys(out)) {
      delete out[k];
      json = JSON.stringify(out);
      if (json.length <= env.ANALYTICS_METADATA_MAX_BYTES) break;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

export const newsletterSubscribeSchema = z.object({
  email: z.string().max(254).email(),
});

export const ttsRequestSchema = z.object({
  text: z.string().min(1).max(env.TTS_MAX_CHARS),
  voice: z.string().max(24).regex(/^[A-Za-z][A-Za-z-]{1,23}$/, 'voice format').optional(),
});

export const commentModerateSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED', 'SPAM', 'PENDING']),
});

// ── Phase 10: admin management surface schemas ──────────────────────────────
export const staffCreateSchema = z.object({
  email: z.string().max(254).email(),
  name: z.string().min(2).max(80),
  role: z.enum([
    'ADMIN', 'MANAGING_EDITOR', 'SECTION_EDITOR', 'COPY_EDITOR',
    'REPORTER', 'PHOTOGRAPHER', 'VIDEO_EDITOR', 'ADVERTISING_MANAGER', 'ANALYST',
  ]), // READER + SUPER_ADMIN are never creatable through this endpoint
  password: z.string().min(10, 'Password must be at least 10 characters.').max(128),
});

export const adSlotCreateSchema = z.object({
  slotName: z.string().min(2).max(40).regex(/^[A-Za-z0-9 _-]+$/, 'Letters, digits, spaces, dashes and underscores only'),
  dimensions: z.string().max(12).regex(/^\d{2,4}x\d{2,4}$/, 'Format: WIDTHxHEIGHT (e.g. 728x90)'),
  adCode: z.string().max(2000).optional(),
  isActive: z.boolean().optional(),
});

export const adSlotUpdateSchema = z.object({
  dimensions: z.string().max(12).regex(/^\d{2,4}x\d{2,4}$/).optional(),
  adCode: z.string().max(2000).optional(),
  isActive: z.boolean().optional(),
});

export const redirectCreateSchema = z.object({
  sourcePath: z.string().min(1).max(300).regex(/^\//, 'must start with "/"'),
  destinationPath: z.string().min(1).max(300).regex(/^\//, 'must start with "/"'),
  statusCode: z.coerce.number().int().min(300).max(399).optional(),
  isActive: z.boolean().optional(),
});

export const redirectUpdateSchema = z.object({
  destinationPath: z.string().min(1).max(300).regex(/^\//).optional(),
  statusCode: z.coerce.number().int().min(300).max(399).optional(),
  isActive: z.boolean().optional(),
});

export const settingsUpdateSchema = z.object({
  key: z.string().min(2).max(60).regex(/^[a-z][a-zA-Z0-9_]*$/, 'snake/camelCase key'),
  value: z.union([z.string().max(300), z.number(), z.boolean(), z.null()]), // primitive settings only
});

export const settingsUpdateManySchema = z.object({
  settings: z.array(settingsUpdateSchema).min(1).max(30),
});

/** Safe public settings keys (GET /api/settings) — everything else stays admin-only. */
export const PUBLIC_SETTING_KEYS = [
  'siteTitle',
  'tagline',
  'defaultLanguage',
  'newsletterEnabled',
  'commentsRequireApproval',
  'breakingBannerAutoRefresh',
] as const;

export const ALLOWED_SETTING_KEYS = [
  ...PUBLIC_SETTING_KEYS,
  'contactEmail',
  'editorialMotto',
] as const;

export type SettingKey = (typeof ALLOWED_SETTING_KEYS)[number];


// ── Public-safe error helpers ───────────────────────────────────────────────
/**
 * Public endpoints must never echo `err.message` (driver internals, file
 * paths, record ids). These helpers keep wire responses generic while the
 * full details go to the internal log at WARN level with the hashed identity.
 */
export function publicSafeError(res: any, err: unknown, route: string, identityKey: string): void {
  const hash = identityHash(identityKey);
  logger.error(`public endpoint ${route} failed for identity ${hash}: ${(err as any)?.message}`, 'ABUSE');
  if (!res.headersSent) res.status(500).json({ error: 'The request could not be completed. Please try again later.' });
}

export function validationErrorResponse(res: any, parsed: { success: boolean; error?: any }): void {
  if (parsed.success) return;
  const firstIssue = parsed.error?.issues?.[0];
  const field = firstIssue?.path?.join('.') || 'payload';
  res.status(400).json({ error: `Invalid request: please review the "${field}" field.` });
}

/** Standard 429 body + abuse monitoring record. */
export function tooManyRequests(res: any, route: string, identityKey: string, reason: string): any {
  abuseMonitor.record(route, identityKey, reason);
  return res.status(429).json({ error: 'Too many requests. Please wait before trying again.' });
}

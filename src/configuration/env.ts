/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Centralised environment configuration.
 * This module is the SINGLE SOURCE OF TRUTH for validated env values.
 * Import from here — never read process.env directly elsewhere.
 *
 * Fail-closed rules:
 *   - In production, JWT_SECRET must be present AND ≥ 32 characters.
 *   - In production, JWT_SECRET must not equal any known-insecure default.
 *   - In production/test, NODE_ENV must be explicit.
 *
 * Secret generation (run once, store securely):
 *   node -e "require('crypto').randomBytes(48).toString('hex').then ? '' : console.log(require('crypto').randomBytes(48).toString('hex'))"
 *   OR: openssl rand -hex 48
 */

import { z } from 'zod';

/** Passwords / secrets that must never appear in a production JWT_SECRET */
const KNOWN_INSECURE_SECRETS = new Set([
  'global-chronicle-secret-key-2026',
  'dev-fallback-secret-for-development-only',
  'your-secure-jwt-secret-here',
  'secret',
  'changeme',
  'password',
  'jwt-secret',
]);

const MIN_SECRET_BYTES = 32; // 256-bit minimum

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  // JWT — validated at startup, not at schema parse time, so we can give clear errors
  JWT_SECRET: z.string().default('global-chronicle-secret-key-2026'),

  // Token lifetime in seconds. Default 8 h. Keep short; use the refresh endpoint.
  JWT_EXPIRES_IN_SECONDS: z.coerce.number().int().min(300).max(86400).default(28800),

  // SMTP — all optional; if absent the mailer operates in dev/log-only mode
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: z.preprocess(v => v === 'true' || v === true, z.boolean()).default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default('noreply@globalchronicle.news'),

  // AI
  GEMINI_API_KEY: z.string().optional(),
  VITE_GEMINI_API_KEY: z.string().optional(),

  // App — Phase 9: single SERVER-ONLY canonical origin (sitemap/canonical/JSON-LD).
  // Must be an absolute URL; production refuses localhost (fail-fast, §note),
  // guaranteeing canonical URLs are never generated against a dev origin.
  APP_URL: z.string().url().default('http://localhost:3000'),
  DATABASE_URL: z.string().optional(),

  // Persistence driver selection (Phase 6B, src/lib/database.ts):
  //   'postgres' → Prisma/PostgreSQL (required in production; DATABASE_URL needed)
  //   'json'     → legacy JSON store, development/test only (never allowed in production)
  DB_DRIVER: z.enum(['postgres', 'json']).optional(),

  // ── Phase 8: public API abuse controls (docs/OPERATIONAL_LIMITS.md) ────────
  // Trusted proxy: when the app is published behind a reverse proxy that sets
  // `X-Forwarded-For`, TRUST_PROXY makes Express resolve req.ip from the proxy
  // chain (app.set('trust proxy', value)). Accepts true/false, a number of
  // hops, or a comma list of IPs/subnets. Default unset = direct connection.
  TRUST_PROXY: z.string().optional(),

  // Rate limits (requests per IP per window unless noted)
  REACTIONS_RATE_MAX: z.coerce.number().int().min(1).max(1000).default(20),
  REACTIONS_RATE_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),
  REACTION_DEDUPE_COOLDOWN_MS: z.coerce.number().int().min(0).default(600_000),
  COMMENTS_RATE_MAX: z.coerce.number().int().min(1).max(1000).default(5),
  COMMENTS_RATE_WINDOW_MS: z.coerce.number().int().min(1000).default(3_600_000),
  COMMENT_MAX_CONTENT_CHARS: z.coerce.number().int().min(50).max(10_000).default(2_000),
  POLLS_RATE_MAX: z.coerce.number().int().min(1).max(1000).default(10),
  POLLS_RATE_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),
  ANALYTICS_RATE_MAX: z.coerce.number().int().min(1).max(10_000).default(60),
  ANALYTICS_RATE_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),
  ANALYTICS_METADATA_MAX_BYTES: z.coerce.number().int().min(64).max(65_536).default(1_024),
  NEWSLETTER_RATE_MAX: z.coerce.number().int().min(1).max(1000).default(5),
  NEWSLETTER_RATE_WINDOW_MS: z.coerce.number().int().min(1000).default(3_600_000),

  // TTS cost controls
  TTS_MAX_CHARS: z.coerce.number().int().min(100).max(50_000).default(5_000),
  TTS_DAILY_QUOTA_PER_USER: z.coerce.number().int().min(0).default(30),
  TTS_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(20_000),
  TTS_MAX_CONCURRENT: z.coerce.number().int().min(1).max(64).default(3),

  // ── Phase 11: storage provider selection (src/server/storage) ──────────────
  // Explicit driver choice; production boot FAILS if this is unset, if the
  // value is not local|s3, or if the selected provider's required credentials
  // are missing (validateStorageConfig below). Defaults only exist so that
  // `npm run dev` works without any env file.
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  // Local provider root directory (relative paths resolve against process.cwd()).
  STORAGE_LOCAL_DIR: z.string().optional(),
  // default visibility for uploaded media: public (direct read URLs) or
  // private (signed, expiring read URLs — SigV4 presign on S3, HMAC on local).
  STORAGE_MEDIA_VISIBILITY: z.enum(['public', 'private']).default('public'),
  // Absolute base URL used to build PUBLIC read URLs. For local driver this is
  // normally APP_URL; for S3 behind a CDN it is the CDN origin.
  STORAGE_PUBLIC_BASE_URL: z.string().url().optional(),
  // Signed read-URL time-to-live for PRIVATE assets (seconds).
  STORAGE_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(86_400).default(900),
  // S3-compatible object store (AWS S3, MinIO, Cloudflare R2, …). Endpoint is
  // optional: when absent the AWS default host is derived from the region.
  S3_BUCKET: z.string().min(3).optional(),
  S3_REGION: z.string().min(2).optional(),
  S3_ENDPOINT: z.string().url().optional(),
  S3_ACCESS_KEY_ID: z.string().min(3).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(16).optional(),
  // Key prefix every object is stored under (e.g. "media" → media/<object>).optional(),
  S3_UPLOAD_PREFIX: z.string().optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;

function validateSecret(secret: string, isProduction: boolean): void {
  if (isProduction) {
    if (!secret || secret.trim().length === 0) {
      throw new Error('[FATAL] JWT_SECRET is required in production. Set a cryptographically secure random string of ≥ 32 characters.');
    }
    if (secret.length < MIN_SECRET_BYTES) {
      throw new Error(`[FATAL] JWT_SECRET is too short (${secret.length} chars). Production requires ≥ ${MIN_SECRET_BYTES} characters. Generate with: openssl rand -hex 48`);
    }
    if (KNOWN_INSECURE_SECRETS.has(secret)) {
      throw new Error('[FATAL] JWT_SECRET is set to a known-insecure default value. Replace it with a cryptographically secure random string.');
    }
  }
}

/**
 * Phase 9: the canonical origin guard. Every sitemap <loc>, canonical link and
 * JSON-LD URL is built from APP_URL, so a dev origin in production would
 * publish broken canonicals to every crawler. Fail the boot instead.
 */
export function validateAppUrl(appUrl: string, isProduction: boolean): void {
  if (!isProduction) return;
  let parsed: URL;
  try {
    parsed = new URL(appUrl);
  } catch {
    throw new Error('[FATAL] APP_URL is not a valid absolute URL.');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('[FATAL] APP_URL must use https:// in production.');
  }
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/i.test(parsed.hostname)) {
    throw new Error('[FATAL] APP_URL must not resolve to localhost in production.');
  }
}

/**
 * Phase 11: the storage boot guard. Production must have an EXPLICIT provider
 * configuration — a missing/invalid object-store credential set fails the boot
 * instead of silently falling back to the development filesystem provider
 * (which would slowly fill the web server's disk in a real deployment).
 */
export function validateStorageConfig(config: EnvConfig, isProduction: boolean): void {
  const driver = config.STORAGE_DRIVER;
  if (isProduction && !process.env.STORAGE_DRIVER) {
    throw new Error(
      '[FATAL] STORAGE_DRIVER is required in production. Set STORAGE_DRIVER=local (with STORAGE_LOCAL_DIR) or STORAGE_DRIVER=s3 (with the S3_* credential set).'
    );
  }
  if (driver === 's3') {
    const missing = (['S3_BUCKET', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const)
      .filter((k) => !config[k]);
    if (missing.length > 0) {
      throw new Error(
        `[FATAL] STORAGE_DRIVER=s3 requires ${missing.join(', ')}${config.S3_ENDPOINT || config.S3_REGION ? '' : ' (S3_ENDPOINT optional for MinIO/R2)'} — refusing to boot with a half-configured S3 driver.`
      );
    }
  } else if (isProduction && !config.STORAGE_LOCAL_DIR) {
    throw new Error('[FATAL] STORAGE_DRIVER=local requires STORAGE_LOCAL_DIR in production.');
  }
  if (config.STORAGE_PUBLIC_BASE_URL && config.STORAGE_PUBLIC_BASE_URL.endsWith('/')) {
    throw new Error('[FATAL] STORAGE_PUBLIC_BASE_URL must not end with a trailing slash.');
  }
}

/** Dev-only fallback copy of the storage keys (mirrors each block above). */
function applyStorageEnvFallback(config: EnvConfig): void {
  const c = config as Record<string, unknown>;
  if (!('STORAGE_DRIVER' in c)) c.STORAGE_DRIVER = process.env.STORAGE_DRIVER || 'local';
  if (!('STORAGE_MEDIA_VISIBILITY' in c)) c.STORAGE_MEDIA_VISIBILITY = process.env.STORAGE_MEDIA_VISIBILITY || 'public';
  if (!('STORAGE_PUBLIC_BASE_URL' in c)) c.STORAGE_PUBLIC_BASE_URL = process.env.STORAGE_PUBLIC_BASE_URL;
  if (!('STORAGE_LOCAL_DIR' in c)) c.STORAGE_LOCAL_DIR = process.env.STORAGE_LOCAL_DIR;
  if (!('STORAGE_SIGNED_URL_TTL_SECONDS' in c)) c.STORAGE_SIGNED_URL_TTL_SECONDS = Number(process.env.STORAGE_SIGNED_URL_TTL_SECONDS) || 900;
  if (!('S3_BUCKET' in c)) c.S3_BUCKET = process.env.S3_BUCKET;
  if (!('S3_REGION' in c)) c.S3_REGION = process.env.S3_REGION;
  if (!('S3_ENDPOINT' in c)) c.S3_ENDPOINT = process.env.S3_ENDPOINT;
  if (!('S3_ACCESS_KEY_ID' in c)) c.S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID;
  if (!('S3_SECRET_ACCESS_KEY' in c)) c.S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY;
  if (!('S3_UPLOAD_PREFIX' in c)) c.S3_UPLOAD_PREFIX = process.env.S3_UPLOAD_PREFIX;
}

function loadConfig(): EnvConfig {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const formatted = result.error.format();
    console.error('[CONFIG] Environment validation errors:', JSON.stringify(formatted, null, 2));
    // Non-fatal in development — fall through with defaults
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`[FATAL] Invalid environment configuration in production: ${result.error.message}`);
    }
  }

  const config = result.success ? result.data : {
    NODE_ENV: (process.env.NODE_ENV as any) || 'development',
    PORT: Number(process.env.PORT) || 3000,
    JWT_SECRET: process.env.JWT_SECRET || 'global-chronicle-secret-key-2026',
    JWT_EXPIRES_IN_SECONDS: Number(process.env.JWT_EXPIRES_IN_SECONDS) || 28800,
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_PORT: Number(process.env.SMTP_PORT) || 587,
    SMTP_SECURE: process.env.SMTP_SECURE === 'true',
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASS: process.env.SMTP_PASS,
    SMTP_FROM: process.env.SMTP_FROM || 'noreply@globalchronicle.news',
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    VITE_GEMINI_API_KEY: process.env.VITE_GEMINI_API_KEY,
    APP_URL: process.env.APP_URL || 'http://localhost:3000',
    DATABASE_URL: process.env.DATABASE_URL,
    TRUST_PROXY: process.env.TRUST_PROXY,
    REACTIONS_RATE_MAX: Number(process.env.REACTIONS_RATE_MAX) || 20,
    REACTIONS_RATE_WINDOW_MS: Number(process.env.REACTIONS_RATE_WINDOW_MS) || 60_000,
    REACTION_DEDUPE_COOLDOWN_MS: Number(process.env.REACTION_DEDUPE_COOLDOWN_MS) || 600_000,
    COMMENTS_RATE_MAX: Number(process.env.COMMENTS_RATE_MAX) || 5,
    COMMENTS_RATE_WINDOW_MS: Number(process.env.COMMENTS_RATE_WINDOW_MS) || 3_600_000,
    COMMENT_MAX_CONTENT_CHARS: Number(process.env.COMMENT_MAX_CONTENT_CHARS) || 2_000,
    POLLS_RATE_MAX: Number(process.env.POLLS_RATE_MAX) || 10,
    POLLS_RATE_WINDOW_MS: Number(process.env.POLLS_RATE_WINDOW_MS) || 60_000,
    ANALYTICS_RATE_MAX: Number(process.env.ANALYTICS_RATE_MAX) || 60,
    ANALYTICS_RATE_WINDOW_MS: Number(process.env.ANALYTICS_RATE_WINDOW_MS) || 60_000,
    ANALYTICS_METADATA_MAX_BYTES: Number(process.env.ANALYTICS_METADATA_MAX_BYTES) || 1_024,
    NEWSLETTER_RATE_MAX: Number(process.env.NEWSLETTER_RATE_MAX) || 5,
    NEWSLETTER_RATE_WINDOW_MS: Number(process.env.NEWSLETTER_RATE_WINDOW_MS) || 3_600_000,
    TTS_MAX_CHARS: Number(process.env.TTS_MAX_CHARS) || 5_000,
    TTS_DAILY_QUOTA_PER_USER: (Number.isFinite(Number(process.env.TTS_DAILY_QUOTA_PER_USER))
      ? Number(process.env.TTS_DAILY_QUOTA_PER_USER) : 30),
    TTS_TIMEOUT_MS: Number(process.env.TTS_TIMEOUT_MS) || 20_000,
    TTS_MAX_CONCURRENT: Number(process.env.TTS_MAX_CONCURRENT) || 3,
  } as EnvConfig;

  // Phase 11 storage env passthrough (only reached in dev when parsing failed)
  applyStorageEnvFallback(config);

  // Fail-closed: validate JWT_SECRET in production
  validateSecret(config.JWT_SECRET, config.NODE_ENV === 'production');
  // Phase 9: canonical-origin guard (https + not localhost in production)
  validateAppUrl(config.APP_URL, config.NODE_ENV === 'production');
  // Phase 11: storage provider guard (explicit driver in prod; S3 creds complete)
  validateStorageConfig(config, config.NODE_ENV === 'production');

  return config;
}

export const env = loadConfig();

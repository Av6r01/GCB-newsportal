/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Phase 7: TTL-based server memory cache.
 *
 * Policy (docs/DATA_MODEL.md §Caching):
 * - Cache key: `homepage` (the rendered homepage payload singleton).
 * - TTL: 60s by default (`HOMEPAGE_CACHE_TTL_MS` env override for ops).
 * - Explicit invalidation: every mutating editorial endpoint must call
 *   `invalidateHomepageCache()` (article create/update/transition/archive,
 *   breaking-news create/update/delete, homepage config changes, category/auth
 *   changes through their existing hooks).
 * - Stale-never rule: caches are only ever populated from PUBLISHED-only
 *   queries; draft/private/unpublished records can never enter the cache.
 */

export interface CacheEntry<T> {
  value: T;
  /** ISO timestamp of when the payload was generated. */
  generatedAt: string;
}

export class TtlCache<T> {
  private entry: CacheEntry<T> | null = null;
  private ttlMs: number;

  constructor(ttlMs: number = 60_000) {
    this.ttlMs = ttlMs;
  }

  /** Fresh payload, or `null` when empty/expired. */
  get(): CacheEntry<T> | null {
    if (!this.entry) return null;
    const age = Date.now() - new Date(this.entry.generatedAt).getTime();
    if (age > this.ttlMs) {
      this.entry = null; // expired: force regeneration instead of serving stale
      return null;
    }
    return this.entry;
  }

  set(value: T): CacheEntry<T> {
    this.entry = { value, generatedAt: new Date().toISOString() };
    return this.entry;
  }

  invalidate(): void {
    this.entry = null;
  }

  /** Seconds remaining before the current entry expires (for observability). */
  ageSeconds(): number | null {
    if (!this.entry) return null;
    const age = Date.now() - new Date(this.entry.generatedAt).getTime();
    return Math.max(0, Math.round(age / 1000));
  }
}

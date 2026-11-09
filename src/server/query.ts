/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Phase 7: standardized query/pagination parsing.
 *
 * Contract (docs/API_ROUTE_MATRIX.md §Pagination):
 * - `page` and `limit` accept decimal strings; anything non-numeric, zero,
 *   negative or beyond the maximum is clamped to the default/maximum value —
 *   never trusted as-is.
 * - `limit` WITHOUT `page` is honored: the route returns a bounded plain array
 *   (no envelope) — this fixes the Phase 7 defect where `limit` was ignored
 *   whenever `page` was omitted.
 * - `page` present → routes respond with `{ data: [...], pagination }`
 *   (or their established envelope key, e.g. `articles`) plus bounded limits.
 * - Maximum page size is enforced for every list endpoint.
 */

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export interface Pagination {
  /** Normalized 1-based page number. */
  page: number;
  /** Normalized page size (1..MAX_PAGE_SIZE). */
  limit: number;
  /** Prisma-style offset: (page - 1) * limit. */
  skip: number;
  /** Prisma-style take: limit. */
  take: number;
}

/**
 * True when req.query carries a `page` parameter. Callers use this to choose
 * between the paged envelope and the pageless array response shape.
 */
export function wantsPagination(query: any): boolean {
  return (
    query !== null &&
    typeof query === 'object' &&
    query.page !== undefined &&
    query.page !== null &&
    String(query.page).trim() !== ''
  );
}

/** Parse one integer-ish query value, falling back on invalid input. */
function parsePositiveInt(raw: any, fallback: number): number {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const n = Number(String(raw));
  if (!Number.isFinite(n)) return fallback;
  const truncated = Math.trunc(n);
  if (truncated < 1) return fallback;
  return truncated;
}

/**
 * Normalize `page`/`limit` query values into safe pagination parameters.
 * Invalid or out-of-range values never throw — they are coerced so a hostile
 * `?limit=99999999` or `?page=-1` cannot generate unbounded/explosive queries.
 */
export function parsePagination(
  query: any,
  opts: { defaultLimit?: number; maxLimit?: number; defaultPage?: number } = {},
): Pagination {
  const defaultLimit = opts.defaultLimit ?? DEFAULT_PAGE_SIZE;
  const maxLimit = opts.maxLimit ?? MAX_PAGE_SIZE;
  const defaultPage = opts.defaultPage ?? 1;

  const requestedPage = parsePositiveInt(query?.page, defaultPage);
  const requestedLimit = parsePositiveInt(query?.limit, defaultLimit);

  const limit = Math.min(requestedLimit, maxLimit);
  const page = Math.min(requestedPage, 100_000); // guard against absurd offsets
  return { page, limit, skip: (page - 1) * limit, take: limit };
}

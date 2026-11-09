/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared ID generator for both persistence drivers.
 *
 * The JSON layer has always produced short prefixed IDs (e.g. `art-ab12cd3`).
 * Existing rows reference these IDs (revisions -> articles, media -> uploads)
 * and they are copied verbatim into PostgreSQL (plan §3.4), so the PostgreSQL
 * driver must keep generating the same namespace to stay compatible.
 */

/** 7-char base36 suffix, matching the historical generator in src/lib/db.ts */
const rand = (): string => Math.random().toString(36).substring(2, 9);

export const genId = (prefix: string): string => `${prefix}-${rand()}`;

/** Normalize an ISO-8601 string (or Date) into a Date, or null when absent */
export function toDate(value: unknown): Date | null | undefined {
  if (value === null || value === undefined) return value as null | undefined;
  if (value instanceof Date) return value;
  if (typeof value === 'string') return new Date(value);
  return undefined;
}

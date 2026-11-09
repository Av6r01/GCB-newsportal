/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Persistence driver selector — Phase 6B (doc: docs/DATABASE_MIGRATION_PLAN.md §7).
 *
 *   DB_DRIVER=postgres  → Prisma/PostgreSQL (src/lib/database/pgDriver.ts)
 *   DB_DRIVER=json      → legacy JSON file store (src/lib/db.ts)
 *
 * Fail-closed rules:
 *   - Production NEVER falls back to JSON. DB_DRIVER=json + NODE_ENV=production
 *     is a hard startup error, and a missing DATABASE_URL aborts startup before
 *     any route can serve stale data.
 *   - Development defaults to JSON so local workflows behave exactly as before;
 *     set DB_DRIVER=postgres to run development against PostgreSQL.
 *
 * Importing this module resolves and validates the driver immediately — a
 * misconfigured deployment dies at startup, not on its first request.
 */

import dotenv from 'dotenv';
import { db as jsonDriverDb, IntegrityError } from './db';
import { PgDatabase } from './database/pgDriver';

// Ensure DATABASE_URL / DB_DRIVER from .env are visible before validation.
// dotenv is idempotent — server.ts also calls dotenv.config() for later readers.
dotenv.config();

export type DbDriverName = 'postgres' | 'json';

const NODE_ENV = process.env.NODE_ENV || 'development';

/** Resolve (and validate) which persistence driver should run. Throws [FATAL] on misconfiguration. */
export function resolveDbDriverName(): DbDriverName {
  const explicit = process.env.DB_DRIVER as DbDriverName | undefined;
  if (explicit && explicit !== 'postgres' && explicit !== 'json') {
    throw new Error(
      `[FATAL] Invalid DB_DRIVER "${explicit}". Allowed values: "postgres" or "json". See .env.example.`
    );
  }
  const driver: DbDriverName = explicit ?? (NODE_ENV === 'production' ? 'postgres' : 'json');

  if (NODE_ENV === 'production') {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        '[FATAL] DATABASE_URL is required in production. ' +
        'Configure the PostgreSQL connection string (postgresql://user:password@host:5432/database) ' +
        'and run `npm run db:migrate:deploy` before starting the server. The JSON fallback is intentionally disabled.'
      );
    }
    if (driver !== 'postgres') {
      throw new Error(
        '[FATAL] DB_DRIVER=json is not allowed in production. ' +
        'The JSON store cannot provide transactional integrity or concurrent-write safety for publishing. ' +
        'Set DB_DRIVER=postgres with a valid DATABASE_URL.'
      );
    }
  }
  return driver;
}

export const persistenceDriverName: DbDriverName = resolveDbDriverName();

/**
 * The active persistence driver.
 *
 * Both drivers implement the same duck-typed method surface (one object per
 * entity: findMany/findUnique/create/update/delete + domain helpers), so route
 * handlers stay agnostic of storage internals (plan §4).
 *
 * In `json` mode this is the historical singleton from src/lib/db.ts (re-used,
 * never duplicated, so legacy tooling and the runtime stay consistent).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db: any = persistenceDriverName === 'json'
  ? jsonDriverDb
  : new PgDatabase();

console.log(
  `[DB] persistence driver: ${persistenceDriverName}` +
  (persistenceDriverName === 'postgres'
    ? ` (Prisma/PostgreSQL, NODE_ENV=${NODE_ENV})`
    : ` (legacy JSON store — development/test only, NODE_ENV=${NODE_ENV})`)
);

export function isPostgresPersistence(): boolean {
  return persistenceDriverName === 'postgres';
}

export { IntegrityError };

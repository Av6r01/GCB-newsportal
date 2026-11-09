/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Canonical JSON-store export (Phase 6B, docs/DATABASE_MIGRATION_PLAN.md §6.6
 * rollback path). Produces a stable, hash-addressed archive of the legacy JSON
 * store WITHOUT modifying it:
 *
 *   - Collections and keys are sorted canonically (byte-stable output).
 *   - Writes data/migration/json-canonical-<timestamp>.json plus SHA-256 meta.
 *   - Fails non-destructively if the source file is unreadable.
 *
 * Usage: npm run db:export
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const JSON_DB = path.join(ROOT, 'data', 'database.json');
const OUT_DIR = path.join(ROOT, 'data', 'migration');

if (!fs.existsSync(JSON_DB)) {
  console.error(`[FATAL] JSON store not found at ${JSON_DB} — nothing to export.`);
  process.exit(1);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = canonicalize((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

const raw = JSON.parse(fs.readFileSync(JSON_DB, 'utf-8'));
const doc = canonicalize(raw) as Record<string, unknown>;
const serialized = JSON.stringify(doc, null, 2);
const sha256 = crypto.createHash('sha256').update(serialized, 'utf-8').digest('hex');

const counts: Record<string, number> = {};
for (const [k, v] of Object.entries(doc)) {
  if (Array.isArray(v)) counts[k] = v.length;
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, -5);
const outFile = path.join(OUT_DIR, `json-canonical-${stamp}.json`);
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(outFile, serialized, 'utf-8');

const meta = {
  exportedAt: new Date().toISOString(),
  source: 'data/database.json',
  output: path.relative(ROOT, outFile),
  sha256,
  counts,
};
fs.writeFileSync(path.join(OUT_DIR, 'export.meta.json'), JSON.stringify(meta, null, 2), 'utf-8');

console.log('[EXPORT] canonical JSON archive written');
console.log(`  file     : ${meta.output}`);
console.log(`  sha256   : ${sha256}`);
console.log(`  records  : ${Object.values(counts).reduce((a, b) => a + b, 0)} across ${Object.keys(counts).length} collections`);
console.log(`  meta     : data/migration/export.meta.json`);

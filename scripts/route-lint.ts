/**
 * Phase 7 route inventory + duplicate registration detector.
 *
 * Scans Express registrations (`app.<method>('<path>', ...)`) in server.ts and
 * src/server/*.ts, normalizes `:param` segments, and flags duplicate
 * method+path pairs (later same-path registrations would be shadowed and
 * unreachable — the P0-07 defect class this tool keeps closed).
 *
 * Usage:
 *   npx tsx scripts/route-lint.ts            (report; exit 1 on duplicates)
 *   npx tsx scripts/route-lint.ts --list     (full ordered inventory)
 *
 * Also usable as a library:
 *   const regs = scanRouteSource(source, 'server.ts');
 *   const dups = findDuplicateRoutes(allRegs);
 */
import fs from 'fs';
import path from 'path';

export interface RouteRegistration {
  method: string;
  routePath: string;
  file: string;
  line: number;
}

/** Normalize a path: `:param` segments collapse so `/a/:id` === `/a/:slug`. */
export function normalizeRoutePath(p: string): string {
  const q = p.replace(/:\w+/g, ':param').replace(/\/+$/, '');
  return q === '' ? '/' : q;
}

const METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL']);

/** Extract a route registration from a single source line, if any. */
function extractRegistration(line: string, file: string, lineNo: number): RouteRegistration | null {
  const m = /^\s*(?:app|router)\.(get|post|put|delete|patch|all)\s*\(\s*/.exec(line);
  if (!m) return null;
  const method = m[1].toUpperCase();
  let i = m[0].length;
  const quote = line[i];
  if (quote !== "'" && quote !== '"' && quote !== '`') return null; // dynamic path expression — skip
  let j = i + 1;
  while (j < line.length) {
    if (line[j] === '\\') {
      j += 2;
      continue;
    }
    if (line[j] === quote) break;
    j++;
  }
  const raw = line.slice(i + 1, j);
  if (/\$\{/.test(raw)) return null; // template-interpolated path — cannot normalize statically
  return { method, routePath: normalizeRoutePath(raw.trim()), file, line: lineNo };
}

/** Scan one source file's text for route registrations. */
export function scanRouteSource(source: string, file: string): RouteRegistration[] {
  const regs: RouteRegistration[] = [];
  source.split('\n').forEach((line, idx) => {
    const reg = extractRegistration(line, file, idx + 1);
    if (reg && METHODS.has(reg.method)) regs.push(reg);
  });
  return regs;
}

/** Scan the repo's route files (server.ts + src/server/*.ts). */
export function scanProjectRoutes(root: string = process.cwd()): RouteRegistration[] {
  const files = ['server.ts'];
  const serverDir = path.join(root, 'src/server');
  if (fs.existsSync(serverDir)) {
    files.push(...fs.readdirSync(serverDir).filter((f) => f.endsWith('.ts')).map((f) => 'src/server/' + f));
  }
  const all: RouteRegistration[] = [];
  for (const file of files) {
    const full = path.join(root, file);
    if (fs.existsSync(full)) all.push(...scanRouteSource(fs.readFileSync(full, 'utf-8'), file));
  }
  return all;
}

export interface Duplicate {
  key: string;
  registrations: RouteRegistration[];
}

/** Group by method+normalized-path and return pairs registered more than once. */
export function findDuplicateRoutes(regs: RouteRegistration[]): Duplicate[] {
  const byKey = new Map<string, RouteRegistration[]>();
  for (const r of regs) {
    const key = `${r.method} ${r.routePath}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(r);
  }
  return [...byKey.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([key, registrations]) => ({ key, registrations }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const isCli = process.argv[1] && path.resolve(process.argv[1]).replace(/\.ts$/, '').endsWith('route-lint');
if (isCli) {
  const all = scanProjectRoutes();
  const list = process.argv.includes('--list');
  if (list) {
    console.log(`[route-lint] total registrations: ${all.length}\n`);
    for (const r of all) console.log(`${r.method.padEnd(7)} ${r.routePath.padEnd(58)} ${r.file}:${r.line}`);
  }
  const dups = findDuplicateRoutes(all);
  if (dups.length === 0) {
    console.log(`[route-lint] OK — ${all.length} route registrations, 0 duplicates.`);
  } else {
    for (const d of dups) {
      console.error(`DUPLICATE: ${d.key}`);
      for (const r of d.registrations) console.error(`  ${r.file}:${r.line}`);
    }
    console.error(`[route-lint] ${dups.length} duplicate route registration(s).`);
    process.exit(1);
  }
}

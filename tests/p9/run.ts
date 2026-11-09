/**
 * Phase 9 orchestrator — one child process per suite (fresh JSON store).
 * Per-suite env injects the CANONICAL ORIGIN (APP_URL) BEFORE import, because
 * src/server/seo.ts resolves it at module scope; the child also inherits
 * defaults the SEO assertions rely on.
 */
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const common = {
  // Validated server-only canonical origin used by sitemaps/canonicals/JSON-LD
  APP_URL: 'https://press.example.org',
};

const SUITES: Record<string, NodeJS.ProcessEnv> = {
  'html-pages': { ...common },
  sitemaps: { ...common },
};

const argv = process.argv.slice(2);
const selected = argv.length > 0 ? argv : Object.keys(SUITES);

let failed = 0;
for (const suite of selected) {
  console.log(`\n▶ suite ${suite}`);
  const res = spawnSync(
    process.execPath,
    ['--import', 'tsx', path.join(__dirname, 'run-suite.ts'), suite],
    {
      cwd: ROOT,
      stdio: 'inherit',
      timeout: 240_000,
      env: { ...process.env, ...(SUITES[suite] || {}) },
    },
  );
  if (res.status !== 0) failed++;
}

console.log('\n========================================================');
if (failed === 0) {
  console.log(`PHASE 9: all ${selected.length} suite(s) passed.`);
} else {
  console.error(`PHASE 9: ${failed}/${selected.length} suite(s) FAILED.`);
  process.exit(1);
}

/**
 * Phase 10 orchestrator — one child process per suite (fresh JSON store).
 * Per-suite env is identical across suites (the management surface needs no
 * APP_URL specific values; the owned-page tests run on the default origin).
 */
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const SUITES: Record<string, NodeJS.ProcessEnv> = {
  'admin-endpoints': {},
  'ui-controls': {},
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
  console.log(`PHASE 10: all ${selected.length} suite(s) passed.`);
} else {
  console.error(`PHASE 10: ${failed}/${selected.length} suite(s) FAILED.`);
  process.exit(1);
}

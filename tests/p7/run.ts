/**
 * Phase 7 regression orchestrator — runs every suite in its OWN tsx child
 * process (one fresh JSON store per suite; the driver is a module singleton).
 * Suites that only need source files (route-lint) can also run standalone.
 */
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const SUITES = [
  'route-duplicates',
  'pagination',
  'cache',
  'archive-purge-slug',
  'atomicity',
  'scheduler',
];

const argv = process.argv.slice(2);
const selected = argv.length > 0 ? argv : SUITES;

let failed = 0;
for (const suite of selected) {
  console.log(`\n▶ suite ${suite}`);
  const res = spawnSync(
    process.execPath,
    ['--import', 'tsx', path.join(__dirname, 'run-suite.ts'), suite],
    { cwd: ROOT, stdio: 'inherit', timeout: 180_000 },
  );
  if (res.status !== 0) failed++;
}

console.log('\n========================================================');
if (failed === 0) {
  console.log(`PHASE 7: all ${selected.length} suite(s) passed.`);
} else {
  console.error(`PHASE 7: ${failed}/${selected.length} suite(s) FAILED.`);
  process.exit(1);
}

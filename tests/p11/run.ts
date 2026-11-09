/**
 * Phase 11 orchestrator — one child process per suite (fresh JSON store +
 * isolated storage directory). Per-suite env injects PROVIDER CHOICE BEFORE
 * import: Suites never share a storage backend and never touch an external
 * media service.
 */
import { spawnSync } from 'child_process';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

// The fake S3 endpoint is started by its suite INSIDE the child; the child
// needs bucket/region/key envs validated before import regardless.
const s3Common = {
  STORAGE_DRIVER: 's3',
  S3_BUCKET: 'gcn-test-bucket',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: 'p11-test-access',
  S3_SECRET_ACCESS_KEY: 'p11-test-secret-key-material-0001',
};

const SUITES: Record<string, NodeJS.ProcessEnv> = {
  providers: { STORAGE_DRIVER: 'local' },
  routes: { STORAGE_DRIVER: 'local' },
  'private-visibility': { STORAGE_DRIVER: 'local', STORAGE_MEDIA_VISIBILITY: 'private' },
  's3-provider': { ...s3Common },
};

const argv = process.argv.slice(2);
const selected = argv.length > 0 ? argv : Object.keys(SUITES);

let failed = 0;
for (const suite of selected) {
  console.log(`\n▶ suite ${suite}`);
  const env = { ...process.env, ...(SUITES[suite] || {}) };
  // isolation: every child gets its own storage directory unless the suite set one
  if (!env.STORAGE_LOCAL_DIR && env.STORAGE_DRIVER === 'local') {
    env.STORAGE_LOCAL_DIR = path.join(os.tmpdir(), `gcn-p11-storage-${suite}-${process.pid}-${Date.now()}`);
  }
  const res = spawnSync(
    process.execPath,
    ['--import', 'tsx', path.join(__dirname, 'run-suite.ts'), suite],
    { cwd: ROOT, stdio: 'inherit', timeout: 240_000, env },
  );
  if (res.status !== 0) failed++;
}

console.log('\n========================================================');
if (failed === 0) {
  console.log(`PHASE 11: all ${selected.length} suite(s) passed.`);
} else {
  console.error(`PHASE 11: ${failed}/${selected.length} suite(s) FAILED.`);
  process.exit(1);
}

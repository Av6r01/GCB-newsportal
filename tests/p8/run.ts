/**
 * Phase 8 regression orchestrator — one child process per suite (fresh JSON
 * store per suite). Per-suite env injects tuned rate limits / quotas so tests
 * run fast while exercising the same production code paths.
 */
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const SUITES: Record<string, NodeJS.ProcessEnv> = {
  validation: {
    // validation suite posts many intentionally-malformed comment payloads;
    // the rate limiter counts every attempt (fail-closed) so the bucket is
    // enlarged here — flood semantics live in the rate-floods suite.
    COMMENTS_RATE_MAX: '50',
  },
  'rate-floods': {
    // tight buckets for fast flood tests
    REACTIONS_RATE_MAX: '5',
    COMMENTS_RATE_MAX: '3',
    ANALYTICS_RATE_MAX: '8',
    NEWSLETTER_RATE_MAX: '3',
    POLLS_RATE_MAX: '50',
  },
  'comments-privacy': {
    // privacy suite posts several comments — keep the bucket generous
    COMMENTS_RATE_MAX: '50',
  },
  'tts-quota': {
    TTS_DAILY_QUOTA_PER_USER: '2',
    TTS_MAX_CONCURRENT: '2',
  },
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
  console.log(`PHASE 8: all ${selected.length} suite(s) passed.`);
} else {
  console.error(`PHASE 8: ${failed}/${selected.length} suite(s) FAILED.`);
  process.exit(1);
}

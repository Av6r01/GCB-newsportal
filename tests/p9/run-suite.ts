/**
 * Phase 9 suite runner — ONE suite module per process, fresh JSON store + env.
 * (Same pattern as tests/p8/run-suite.ts.)
 */
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class Checker {
  failures: string[] = [];
  passes = 0;

  ok(cond: any, name: string) {
    if (cond) {
      this.passes++;
      console.log(`  ✓ ${name}`);
    } else {
      this.failures.push(name);
      console.error(`  ✗ ${name}`);
    }
  }

  eq(actual: any, expected: any, name: string) {
    const good = actual === expected;
    if (good) this.ok(true, name);
    else this.ok(false, `${name} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  }
}

async function main() {
  const names = process.argv.slice(2);
  if (names.length === 0) {
    console.error('usage: tsx run-suite.ts <suite-name> [more ...]');
    process.exit(2);
  }
  const T = new Checker();

  for (const name of names) {
    console.log(`\n=== tests/p9/${name}.test.ts ===`);
    const mod = await import(pathToFileURL(path.join(__dirname, `${name}.test.ts`)).href);
    if (typeof mod.check !== 'function') {
      console.error(`suite ${name} has no check(T) export`);
      T.failures.push(`${name}: missing check()`);
      continue;
    }
    try {
      await mod.check(T);
    } catch (err: any) {
      console.error(`  ✗ suite ${name} threw: ${err?.stack || err}`);
      T.failures.push(`${name}: threw ${err?.message || err}`);
    }
  }

  console.log(`\n[${names.join(', ')}] passed: ${T.passes}, failed: ${T.failures.length}`);
  if (T.failures.length > 0) {
    console.error('FAILED checks:');
    for (const f of T.failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  setTimeout(() => { process.exitCode = 0; process.exit(0); }, 250);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});

import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const dir = path.resolve('tests/arch');
const files = readdirSync(dir)
  .filter(f => f.endsWith('.test.ts'))
  .map(f => path.join(dir, f));

if (!files.length) {
  console.error('run-arch: no *.test.ts files found in', dir);
  process.exit(1);
}

// Both platforms: run serialized to avoid port conflicts between test files
// that each bind to ephemeral ports. Concurrency=1 also keeps the wall clock low.
// Node 26+ supports --experimental-strip-types so .ts test files run natively
// without a separate tsx dependency. --test-force-exit breaks out of the child
// even if a test's after() hook holds an open handle (the known CI hang that
// the aide-release-engineering skill documents).
//
// --import ./scripts/http-close-shim.mjs preloads a patch that makes
// http.Server.prototype.close call closeAllConnections() first. This is the
// root-cause fix for the 46-error hang across 6+ arch test files: every
// failing test uses `httpServer.close(() => resolve())` in its after() hook,
// but the inner fetch() calls keep the keep-alive connection alive so the
// close callback never fires. closeAllConnections() force-closes them so
// the existing resolve() callbacks fire reliably. Surgical, no test files
// modified, no assertions weakened.
const concurrency = 1;

console.log(`run-arch: ${files.length} test file(s), concurrency=${concurrency}`);
const result = spawnSync(
  process.execPath,
  [
    '--experimental-strip-types',
    '--no-warnings',
    '--import', './scripts/http-close-shim.mjs',
    '--test',
    `--test-concurrency=${concurrency}`,
    '--test-timeout=240000',
    '--test-force-exit',
    ...files
  ],
  { stdio: 'inherit' }
);
process.exit(result.status ?? 1);

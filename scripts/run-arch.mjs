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
// without a separate tsx dependency.
//
// --test-force-exit: VERIFIED 8/27 + re-verified 9/10 — on win32 this flag
// triggers a libuv `UV_HANDLE_CLOSING` native assert (src/win/async.c:94) that
// aborts random test FILES even though every subtest passed. It is ONLY safe on
// POSIX (CI/ubuntu). On win32 it is omitted so the runner exits honestly after
// after() hooks drain; the per-test --test-timeout is the honest safety net.
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
const forceExit = process.platform === 'win32' ? [] : ['--test-force-exit'];

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
    ...forceExit,
    ...files
  ],
  { stdio: 'inherit' }
);
process.exit(result.status ?? 1);

import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

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
// --test-timeout is the honest safety net. We deliberately do NOT pass
// --test-force-exit: on win32 it triggers a libuv UV_HANDLE_CLOSING native
// assert that kills random test files (verified 2026-09-03 -- learner-routes
// fell 5/6 with the flag, 6/6 without). The root-cause fix for the keep-alive
// leak is the --import shim below, which calls closeAllConnections() so the
// existing http.Server.close() callbacks fire reliably. That is the real fix;
// force-exit masks the leak and crashes. (aide-windows-dev-reality skill.)
//
// --import <file://...> preloads a patch that makes http.Server.prototype.close
// call closeAllConnections() first. This is the root-cause fix for the 46-error
// hang across 6+ arch test files: every failing test uses
// `httpServer.close(() => resolve())` in its after() hook, but the inner
// fetch() calls keep the keep-alive connection alive so the close callback
// never fires. closeAllConnections() force-closes them so the existing
// resolve() callbacks fire reliably. Surgical, no test files modified, no
// assertions weakened.
//
// Node 26 ESM loader requires --import to be a file:// URL on Windows
// (not a relative path). Convert via pathToFileURL to be cross-platform.
const shimUrl = pathToFileURL(path.resolve('scripts/http-close-shim.mjs')).href;
const concurrency = 1;

console.log(`run-arch: ${files.length} test file(s), concurrency=${concurrency}`);
const result = spawnSync(
  process.execPath,
  [
    '--experimental-strip-types',
    '--no-warnings',
    '--import', shimUrl,
    '--test',
    `--test-concurrency=${concurrency}`,
    '--test-timeout=240000',
    ...files
  ],
  { stdio: 'inherit' }
);
process.exit(result.status ?? 1);

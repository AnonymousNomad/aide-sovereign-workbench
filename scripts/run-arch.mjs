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

// Windows: concurrent test processes trip a libuv UV_HANDLE_CLOSING native
// assert (node/win async.c) nondeterministically; run serialized there.
const concurrency = process.platform === 'win32' ? 1 : 3;

console.log(`run-arch: ${files.length} test file(s), concurrency=${concurrency}`);
const result = spawnSync(
  process.execPath,
  ['--test', `--test-concurrency=${concurrency}`, '--test-timeout=240000', '--test-force-exit', ...files],
  { stdio: 'inherit' }
);
process.exit(result.status ?? 1);

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
// that each bind to ephemeral ports. Concurrency=3 caused intermittent
// failures in CI (veritas gates) due to test files racing on the same ports.
const concurrency = 1;

console.log(`run-arch: ${files.length} test file(s), concurrency=${concurrency}`);
const result = spawnSync(
  process.execPath,
  ['--test', `--test-concurrency=${concurrency}`, '--test-timeout=240000', ...files],
  { stdio: 'inherit' }
);
process.exit(result.status ?? 1);

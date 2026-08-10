import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
const { stdout } = await run(process.execPath, ['benchmarks/run.mjs', process.cwd(), '--dry-run']);
const result = JSON.parse(stdout);
assert.equal(result.mode, 'dry-run');
assert.equal(result.rows.length, 9);
console.log('benchmark runner test passed');

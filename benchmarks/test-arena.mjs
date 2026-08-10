import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile); const { stdout } = await run(process.execPath, ['benchmarks/arena.mjs'], { cwd: process.cwd() });
const result = JSON.parse(stdout); assert.equal(result.ranking.length, 3); assert.equal(result.winner.score, 0.667); console.log('arena test passed');

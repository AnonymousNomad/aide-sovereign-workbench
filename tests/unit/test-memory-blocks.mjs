import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readBlocks, writeBlock, composeMemorySection, recentWorkLine, BLOCK_CAPS, BlockCapError } from '../../harness/memory-blocks.mjs';

test('blocks round-trip and missing files default to empty', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-blocks-'));
  const empty = await readBlocks(dir);
  assert.deepEqual(empty, { project: '', user: '', task: '' });
  await writeBlock(dir, 'project', 'stack: Node 26 + TypeScript strict');
  const blocks = await readBlocks(dir);
  assert.equal(blocks.project, 'stack: Node 26 + TypeScript strict');
  assert.equal(blocks.user, '');
});

test('cap enforcement rejects oversize writes with honest error', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-blocks2-'));
  // ~1000 tokens of text: 4000+ chars
  const big = 'x'.repeat(BLOCK_CAPS.project * 4 + 100);
  await assert.rejects(() => writeBlock(dir, 'project', big), BlockCapError);
  await assert.rejects(() => writeBlock(dir, 'project', big), /cap is 800/);
  // within-cap write succeeds
  await writeBlock(dir, 'project', 'small note');
  // unknown block name rejected
  await assert.rejects(() => writeBlock(dir, 'everything', 'nope'), /unknown memory block/);
});

test('empty content deletes the block file', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-blocks3-'));
  await writeBlock(dir, 'task', 'current objective');
  await writeBlock(dir, 'task', '');
  const blocks = await readBlocks(dir);
  assert.equal(blocks.task, '');
});

test('composeMemorySection skips empties, includes work line, empty when all blank', () => {
  assert.equal(composeMemorySection({ project: '', user: '', task: '' }, ''), '');
  const out = composeMemorySection(
    { project: 'uses pnpm', user: '', task: 'ship X1' },
    '[recent work] 2026-08-25: 1 shipped'
  );
  assert.match(out, /\[memory:project\]/);
  assert.match(out, /uses pnpm/);
  assert.match(out, /\[memory:task\]/);
  assert.doesNotMatch(out, /\[memory:user\]/);
  assert.match(out, /\[recent work\]/);
  // never injects a bare header
  assert.equal(composeMemorySection({ project: '   ', user: '', task: '' }, '').includes('[memory:'), false);
});

test('recentWorkLine reads last two digests, tolerant of missing/corrupt', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-blocks4-'));
  assert.equal(await recentWorkLine(dir), '');
  const daysDir = path.join(dir, '.aide/memory/days');
  await fs.mkdir(daysDir, { recursive: true });
  await fs.writeFile(path.join(daysDir, '2026-08-24.json'), JSON.stringify({ date: '2026-08-24', ships: 2, approvals: 3, rejections: 1 }), 'utf8');
  await fs.writeFile(path.join(daysDir, '2026-08-25.json'), JSON.stringify({ date: '2026-08-25', ships: 0, approvals: 1, rejections: 0 }), 'utf8');
  await fs.writeFile(path.join(daysDir, 'corrupt.json'), '{not json', 'utf8');
  const line = await recentWorkLine(dir);
  assert.match(line, /\[recent work\]/);
  assert.match(line, /2026-08-24: 2 shipped, 3a\/1r/);
  assert.match(line, /2026-08-25: 0 shipped/);
  assert.doesNotMatch(line, /undefined|NaN/);
});

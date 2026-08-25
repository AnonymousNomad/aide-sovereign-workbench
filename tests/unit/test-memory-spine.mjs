import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readWorkEvents, buildDayDigest, writeDayDigest, readDayDigest, listDayDigests, refreshDayDigests } from '../../harness/memory-spine.mjs';

test('readWorkEvents merges cipher bus and ships log chronologically', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-spine-'));
  await fs.mkdir(path.join(dir, '.aide'), { recursive: true });
  await fs.writeFile(path.join(dir, '.aide', 'cipher-state.jsonl'),
    JSON.stringify({ type: 'ship', message: 'fix parser', files_count: 2, at: '2026-08-20T10:00:00.000Z' }) + '\n' +
    'not json at all\n' +
    JSON.stringify({ type: 'approval', tool: 'write_file', pattern: 'write_file', summary: 'p', at: '2026-08-21T09:00:00.000Z' }) + '\n', 'utf8');
  await fs.mkdir(path.join(dir, '.aide', 'metrics'), { recursive: true });
  await fs.writeFile(path.join(dir, '.aide', 'metrics', 'ships.log'),
    JSON.stringify({ at: '2026-08-20T08:00:00.000Z', intent: 'fix the parser', message: 'commit msg' }) + '\n', 'utf8');
  const events = await readWorkEvents(dir);
  assert.equal(events.length, 3);
  // chronological merge across sources
  assert.equal(events[0].kind, 'ship_intent');
  assert.equal(events[1].kind, 'ship');
  assert.equal(events[2].kind, 'approval');
  // since/until filters
  const only21st = await readWorkEvents(dir, { since: '2026-08-21T00:00:00.000Z' });
  assert.equal(only21st.length, 1);
  assert.equal(only21st[0].kind, 'approval');
});

test('buildDayDigest is a deterministic rollup with highlights capped', () => {
  const events = [
    { at: '2026-08-20T10:00:00.000Z', kind: 'ship', detail: { message: 'a'.repeat(300), files_count: 3 } },
    { at: '2026-08-20T11:00:00.000Z', kind: 'approval', detail: { tool: 'run_command', pattern: 'run_command', summary: '' } },
    { at: '2026-08-20T12:00:00.000Z', kind: 'rejection', detail: { tool: 'write_file', pattern: 'write_file', summary: '' } },
    { at: '2026-08-19T12:00:00.000Z', kind: 'ship', detail: { message: 'other day', files_count: 9 } }
  ];
  const d = buildDayDigest('2026-08-20', events);
  assert.equal(d.date, '2026-08-20');
  assert.equal(d.ships, 1);
  assert.equal(d.files_touched, 3);
  assert.equal(d.approvals, 1);
  assert.equal(d.rejections, 1);
  assert.equal(d.tools_used.run_command, 1);
  assert.equal(d.tools_used.write_file, 1);
  assert.equal(d.highlights.length, 1);
  assert.ok(d.highlights[0].length <= 220);
  // other-day event excluded entirely
  const d19 = buildDayDigest('2026-08-19', events);
  assert.equal(d19.ships, 1);
  assert.equal(d19.files_touched, 9);
});

test('digest round-trips through disk and lists by range', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-spine2-'));
  const digest = buildDayDigest('2026-08-20', [
    { at: '2026-08-20T10:00:00.000Z', kind: 'ship', detail: { message: 'x', files_count: 1 } }
  ]);
  await writeDayDigest(dir, digest);
  const back = await readDayDigest(dir, '2026-08-20');
  assert.equal(back.ships, 1);
  assert.equal(await readDayDigest(dir, '1999-01-01'), null);
  await writeDayDigest(dir, buildDayDigest('2026-08-21', []));
  const all = await listDayDigests(dir);
  assert.deepEqual(all, ['2026-08-20', '2026-08-21']);
  const windowed = await listDayDigests(dir, { from: '2026-08-21' });
  assert.deepEqual(windowed, ['2026-08-21']);
});

test('refreshDayDigests writes one digest per active local day, idempotent', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-spine3-'));
  await fs.mkdir(path.join(dir, '.aide'), { recursive: true });
  await fs.writeFile(path.join(dir, '.aide', 'cipher-state.jsonl'),
    JSON.stringify({ type: 'ship', message: 'day1 work', files_count: 1, at: new Date('2026-08-20T12:00:00Z').toISOString() }) + '\n' +
    JSON.stringify({ type: 'rejection', tool: 'run_command', pattern: 'run_command', summary: '', at: new Date('2026-08-22T15:00:00Z').toISOString() }) + '\n', 'utf8');
  const written = await refreshDayDigests(dir);
  assert.equal(written.length, 2);
  assert.ok(written.includes('2026-08-20') && written.includes('2026-08-22'));
  const again = await refreshDayDigests(dir);
  assert.deepEqual(again.sort(), written.sort());
  const d = await readDayDigest(dir, '2026-08-22');
  assert.equal(d.rejections, 1);
  // range-bounded refresh skips out-of-window days
  const bounded = await refreshDayDigests(dir, { from: '2026-08-21', to: '2026-08-30' });
  assert.deepEqual(bounded, ['2026-08-22']);
});

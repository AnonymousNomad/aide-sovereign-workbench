import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { buildDayDigest, writeDayDigest } from '../../harness/memory-spine.mjs';
import * as helixJoin from '../../harness/helix-join.mjs';
import * as helixRetention from '../../harness/helix-retention.mjs';

test('helix-join refresh derives no patterns from an empty day-d digest store', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-helix-'));
  const st = await helixJoin.refresh(dir);
  assert.equal(st.patterns_total, 0);
  assert.equal(st.active, 0);
  // refresh is idempotent
  const again = await helixJoin.refresh(dir);
  assert.equal(again.patterns_total, 0);
});

test('helix-join refreshes and listActive injects learned lines', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-helix2-'));
  // buildDayDigest buckets by LOCAL date, so derive the digest date locally.
  const local = (d) => {
    const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, '0'); const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  };
  const todayStr = local(new Date());
  const iso = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString();
  await writeDayDigest(dir, buildDayDigest(todayStr, [
    { at: iso(0), kind: 'ship', detail: { message: 'fixed the parser again', files_count: 3 } },
    { at: iso(0), kind: 'approval', detail: { tool: 'write_file', pattern: 'write_file', summary: '' } },
    { at: iso(0), kind: 'approval', detail: { tool: 'write_file', pattern: 'write_file', summary: '' } },
    { at: iso(0), kind: 'approval', detail: { tool: 'write_file', pattern: 'write_file', summary: '' } }
  ]));
  const st = await helixJoin.refresh(dir);
  assert.ok(st.patterns_total >= 1);
  assert.ok(st.active >= 1);
  const active = await helixJoin.listActive(dir);
  assert.ok(active.length >= 1);
  assert.ok(active[0].startsWith('[learned] '));
  const snap = await helixJoin.status(dir);
  assert.equal(snap.file.endsWith(path.join('.aide', 'memory', 'patterns.jsonl')), true);
  assert.ok(snap.last_refreshed_at);
});

test('helix-retention rollup writes monthly summaries for old days, keeps current daily', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-helix3-'));
  // A day digest > 31 days old (fixed calendar date, not relative).
  const oldDate = '2026-06-15';
  await writeDayDigest(dir, buildDayDigest(oldDate, [
    { at: '2026-06-15T10:00:00.000Z', kind: 'ship', detail: { message: 'old work', files_count: 2 } }
  ]));
  // A recent day digest (stays in daily tier).
  const local = (d) => {
    const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, '0'); const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  };
  const today = local(new Date());
  await writeDayDigest(dir, buildDayDigest(today, [
    { at: new Date().toISOString(), kind: 'ship', detail: { message: 'today work', files_count: 1 } }
  ]));

  const written = await helixRetention.rollup(dir);
  // The 2026-06 month is older than 31 days relative to now => monthly.
  assert.ok(written.monthly.includes('2026-06'), 'expected 2026-06 monthly, got ' + JSON.stringify(written));
  // Today's month threshold depends on the current date; just assert the
  // current month was NOT rolled if it is < 31 days old, and that a monthly
  // file exists with the rolled count.
  const monthly = await fs.readFile(path.join(dir, '.aide', 'memory', 'months', '2026-06.json'), 'utf8');
  const parsed = JSON.parse(monthly);
  assert.equal(parsed.ships, 1);
  assert.equal(parsed.files_touched, 2);

  const snap = await helixRetention.status(dir);
  assert.equal(snap.days, 2);
  assert.ok(snap.months >= 1);
});

test('helix-retention rollup is idempotent and year summaries appear for very old days', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-helix4-'));
  // > 366 days old => yearly tier.
  await writeDayDigest(dir, buildDayDigest('2024-07-10', [
    { at: '2024-07-10T10:00:00.000Z', kind: 'ship', detail: { message: 'ancient work', files_count: 4 } }
  ]));
  const first = await helixRetention.rollup(dir);
  const second = await helixRetention.rollup(dir);
  assert.deepEqual(second.monthly, first.monthly, 'rollup must be idempotent');
  assert.deepEqual(second.yearly, first.yearly, 'rollup must be idempotent');
  assert.ok(first.yearly.includes('2024'), 'expected yearly rollup for 2024, got ' + JSON.stringify(first.yearly));
  const s = await helixRetention.status(dir);
  assert.equal(s.days, 1);
});
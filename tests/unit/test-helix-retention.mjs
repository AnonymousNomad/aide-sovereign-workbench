import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { refreshRetention, readMonthlySummary, readYearlySummary, listMonthlySummaries, listYearlySummaries } from '../../harness/helix-retention.mjs';

async function writeDay(workspace, date, overrides = {}) {
  const dir = path.join(workspace, '.aide', 'memory', 'days');
  await fs.mkdir(dir, { recursive: true });
  const digest = {
    date,
    ships: 1,
    files_touched: 2,
    approvals: 1,
    rejections: 0,
    aborts: 0,
    ship_intents: 1,
    tools_used: { read_file: 2 },
    highlights: [`decision from ${date}`],
    ...overrides
  };
  await fs.writeFile(path.join(dir, `${date}.json`), JSON.stringify(digest), 'utf8');
}

test('Helix retention preserves the 30-day warm window and rolls day 31 into a provenance summary', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-helix-retention-'));
  await writeDay(workspace, '2025-09-01'); // exactly 30 days before the as-of date
  await writeDay(workspace, '2025-08-31'); // exactly 31 days before the as-of date
  const first = await refreshRetention(workspace, { asOf: '2025-10-01' });
  assert.deepEqual(first.monthly_summaries, ['2025-08']);
  assert.deepEqual(await listMonthlySummaries(workspace), ['2025-08.json']);
  assert.equal((await readMonthlySummary(workspace, '2025-08')).source_dates[0], '2025-08-31');
  assert.equal((await readMonthlySummary(workspace, '2025-08')).ships, 1);
  assert.equal(await fs.stat(path.join(workspace, '.aide', 'memory', 'days', '2025-08-31.json')).then(() => true), true);
  assert.equal(await readMonthlySummary(workspace, '2025-09'), null, 'day 30 stays in the warm day tier');
});

test('Helix retention rolls an existing month into a year, is restart-safe, and never deletes source data', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-helix-year-'));
  await writeDay(workspace, '2024-08-01', { ships: 3, files_touched: 7 });
  await refreshRetention(workspace, { asOf: '2024-10-15' });
  const before = await readMonthlySummary(workspace, '2024-08');
  assert.ok(before);
  const result = await refreshRetention(workspace, { asOf: '2026-09-06' });
  assert.deepEqual(result.yearly_summaries, ['2024']);
  const year = await readYearlySummary(workspace, '2024');
  assert.ok(year);
  assert.equal(year.period_type, 'year');
  assert.equal(year.ships, 3);
  assert.ok(year.source_files.some(file => file.endsWith('months/2024-08.json')));
  assert.deepEqual(await listYearlySummaries(workspace), ['2024.json']);
  const again = await refreshRetention(workspace, { asOf: '2026-09-06' });
  assert.deepEqual(again.yearly_summaries, ['2024']);
  const after = await readYearlySummary(workspace, '2024');
  assert.deepEqual(after.source_dates, year.source_dates);
  assert.equal(await fs.stat(path.join(workspace, '.aide', 'memory', 'days', '2024-08-01.json')).then(() => true), true);
});

test('Helix retention rejects an invalid as-of boundary instead of guessing', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-helix-invalid-'));
  await assert.rejects(() => refreshRetention(workspace, { asOf: 'not-a-date' }), /ISO calendar date/);
});


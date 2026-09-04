import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStateBus } from '../../harness/cipher-state.mjs';

// Each test gets its own workspace — the bus writes to a real file, so
// isolation prevents cross-test pollution. The previous shared-`before`
// pattern caused tests 2 and 6 to see appends from test 1.
async function freshWorkspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'aide-csb-'));
}

async function cleanup(workspace: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    try { await fs.rm(workspace, { recursive: true, force: true }); return; }
    catch (error) {
      if (!['EBUSY', 'ENOTEMPTY', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
}

test('append writes one JSON line per event with an ISO timestamp', async () => {
  const workspace = await freshWorkspace();
  try {
    const bus = createStateBus(workspace);
    await bus.append({ type: 'approval', tool: 'file_write', pattern: 'file_write', decision: 'approve' });
    const raw = await fs.readFile(path.join(workspace, '.aide', 'cipher-state.jsonl'), 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    assert.equal(lines.length, 1, 'one event = one line');
    const entry = JSON.parse(lines[0] as string) as { type: string; at: string; tool: string };
    assert.equal(entry.type, 'approval');
    assert.equal(entry.tool, 'file_write');
    assert.match(entry.at, /^\d{4}-\d{2}-\d{2}T/);
  } finally { await cleanup(workspace); }
});

test('readState filters by type and limit (newest first)', async () => {
  const workspace = await freshWorkspace();
  try {
    const bus = createStateBus(workspace);
    for (let i = 0; i < 5; i++) await bus.append({ type: 'approval', tool: `t${i}`, decision: 'approve' });
    for (let i = 0; i < 3; i++) await bus.append({ type: 'rejection', tool: `r${i}`, decision: 'reject' });
    const approvals = await bus.readState({ type: 'approval' });
    assert.equal(approvals.length, 5, '5 approvals only');
    const all = await bus.readState({ limit: 4 });
    assert.equal(all.length, 4, 'limit caps the tail');
    assert.equal((all[0] as { tool?: string }).tool, 'r2', 'newest rejection is first');
  } finally { await cleanup(workspace); }
});

test('getPreferences emits [learned] lines only for patterns with count>=3 and >=60% approved', async () => {
  const workspace = await freshWorkspace();
  try {
    const bus = createStateBus(workspace);
    for (let i = 0; i < 3; i++) await bus.append({ type: 'approval', tool: 'a', pattern: 'stable_a', decision: 'approve' });
    await bus.append({ type: 'approval', tool: 'b', pattern: 'mixed_b', decision: 'approve' });
    await bus.append({ type: 'approval', tool: 'b', pattern: 'mixed_b', decision: 'approve' });
    await bus.append({ type: 'rejection', tool: 'b', pattern: 'mixed_b', decision: 'reject' });
    await bus.append({ type: 'rejection', tool: 'b', pattern: 'mixed_b', decision: 'reject' });
    await bus.append({ type: 'approval', tool: 'c', pattern: 'singleton_c', decision: 'approve' });
    const learned = await bus.getPreferences(3, 15);
    assert.deepEqual(learned, ['[learned] stable_a'], 'only stable_a qualifies; mixed_b and singleton_c filtered');
  } finally { await cleanup(workspace); }
});

test('getPreferences returns [] on a fresh workspace (no false positives)', async () => {
  const workspace = await freshWorkspace();
  try {
    const bus = createStateBus(workspace);
    const learned = await bus.getPreferences(3, 15);
    assert.deepEqual(learned, []);
  } finally { await cleanup(workspace); }
});

test('getPreferences is sorted by approved-count desc and capped at limit', async () => {
  const workspace = await freshWorkspace();
  try {
    const bus = createStateBus(workspace);
    // p_heavy gets 6 approvals, p_light gets 3; p_heavy must come first.
    for (let i = 0; i < 6; i++) await bus.append({ type: 'approval', tool: 'h', pattern: 'p_heavy', decision: 'approve' });
    for (let i = 0; i < 3; i++) await bus.append({ type: 'approval', tool: 'l', pattern: 'p_light', decision: 'approve' });
    for (let i = 0; i < 5; i++) await bus.append({ type: 'approval', tool: 'm', pattern: 'p_mid', decision: 'approve' });
    const learned = await bus.getPreferences(3, 2);
    assert.equal(learned.length, 2, 'limit caps the list');
    assert.equal(learned[0], '[learned] p_heavy', 'heaviest (6 approvals) sorts first');
    assert.equal(learned[1], '[learned] p_mid', 'mid (5 approvals) sorts second');
  } finally { await cleanup(workspace); }
});

test('append failures never throw (bus is best-effort)', async () => {
  const tmp = await freshWorkspace();
  try {
    const badFile = path.join(tmp, 'not-a-dir');
    await fs.writeFile(badFile, 'x');
    const bus = createStateBus(badFile);
    await bus.append({ type: 'approval', tool: 'noop', decision: 'approve' });
    await assert.rejects(
      () => fs.access(path.join(badFile, '.aide', 'cipher-state.jsonl')),
      (error: unknown) => error instanceof Error && ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')
    );
  } finally { await cleanup(tmp); }
});

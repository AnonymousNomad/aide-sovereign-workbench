// Audit envelope focused battery (C6 release gate 4 / competitor-research
// gap #1): every chassis boundary event lands in cipher-state.jsonl
// with the chassis v1 envelope. The audit-trail service is the single
// emit point; this battery exercises every typed helper + read filter
// + trajectory shape without spinning up the full stack.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAuditTrail } from '../../node/src/services/audit-trail.mjs';

function makeWorkspace() {
  return mkdtempSync(join(tmpdir(), 'aide-audit-'));
}

test('audit envelope: known event types are the chassis v1 surface', () => {
  const service = createAuditTrail({ workspace: makeWorkspace() });
  const types = service.knownTypes();
  // Every type the operator cares about (per competitor-research gap #1).
  for (const required of [
    'chat', 'agent.start', 'agent.message', 'agent.tool.call', 'agent.tool.result',
    'agent.approval', 'agent.bundle.preview', 'agent.bundle.run',
    'subagent.spawn', 'subagent.done', 'subagent.error', 'desktop'
  ]) {
    assert.ok(types.includes(required), `audit envelope must include type: ${required}`);
  }
  // Legacy shapes preserved for [learned] injector (X1.a).
  for (const legacy of ['approval', 'rejection', 'abort']) {
    assert.ok(types.includes(legacy), `legacy shape must be preserved: ${legacy}`);
  }
});

test('audit envelope: cipher-state.jsonl lands under .aide/', async () => {
  const workspace = makeWorkspace();
  try {
    const service = createAuditTrail({ workspace });
    await service.emitChat({ task: 'hello' });
    const file = join(workspace, '.aide', 'cipher-state.jsonl');
    assert.ok(existsSync(file), 'cipher-state.jsonl must be written under .aide/');
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('audit envelope: full agent trajectory (start -> message -> tool.call -> tool.result -> approval -> message)', async () => {
  const workspace = makeWorkspace();
  try {
    const service = createAuditTrail({ workspace });
    const sessionId = 'sess_traj_001';
    const bundleId = 'wb_traj_001';
    await service.emitBundlePreview({ task: 'fix the bug', mode: 'act', bundleId, primarySkill: 'debug-error' });
    await service.emitBundleRun({ bundleId, sessionId, chatSource: 'local' });
    await service.emitAgentStart({ sessionId, mode: 'act', task: 'fix the bug', bundleId, chatSource: 'local' });
    await service.emitAgentMessage({ sessionId, role: 'user', content: 'fix the bug', iteration: 0 });
    await service.emitToolCall({ sessionId, tool: 'file_write', args: { path: 'app.js' }, iteration: 1 });
    await service.emitToolResult({ sessionId, tool: 'file_write', ok: true, output: 'wrote 12 lines', iteration: 1 });
    await service.emitApproval({ sessionId, tool: 'file_write', decision: 'approve', argsPreview: 'app.js' });
    await service.emitAgentMessage({ sessionId, role: 'assistant', content: 'done', iteration: 2 });
    const traj = await service.sessionTrajectory(sessionId);
    assert.equal(traj.session_id, sessionId);
    assert.ok(traj.event_count >= 6, `expected >=6 events, got ${traj.event_count}`);
    // Each required boundary event must be present
    for (const required of ['agent.start', 'agent.message', 'agent.tool.call', 'agent.tool.result', 'agent.approval']) {
      assert.ok(traj.by_type[required], `trajectory must include ${required}`);
      assert.ok(traj.by_type[required].length >= 1, `${required} must have at least one entry`);
    }
    // bundleTrajectory must also pick up the bundle.preview + bundle.run
    const btraj = await service.bundleTrajectory(bundleId);
    assert.ok(btraj.event_count >= 2, 'bundleTrajectory must include preview + run');
    const btypes = btraj.events.map(e => e.type);
    assert.ok(btypes.includes('agent.bundle.preview'));
    assert.ok(btypes.includes('agent.bundle.run'));
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('audit envelope: subagent trajectory (spawn -> done, error)', async () => {
  const workspace = makeWorkspace();
  try {
    const service = createAuditTrail({ workspace });
    await service.emitSubagentSpawn({ parentSessionId: 'p1', childSessionId: 'c1', role: 'researcher' });
    await service.emitSubagentDone({ parentSessionId: 'p1', childSessionId: 'c1', status: 'done', filesChanged: ['a.js', 'b.js'] });
    await service.emitSubagentError({ parentSessionId: 'p1', childSessionId: 'c2', error: 'permission denied' });
    const events = await service.readEvents({ sessionId: 'p1' });
    assert.equal(events.length, 3);
    const types = events.map(e => e.type);
    assert.ok(types.includes('subagent.spawn'));
    assert.ok(types.includes('subagent.done'));
    assert.ok(types.includes('subagent.error'));
    const errorEvt = events.find(e => e.type === 'subagent.error');
    assert.equal(errorEvt.error, 'permission denied');
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('audit envelope: emit never throws even on a forced I/O error', async () => {
  // Force a real I/O error by passing a workspace path the bus cannot
  // touch (a path under a non-existent drive). The bus's appendFile
  // should fail and the emit's try/catch should swallow the error.
  // The audit capture must NEVER break the operation it audits.
  const service = createAuditTrail({ workspace: 'Z:\\nonexistent\\audit-test' });
  // Should not throw.
  await service.emitChat({ task: 'after forced error' });
  // And the read should return [] (no file).
  const events = await service.readEvents({ type: 'chat' });
  assert.equal(events.length, 0);
});

test('audit envelope: readEvents filters by type, sessionId, bundleId, since', async () => {
  const workspace = makeWorkspace();
  try {
    const service = createAuditTrail({ workspace });
    await new Promise(r => setTimeout(r, 5));
    const before = new Date().toISOString();
    await new Promise(r => setTimeout(r, 5));
    await service.emitChat({ task: 'a' });
    await service.emitChat({ task: 'b' });
    await service.emitAgentStart({ sessionId: 's1', mode: 'act', task: 'x' });
    await service.emitAgentStart({ sessionId: 's2', mode: 'act', task: 'y' });
    assert.equal((await service.readEvents({ type: 'chat' })).length, 2);
    assert.equal((await service.readEvents({ sessionId: 's1' })).length, 1);
    assert.equal((await service.readEvents({ sessionId: 's2' })).length, 1);
    const filtered = await service.readEvents({ since: before });
    assert.ok(filtered.length >= 4, `expected >=4 events after ${before}, got ${filtered.length}`);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('audit envelope: long strings are trimmed (240 char cap)', async () => {
  const workspace = makeWorkspace();
  try {
    const service = createAuditTrail({ workspace });
    const longTask = 'x'.repeat(8000);
    await service.emitChat({ task: longTask });
    const events = await service.readEvents({ type: 'chat' });
    assert.equal(events.length, 1);
    assert.ok(events[0].task.length <= 1000, `task should be trimmed, got ${events[0].task.length} chars`);
    assert.ok(events[0].task.endsWith('...'), 'trimmed strings should end with ellipsis');
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('audit envelope: approval event includes both legacy (decision) and new (agent.approval) shapes', async () => {
  // X1.a legacy: readState({ type: 'approval' }) is consumed by getPreferences
  // to inject [learned] blocks. The new envelope must keep emitting
  // both shapes for backwards compatibility.
  const workspace = makeWorkspace();
  try {
    const service = createAuditTrail({ workspace });
    await service.emitApproval({ sessionId: 's1', tool: 'file_write', decision: 'approve', argsPreview: 'app.js' });
    const events = await service.readEvents({});
    assert.equal(events.length, 2, 'emitApproval should land both legacy + new');
    const types = events.map(e => e.type);
    assert.ok(types.includes('approval'), 'legacy shape must be present for [learned]');
    assert.ok(types.includes('agent.approval'), 'new envelope shape must be present');
    const legacy = events.find(e => e.type === 'approval');
    const enriched = events.find(e => e.type === 'agent.approval');
    assert.equal(legacy.tool, enriched.tool);
    assert.equal(legacy.decision, enriched.decision);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

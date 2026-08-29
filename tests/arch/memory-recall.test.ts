// Tests for memory-recall.mjs (Gap #4: auto-memory)
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fsp } from 'node:fs';

import { createMemoryRecall } from '../../node/src/services/memory-recall.mjs';

let dir: string = '';

beforeEach(async function() {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'aide-mem-'));
});

afterEach(async function() {
  await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
});

function makeEntry(i: number, opts: any = {}): any {
  return {
    session_id: 's' + i,
    ts: '2026-08-29T0' + (i % 10) + ':00:00Z',
    intent: opts.intent || 'fix chat crash',
    summary: opts.summary || 'investigated cipher engine crash',
    skills_invoked: opts.skills_invoked || ['aide-engine-lifecycle-doctrine'],
    files_touched: opts.files_touched || ['daemon/model-manager.mjs'],
    outcome: opts.outcome || 'resolved'
  };
}

test('recall returns empty list when no memories exist', async function() {
  const r = createMemoryRecall({ workspace: dir });
  const out = await r.recall('something');
  assert.equal(out.hits.length, 0);
  assert.equal(out.degraded, true);
  assert.match(out.reason!, /no memories/);
});

test('recall scores by token overlap and returns ranked hits', async function() {
  const r = createMemoryRecall({ workspace: dir });
  await r.remember(makeEntry(1, { intent: 'cipher engine crash', summary: 'cipher crash on vulkan' }));
  await r.remember(makeEntry(2, { intent: 'desktop action grammar', summary: 'added <desktop_action> parser' }));
  await r.remember(makeEntry(3, { intent: 'telegram bot connect', summary: 'connected @AIDECYPHER_bot' }));

  const out = await r.recall('cipher engine crash on vulkan');
  assert.equal(out.degraded, false);
  assert.ok(out.hits.length >= 1, 'should return at least one hit');
  assert.equal(out.hits[0]!.session_id, 's1', 'most relevant should be s1');
  assert.ok(out.hits[0]!.score > 0);
});

test('skills and file paths get field-weighted bonus over prose', async function() {
  const r = createMemoryRecall({ workspace: dir });
  await r.remember(makeEntry(1, { intent: 'fix things', summary: 'general maintenance', skills_invoked: ['unrelated-skill'] }));
  await r.remember(makeEntry(2, { intent: 'fix things', summary: 'general maintenance', skills_invoked: ['aide-engine-lifecycle-doctrine'], files_touched: ['daemon/model-manager.mjs'] }));

  const out = await r.recall('aide-engine-lifecycle-doctrine daemon/model-manager.mjs');
  assert.equal(out.hits[0]!.session_id, 's2', 'weighted fields should rank s2 first');
});

test('budget cap stops at ~800 tokens', async function() {
  const r = createMemoryRecall({ workspace: dir });
  // Add 20 memories that all match, so the budget cap has to trim
  for (let i = 0; i < 20; i++) {
    await r.remember(makeEntry(i, { intent: 'chat crash', summary: 'x'.repeat(500) }));
  }
  const out = await r.recall('chat crash');
  assert.ok(out.hits.length <= 20);
  assert.ok(out.approxTokens <= 800 + 50, 'approxTokens near budget, with small slack');
});

test('status reports count and last ts', async function() {
  const r = createMemoryRecall({ workspace: dir });
  let s = await r.status();
  assert.equal(s.count, 0);
  assert.equal(s.lastTs, null);
  await r.remember(makeEntry(1));
  s = await r.status();
  assert.equal(s.count, 1);
  assert.equal(s.lastTs, '2026-08-29T01:00:00Z');
});

test('malformed lines are skipped, valid ones still load', async function() {
  const r = createMemoryRecall({ workspace: dir });
  const memFile = path.join(dir, '.aide', 'memory', 'sessions.jsonl');
  await fsp.mkdir(path.dirname(memFile), { recursive: true });
  await fsp.writeFile(memFile,
    JSON.stringify(makeEntry(1)) + '\n' +
    'this is not json\n' +
    JSON.stringify(makeEntry(2)) + '\n'
  );
  const out = await r.recall('cipher engine crash');
  assert.equal(out.hits.length, 2, 'both valid entries should load; the malformed line should be skipped');
});

test('remember rejects entries missing required fields', async function() {
  const r = createMemoryRecall({ workspace: dir });
  await assert.rejects(function() { return r.remember({}); });
  await assert.rejects(function() { return r.remember({ session_id: 's1' }); });
});

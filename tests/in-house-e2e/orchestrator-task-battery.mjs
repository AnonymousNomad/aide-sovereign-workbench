// Behavioral task matrix for the CPU orchestrator + scaffold card.
// This is deliberately user-shaped input, not a route/status smoke probe.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createOrchestratorCardService } from '../../node/src/services/orchestrator-card.mjs';
import { OrchestratorBundleCardResponse } from '../../common/contracts/orchestrator.ts';

const workspace = process.cwd();
const service = createOrchestratorCardService({ workspace });
const tasks = [
  ['debug the auth error and reproduce it', 'debug-error'],
  ['explain the request path through this service', 'explain-code'],
  ['commit this focused change with an atomic message', 'git-commit-atomic'],
  ['refactor this duplicated parser safely', 'refactor-safely'],
  ['write a regression test for the failing case', 'write-test'],
  ['aide arch extensions activation events and VSIX host', 'aide-arch-extensions']
];

test('real task matrix routes and scaffolds every representative intent', () => {
  const before = fs.readdirSync(path.join(workspace, '.aide'), { withFileTypes: true }).map(e => e.name).sort();
  for (const [task, expected] of tasks) {
    const card = service.card(task, 'act');
    const parsed = OrchestratorBundleCardResponse.safeParse(card);
    assert.equal(parsed.success, true, parsed.success ? '' : parsed.error.message);
    assert.equal(card.primary_skill.name, expected, `wrong route for: ${task}`);
    assert.ok(card.routing_log.length >= 3, `no evidence for: ${task}`);
    assert.equal(card.helix.bootstrap_visible, true);
    assert.ok(card.scaffold.system.includes('AIDE scaffold v2'));
    assert.ok(card.scaffold.system.includes('SOP 1') || card.scaffold.system.includes('L0 truncated'), `L0 missing for: ${task}`);
    assert.ok(card.scaffold.bytes <= card.prompt_budget.bytes, `budget exceeded for: ${task}`);
  }
  const after = fs.readdirSync(path.join(workspace, '.aide'), { withFileTypes: true }).map(e => e.name).sort();
  assert.deepEqual(after, before, 'read-only task classification must not mutate workspace state');
});

test('unknown task remains explicit and still receives uncertainty SOPs', () => {
  const card = service.card('zzzzqqqq no known intent', 'plan');
  assert.equal(card.primary_skill.name, 'unknown');
  assert.ok(card.sop_names.includes('surface-uncertainty'));
  assert.equal(card.mode, 'plan');
  assert.ok(card.routing_log.some(entry => entry.decision === 'rejected'));
});

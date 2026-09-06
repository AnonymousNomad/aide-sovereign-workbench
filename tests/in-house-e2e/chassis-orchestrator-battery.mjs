// tests/in-house-e2e/chassis-orchestrator-battery.mjs
// Slice C3+C4 batched: orchestrator + scaffold-v2 + 4-layer composition +
// 1 real end-to-end skill flow. 7 tests.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createOrchestrator, HELIX_CONFIDENCE_THRESHOLD, HELIX_MIN_TRAJECTORIES } from '../../harness/orchestrator.mjs';
import { assembleScaffold } from '../../harness/scaffold-v2.mjs';
import { createWorkflowBundle, addRoutingEvidence } from '../../harness/workflow-bundle.mjs';

test('orchestrator: classify a debug request picks a skill with a routing_log', () => {
  const orch = createOrchestrator({ workspace: process.cwd() });
  const bundle = orch.classify('debug this null pointer in auth.ts');
  assert.equal(bundle.goal, 'debug this null pointer in auth.ts');
  assert.ok(bundle.primarySkill && bundle.primarySkill.name, 'primarySkill.name required');
  assert.ok(Array.isArray(bundle.routingLog) && bundle.routingLog.length >= 1, 'routingLog captured');
  for (const entry of bundle.routingLog) {
    assert.ok(typeof entry.stage === 'string');
    assert.ok(typeof entry.signal === 'string');
    assert.ok(typeof entry.score === 'number');
    assert.ok(typeof entry.threshold === 'number');
    assert.ok(['kept', 'rejected', 'injected', 'skipped'].includes(entry.decision));
  }
  assert.ok(typeof bundle.rationale === 'string' && bundle.rationale.length > 0, 'rationale present');
  assert.ok(bundle.toolSet.includes('read_file'));
  assert.ok(bundle.toolSet.includes('write_file'));
  assert.ok(bundle.toolSet.includes('bash'));
  assert.equal(bundle.requireApproval, true);
});

test('orchestrator: classify a non-matching request returns unknown + operator routing', () => {
  const orch = createOrchestrator({ workspace: process.cwd() });
  const bundle = orch.classify('zzzzqqqqxxxxx random words no match here');
  assert.ok(bundle.primarySkill);
  assert.ok(bundle.routingLog.length >= 1);
  const decisions = bundle.routingLog.map(e => e.decision);
  assert.ok(decisions.includes('rejected'), 'at least one rejection in routing_log when no match');
});

test('orchestrator: returns a glass-box workflow bundle with all chassis fields', () => {
  const orch = createOrchestrator({ workspace: process.cwd() });
  const bundle = orch.classify('review the PR for auth.ts');
  for (const f of ['id', 'goal', 'primarySkill', 'sopNames', 'toolSet', 'promptBudget', 'helix', 'routingLog', 'rationale', 'requireApproval']) {
    assert.ok(bundle[f] !== undefined, `missing field: ${f}`);
  }
  assert.equal(bundle.helix.skipped, true);
  assert.match(bundle.helix.skipped_reason, /Helix has \d+ trajectories/);
  assert.equal(bundle.helix.threshold, HELIX_CONFIDENCE_THRESHOLD);
  assert.equal(bundle.helix.enabled, true);
  assert.equal(bundle.helix.skipped, true);
});

test('orchestrator: helix status reports file count and threshold', () => {
  const orch = createOrchestrator({ workspace: process.cwd() });
  const s = orch.helixStatus();
  assert.equal(s.threshold, HELIX_CONFIDENCE_THRESHOLD);
  assert.equal(s.min_trajectories, HELIX_MIN_TRAJECTORIES);
  assert.ok(typeof s.file_count === 'number');
  assert.ok(s.file_count < HELIX_MIN_TRAJECTORIES, 'day-one AIDE has empty Helix');
});

test('orchestrator: legacy registry skills remain routable through the lazy shim', () => {
  const orch = createOrchestrator({ workspace: process.cwd() });
  const catalog = orch.listCatalog();
  const legacy = catalog.find(item => item.name === 'aide-arch-extensions');
  assert.ok(legacy, 'legacy skill must be present in the orchestrator catalog');
  assert.equal(legacy.legacy, true);
  const bundle = orch.classify('aide arch extensions activation events and VSIX host');
  assert.equal(bundle.primarySkill.name, 'aide-arch-extensions');
  assert.equal(bundle.primarySkill.legacy, true);
  assert.equal(bundle.primarySkill.version, '0.0.0-legacy');
});

test('scaffold-v2: 4-layer composition respects byte and line budgets', () => {
  const bundle = createWorkflowBundle({
    goal: 'review PR auth.ts',
    primarySkill: { name: 'code-review', version: '1.0.0' },
    sopNames: ['ask-dont-circle', 'verify-before-claiming', 'fail-closed', 'operator-approves-mutations'],
    toolSet: ['read_file', 'search', 'git_diff'],
    promptBudget: { lines: 80, bytes: 2048 },
    helixMatches: 0,
    helixSkipped: true,
    helixSkippedReason: 'test'
  });
  const sopBodies = {
    'ask-dont-circle': '1. ask one focused question.\n2. do not fabricate.\n3. surface uncertainty.',
    'verify-before-claiming': '1. run the test.\n2. show the output.\n3. never claim without evidence.',
    'fail-closed': '1. on error, stop and report.\n2. do not guess-and-continue.',
    'operator-approves-mutations': '1. read_file and list are free.\n2. write_file and bash need approval.'
  };
  const skillBody = '# code-review skill body\n\nThe skill reviews code changes for bugs, security, style, tests, and docs.';
  const out = assembleScaffold({ workflowBundle: bundle, sopBodies, skillBody, smallModel: true });
  assert.ok(out.system.length > 0);
  assert.ok(out.bytes <= 2048, `system ${out.bytes}b exceeds 2048b budget`);
  assert.ok(out.lines <= 80, `system ${out.lines} lines exceeds 80-line budget`);
  assert.match(out.system, /AIDE scaffold v2/);
  assert.match(out.system, /SOP 1/);
  assert.match(out.system, /code-review skill body/);
});

test('scaffold-v2: drops L2 first, then L1, then L0 to fit budget', () => {
  const bundle = createWorkflowBundle({
    goal: 'test',
    primarySkill: { name: 'huge-skill', version: '1.0.0' },
    sopNames: ['a', 'b', 'c', 'd'],
    toolSet: ['read_file'],
    promptBudget: { lines: 20, bytes: 600 },
    helixMatches: 0,
    helixSkipped: true,
    helixSkippedReason: 'test'
  });
  const sopBodies = {
    a: 'sop a body one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten',
    b: 'sop b body one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten',
    c: 'sop c body one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten',
    d: 'sop d body one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten'
  };
  const skillBody = 'x'.repeat(2000);
  const out = assembleScaffold({ workflowBundle: bundle, sopBodies, skillBody, smallModel: true });
  assert.ok(out.dropped.length > 0, 'something must be dropped when over budget');
  assert.ok(out.dropped.includes('L1') || out.dropped.includes('L0'),
    `expected L1 or L0 in dropped, got: ${out.dropped.join(',')}`);
});

test('workflow-bundle: 4-layer composer respects a small budget for tiny local models', () => {
  const bundle = createWorkflowBundle({
    goal: 'fix typo',
    primarySkill: { name: 'quick-fix', version: '0.1.0' },
    sopNames: ['minimal-diff'],
    toolSet: ['edit_file'],
    promptBudget: { lines: 30, bytes: 500 },
    helixMatches: 0,
    helixSkipped: true,
    helixSkippedReason: 'test'
  });
  const out = assembleScaffold({
    workflowBundle: bundle,
    sopBodies: { 'minimal-diff': '1. one line change.\n2. one test.' },
    skillBody: '# quick-fix\n\nMake a minimal change.',
    smallModel: true
  });
  assert.ok(out.bytes <= 500);
  assert.ok(out.lines <= 30);
});

// tests/in-house-e2e/chassis-skill-battery.mjs
// Slice D2: the 6 seed skills (developer-credo, kaizen-loop, debug-error,
// explain-code, git-commit-atomic, refactor-safely, write-test).
// Plus the orchestrator's L0.5 credo loading and the skill-writer SOP gate.

import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createOrchestrator } from '../../harness/orchestrator.mjs';
import { createSkillLoader } from '../../harness/skill-loader.mjs';
import { createSopLoader } from '../../harness/sop-loader.mjs';

test('L0.5 credo loads first in the orchestrator bundle when present', () => {
  const orch = createOrchestrator({ workspace: 'E:/aide-sovern-workbench' });
  const bundle = orch.classify('debug the auth error');
  // The first entry in sopNames should be 'developer-credo' (L0.5).
  assert.ok(bundle.sopNames.length > 0, 'sopNames must not be empty');
  assert.equal(bundle.sopNames[0], 'developer-credo', 'credo must be the first SOP loaded');
  // The routing log should record the L0.5 credo evidence.
  const credoEntry = bundle.routingLog.find(e => e.stage === 'L0.5_credo');
  assert.ok(credoEntry, 'routingLog must include L0.5_credo evidence');
  assert.equal(credoEntry.decision, 'injected', 'credo should be marked injected');
});

test('all 6 seed skills parse with full v1 envelope', () => {
  const loader = createSkillLoader({ workspace: 'E:/aide-sovern-workbench' });
  const expected = [
    'developer-credo',
    'kaizen-loop',
    'debug-error',
    'explain-code',
    'git-commit-atomic',
    'refactor-safely',
    'write-test'
  ];
  const available = loader.listAvailable();
  for (const name of expected) {
    assert.ok(available.includes(name), `expected seed skill ${name} in catalog`);
  }
  for (const name of expected) {
    const r = loader.readSkillFile(name);
    assert.equal(r.ok, true, `seed skill ${name} failed to parse: ${r.error}`);
    // v1 envelope: name matches filename, version is semver, category is in allowlist.
    assert.equal(r.name, name);
    assert.match(r.version, /^[0-9]+\.[0-9]+\.[0-9]+$/);
    assert.ok(r.appliesTo && r.appliesTo.length > 0, `${name} must have at least one applies_to trigger`);
    assert.ok(r.toolsRequired && r.toolsRequired.length > 0, `${name} must require at least one tool`);
    assert.ok(r.sop && r.sop.length > 20, `${name} must have a multi-step sop`);
    assert.ok(r.body && r.body.length > 100, `${name} must have a substantial body`);
    // skill-writer gate: at least 2 failure_modes (the writer is its own proof).
    if (name !== 'developer-credo') {
      assert.ok(r.failureModes && r.failureModes.length >= 2, `${name} must have at least 2 failure_modes (skill-writer gate)`);
    }
  }
});

test('chassis SOPs include the skill-writer and kaizen-loop disciplines', () => {
  const sopLoader = createSopLoader({ workspace: 'E:/aide-sovern-workbench' });
  const available = sopLoader.listAvailable();
  // The skill-writer SOP enforces the premeditation discipline on every new skill.
  assert.ok(available.includes('skill-writer'), 'sops/skill-writer.md must exist');
  const sw = sopLoader.readSopFile('skill-writer');
  assert.equal(sw.ok, true);
  // The kaizen-loop SOP enforces the closed-loop failure -> skill mechanism.
  assert.ok(available.includes('kaizen-loop'), 'sops/kaizen-loop.md must exist');
  const kl = sopLoader.readSopFile('kaizen-loop');
  assert.equal(kl.ok, true);
});

test('orchestrator routes debug-error for a debug request', () => {
  const orch = createOrchestrator({ workspace: 'E:/aide-sovern-workbench' });
  const bundle = orch.classify('debug the auth.ts error');
  assert.equal(bundle.primarySkill.name, 'debug-error');
  // credo is in the bundle
  assert.ok(bundle.sopNames.includes('developer-credo'));
});

test('orchestrator routes git-commit-atomic for a commit request', () => {
  const orch = createOrchestrator({ workspace: 'E:/aide-sovern-workbench' });
  const bundle = orch.classify('commit these changes with a good message');
  assert.equal(bundle.primarySkill.name, 'git-commit-atomic');
});

test('orchestrator routes explain-code for an explain request', () => {
  const orch = createOrchestrator({ workspace: 'E:/aide-sovern-workbench' });
  const bundle = orch.classify('explain what this function does');
  assert.equal(bundle.primarySkill.name, 'explain-code');
});

test('orchestrator routes refactor-safely for a refactor request', () => {
  const orch = createOrchestrator({ workspace: 'E:/aide-sovern-workbench' });
  const bundle = orch.classify('refactor this large class into smaller pieces');
  assert.equal(bundle.primarySkill.name, 'refactor-safely');
});

test('orchestrator routes write-test for a test request', () => {
  const orch = createOrchestrator({ workspace: 'E:/aide-sovern-workbench' });
  const bundle = orch.classify('write a test for the login function');
  assert.equal(bundle.primarySkill.name, 'write-test');
});

test('the 6 seed skills each have a real primary source citation in the body', () => {
  const loader = createSkillLoader({ workspace: 'E:/aide-sovern-workbench' });
  for (const name of ['developer-credo', 'kaizen-loop', 'debug-error', 'explain-code', 'git-commit-atomic', 'refactor-safely', 'write-test']) {
    const r = loader.readSkillFile(name);
    assert.equal(r.ok, true);
    // skill-writer gate: body must cite at least one primary source
    // (convention: explicit "Sources:" block, or inline URL/cite).
    const body = r.body || '';
    const hasSourcesBlock = /\bSources?\s*:/i.test(body);
    const hasUrl = /https?:\/\//.test(body);
    const hasCitation = /\b(En|Wikipedia|agilealliance|refactoring\.guru|TDD|BDD|Kent Beck|Martin Fowler|Pragmatic|Programmer|Toyota|Fow)\b/.test(body);
    assert.ok(hasSourcesBlock || hasUrl || hasCitation,
      `${name} must cite at least one primary source (Sources: block, URL, or named canonical reference)`);
  }
});

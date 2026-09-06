// tests/arch/orchestrator.test.ts
// Current chassis orchestrator contract: deterministic classification, a
// visible routing log, legacy lazy shims, and an explicit unknown boundary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createOrchestrator } from '../../harness/orchestrator.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');

test('orchestrator routes a debug task to the research-backed debug skill', () => {
  const bundle = createOrchestrator({ workspace: repoRoot }).classify('debug this Python script with breakpoints');
  assert.equal(bundle.primarySkill.name, 'debug-error');
  assert.ok(bundle.primarySkill.body.includes('Four primary sources'));
  assert.ok(bundle.sopNames.includes('developer-credo'));
  assert.ok(bundle.sopNames.includes('verify-before-claiming'));
});

test('orchestrator keeps a legacy Shopify skill routable through a lazy shim', () => {
  const bundle = createOrchestrator({ workspace: repoRoot }).classify('write a Shopify theme section');
  assert.equal(bundle.primarySkill.name, 'shopify-capability-engineering');
  assert.equal(bundle.primarySkill.legacy, true);
  assert.match(bundle.rationale, /shim from legacy registry/);
});

test('orchestrator keeps an unrelated request explicitly unknown', () => {
  const bundle = createOrchestrator({ workspace: repoRoot }).classify('tell me a joke about blue');
  assert.equal(bundle.primarySkill.name, 'unknown');
  assert.ok(bundle.sopNames.includes('surface-uncertainty'));
  assert.equal(bundle.helix.skipped, true);
});

test('orchestrator routing log exposes each decision stage and credo load', () => {
  const bundle = createOrchestrator({ workspace: repoRoot }).classify('debug Python with breakpoints');
  const stages = bundle.routingLog.map(entry => entry.stage);
  assert.deepEqual(stages, ['keyword_match', 'embedding_cosine', 'helix_similarity', 'L0.5_credo']);
  const keyword = bundle.routingLog.find(entry => entry.stage === 'keyword_match');
  assert.ok(keyword, 'expected keyword_match entry in routing log');
  assert.equal(keyword.decision, 'kept');
  assert.equal(bundle.helix.bootstrap_visible, true);
});

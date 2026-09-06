import test from 'node:test';
import assert from 'node:assert/strict';
import { createOrchestratorCardService } from '../../node/src/services/orchestrator-card.mjs';
import { routesForOrchestrator } from '../../node/src/routes/orchestrator.ts';
import { OrchestratorBundleCardResponse } from '../../common/contracts/orchestrator.ts';

const workspace = process.cwd();

test('bundle card returns inspectable routing, Helix, and scaffold evidence', async () => {
  const service = createOrchestratorCardService({ workspace });
  const route = routesForOrchestrator(service)[0];
  const card = await route.handler({ query: { task: 'debug the auth error', mode: 'act' }, body: {} });
  const parsed = OrchestratorBundleCardResponse.safeParse(card);
  assert.equal(parsed.success, true, parsed.success ? '' : parsed.error.message);
  assert.equal(card.mode, 'act');
  assert.equal(card.primary_skill.name, 'debug-error');
  assert.ok(card.routing_log.length >= 3);
  assert.equal(card.helix.enabled, true);
  assert.ok(card.scaffold.system.includes('AIDE scaffold v2'));
  assert.ok(card.scaffold.system.includes('SOP 1') || card.scaffold.system.includes('L0 truncated'), 'safety SOP layer must survive budget enforcement');
  assert.ok(card.scaffold.bytes <= card.prompt_budget.bytes);
});

test('bundle card preserves legacy skill provenance', async () => {
  const service = createOrchestratorCardService({ workspace });
  const card = service.card('aide arch extensions activation events and VSIX host', 'plan');
  const parsed = OrchestratorBundleCardResponse.safeParse(card);
  assert.equal(parsed.success, true, parsed.success ? '' : parsed.error.message);
  assert.equal(card.mode, 'plan');
  assert.equal(card.primary_skill.name, 'aide-arch-extensions');
  assert.equal(card.primary_skill.legacy, true);
  assert.equal(card.primary_skill.version, '0.0.0-legacy');
});

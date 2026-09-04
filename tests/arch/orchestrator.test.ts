// tests/arch/orchestrator.test.ts
// Per skill: aid-skills-auto-load-by-context
// Proves the orchestrator loads the right skill into the system prompt for the right task.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const orchestratorUrl = pathToFileURL(path.join(repoRoot, 'harness', 'orchestrator.mjs')).href;

const { createHarness } = await import(orchestratorUrl);

function makeProvider(name: string, response: string): { complete: () => Promise<string>; role: string } {
  return { complete: async () => response, role: name };
}

test('orchestrator auto-loads DAP skill when task mentions debug/breakpoint', async () => {
  let capturedSkills = '';
  const reasonProvider = {
    complete: async (args: { skills?: string }): Promise<string> => { capturedSkills = args.skills || ''; return 'PLAN: inspect DAP lifecycle'; }
  };
  const buildProvider = makeProvider('build', '--- a\n+++ b\n@@ -0,0 +1 @@\n+x\n');
  const verifyProvider = makeProvider('verify', 'APPROVE');
  const harness = createHarness({
    providers: { reason: reasonProvider, build: buildProvider, verify: verifyProvider }
  });
  await harness.run('debug this Python script with breakpoints');
  assert.ok(capturedSkills.length > 0, 'expected skills to be loaded into reason provider');
  assert.ok(capturedSkills.includes('aide-arch-protocols'), 'expected DAP skill in loaded skills');
  assert.ok(capturedSkills.includes('DAP') || capturedSkills.includes('Debug Adapter'), 'expected DAP doctrine in skill content');
});

test('orchestrator auto-loads Shopify skill when task mentions Shopify', async () => {
  let capturedSkills = '';
  const reasonProvider = {
    complete: async (args: { skills?: string }): Promise<string> => { capturedSkills = args.skills || ''; return 'PLAN: use Liquid'; }
  };
  const buildProvider = makeProvider('build', '--- a\n+++ b\n@@ -0,0 +1 @@\n+x\n');
  const verifyProvider = makeProvider('verify', 'APPROVE');
  const harness = createHarness({
    providers: { reason: reasonProvider, build: buildProvider, verify: verifyProvider }
  });
  await harness.run('write a Shopify theme section');
  assert.ok(capturedSkills.includes('shopify-capability-engineering'), 'expected Shopify skill');
});

test('orchestrator loads no skills for unrelated tasks', async () => {
  let capturedSkills = '';
  const reasonProvider = {
    complete: async (): Promise<string> => { capturedSkills = ''; return 'PLAN: explain blue'; }
  };
  const buildProvider = makeProvider('build', '--- a\n+++ b\n@@ -0,0 +1 @@\n+x\n');
  const verifyProvider = makeProvider('verify', 'APPROVE');
  const harness = createHarness({
    providers: { reason: reasonProvider, build: buildProvider, verify: verifyProvider }
  });
  await harness.run('explain the color blue');
  assert.equal(capturedSkills, '', 'expected no skills loaded for unrelated task');
});

test('orchestrator trace includes skill-detect stage with detected skill names', async () => {
  const reasonProvider = {
    complete: async (): Promise<string> => 'PLAN: debug Python'
  };
  const buildProvider = makeProvider('build', '--- a\n+++ b\n@@ -0,0 +1 @@\n+x\n');
  const verifyProvider = makeProvider('verify', 'APPROVE');
  const harness = createHarness({
    providers: { reason: reasonProvider, build: buildProvider, verify: verifyProvider }
  });
  const result = await harness.run('debug Python with breakpoints');
  const trace = result.trace as Array<{ stage: string; skills?: string[] }>;
  const detectStage = trace.find((entry: { stage: string; skills?: string[] }) => entry.stage === 'skill-detect');
  assert.ok(detectStage, 'expected skill-detect stage in trace');
  const skills = detectStage?.skills;
  assert.ok(Array.isArray(skills), 'expected skills array in trace');
  assert.ok(skills.includes('aide-arch-protocols'), 'expected DAP skill in trace.skills');
});

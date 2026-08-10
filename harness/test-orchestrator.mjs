import assert from 'node:assert/strict';
import { createHarness } from './orchestrator.mjs';

const calls = [];
const provider = role => ({ complete: async input => {
  calls.push({ role, input });
  if (role === 'reason') return 'constraints: preserve API; tests: npm test';
  if (role === 'build') return 'diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n+safe change';
  return 'APPROVE: diff is bounded; run tests before apply';
}});

const harness = createHarness({ providers: { reason: provider('reason'), build: provider('build'), verify: provider('verify') } });
const result = await harness.run('Improve the provider router', { files: ['router.ts'] });
assert.equal(result.status, 'awaiting-human-approval');
assert.equal(result.trace.length, 5);
assert.equal(calls.length, 3);
assert.equal(result.veritas.status, 'abstain-needs-evidence');
assert.ok(calls.every(call => call.input.mandatory_credo.includes('Protect the user')));
await assert.rejects(result.apply(), /permission-gated daemon/);
const verifiedHarness = createHarness({
  providers: { reason: provider('reason'), build: provider('build'), verify: provider('verify') },
  policy: { require_human_approval: false },
  verificationRunner: async () => ({ passed: true, checks: { compile: true, tests: true, 'git-diff': true } })
});
const verified = await verifiedHarness.run('Run the verified flow', { taskClass: 'code-change' });
assert.equal(verified.status, 'ready-for-apply');
assert.equal(verified.veritas.status, 'verified');
assert.equal(verified.execution.checks['patch-parse'], true);
const malformedProviders = { reason: provider('reason'), build: { complete: async () => '```diff\nnot a patch\n```' }, verify: provider('verify'), repair: { complete: async () => 'diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n+new\n' } };
const repaired = await createHarness({ providers: malformedProviders, policy: { require_human_approval: false }, verificationRunner: async () => ({ passed: true, checks: { compile: true } }) }).run('Repair the patch');
assert.equal(repaired.veritas.status, 'verified');
assert.ok(repaired.trace.some(item => item.stage === 'repair' && item.status === 'accepted'));
console.log('universal harness test passed');

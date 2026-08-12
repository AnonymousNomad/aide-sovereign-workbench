import assert from 'node:assert/strict';
import { WorkflowManager } from './workflow.mjs';
const calls = [];
const workflow = new WorkflowManager({
  modelManager: { chat: async (id, messages) => { calls.push(messages[0].content); return calls.length === 1 ? { choices: [{ message: { content: '1. inspect file\n2. patch file\n3. run tests' } }] } : { choices: [{ message: { content: 'diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-old\n+new\n' } }] }; } },
  workspaceManager: { tree: async () => [{ name: 'README.md', kind: 'file' }], applyPatch: async () => ({ applied: true }) },
  artifactStore: { add: async value => ({ id: 'audit-test', ...value }) }
});
const result = await workflow.planAndPropose({ modelId: 'local', task: 'update README' });
assert.equal(result.status, 'awaiting-approval'); assert.equal(calls.length, 2); assert.equal((await workflow.apply({ patch: result.patch, approved: true })).applied, true); console.log('workflow test passed');

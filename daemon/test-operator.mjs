import assert from 'node:assert/strict';
import { Operator } from './operator.mjs';

const calls = [];
const operator = new Operator({
  modelManager: { chat: async (id, messages, options) => { calls.push({ id, messages, options }); return { choices: [{ message: { content: 'plan' } }] }; } },
  workspaceManager: { tree: async () => [{ name: 'app.js', kind: 'file' }] },
  gitStatus: async () => ''
});
const result = await operator.run({ mode: 'agent', modelId: 'local', prompt: 'inspect the app' });
assert.equal(result.approval_required, true);
assert.deepEqual(result.tools_executed, []);
assert.equal(calls[0].options.max_tokens, 180);
console.log('operator test passed');

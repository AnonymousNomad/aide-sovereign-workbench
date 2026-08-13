import assert from 'node:assert/strict';
import { Operator } from './operator.mjs';

const calls = [];
const operator = new Operator({
  modelManager: { chat: async (id, messages, options) => { calls.push({ id, messages, options }); return { choices: [{ message: { content: '```json\n{"commands":[{"program":"node","args":["--version"]}]}\n```' } }] }; } },
  workspaceManager: { tree: async () => [{ name: 'app.js', kind: 'file' }] },
  gitStatus: async () => ''
});
const result = await operator.run({ mode: 'agent', modelId: 'local', prompt: 'inspect the app' });
assert.equal(result.approval_required, true);
assert.deepEqual(result.tools_executed, []);
assert.deepEqual(result.proposed_tools, [{ program: 'node', args: ['--version'] }]);
assert.equal(calls[0].options.max_tokens, 180);
const auto = await operator.run({ mode: 'auto', modelId: 'local', prompt: 'fix the failing test', history: [{ role: 'user', content: 'inspect the test' }, { role: 'assistant', content: 'I found a failing test.' }] });
assert.equal(auto.mode, 'agent');
assert.equal(auto.requested_mode, 'auto');
assert.equal(auto.context_turns, 2);
assert.equal(calls[1].messages[1].content, 'inspect the test');
console.log('operator test passed');

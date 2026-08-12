import assert from 'node:assert/strict';
import { HandoffManager } from './handoff.mjs';
const calls = [];
const handoff = new HandoffManager({
  modelManager: { chat: async (id) => { calls.push(id); return { choices: [{ message: { content: `analysis from ${id}` } }] }; }, start: async () => {}, waitReady: async () => {} },
  workspaceManager: { tree: async () => [{ name: 'README.md', kind: 'file' }] },
  artifactStore: { add: async value => ({ id: 'handoff-audit', ...value }) }
});
const proposed = await handoff.propose({ fromModelId: 'analyst', toModelId: 'builder', task: 'inspect project' });
assert.equal(proposed.status, 'awaiting-approval'); assert.equal((await handoff.continue({ handoff: proposed.handoff, approved: true })).status, 'completed'); assert.deepEqual(calls, ['analyst', 'builder']); console.log('handoff test passed');

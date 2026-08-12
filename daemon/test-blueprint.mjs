import assert from 'node:assert/strict';
import { buildBlueprint } from '../blueprint/graph.mjs';

const graph = buildBlueprint({
  entries: [{ name: 'app.js', kind: 'file' }, { name: 'data', kind: 'directory' }],
  models: [{ id: 'local-coder', name: 'Local Coder', format: 'GGUF', lane: 'build', status: 'ready' }],
  training: { active: { id: 'tinyliquid' } }
});
assert.equal(graph.nodes.find(node => node.id === 'training').status, 'active');
assert.ok(graph.nodes.some(node => node.id === 'file:app.js'));
assert.ok(graph.edges.some(edge => edge.source === 'training' && edge.target === 'model:local-coder'));
assert.equal(new Set(graph.nodes.map(node => node.id)).size, graph.nodes.length);
console.log('blueprint graph test passed');

import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ModelManager } from './model-manager.mjs';

const root = await mkdtemp(path.join(tmpdir(), 'aide-manager-'));
await mkdir(path.join(root, 'models'));
await writeFile(path.join(root, 'models', 'safe.gguf'), 'test');
await writeFile(path.join(root, 'models', 'manifest.json'), JSON.stringify({ models: [{ id: 'safe', name: 'Safe', status: 'pending', endpoint: 'http://127.0.0.1:9001/v1', artifact_uri: 'local://safe.gguf', context_tokens: 2048 }] }));
const manager = new ModelManager({ manifestPath: path.join(root, 'models', 'manifest.json'), modelDir: path.join(root, 'models'), binaryPath: '/missing' });
await manager.load();
assert.equal(manager.status()[0].status, 'pending');
await assert.rejects(manager.start('unknown'), /not allowlisted/);
await assert.rejects(manager.start('safe'), /llama-server binary/);
console.log('model manager test passed');

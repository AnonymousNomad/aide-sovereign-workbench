import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LspManager } from './lsp-manager.mjs';

const root = await mkdtemp(path.join(tmpdir(), 'aide-lsp-'));
await mkdir(path.join(root, 'node_modules', '.bin'), { recursive: true });
await writeFile(path.join(root, 'languages.json'), JSON.stringify({ servers: [{ id: 'ts', name: 'TS', command: 'node_modules/.bin/tsserver', args: [], languages: ['typescript'], status: 'available' }] }));
await writeFile(path.join(root, 'node_modules', '.bin', 'tsserver'), '');
const manager = new LspManager({ manifestPath: path.join(root, 'languages.json'), workspace: root, spawnProcess: () => ({ once() {}, kill() {} }) });
await manager.load();
assert.equal(manager.status()[0].status, 'available');
assert.deepEqual(await manager.start('ts'), { id: 'ts', status: 'starting', languages: ['typescript'] });
await assert.rejects(manager.start('unknown'), /not allowlisted/);
console.log('lsp manager test passed');

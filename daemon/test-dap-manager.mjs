import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DapManager } from './dap-manager.mjs';

const root = await mkdtemp(path.join(tmpdir(), 'aide-dap-'));
await mkdir(path.join(root, '.venv', 'bin'), { recursive: true });
await writeFile(path.join(root, 'debuggers.json'), JSON.stringify({ adapters: [{ id: 'python', name: 'Python', command: '.venv/bin/python', args: [], languages: ['python'], status: 'available' }] }));
await writeFile(path.join(root, '.venv', 'bin', 'python'), '');
const manager = new DapManager({ manifestPath: path.join(root, 'debuggers.json'), workspace: root, spawnProcess: () => ({ once() {}, kill() {} }) });
await manager.load();
assert.equal(manager.status()[0].status, 'available');
assert.deepEqual(await manager.start('python'), { id: 'python', status: 'starting', languages: ['python'], protocol: 'DAP' });
await assert.rejects(manager.start('unknown'), /not allowlisted/);
console.log('dap manager test passed');

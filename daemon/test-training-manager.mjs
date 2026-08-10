import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TrainingManager } from './training-manager.mjs';

const root = await mkdtemp(path.join(tmpdir(), 'aide-training-'));
await writeFile(path.join(root, 'manifest.json'), JSON.stringify({ jobs: [{ id: 'safe', name: 'Safe', command: 'node', args: ['--version'] }] }));
const manager = new TrainingManager({ manifestPath: path.join(root, 'manifest.json'), workspace: root, spawnProcess: () => ({ stdout: { on() {} }, stderr: { on() {} }, once() {}, kill() {} }) });
await manager.load();
await assert.rejects(Promise.resolve().then(() => manager.start('safe', false)), /approval/);
assert.deepEqual(manager.start('safe', true), { id: 'safe', status: 'running' });
await assert.rejects(Promise.resolve().then(() => manager.start('safe', true)), /already running/);
assert.deepEqual(manager.stop(), { status: 'stopped' });
console.log('training manager test passed');

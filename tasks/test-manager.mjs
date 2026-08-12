import assert from 'node:assert/strict';
import path from 'node:path';
import { TaskManager } from './manager.mjs';
const manager = new TaskManager({ manifestPath: path.join(process.cwd(), 'tasks/manifest.json'), workspace: process.cwd() });
await manager.load();
assert.ok(manager.list().some(task => task.id === 'test'));
assert.throws(() => manager.run('not-allowlisted'), /not allowlisted/);
console.log('task manager test passed');

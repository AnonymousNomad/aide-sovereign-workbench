import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ReplayStore } from './replay-store.mjs';
const root = await mkdtemp(path.join(tmpdir(), 'aide-replay-')); const file = path.join(root, 'replays', 'store.json');
await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, JSON.stringify({ schema_version: '1.0', privacy: 'metadata-only', replays: [] }));
const store = new ReplayStore(file); await store.load(); const record = await store.add({ task_class: 'code-change', model: 'qwen-coder-1.5b-q4', status: 'verified', checks: { tests: true } });
assert.equal(store.list().replays.length, 1); assert.equal(record.checks.tests, true); console.log('replay store test passed');

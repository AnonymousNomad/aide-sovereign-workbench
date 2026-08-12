import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SessionStore } from './store.mjs';
const root = await mkdtemp(path.join(tmpdir(), 'aide-session-')); const store = new SessionStore(path.join(root, 'session.json'));
await store.load(); const saved = await store.save({ active_file: 'README.md', open_files: ['README.md'], panel: 'terminal' });
assert.equal(saved.active_file, 'README.md'); assert.equal((await store.load()).open_files[0], 'README.md'); console.log('session store test passed');

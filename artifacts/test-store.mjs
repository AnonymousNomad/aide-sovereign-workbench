import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ArtifactStore } from './store.mjs';
const root = await mkdtemp(path.join(tmpdir(), 'aide-artifacts-')); const store = new ArtifactStore(root);
const artifact = await store.add({ kind: 'operator-session', status: 'awaiting-approval', claims: [], tools: [] });
assert.equal((await store.list())[0].id, artifact.id); console.log('artifact store test passed');

import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatasetStore } from './dataset-store.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-datasets-'));
try {
  const store = new DatasetStore({ rootDir: root });
  await store.load();
  assert.equal(store.list().length, 0);

  const created = await store.create('My Fine-tune Set');
  assert.match(created.id, /^my-fine-tune-set-[0-9a-f]{6}$/);
  assert.equal(created.count, 0);
  await assert.rejects(() => store.create('bad name!'), /name must be/);
  await assert.rejects(() => store.create('My Fine-tune Set'), /already exists/);

  const first = await store.append(created.id, [
    { text: 'The Eiffel Tower is located in Paris, France.' },
    { input: 'capital of France?', output: 'Paris' },
    { text: 'short' },
    { text: '' },
    { input: 'missing output' },
    42
  ]);
  assert.equal(first.accepted, 2);
  assert.equal(first.rejected_invalid, 4);
  assert.equal(first.rejected_dupes, 0);
  assert.ok(first.errors.length >= 2 && first.errors.length <= 10);

  const dupe = await store.append(created.id, [{ text: 'The Eiffel Tower is located in Paris, France.' }]);
  assert.equal(dupe.accepted, 0);
  assert.equal(dupe.rejected_dupes, 1, 'exact duplicate must be rejected by hash');
  assert.equal((await store.append('no-such-id', [])).error, 'NOT_FOUND');
  assert.equal((await store.append(created.id, 'not-an-array')).error, 'BAD_REQUEST');

  const page = await store.read(created.id, { offset: 1, limit: 1 });
  assert.equal(page.total, 2);
  assert.equal(page.samples.length, 1);
  assert.equal(page.samples[0].input, 'capital of France?');

  const reloaded = new DatasetStore({ rootDir: root });
  const metas = await reloaded.load();
  assert.equal(metas.length, 1);
  assert.equal(metas[0].count, 2);
  const afterReload = await reloaded.append(metas[0].id, [{ text: 'The Eiffel Tower is located in Paris, France.' }]);
  assert.equal(afterReload.rejected_dupes, 1, 'dedup hashes must survive reload');

  const long = 'x'.repeat(40000);
  assert.ok((await store.append(metas[0].id, [{ text: long }])).rejected_invalid === 1, 'oversize sample rejected');

  assert.equal(await store.delete(metas[0].id), true);
  assert.equal(store.get(metas[0].id), null);
  assert.equal(await store.delete(metas[0].id), false);
  await assert.rejects(() => store.read(metas[0].id), { code: 'ENOENT' })?.catch?.(() => {});
  const goneRead = await new DatasetStore({ rootDir: root }).load();
  assert.equal(goneRead.length, 0);
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
console.log('dataset-store tests passed');

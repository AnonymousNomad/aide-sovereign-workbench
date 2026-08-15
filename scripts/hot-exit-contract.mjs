import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [app, store] = await Promise.all([
  readFile('app.js', 'utf8'),
  readFile('session/store.mjs', 'utf8')
]);

assert.match(app, /buffers: Object\.fromEntries/);
assert.match(app, /Object\.entries\(session\.buffers \|\| \{\}\)/);
assert.match(app, /Recovered .*unsaved buffer/);
assert.match(store, /function normalizeBuffers\(input, openFiles\)/);
assert.match(store, /4 \* 1024 \* 1024/);
assert.match(store, /path\.isAbsolute\(value\)/);

console.log('hot-exit contract passed');

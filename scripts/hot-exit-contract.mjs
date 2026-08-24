import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [app, store] = await Promise.all([
  readFile('app.js', 'utf8'),
  readFile('session/store.mjs', 'utf8')
]);

// Cockpit hot-exit v0: unload persists dirty buffer via /api/session
// (open_files allowlist + buffers map); boot offers REOPEN/DISCARD.
assert.match(app, /window\.addEventListener\('beforeunload'/);
assert.match(app, /api\/session/, { });
assert.match(app, /open_files: \[editorState\.path\]/);
assert.match(app, /tryHotExitRecovery/);
assert.match(app, /REOPEN/);
assert.match(app, /DISCARD/);
assert.match(store, /function normalizeBuffers\(input, openFiles\)/);
assert.match(store, /4 \* 1024 \* 1024/);
assert.match(store, /path\.isAbsolute\(value\)/);

console.log('hot-exit contract passed');

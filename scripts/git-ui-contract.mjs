import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Cockpit git contract: SHIP panel (review -> stage -> commit w/ attribution)
// + git sheet (branches/history/consented push). Replaces old-shell ids.
const [index, app, server] = await Promise.all([
  readFile('index.html', 'utf8'),
  readFile('app.js', 'utf8'),
  readFile('daemon/server.mjs', 'utf8')
]);

assert.match(index, /id="ship-files"/);
assert.match(index, /id="ship-message"/);
assert.match(index, /id="git-sheet"/);
assert.match(index, /id="git-branch-select"/);
assert.match(app, /async function openShipPanel\(\)/);
assert.match(app, /api\/git\/stage/);
assert.match(app, /api\/git\/commit/);
assert.match(app, /Assisted-by: AIDE harness/);
assert.match(app, /api\/git\/push/, 'push must exist as explicit consented action');
assert.match(server, /function parseGitStatus\(raw\)/);
assert.match(server, /status', '--porcelain=v1', '-z', '--branch'/);
assert.match(server, /request\.url\.startsWith\('\/api\/git\/diff'\)/);
assert.match(server, /api\/git\/push/);

console.log('git UI contract passed');

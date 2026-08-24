import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Cockpit tasks contract (v0): the terminal drawer is the run surface;
// task-service routes exist daemon-side and stay wired for E2 pty upgrade.
const [index, app, server] = await Promise.all([
  readFile('index.html', 'utf8'),
  readFile('app.js', 'utf8'),
  readFile('daemon/server.mjs', 'utf8')
]);

assert.match(index, /id="terminal-drawer"/);
assert.match(index, /id="term-form"/);
assert.match(app, /api\/terminal\/run/);
assert.match(app, /approved: true/);
assert.match(server, /'\/api\/tasks\/status'/);
assert.match(server, /'\/api\/tasks\/stop'/);

console.log('task UI contract passed');

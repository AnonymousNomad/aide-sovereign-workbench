import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [index, app] = await Promise.all([readFile('index.html', 'utf8'), readFile('app.js', 'utf8')]);

assert.match(index, /id="task-list"/);
assert.match(index, /id="task-stop"/);
assert.match(index, /id="task-status"/);
assert.match(app, /async function runTask\(button\)/);
assert.match(app, /api\/tasks\/status/);
assert.match(app, /async function stopTask\(\)/);
assert.match(app, /api\/tasks\/stop/);
assert.match(app, /task status polling timed out/);

console.log('task UI contract passed');

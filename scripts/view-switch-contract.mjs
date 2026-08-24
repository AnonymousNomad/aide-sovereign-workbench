import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [index, app, styles, manager] = await Promise.all([
  readFile('index.html', 'utf8'),
  readFile('app.js', 'utf8'),
  readFile('styles.css', 'utf8'),
  readFile('daemon/model-manager.mjs', 'utf8')
]);

// Cockpit wiring contract (post-redesign): states-not-modes, single describe
// surface, terminal drawer, ship panel.
assert.match(index, /<link rel="stylesheet" href="styles\.css">/);
assert.match(index, /<script src="app\.js"><\/script>/);
assert.match(index, /class="state-cold"/);
assert.match(index, /id="cold-card"/);
assert.match(index, /id="editor-slot" hidden/);
assert.match(index, /id="terminal-drawer"/);
assert.match(index, /id="ship-panel"[^>]*hidden/);
assert.match(app, /document\.body\.classList\.replace\('state-cold', 'state-ready'\)/);
assert.match(app, /const setStrip = /);
assert.match(app, /async function startEngine\(\)/);
assert.match(app, /\$\('#stop-engine'\)\.addEventListener/);
assert.match(styles, /\.state-cold|body\.state-ready/);
assert.match(styles, /VIEW SWITCH CONTRACT|cockpit/i);

// Engine runtime contract (legacy manager retains python fallback path).
assert.doesNotMatch(manager, /spawnSync/);
assert.match(manager, /this\.pythonProbe/);
assert.match(manager, /runtimeProbePending/);
assert.match(manager, /await this\.probePython\(\)/);
assert.match(await readFile('daemon/server.mjs', 'utf8'), /Local model setup required[\s\S]*503/);

console.log('view-switch/runtime contract passed');

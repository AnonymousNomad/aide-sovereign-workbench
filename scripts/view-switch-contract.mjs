import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [index, app, styles, manager] = await Promise.all([
  readFile('index.html', 'utf8'),
  readFile('app.js', 'utf8'),
  readFile('styles.css', 'utf8'),
  readFile('daemon/model-manager.mjs', 'utf8')
]);

assert.match(index, /<link rel="stylesheet" href="styles\.css">/);
assert.match(index, /<script src="app\.js"><\/script>/);
assert.match(app, /function setWorkbenchView\(view\)/);
assert.match(app, /setWorkbenchView\('editor'\)/);
assert.match(app, /setWorkbenchView\('run'\)/);
assert.match(app, /setWorkbenchView\('learn'\)/);
assert.match(app, /setWorkbenchView\('map'\)/);
assert.match(app, /console\.log\(`VIEW: \$\{String\(view\)\.toUpperCase\(\)\}`\)/);
assert.match(styles, /#learn-view:not\(\[hidden\]\)[\s\S]*position:absolute[\s\S]*overflow-y:auto/);
assert.match(styles, /VIEW SWITCH CONTRACT/);
assert.match(styles, /body\.simple-mode\.workbench-view-run \.editor-column>\.bottom-panel[\s\S]*height:min\(42vh,320px\)!important/);
assert.match(styles, /html,[\s\S]*body\.simple-mode\s*\{[\s\S]*overflow:hidden!important/);
assert.doesNotMatch(manager, /spawnSync/);
assert.match(manager, /this\.pythonProbe/);
assert.match(manager, /runtimeProbePending/);
assert.match(manager, /await this\.probePython\(\)/);
assert.match(await readFile('daemon/server.mjs', 'utf8'), /Local model setup required[\s\S]*503/);

console.log('view-switch/runtime contract passed');

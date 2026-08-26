// Sandbox Loop Battery — gates per aide-sandbox-loop SOP.
// Fixture project in temp dir; REAL verification commands (node --test).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createSandbox } = require('../harness/sandbox.mjs');

let ws;
let sb;
const results = [];
function record(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name} — ${detail}`);
}

const LIB_GOOD = `function add(a, b) {\n  return a + b;\n}\nmodule.exports = { add };\n`;
const TEST_FILE = `const { add } = require('./lib.js');\nconst assert = require('node:assert');\nassert.equal(add(2, 3), 5);\nassert.equal(add(-1, 1), 0);\nconsole.log('TESTS-PASSED');\n`;
const RUN_TESTS = (scratchRoot) => [{ cmd: process.execPath, args: [path.join(scratchRoot, 'test.js')] }];

async function seedScratch(sessionId, libContent) {
  const { scratchRoot } = await sb.materializeScratch(sessionId, ['lib.js']);
  await fs.writeFile(path.join(scratchRoot, 'lib.js'), libContent, 'utf8');
  await fs.copyFile(path.join(ws, 'test.js'), path.join(scratchRoot, 'test.js'));
  return scratchRoot;
}

before(async () => {
  ws = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-sbx-'));
  sb = createSandbox({ workspace: ws });
  await fs.writeFile(path.join(ws, 'test.js'), TEST_FILE, 'utf8');
});

test('PASS path: valid fix verifies in scratch; real file untouched', async () => {
  await fs.writeFile(path.join(ws, 'lib.js'), `function add(a, b) {\n  return a - b;\n}\nmodule.exports = { add };\n`, 'utf8');
  const scratchRoot = await seedScratch('sess-pass', `function add(a, b) {\n  return a + b;\n}\nmodule.exports = { add };\n`);
  const v = await sb.runVerification(RUN_TESTS(scratchRoot), scratchRoot);
  assert.equal(v.passed, true);
  const realLib = await fs.readFile(path.join(ws, 'lib.js'), 'utf8');
  assert.match(realLib, /a - b/, 'real file untouched until approval');
  record('pass-path', true, 'scratch green, real untouched');
});

test('FAIL->retry: error tail carries context; converges attempt 2', async () => {
  const scratchRoot = await seedScratch('sess-retry', `function add(a, b) {\n  return a * b;\n}\nmodule.exports = { add };\n`);
  const proposals = [
    { path: 'lib.js', search: 'return a * b;', replace: 'return a / b;' },
    { path: 'lib.js', search: 'return a / b;', replace: 'return a + b;' }
  ];
  let attempts = 0;
  let lastTail = '';
  let verified = false;
  for (const p of proposals) {
    attempts += 1;
    await sb.applyToScratch(scratchRoot, [p]);
    const v = await sb.runVerification(RUN_TESTS(scratchRoot), scratchRoot);
    if (v.passed) { verified = true; break; }
    lastTail = v.report_tail;
    assert.ok(lastTail.length > 0, 'failure carries error tail');
  }
  assert.equal(verified, true);
  assert.equal(attempts, 2);
  assert.match(lastTail, /AssertionError|assert/);
  record('fail-retry-context', true, `converged attempt ${attempts}`);
});

test('cap: persistent failure stays honest after bounded attempts', async () => {
  const scratchRoot = await seedScratch('sess-cap', `function add(a, b) {\n  return a - b;\n}\nmodule.exports = { add };\n`);
  let verified = false;
  let attempts = 0;
  while (attempts < 3 && !verified) {
    attempts += 1;
    await sb.applyToScratch(scratchRoot, [{ path: 'lib.js', search: 'return a - b;', replace: `return a - b - ${attempts};` }]);
    verified = (await sb.runVerification(RUN_TESTS(scratchRoot), scratchRoot)).passed;
  }
  assert.equal(verified, false);
  assert.equal(attempts, 3);
  record('bounded-cap', true, 'honest fail after 3');
});

test('path escape rejected before any copy', async () => {
  await assert.rejects(() => sb.materializeScratch('sess-esc', ['../../outside.txt']), /escapes workspace/);
  record('path-escape', true);
});

test('atomic apply: success path + honest partial report on failure', async () => {
  const ok = await sb.applyToReal([
    { path: 'ok1.js', replace: 'x' },
    { path: 'sub/ok2.js', replace: 'y' }
  ]);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.appliedFiles.sort(), ['ok1.js', 'sub/ok2.js'].sort());
  // failure case: destination inside a FILE path (rename target invalid)
  await fs.writeFile(path.join(ws, 'not-a-dir'), 'blocker', 'utf8');
  const partial = await sb.applyToReal([
    { path: 'before-fail.js', replace: 'a' },
    { path: 'not-a-dir/inner.js', replace: 'b' }
  ]);
  assert.equal(partial.ok, false);
  assert.deepEqual(partial.appliedFiles, ['before-fail.js']);
  assert.match(partial.reason || '', /not-a-dir|EEXIST|ENOTDIR|EPERM/i);
  record('atomic-apply', true, 'partial report accurate');
});

test('timeout bound: hung command fails within ceiling', async () => {
  const { scratchRoot } = await sb.materializeScratch('sess-timeout', []);
  const sw = Date.now();
  const v = await sb.runVerification(
    [{ cmd: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'] }],
    scratchRoot,
    { timeoutMs: 1500 }
  );
  const elapsed = Date.now() - sw;
  assert.equal(v.passed, false);
  assert.ok(elapsed < 8000, `${elapsed}ms`);
  record('timeout-bound', true, `${elapsed}ms under 8s guard`);
});

after(async () => {
  await sb.cleanupAll();
  await fs.rm(ws, { recursive: true, force: true }).catch(() => {});
  const passed = results.filter(r => r.passed).length;
  console.log(`\nSANDBOX BATTERY: ${passed}/${results.length} passed`);
  if (passed !== results.length) process.exitCode = 1;
});

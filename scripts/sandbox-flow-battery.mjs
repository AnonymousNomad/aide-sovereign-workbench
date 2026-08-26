// Sandbox Flow Battery — composed loop w/ scripted chat (deterministic).
// Fixture matches the verified dbg3 scenario exactly (calc.js + test.js).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createSandboxFlow } = require('../daemon/sandbox-flow.mjs');

let ws;
const results = [];
function record(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name} — ${detail}`);
}

const CALC_BAD = `function calc(a,b){\n  return a - b;\n}\nmodule.exports = { calc };\n`;
const TEST_FILE = `const {calc}=require('./calc.js');\nconst assert=require('node:assert');\nassert.equal(calc(2,3),5);\nconsole.log('OK');\n`;
const RUN = (root) => [{ cmd: process.execPath, args: [path.join(root, 'test.js')] }];
const SR = (from, to) => `<!-- SR: calc.js -->\n<<<<<<< SEARCH\n${from}\n=======\n${to}\n>>>>>>> REPLACE`;

before(async () => {
  ws = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-sbxflow2-'));
  await fs.writeFile(path.join(ws, 'package.json'), '{}', 'utf8');
  await fs.writeFile(path.join(ws, 'calc.js'), CALC_BAD, 'utf8');
  await fs.writeFile(path.join(ws, 'test.js'), TEST_FILE, 'utf8');
});

test('verified path: wrong proposal then correct -> verified=true, attempts=2', async () => {
  let i = 0;
  const replies = [SR('return a - b;', 'return a * b;'), SR('return a * b;', 'return a + b;')];
  const flow = createSandboxFlow({ workspace: ws, chatFn: async () => replies[Math.min(i++, 1)] });
  const r = await flow.run({ task: 'fix calc to addition', targets: ['calc.js', 'test.js'], commands: [{ cmd: process.execPath, args: ['test.js'] }] });
  console.log('ATTEMPTS:', JSON.stringify(r.attempts));
  assert.equal(r.ok, true);
  assert.equal(r.verified, true);
  assert.equal(r.attempts.length, 2);
  record('verified-retry-loop', true, `${r.attempts.length} attempts, wall ${r.wall_ms}ms`);
});

test('approve applies atomically to real file', async () => {
  let i = 0;
  const replies = [SR('return a - b;', 'return a + b;')];
  const flow = createSandboxFlow({ workspace: ws, chatFn: async () => replies[Math.min(i++, 0)] });
  const r = await flow.run({ task: 'fix calc', targets: ['calc.js', 'test.js'], commands: [{ cmd: process.execPath, args: ['test.js'] }] });
  assert.equal(r.verified, true);
  const applied = await flow.approveApply(r.patch);
  assert.equal(applied.ok, true);
  const real = await fs.readFile(path.join(ws, 'calc.js'), 'utf8');
  assert.match(real, /return a \+ b;/);
  // restore fixture for later tests
  await fs.writeFile(path.join(ws, 'calc.js'), CALC_BAD, 'utf8');
  record('approve-applies', true, 'real file updated post-approval');
});

test('cap honesty: three bad proposals -> verified=false w/ full attempt log', async () => {
  let i = 0;
  const bad = SR('return a - b;', 'return a - b - 9;');
  const flow = createSandboxFlow({ workspace: ws, chatFn: async () => { i += 1; return bad; } });
  const r = await flow.run({ task: 'make it worse', targets: ['calc.js', 'test.js'], commands: [{ cmd: process.execPath, args: ['test.js'] }] });
  assert.equal(r.verified, false);
  assert.equal(r.attempts.length, 3);
  assert.ok(r.attempts.every(a => !a.passed));
  record('cap-honesty', true, '3 attempts logged, honest verdict');
});

test('no-proposal attempt journaled and retried', async () => {
  let i = 0;
  const replies = ['I cannot help with that.', SR('return a - b;', 'return a + b;')];
  const flow = createSandboxFlow({ workspace: ws, chatFn: async () => replies[Math.min(i++, 1)] });
  const r = await flow.run({ task: 'fix calc', targets: ['calc.js', 'test.js'], commands: [{ cmd: process.execPath, args: ['test.js'] }] });
  assert.equal(r.verified, true);
  assert.match(String(r.attempts[0].reason || ''), /no parseable/);
  record('no-proposal-retry', true, 'attempt 1 journaled, attempt 2 verified');
});

after(async () => {
  await fs.rm(ws, { recursive: true, force: true }).catch(() => {});
  const passed = results.filter(r => r.passed).length;
  console.log(`\nSANDBOX-FLOW BATTERY: ${passed}/${results.length} passed`);
  if (passed !== results.length) process.exitCode = 1;
});

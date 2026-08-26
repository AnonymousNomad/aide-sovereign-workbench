import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const require = createRequire(import.meta.url);
const sbMod = require('../harness/sandbox.mjs');
const { createSandbox } = sbMod;
const { applySearchReplace } = require('../node/src/services/agent-tools.mjs');

const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'dbg2-'));
await fs.writeFile(path.join(ws, 'test.js'), "const {calc}=require('./calc.js');\nconst assert=require('node:assert');\nassert.equal(calc(2,3),5);\nconsole.log('OK');\n");
await fs.writeFile(path.join(ws, 'calc.js'), "function calc(a,b){\n  return a - b;\n}\nmodule.exports = { calc };\n");
const sb = createSandbox({ workspace: ws });
const { scratchRoot } = await sb.materializeScratch('dbg', ['calc.js','test.js']);
console.log('scratch files:', await fs.readdir(scratchRoot));
let content = await fs.readFile(path.join(scratchRoot,'calc.js'),'utf8');
console.log('initial:', JSON.stringify(content));
for (const [s,r] of [['return a - b;','return a * b;'],['return a * b;','return a + b;']]) {
  const out = applySearchReplace(content, [{ search: s, replace: r }]);
  console.log('applied:', out.applied, 'content now:', JSON.stringify(out.content));
  content = out.content;
}
await fs.writeFile(path.join(scratchRoot,'calc.js'), content);
const v = await sb.runVerification([{ cmd: process.execPath, args: ['test.js'] }], scratchRoot);
console.log('final verify passed:', v.passed, v.report_tail.slice(0,120));
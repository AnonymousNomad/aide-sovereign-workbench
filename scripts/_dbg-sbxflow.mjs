// Debug: dump full attempt detail from sandbox-flow
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const require = createRequire(import.meta.url);
const { createSandboxFlow } = require('../daemon/sandbox-flow.mjs');

const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'dbg-sbx-'));
await fs.writeFile(path.join(ws, 'package.json'), '{}');
await fs.writeFile(path.join(ws, 'calc.js'), 'function calc(a,b){\n  return a - b;\n}\n');
await fs.writeFile(path.join(ws, 'test.js'), "const {calc}=require('./calc.js');\nconst assert=require('node:assert');\nassert.equal(calc(2,3),5);\nconsole.log('OK');\n");

let i = 0;
const replies = [
  '<!-- SR: calc.js -->\n<<<<<<< SEARCH\nreturn a - b;\n=======\nreturn a * b;\n>>>>>>> REPLACE',
  '<!-- SR: calc.js -->\n<<<<<<< SEARCH\nreturn a * b;\n=======\nreturn a + b;\n>>>>>>> REPLACE'
];
const flow = createSandboxFlow({ workspace: ws, chatFn: async () => replies[Math.min(i++, 1)] });
const r = await flow.run({ task: 'fix', targets: ['calc.js', 'test.js'], commands: [{ cmd: process.execPath, args: ['test.js'] }] });
console.log(JSON.stringify(r, null, 1).slice(0, 1600));

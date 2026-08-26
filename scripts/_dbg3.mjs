import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const require = createRequire(import.meta.url);
const sbMod = require('../daemon/sandbox-flow.mjs');
const flow = sbMod.createSandboxFlow({ workspace: await fs.mkdtemp(path.join(os.tmpdir(),'dbg3-')), chatFn: async()=>'' });
// reach into parser via a crafted run? parser not exported; test through replies but DUMP raw chat input->output by wrapping chatFn
const seen = [];
let i = 0;
const replies = [
  '<!-- SR: calc.js -->\n<<<<<<< SEARCH\nreturn a - b;\n=======\nreturn a * b;\n>>>>>>> REPLACE',
  '<!-- SR: calc.js -->\n<<<<<<< SEARCH\nreturn a * b;\n=======\nreturn a + b;\n>>>>>>> REPLACE'
];
const ws2 = await fs.mkdtemp(path.join(os.tmpdir(),'dbg3ws-'));
await fs.writeFile(path.join(ws2,'test.js'), "const {calc}=require('./calc.js');\nconst assert=require('node:assert');\nassert.equal(calc(2,3),5);\nconsole.log('OK');\n");
await fs.writeFile(path.join(ws2,'calc.js'), "function calc(a,b){\n  return a - b;\n}\nmodule.exports = { calc };\n");
await fs.writeFile(path.join(ws2,'package.json'), '{}');
const flow2 = sbMod.createSandboxFlow({ workspace: ws2, chatFn: async ({system,user}) => {
  const r = replies[Math.min(i++,1)];
  seen.push({ user_head: user.slice(0,80), reply: r });
  return r;
}});
const out = await flow2.run({ task:'fix', targets:['calc.js','test.js'], commands:[{cmd:process.execPath,args:['test.js']}] });
console.log('verified:', out.verified);
for (const a of out.attempts) console.log('attempt', a.attempt, 'passed:', a.passed, 'tail:', JSON.stringify((a.report_tail||'').slice(0,100)));
console.dir(seen, { depth: null }).toString?.();
seen.forEach(s => console.log('CHAT REPLY RAW:', JSON.stringify(s.reply)));
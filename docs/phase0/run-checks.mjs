// Bounded audit gates. This is not the full architecture or acceptance battery.
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const gates = [
  ['node-types', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.node.json', '--noEmit']],
  ['browser-types', ['node_modules/typescript/bin/tsc', '-p', 'browser/tsconfig.browser.json', '--noEmit']],
  ['focused-tests', ['--import', './scripts/http-close-shim.mjs', '--test', '--test-concurrency=1', '--test-timeout=30000', 'tests/unit/test-facade.mjs', 'tests/unit/test-agent-loop-tier.mjs', 'tests/arch/api-client.test.ts', 'tests/arch/events-contract.test.ts']]
];
const results = [];
for (const [name, args] of gates) {
  const started = Date.now();
  const result = await new Promise(resolve => {
    const child = spawn(process.execPath, args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', data => { output += data.toString(); });
    child.stderr.on('data', data => { output += data.toString(); });
    const timer = setTimeout(() => child.kill(), 120000);
    child.once('error', error => { output += `\nSPAWN ERROR: ${error.message}`; });
    child.once('close', (code, signal) => { clearTimeout(timer); resolve({ name, command: ['node', ...args], pid: child.pid, code, signal, elapsedMs: Date.now() - started, output }); });
  });
  results.push(result);
  console.log(JSON.stringify({ ...result, output: result.output.slice(-2500) }));
  if (result.code !== 0) { process.exitCode = 1; break; }
}
await fs.writeFile(path.join(here, 'evidence/gates.json'), JSON.stringify({ date: new Date().toISOString(), results }, null, 2) + '\n');

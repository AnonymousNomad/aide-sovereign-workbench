// Local, serial gate recorder. Does not launch models or change operator processes.
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
const [label, ...args] = process.argv.slice(2);
if (!/^[a-z0-9-]+$/.test(label ?? '') || !args.length) throw new Error('label and node arguments required');
const started = new Date().toISOString();
const child = spawn(process.execPath, args, { cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = '', stderr = '';
child.stdout.on('data', data => { stdout += data; process.stdout.write(data); });
child.stderr.on('data', data => { stderr += data; process.stderr.write(data); });
const result = await new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
await fs.writeFile(new URL(`./phase1a-${label}.json`, import.meta.url), JSON.stringify({ started, ended: new Date().toISOString(), args, pid: child.pid, freeMemoryBytes: os.freemem(), ...result, stdout, stderr }, null, 2));
process.exitCode = result.code ?? 1;

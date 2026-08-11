import { promises as fs } from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const checks = [];
const pass = (name, detail) => checks.push({ name, detail, ok: true });
const warn = (name, detail) => checks.push({ name, detail, ok: true, warning: true });
const fail = (name, detail) => checks.push({ name, detail, ok: false });

if (Number(process.versions.node.split('.')[0]) >= 20) pass('Node.js', process.version); else fail('Node.js', 'Node 20 or newer is required');
for (const file of ['models/manifest.json', 'community/node-manifest.json', 'training/manifest.json']) {
  try { JSON.parse(await fs.readFile(path.join(root, file), 'utf8')); pass(file, 'valid JSON'); } catch { fail(file, 'missing or invalid JSON'); }
}
try { await fs.access(path.join(root, 'daemon/server.mjs')); pass('Local daemon', 'available'); } catch { fail('Local daemon', 'daemon/server.mjs missing'); }
try { await fs.access(process.env.AIDE_LLAMA_SERVER || '/root/runtime/llama-b10333/llama-server'); pass('llama.cpp', 'runtime binary found'); } catch { warn('llama.cpp', 'install a local llama-server runtime before starting models'); }
const manifest = JSON.parse(await fs.readFile(path.join(root, 'models/manifest.json'), 'utf8'));
const ready = manifest.models.filter(model => model.status === 'ready').length;
if (ready) pass('Model packs', `${ready} ready pack(s)`); else warn('Model packs', 'import at least one model pack');
console.log('\nAIDE Doctor\n');
for (const check of checks) console.log(`${check.ok ? (check.warning ? 'WARN' : 'OK') : 'FAIL'}  ${check.name}: ${check.detail}`);
const failures = checks.filter(check => !check.ok).length;
console.log(`\n${failures ? 'Preflight failed' : 'Preflight passed'}: ${checks.length - failures}/${checks.length} checks\n`);
if (failures) process.exitCode = 1;

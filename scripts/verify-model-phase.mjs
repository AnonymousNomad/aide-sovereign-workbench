import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4880;
const BASE = `http://127.0.0.1:${PORT}`;
const results = [];
const record = (name, ok, detail = '') => results.push({ name, ok, detail });

function portOpen(port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(500);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
  });
}

async function waitFor(predicate, label, timeoutMs = 120000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if (await predicate()) return;
    } catch {
      // retry
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`timed out waiting for ${label}`);
}

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-live-'));
const daemon = spawn(process.execPath, ['node/src/server.ts'], {
  cwd: REPO_ROOT,
  env: { ...process.env, AIDE_WORKSPACE: workspace, AIDE_ARCH_PORT: String(PORT) },
  stdio: 'ignore',
  windowsHide: true
});

try {
  await waitFor(() => portOpen(PORT), 'daemon listen', 30000);

  const status = await (await fetch(`${BASE}/api/models/status`)).json();
  record('models status envelope', status.ok === true && Array.isArray(status.data.models), `${status.data.models.length} models listed`);
  let runtimeOk = status.data.runtime === true;
  await waitFor(async () => {
    if (runtimeOk) return true;
    const s = await (await fetch(`${BASE}/api/models/status`)).json();
    runtimeOk = s.data.runtime === true;
    return runtimeOk;
  }, 'python runtime probe', 30000);
  record('runtime probe', runtimeOk, 'python+llama_cpp available');

  const start = await (await fetch(`${BASE}/api/models/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'qwen-coder-0.5b-q4' })
  })).json();
  record('model start', start.ok === true, start.data?.status);

  let runningStatus = null;
  await waitFor(async () => {
    const s = await (await fetch(`${BASE}/api/models/status`)).json();
    const entry = s.data.models.find(m => m.id === 'qwen-coder-0.5b-q4');
    if (entry?.status === 'running') { runningStatus = entry; return true; }
    return false;
  }, 'model running', 120000);
  record('model status running', runningStatus !== null, runningStatus?.endpoint);

  let chat = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    chat = await (await fetch(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelId: 'qwen-coder-0.5b-q4', messages: [{ role: 'user', content: 'Reply with the single word: OK.' }] })
    })).json();
    if (chat.ok === true) break;
    await new Promise(resolve => setTimeout(resolve, 10_000));
  }
  record('non-stream chat round-trip (warms the model)', chat.ok === true && typeof chat.data?.text === 'string' && chat.data.text.length > 0, chat.ok ? chat.data?.text?.trim().slice(0, 60) : chat.error?.message);

  const streamResponse = await fetch(`${BASE}/api/chat/stream?modelId=qwen-coder-0.5b-q4&prompt=${encodeURIComponent('Say the word HELLO and nothing else.')}`);
  const streamText = await streamResponse.text();
  const deltas = [...streamText.matchAll(/data: (\{.*\})/g)].map(m => JSON.parse(m[1]));
  const full = deltas.filter(d => d.delta).map(d => d.delta).join('');
  const done = deltas.some(d => d.done === true);
  record('streaming chat round-trip', done && full.trim().length > 0, `streamed ${full.trim().length} chars, done=${done}`);
  record('stream content', /hello/i.test(full), full.trim().slice(0, 80));

  const stop = await (await fetch(`${BASE}/api/models/stop`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'qwen-coder-0.5b-q4' })
  })).json();
  record('model stop', stop.ok === true, stop.data?.status);
} finally {
  daemon.kill('SIGINT');
  await new Promise(resolve => setTimeout(resolve, 3000));
  await fs.rm(workspace, { recursive: true, force: true });
}

const { execFile } = await import('node:child_process');
const { promisify } = await import('node:util');
const run = promisify(execFile);
let orphans = [];
try {
  const { stdout } = await run('wmic', ['process', 'where', "name='python.exe'", 'get', 'CommandLine', '/format:list'], { timeout: 20000, windowsHide: true });
  orphans = String(stdout).split('\n').filter(line => line.includes('llama_cpp.server')).map(line => line.trim());
} catch {
  orphans = [];
}
record('no orphaned llama servers after daemon shutdown', orphans.length === 0, orphans.length === 0 ? 'PID scan clean' : orphans.join(' | '));

const failed = results.filter(r => !r.ok);
console.log(`live verification ${failed.length === 0 ? 'PASSED' : 'FAILED'} (${results.length - failed.length}/${results.length})`);
for (const r of results) console.log(`  ${r.ok ? 'OK' : 'FAIL'}  ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
if (failed.length > 0) process.exitCode = 1;
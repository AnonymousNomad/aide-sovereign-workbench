import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeNode = path.join(root, 'desktop', 'resources', 'runtime', process.platform === 'win32' ? 'node.exe' : 'node');
const launcher = path.join(root, 'desktop', 'resources', 'stack-launcher.mjs');
if (!existsSync(launcher) || !existsSync(runtimeNode)) {
  console.log(`desktop staged smoke SKIPPED: staged resources absent (${path.dirname(launcher)}); run "node desktop/prepare.mjs" and stage stack-launcher.mjs first - the packaged-stack gate is enforced where the staged tree exists`);
  process.exit(0);
}
const archPort = 4798;
const legacyPort = 4799;
const facadePort = 4797;
const workspace = await mkdtemp(path.join(os.tmpdir(), 'aide-staged-smoke-'));

const child = spawn(runtimeNode, [launcher], {
  cwd: root,
  env: {
    ...process.env,
    AIDE_WORKSPACE: workspace,
    AIDE_MODEL_DIR: path.join(workspace, 'models'),
    AIDE_ARCH_PORT: String(archPort),
    AIDE_LEGACY_PORT: String(legacyPort),
    AIDE_DAEMON_PORT: String(legacyPort),
    AIDE_FACADE_PORT: String(facadePort),
    AIDE_LLAMA_SERVER: path.join(root, 'desktop', 'resources', 'runtime', 'llama-server.exe'),
    AIDE_CLOSED_LOOP: 'false'
  },
  shell: false,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe']
});
child.stdout.on('data', chunk => process.stdout.write(`[staged] ${chunk}`));
child.stderr.on('data', chunk => process.stderr.write(`[staged] ${chunk}`));

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const alive = () => child.exitCode === null;
const tryFetch = async url => {
  try {
    const res = await fetch(url);
    return { status: res.status, body: await res.text() };
  } catch {
    return { status: 0, body: '' };
  }
};

async function waitFor(url, attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    if (!alive()) throw new Error(`staged stack died early`);
    const r = await tryFetch(url);
    if (r.status >= 200 && r.status < 500) return r;
    await sleep(500);
  }
  return tryFetch(url);
}

const checks = [];

try {
  const health = await waitFor(`http://127.0.0.1:${facadePort}/api/health`);
  checks.push({ name: 'staged facade /api/health', pass: health.status === 200, detail: `${health.status} ${health.body.slice(0, 120)}` });

  const models = await waitFor(`http://127.0.0.1:${facadePort}/api/models`);
  let modelsOk = false;
  try {
    const parsed = JSON.parse(models.body);
    modelsOk = Array.isArray(parsed) || (parsed && Array.isArray(parsed.models)) || (parsed && Array.isArray(parsed.data));
  } catch {}
  checks.push({ name: 'staged facade /api/models', pass: models.status === 200 && modelsOk, detail: `${models.status} ${models.body.slice(0, 120)}` });

  const tsHealth = await waitFor(`http://127.0.0.1:${facadePort}/api/health/ts`);
  checks.push({ name: 'staged facade /api/health/ts sentinel', pass: tsHealth.status === 200 && tsHealth.body.includes('ok'), detail: `${tsHealth.status} ${tsHealth.body.slice(0, 80)}` });

  const legacyProbe = await waitFor(`http://127.0.0.1:${legacyPort}/api/status`);
  checks.push({ name: 'staged legacy :4799 reachable', pass: legacyProbe.status !== 0, detail: `${legacyProbe.status}` });

  const archProbe = await waitFor(`http://127.0.0.1:${archPort}/api/health`);
  checks.push({ name: 'staged arch :4798 reachable', pass: archProbe.status !== 0, detail: `${archProbe.status}` });

  const unknown = await tryFetch(`http://127.0.0.1:${facadePort}/api/does-not-exist`);
  checks.push({ name: 'facade unknown /api route', pass: unknown.status >= 400, detail: `${unknown.status}` });
} catch (error) {
  checks.push({ name: 'staged stack boot', pass: false, detail: error.message });
}

for (const check of checks) {
  console.log(`${check.pass ? 'PASS' : 'FAIL'}  ${check.name}: ${check.detail}`);
}

const passed = checks.length > 0 && checks.every(check => check.pass);
console.log(passed ? 'staged stack smoke PASSED' : 'staged stack smoke FAILED');

await rm(workspace, { recursive: true, force: true }).catch(() => {});
if (alive()) {
  child.kill('SIGTERM');
  await new Promise(resolve => {
    const timer = setTimeout(() => {
      if (process.platform === 'win32') spawn(process.env.ComSpec || 'cmd.exe', ['/c', `taskkill /PID ${child.pid} /T /F >nul 2>&1`]).on('exit', resolve);
      else { child.kill('SIGKILL'); resolve(); }
    }, 5000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}
process.exitCode = passed ? 0 : 1;
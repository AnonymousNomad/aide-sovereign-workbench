import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile, spawn } from 'node:child_process';

const root = path.dirname(fileURLToPath(import.meta.url));
// Staged resource root is explicit, as with the backend entrypoints below.
const { superviseAuthority } = await import(pathToFileURL(path.join(root, 'common/security/authority-channel.mjs')).href);
const nativeBootstrap = process.argv.includes('--native-bootstrap');
const pairingOrigin = process.argv.find(arg => arg.startsWith('--pair-origin='))?.slice('--pair-origin='.length);
if (!nativeBootstrap || !['http://127.0.0.1:5173', 'http://tauri.localhost', 'https://tauri.localhost', 'tauri://localhost'].includes(pairingOrigin)) {
  throw new Error('native parent bootstrap required');
}
const workspace = path.resolve(process.env.AIDE_WORKSPACE || path.join(root, 'workspace'));
const modelDir = path.resolve(process.env.AIDE_MODEL_DIR || path.join(workspace, 'models'));
const logsDir = path.join(workspace, '.aide', 'logs');
const nodeName = process.platform === 'win32' ? 'node.exe' : 'node';
const node = path.join(root, 'runtime', nodeName);
const ports = {
  arch: process.env.AIDE_ARCH_PORT || '4778',
  legacy: process.env.AIDE_LEGACY_PORT || process.env.AIDE_DAEMON_PORT || '4779',
  facade: process.env.AIDE_FACADE_PORT || '4777'
};
const env = {
  ...process.env,
  AIDE_WORKSPACE: workspace,
  AIDE_MODEL_DIR: modelDir,
  AIDE_ARCH_PORT: ports.arch,
  AIDE_LEGACY_PORT: ports.legacy,
  AIDE_DAEMON_PORT: ports.legacy,
  AIDE_FACADE_PORT: ports.facade,
  AIDE_LLAMA_SERVER: process.env.AIDE_LLAMA_SERVER || path.join(root, 'runtime', process.platform === 'win32' ? 'llama-server.exe' : 'llama-server')
};

const children = new Set();
let stopping = false;
let supervisor = null;

async function append(file, chunk) {
  await fs.appendFile(file, chunk).catch(() => {});
}

function spawnChild(label, args) {
  const child = spawn(node, args, {
    cwd: root,
    env,
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
  const outFile = path.join(logsDir, `desktop-${label}-out.log`);
  const errFile = path.join(logsDir, `desktop-${label}-err.log`);
  children.add(child);
  child.stdout?.on('data', chunk => void append(outFile, chunk));
  child.stderr?.on('data', chunk => void append(errFile, chunk));
  child.once('error', error => {
    void append(errFile, `[stack-launcher] ${label} spawn error: ${error.message}\n`);
    if (!stopping) void stop(1);
  });
  child.once('exit', (code, signal) => {
    children.delete(child);
    void append(errFile, `[stack-launcher] ${label} exit code=${code ?? 'null'} signal=${signal || 'none'}\n`);
    if (!stopping) void stop(code === 0 ? 1 : (code ?? 1));
  });
  return child;
}

function killTree(child) {
  if (child.exitCode !== null) return Promise.resolve();
  if (process.platform !== 'win32') {
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
    return Promise.resolve();
  }
  return new Promise(resolve => {
    execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => resolve());
  });
}

async function stop(code) {
  if (stopping) return;
  stopping = true;
  supervisor?.close();
  await Promise.all([...children].map(killTree));
  process.exitCode = code;
}

await fs.mkdir(logsDir, { recursive: true });
await fs.mkdir(modelDir, { recursive: true });
supervisor = superviseAuthority(spawnChild('arch', ['--experimental-strip-types', path.join(root, 'node', 'src', 'server.ts')]));
supervisor.attach('legacy', spawnChild('legacy', [path.join(root, 'daemon', 'server.mjs')]));
supervisor.attach('facade', spawnChild('facade', [path.join(root, 'scripts', 'facade.mjs')]));
await supervisor.ready();
const pairing = await supervisor.pairing(pairingOrigin);
// Dedicated native-parent pipe, never the children logs or a workspace file.
process.stdout.write(`COVERT_PAIRING_V1 ${pairing.proof}\n`);

process.once('SIGINT', () => void stop(0));
process.once('SIGTERM', () => void stop(0));

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

async function canExecute(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function resolveBrowser() {
  if (process.env.AIDE_BROWSER && await canExecute(process.env.AIDE_BROWSER)) return process.env.AIDE_BROWSER;
  const names = process.platform === 'win32'
    ? [
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
      ]
    : ['microsoft-edge', 'google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser'];
  const pathDirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const name of names) {
    if (path.isAbsolute(name) && await canExecute(name)) return name;
    for (const directory of pathDirs) {
      const candidate = path.join(directory, name);
      if (await canExecute(candidate)) return candidate;
    }
  }
  return null;
}

const browser = await resolveBrowser();
if (!browser) {
  console.log('editor smoke e2e skipped: no supported headless browser found');
  process.exit(0);
}

const root = process.cwd();
const workspace = await mkdtemp(path.join(tmpdir(), 'aide-smoke-'));
await writeFile(path.join(workspace, 'README.md'), '# Smoke workspace\n');
const daemon = spawn(process.execPath, ['daemon/server.mjs'], { cwd: root, env: { ...process.env, AIDE_WORKSPACE: workspace, AIDE_DAEMON_PORT: '4777' }, stdio: ['ignore', 'ignore', 'pipe'] });
let daemonExit = null;
let daemonError = null;
let daemonStderr = '';
daemon.stderr.on('data', chunk => { daemonStderr = `${daemonStderr}${chunk}`.slice(-4000); });
daemon.once('error', error => { daemonError = `daemon spawn error: ${error.message}`; });
daemon.once('exit', (code, signal) => { daemonExit = `daemon exited before readiness (code=${code}, signal=${signal || 'none'})`; });

const runner = await readFile(path.join(root, 'scripts', 'editor-smoke.html'), 'utf8');
const index = await readFile(path.join(root, 'index.html'), 'utf8');
if (!index.includes('</body>')) throw new Error('index.html has no closing body tag');
const smokePage = index.replace('</body>', `<div id="editor-smoke-output" hidden></div><script>${runner}</script></body>`);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const staticServer = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1:4173');
    let file = decodeURIComponent(url.pathname);
    if (file === '/' || file === '/index.html') { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end(smokePage); return; }
    const full = path.join(root, file);
    if (!full.startsWith(root) || full.endsWith('model-bundles')) { response.writeHead(403).end(); return; }
    const content = await readFile(full);
    response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    response.end(content);
  } catch { response.writeHead(404).end('not found'); }
});
await new Promise(resolve => staticServer.listen(4173, '127.0.0.1', resolve));

try {
  let ok = false;
  for (let i = 0; i < 150; i += 1) {
    try { const health = await fetch('http://127.0.0.1:4777/health'); if (health.ok) { ok = true; break; } } catch {}
    if (daemonError || daemonExit) break;
    await delay(100);
  }
  assert.equal(ok, true, daemonError || daemonExit || `daemon did not come up within 15 seconds${daemonStderr ? `: ${daemonStderr.trim()}` : ''}`);

  const dumpDom = () => new Promise((resolve, reject) => {
    const profile = path.join(tmpdir(), `aide-edge-${Date.now()}`);
    const browserArgs = ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-dev-shm-usage'];
    if (process.platform === 'linux') browserArgs.push('--no-sandbox');
    browserArgs.push(`--user-data-dir=${profile}`, '--virtual-time-budget=15000', '--dump-dom', 'http://127.0.0.1:4173/index.html');
    const child = spawn(browser, browserArgs, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let output = '';
    let errorOutput = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr?.on('data', chunk => { errorOutput += chunk; });
    child.on('close', code => resolve({ output, code, errorOutput }));
    child.on('error', reject);
    setTimeout(() => { child.kill(); }, 30000);
  });
  let browserResult = await dumpDom();
  let dom = browserResult.output;
  if (!/<title[\s>]/i.test(dom) && !dom.includes('editor-smoke-output')) {
    await delay(500);
    browserResult = await dumpDom();
    dom = browserResult.output;
  }
  assert.ok(dom, `Edge returned no DOM (exit=${browserResult.code})${browserResult.errorOutput ? `: ${browserResult.errorOutput.trim()}` : ''}`);

  const titleElement = dom.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const text = titleElement?.[1] || '';
  const results = dom.match(/<div id="editor-smoke-output"[^>]*>([\s\S]*?)<\/div>/)?.[1] || dom.match(/EDITOR-SMOKE-[A-Z-]+/)?.[0] || '';
  const title = (text.match(/EDITOR-SMOKE-[A-Z-]+/) || ['EDITOR-SMOKE-UNKNOWN'])[0];
  console.log(`smoke title: ${title}`);
  console.log(results.split('\n').map(line => `  ${line}`).join('\n'));
  assert.match(dom, /PASS boot/);
  assert.match(dom, /PASS undo: reverted byte-exact/);
  assert.match(dom, /PASS replace: text replaced/);
  assert.match(dom, /PASS save: written to workspace/);
  assert.doesNotMatch(results, /FAIL /);
  assert.match(title, /^EDITOR-SMOKE-(ALL-PASS|DONE|EXCEPTION)?$/);
  console.log('editor smoke e2e passed');
} finally {
  daemon.kill('SIGTERM');
  await new Promise(resolve => staticServer.close(resolve));
  await rm(workspace, { recursive: true, force: true });
}

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const root = process.cwd();
const workspace = await mkdtemp(path.join(tmpdir(), 'aide-smoke-'));
await writeFile(path.join(workspace, 'README.md'), '# Smoke workspace\n');
const daemon = spawn(process.execPath, ['daemon/server.mjs'], { cwd: root, env: { ...process.env, AIDE_WORKSPACE: workspace, AIDE_DAEMON_PORT: '4777' }, stdio: 'ignore' });

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
  for (let i = 0; i < 40; i += 1) { try { const health = await fetch('http://127.0.0.1:4777/health'); if (health.ok) { ok = true; break; } } catch {} await delay(50); }
  assert.equal(ok, true, 'daemon did not come up');

  const dom = await new Promise((resolve, reject) => {
    const profile = path.join(tmpdir(), `aide-edge-${Date.now()}`);
    const child = spawn(edge, ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${profile}`, '--virtual-time-budget=15000', '--dump-dom', 'http://127.0.0.1:4173/index.html'], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.on('close', code => resolve(output));
    child.on('error', reject);
    setTimeout(() => { child.kill(); }, 30000);
  });

  const text = dom.split('<title>')[1].split('</title>')[0]?.split('>').pop() || dom.match(/<title>[^<]*<\/title>/)?.[0] || '';
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
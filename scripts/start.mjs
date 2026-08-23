import http from 'node:http';
import net from 'node:net';
import { createReadStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.AIDE_UI_PORT || 4173);
const children = [];

function spawnChild(label, args, extraEnv = {}) {
  const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, AIDE_WORKSPACE: process.env.AIDE_WORKSPACE || root, ...extraEnv }, stdio: 'inherit' });
  child.label = label;
  children.push(child);
  child.on('exit', code => {
    if (code && code !== 143) console.error(`${label} exited with ${code}`);
  });
  return child;
}

spawnChild('arch', ['node/src/server.ts'], { AIDE_ARCH_PORT: process.env.AIDE_ARCH_PORT || '4778' });
spawnChild('legacy', ['daemon/server.mjs'], { AIDE_DAEMON_PORT: process.env.AIDE_LEGACY_PORT || '4779', AIDE_LEGACY_PORT: process.env.AIDE_LEGACY_PORT || '4779' });
spawnChild('facade', ['scripts/facade.mjs'], { AIDE_FACADE_PORT: process.env.AIDE_FACADE_PORT || '4777' });

function watchBackend(label, port) {
  let announced = false;
  const timer = setInterval(() => {
    const socket = net.connect(port, '127.0.0.1');
    socket.on('connect', () => {
      socket.destroy();
      if (!announced) {
        announced = true;
        console.log(`${label} backend ready on 127.0.0.1:${port}`);
        clearInterval(timer);
      }
    });
    socket.on('error', () => socket.destroy());
  }, 500);
  timer.unref();
}
watchBackend('ts', Number(process.env.AIDE_ARCH_PORT || 4778));
watchBackend('legacy', Number(process.env.AIDE_LEGACY_PORT || process.env.AIDE_DAEMON_PORT || 4779));

const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.md': 'text/plain', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer(async (request, response) => {
  const requested = decodeURIComponent((request.url || '/').split('?')[0]);
  const relative = requested === '/' ? 'index.html' : requested.replace(/^\//, '');
  const file = path.resolve(root, relative);
  if (!file.startsWith(`${root}${path.sep}`)) return response.writeHead(403).end();
  try { await fs.access(file); response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }); createReadStream(file).pipe(response); }
  catch { response.writeHead(404).end('Not found'); }
});
server.listen(port, '127.0.0.1', () => console.log(`AIDE running at http://127.0.0.1:${port}`));

const stop = () => {
  server.close();
  for (const child of children) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

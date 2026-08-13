import http from 'node:http';
import { createReadStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.AIDE_UI_PORT || 4173);
const daemon = spawn(process.execPath, ['daemon/server.mjs'], { cwd: root, env: { ...process.env, AIDE_WORKSPACE: process.env.AIDE_WORKSPACE || root }, stdio: 'inherit' });
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
const stop = () => { server.close(); daemon.kill('SIGTERM'); };
process.on('SIGINT', stop); process.on('SIGTERM', stop); daemon.on('exit', code => { if (code && code !== 143) console.error(`daemon exited with ${code}`); });

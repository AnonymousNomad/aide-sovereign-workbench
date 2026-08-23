import http from 'node:http';
import net from 'node:net';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function stripHopByHop(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!HOP_BY_HOP.has(key.toLowerCase())) out[key] = value;
  }
  delete out.host;
  return out;
}

function canonicalPath(rawUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(rawUrl, 'http://localhost').pathname);
  } catch {
    return null;
  }
  if (pathname.includes('\0') || pathname.split('/').includes('..')) return null;
  return pathname;
}

function pickTarget(routeMap, pathname) {
  if (routeMap.exact && Object.prototype.hasOwnProperty.call(routeMap.exact, pathname)) return routeMap.exact[pathname];
  let best = null;
  let bestLength = -1;
  for (const [prefix, target] of Object.entries(routeMap.prefixes || {})) {
    const scoped = prefix.endsWith('/') ? prefix : prefix + '/';
    if ((pathname === prefix || pathname.startsWith(scoped)) && prefix.length > bestLength) {
      best = target;
      bestLength = prefix.length;
    }
  }
  return best || 'legacy';
}

function rewriteErrorEnvelope(rawBody) {
  try {
    const parsed = JSON.parse(rawBody);
    if (parsed && typeof parsed.error === 'object' && parsed.error !== null && typeof parsed.error.message === 'string') {
      return JSON.stringify({ error: parsed.error.message, code: parsed.error.code });
    }
  } catch {}
  return null;
}

// The TS backend wraps every contract response as {ok:true,data} (common/errors.ts).
// Legacy consumers read bare payloads - the facade strips the wrapper on ts-targeted
// JSON responses so both frontends see one shape (anti-corruption layer).
const UNWRAP_CAP_BYTES = 4 * 1024 * 1024;

function unwrapSuccessEnvelope(rawBody) {
  try {
    const parsed = JSON.parse(rawBody);
    if (
      parsed && typeof parsed === 'object' && !Array.isArray(parsed) &&
      parsed.ok === true && Object.keys(parsed).length === 2 && 'data' in parsed
    ) {
      return JSON.stringify(parsed.data);
    }
  } catch {}
  return null;
}

export async function loadRouteMap(file) {
  const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
  const map = { prefixes: parsed.prefixes || {}, exact: parsed.exact || {}, upgrades: parsed.upgrades || {} };
  for (const group of ['prefixes', 'exact', 'upgrades']) {
    for (const key of Object.keys(map[group])) {
      if (!key.startsWith('/') || key.includes('..') || key.includes('\0') || !['ts', 'legacy'].includes(map[group][key])) {
        throw new Error(`invalid route map entry: ${group}[${JSON.stringify(key)}]`);
      }
    }
  }
  return map;
}

export function createFacade({ port = 0, host = '127.0.0.1', routeMap, targets }) {
  if (!targets?.ts || !targets?.legacy) throw new Error('targets.ts and targets.legacy are required');
  const closed = { value: false };
  const relays = new Set();
  const upstreamAgent = new http.Agent({ keepAlive: true, maxSockets: 16 });
  const server = http.createServer(async (request, response) => {
    const started = Date.now();
    const pathname = canonicalPath(request.url || '/');
    const finish = (status, target) => {
      console.log(`${request.method} ${pathname ?? '(bad)'} -> ${target} ${status} ${Date.now() - started}ms`);
    };
    if (pathname === null) {
      finish(400, '-');
      response.writeHead(400, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: { code: 'bad_request', message: 'malformed path' } }));
      return;
    }
    if (request.method === 'GET' && (pathname === '/api/health/ts' || pathname === '/api/health/legacy')) {
      const name = pathname === '/api/health/ts' ? 'ts' : 'legacy';
      finish(200, name);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: true, target: name }));
      return;
    }
    const targetName = pickTarget(routeMap, pathname);
    const target = targets[targetName];
    const headers = stripHopByHop(request.headers);
    headers.host = `${target.host}:${target.port}`;
    const proxied = http.request({ host: target.host, port: target.port, method: request.method, path: request.url, headers, agent: upstreamAgent }, proxiedResponse => {
      finish(proxiedResponse.statusCode, targetName);
      const outHeaders = stripHopByHop(proxiedResponse.headers);
      const status = proxiedResponse.statusCode || 502;
      const contentType = String(outHeaders['content-type'] || '');
      if (contentType.includes('application/json') && targetName === 'ts') {
        const chunks = [];
        let total = 0;
        let overflow = false;
        proxiedResponse.on('data', chunk => {
          total += chunk.length;
          if (total <= UNWRAP_CAP_BYTES) chunks.push(chunk);
          else overflow = true;
        });
        proxiedResponse.on('end', () => {
          if (overflow) {
            finish(502, targetName);
            response.writeHead(502, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ error: 'upstream response body exceeded facade adaptation cap', code: 'backend_error' }));
            return;
          }
          const body = Buffer.concat(chunks).toString('utf8');
          const payload = status >= 400 ? (rewriteErrorEnvelope(body) ?? body) : (unwrapSuccessEnvelope(body) ?? body);
          outHeaders['content-length'] = String(Buffer.byteLength(payload));
          delete outHeaders['transfer-encoding'];
          response.writeHead(status, outHeaders);
          response.end(payload);
        });
        return;
      }
      response.writeHead(status, outHeaders);
      proxiedResponse.pipe(response);
    });
    proxied.on('error', () => {
      finish(502, targetName);
      if (!response.headersSent) {
        response.writeHead(502, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: { code: 'backend_unavailable', message: `target ${targetName} at ${target.host}:${target.port} unreachable` } }));
      } else {
        response.destroy();
      }
    });
    request.pipe(proxied);
  });
  server.on('upgrade', (request, socket, head) => {
    const pathname = canonicalPath(request.url || '/');
    if (pathname === null) {
      socket.destroy();
      return;
    }
    const targetName = (routeMap.upgrades && Object.prototype.hasOwnProperty.call(routeMap.upgrades, pathname)) ? routeMap.upgrades[pathname] : 'legacy';
    const target = targets[targetName];
    const headers = {};
    for (const [key, value] of Object.entries(request.headers)) {
      if (key.toLowerCase() !== 'host') headers[key] = value;
    }
    headers.host = `${target.host}:${target.port}`;
    const lines = [`${request.method} ${request.url} HTTP/1.1`, ...Object.entries(headers).map(([key, value]) => `${key}: ${value}`)];
    const upstream = net.connect(target.port, target.host, () => {
      upstream.write(lines.join('\r\n') + '\r\n\r\n');
      if (head && head.length) upstream.write(head);
      socket.pipe(upstream);
      upstream.pipe(socket);
    });
    const teardown = () => {
      relays.delete(socket);
      relays.delete(upstream);
      socket.destroy();
      upstream.destroy();
    };
    relays.add(socket);
    relays.add(upstream);
    upstream.on('error', teardown);
    socket.on('error', teardown);
    upstream.on('close', () => {
      relays.delete(upstream);
      socket.destroy();
    });
  });
  const facade = {
    server,
    close: () => {
      if (closed.value) return Promise.resolve();
      closed.value = true;
      upstreamAgent.destroy();
      for (const socket of relays) socket.destroy();
      server.closeAllConnections?.();
      return new Promise(resolve => server.close(() => resolve()));
    }
  };
  return new Promise(resolve => {
    server.listen(port, host, () => resolve(facade));
    server.on('error', error => {
      if (error.code === 'EADDRINUSE') {
        console.error(`facade failed to start: port ${port} on ${host} is already in use`);
        process.exitCode = 1;
      }
      throw error;
    });
  });
}

export async function main() {
  const overridePath = path.join(process.cwd(), '.aide', 'facade-routes.json');
  const defaultPath = path.join(ROOT, 'common', 'facade-route-map.json');
  let mapFile = defaultPath;
  try {
    await fs.access(overridePath);
    mapFile = overridePath;
  } catch {}
  const routeMap = await loadRouteMap(mapFile);
  const targets = {
    ts: { host: '127.0.0.1', port: Number(process.env.AIDE_ARCH_PORT || 4778) },
    legacy: { host: '127.0.0.1', port: Number(process.env.AIDE_LEGACY_PORT || process.env.AIDE_DAEMON_PORT || 4779) }
  };
  const facade = await createFacade({ port: Number(process.env.AIDE_FACADE_PORT || 4777), routeMap, targets });
  const bound = facade.server.address();
  console.log(`facade listening on ${bound.address}:${bound.port} (routes: ${mapFile}, ts: ${targets.ts.port}, legacy: ${targets.legacy.port})`);
  const stop = () => facade.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

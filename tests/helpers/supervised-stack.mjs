// Canonical supervised test-launch path for CI scripts and integration tests.
//
// Production refuses to run the arch backend and the facade without a trusted
// launch supervisor (node/src/server.ts, scripts/facade.mjs both require a
// live IPC supervisor). Tests must therefore either drive scripts/start.mjs or
// reproduce the exact supervisor wiring here using the canonical modules:
// `superviseAuthority` owns the arch child and attaches the legacy adapter;
// the facade is instantiated in-process with `authenticate` delegated to the
// supervisor so transport authentication follows the production channel.
//
// Pairing and every mutation approval use the real HTTP control plane
// (POST /api/authority/pair, /api/authority/prepare, /api/authority/decision).
// No test-only credential, bypass, or internal state access is involved.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { superviseAuthority } from '../../common/security/authority-channel.mjs';
import { createFacade, loadRouteMap } from '../../scripts/facade.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HOST = '127.0.0.1';

export async function waitForHttp(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${url}: ${last}`);
}

function terminateChild(ref, timeoutMs = 5000) {
  if (ref.exitCode !== null || ref.signalCode !== null || ref.pid === undefined) return Promise.resolve();
  return new Promise(resolve => {
    const finished = () => resolve();
    ref.once('exit', finished);
    try { ref.kill(); } catch { finished(); }
    setTimeout(() => {
      if (ref.exitCode === null && ref.signalCode === null) {
        const taskkill = spawn('taskkill', ['/pid', String(ref.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
        taskkill.once('exit', finished);
        taskkill.once('error', finished);
      } else {
        finished();
      }
    }, timeoutMs);
  });
}

export async function launchSupervisedStack({ workspace, env = {}, origin = 'http://127.0.0.1:4173' } = {}) {
  if (!workspace) throw new Error('workspace is required');
  const children = [];
  const logs = [];
  function child(entry, extra) {
    const ref = spawn(process.execPath, [entry], {
      cwd: ROOT,
      windowsHide: true,
      env: { ...process.env, AIDE_WORKSPACE: workspace, AIDE_CLOSED_LOOP: 'false', ...env, ...extra },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });
    ref.stdout?.on('data', bytes => logs.push(String(bytes)));
    ref.stderr?.on('data', bytes => logs.push(String(bytes)));
    children.push(ref);
    return ref;
  }

  const supervisor = superviseAuthority(child('node/src/server.ts', { AIDE_ARCH_PORT: '0' }));
  const legacy = child('daemon/server.mjs', { AIDE_DAEMON_PORT: '0', AIDE_LEGACY_PORT: '0' });
  supervisor.attach('legacy', legacy);
  const addresses = await supervisor.ready();
  const targets = {
    ts: { host: HOST, port: addresses.arch.port },
    legacy: { host: HOST, port: addresses.legacy.port }
  };
  const routeMap = await loadRouteMap(path.join(ROOT, 'common/facade-route-map.json'));
  const facade = await createFacade({
    routeMap,
    targets,
    authenticate: (token, requestOrigin) => supervisor.authenticate(token, requestOrigin)
  });
  const facadePort = facade.server.address().port;
  const bases = {
    facade: `http://${HOST}:${facadePort}`,
    ts: `http://${HOST}:${targets.ts.port}`,
    legacy: `http://${HOST}:${targets.legacy.port}`
  };
  await waitForHttp(`${bases.facade}/api/health`);

  let token = null;
  let actorId = null;
  const boundOrigin = origin;

  async function pair() {
    const { proof } = await supervisor.pairing(boundOrigin);
    const exchange = await fetch(`${bases.facade}/api/authority/pair`, {
      method: 'POST',
      headers: { Origin: boundOrigin, 'Content-Type': 'application/json', 'X-AIDE-API-Format': 'envelope-v1' },
      body: JSON.stringify({ proof }),
      signal: AbortSignal.timeout(60000)
    });
    const session = await exchange.json().catch(() => null);
    if (exchange.status !== 200 || session?.ok !== true) {
      throw new Error(`pairing failed: HTTP ${exchange.status} ${JSON.stringify(session).slice(0, 200)}`);
    }
    token = session.data.token;
    actorId = session.data.actor_id;
    return session.data;
  }
  await pair();

  function authHeaders(extra, envelope = true) {
    const headers = new Headers({ Origin: boundOrigin });
    if (envelope) headers.set('X-AIDE-API-Format', 'envelope-v1');
    if (token) headers.set('Authorization', `Bearer ${token}`);
    new Headers(extra).forEach((value, key) => headers.set(key, value));
    return headers;
  }

  function resolveBase(baseName) {
    return bases[baseName] ?? baseName;
  }

  async function request(baseName, method, pathname, { body, headers, signal, envelope = true } = {}) {
    const init = { method, headers: authHeaders(headers, envelope) };
    if (body !== undefined) {
      init.headers.set('Content-Type', 'application/json');
      init.body = JSON.stringify(body);
    }
    return fetch(`${resolveBase(baseName)}${pathname}`, { ...init, signal: signal ?? AbortSignal.timeout(30000) });
  }

  async function json(baseName, method, pathname, options = {}) {
    const response = await request(baseName, method, pathname, options);
    let body = {};
    try { body = await response.json(); } catch {}
    return { status: response.status, body };
  }

  async function prepare({ adapter, method, path: pathname, body, taskId }) {
    const payload = {
      ...(adapter ? { adapter } : {}),
      method,
      path: pathname,
      task_id: taskId ?? `ci-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      body: body ?? {}
    };
    const response = await request('facade', 'POST', '/api/authority/prepare', { body: payload });
    const envelope = await response.json().catch(() => null);
    if (response.status !== 200 || envelope?.ok !== true) {
      throw new Error(`prepare failed: HTTP ${response.status} ${JSON.stringify(envelope).slice(0, 220)}`);
    }
    return envelope.data;
  }

  async function decide(operationId, decision = 'approve') {
    const result = await json('facade', 'POST', '/api/authority/decision', { body: { operation_id: operationId, decision } });
    if (result.status !== 200 || result.body?.ok !== true) {
      throw new Error(`decision failed: HTTP ${result.status} ${JSON.stringify(result.body).slice(0, 220)}`);
    }
    return result.body;
  }

  async function approve({ adapter, method, path: pathname, body, baseName = 'facade', taskId }) {
    const operation = await prepare({ adapter, method, path: pathname, body, taskId });
    await decide(operation.operation_id);
    return request(baseName, method, pathname, {
      body,
      headers: { 'X-AIDE-Operation': operation.operation_id, 'X-AIDE-Task': operation.task_id }
    });
  }

  async function approveJson(options) {
    const response = await approve(options);
    let body = {};
    try { body = await response.json(); } catch {}
    return { status: response.status, body };
  }

  async function close() {
    supervisor.close();
    await facade.close();
    await Promise.all(children.map(ref => terminateChild(ref)));
  }

  // Canonical approval surface for operations the services propose at run time
  // (task commands, cache phases): the operator sees them on the authenticated
  // event channel and decides each exact operation.
  async function openEventSocket(channels = ['tasks']) {
    const socket = new WebSocket(`ws://${HOST}:${facadePort}/ws`, { headers: { Origin: boundOrigin } });
    await once(socket, 'open');
    const acknowledged = once(socket, 'message');
    socket.send(JSON.stringify({ type: 'authenticate', token }));
    await acknowledged;
    socket.send(JSON.stringify({ type: 'subscribe', channels }));
    return socket;
  }

  function autoApprove(socket, options = {}) {
    const decided = new Set();
    const approved = [];
    const onMessage = raw => {
      let envelope;
      try { envelope = JSON.parse(String(raw)); } catch { return; }
      const event = envelope?.data;
      if (event?.authority_state?.state !== 'pending' || typeof event.authority_state.operation_id !== 'string') return;
      const id = event.authority_state.operation_id;
      if (decided.has(id)) return;
      decided.add(id);
      decide(id, 'approve').then(() => {
        approved.push({ id, kind: event.authority_state.phase ?? null, event: event.event });
        options.log?.(`approved ${id}`);
      }).catch(() => {});
    };
    socket.on('message', onMessage);
    return { stop: () => socket.off('message', onMessage), approved, decided };
  }

  return {
    supervisor,
    facade,
    facadePort,
    children,
    logs,
    bases,
    addresses,
    origin: boundOrigin,
    pair,
    request,
    json,
    prepare,
    decide,
    approve,
    approveJson,
    close,
    openEventSocket,
    autoApprove,
    getToken: () => token,
    getActorId: () => actorId
  };
}

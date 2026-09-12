import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { superviseAuthority } from '../../common/security/authority-channel.mjs';
import { createFacade, loadRouteMap } from '../../scripts/facade.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
test('real supervisor -> facade/direct TS/legacy: pairing, bound write and denial without fallback', { timeout: 90000 }, async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'phase2a-stack-'));
  const children = [];
  const capturedLogs = [];
  let facade;
  let supervisor;
  let ws;
  function child(entry, extra) {
    const processRef = spawn(process.execPath, [entry], { cwd: root, windowsHide: true,
      env: { ...process.env, AIDE_WORKSPACE: workspace, AIDE_MODEL_DIR: path.join(workspace, 'models'), AIDE_CLOSED_LOOP: 'false', AIDE_EMBEDDINGS_URL: '', ...extra },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    processRef.stdout.on('data', bytes => capturedLogs.push(String(bytes)));
    processRef.stderr.on('data', bytes => capturedLogs.push(String(bytes)));
    children.push(processRef);
    return processRef;
  }
  try {
    supervisor = superviseAuthority(child('node/src/server.ts', { AIDE_ARCH_PORT: '0' }));
    supervisor.attach('legacy', child('daemon/server.mjs', { AIDE_DAEMON_PORT: '0' }));
    const addresses = await supervisor.ready();
    assert.ok(addresses.arch.port > 0 && addresses.legacy.port > 0);
    facade = await createFacade({ routeMap: await loadRouteMap(path.join(root, 'common/facade-route-map.json')),
      targets: { ts: { host: '127.0.0.1', port: addresses.arch.port }, legacy: { host: '127.0.0.1', port: addresses.legacy.port } },
      authenticate: (token, origin) => supervisor.authenticate(token, origin) });
    const facadePort = facade.server.address().port;
    const origin = 'http://127.0.0.1:4173';
    const mutation = { path: 'owned.txt', content: 'exact approved content', approved: true };
    for (const port of [addresses.arch.port, addresses.legacy.port, facadePort]) {
      const denied = await fetch(`http://127.0.0.1:${port}/api/file/write`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: origin, 'X-AIDE-Internal': 'true', 'X-AIDE-Actor': 'operator' }, body: JSON.stringify(mutation) });
      assert.equal(denied.status, 403);
      assert.equal(await fs.access(path.join(workspace, mutation.path)).then(() => true, () => false), false);
    }
    const { proof } = await supervisor.pairing(origin);
    const base = `http://127.0.0.1:${facadePort}`;
    const paired = await fetch(`${base}/api/authority/pair`, { method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', 'X-AIDE-API-Format': 'envelope-v1' }, body: JSON.stringify({ proof }) });
    assert.equal(paired.status, 200);
    const session = await paired.json();
    assert.equal(session.ok, true);
    const headers = { Origin: origin, Authorization: `Bearer ${session.data.token}`, 'Content-Type': 'application/json', 'X-AIDE-API-Format': 'envelope-v1' };
    const post = (url, body, extra = {}) => fetch(url, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body) });
    for (const [adapter, targetPort] of [['ts', facadePort], ['legacy', addresses.legacy.port]]) {
      const task = `fixture-${adapter}`;
      const body = { ...mutation, path: `${adapter}.txt` };
      const missingHeaders = { ...headers }; delete missingHeaders['X-AIDE-API-Format'];
      const missingApproval = await fetch(`http://127.0.0.1:${targetPort}/api/file/write`, { method: 'POST', headers: missingHeaders, body: JSON.stringify(body) });
      assert.equal(missingApproval.status, 409);
      const missingBody = await missingApproval.json();
      assert.equal(missingBody.detail?.reason, 'APPROVAL_REQUIRED');
      assert.equal(missingBody.detail?.adapter, adapter);
      assert.equal(await fs.access(path.join(workspace, body.path)).then(() => true, () => false), false);
      const proposal = await post(`${base}/api/authority/prepare`, { adapter, method: 'POST', path: '/api/file/write', task_id: task, body });
      assert.equal(proposal.status, 200);
      const prepared = await proposal.json();
      assert.equal(prepared.ok, true);
      const id = prepared.data.operation_id;
      assert.equal((await post(`${base}/api/authority/decision`, { operation_id: id, decision: 'approve' })).status, 200);
      const bound = { 'X-AIDE-Operation': id, 'X-AIDE-Task': task };
      const target = `http://127.0.0.1:${targetPort}/api/file/write`;
      const altered = await post(target, { ...body, content: 'changed after approval' }, bound);
      assert.equal(altered.status, 409);
      assert.equal(await fs.access(path.join(workspace, body.path)).then(() => true, () => false), false);
      assert.equal((await post(target, body, bound)).status, 200);
      assert.equal(await fs.readFile(path.join(workspace, body.path), 'utf8'), body.content);
      assert.equal((await post(target, body, bound)).status, 409);
      assert.equal(await fs.readFile(path.join(workspace, body.path), 'utf8'), body.content);
    }
    ws = new WebSocket(`ws://127.0.0.1:${facadePort}/ws`, { origin });
    await once(ws, 'open');
    const acknowledged = once(ws, 'message', { signal: AbortSignal.timeout(5000) });
    ws.send(JSON.stringify({ type: 'authenticate', token: session.data.token }));
    assert.deepEqual(JSON.parse(String((await acknowledged)[0])), { type: 'authenticated' });
    ws.send(JSON.stringify({ type: 'subscribe', channels: ['log'] }));
    const barrier = once(ws, 'pong', { signal: AbortSignal.timeout(5000) }); ws.ping(); await barrier;
    const event = once(ws, 'message', { signal: AbortSignal.timeout(5000) });
    const read = await fetch(`${base}/api/file?path=ts.txt`, { headers });
    assert.equal(read.status, 200);
    assert.equal(JSON.parse(String((await event)[0])).channel, 'log');
    for (const value of [proof, session.data.token]) {
      assert.equal(capturedLogs.join('').includes(value), false, 'secret must not be in ordinary child logs');
      const journal = await fs.readFile(path.join(workspace, '.aide/cipher-state.jsonl'), 'utf8');
      assert.equal(journal.includes(value), false, 'secret must not be in audit journal');
    }
    console.log(JSON.stringify({ workspace, fixturePids: children.map(ref => ref.pid), ports: [addresses.arch.port, addresses.legacy.port, facadePort], negativeHttpCases: 9, approvedWorkspaceWrites: 2, realModelAcceptance: 'NOT_RUN' }));
  } finally {
    ws?.terminate();
    await facade?.close();
    supervisor?.close();
    for (const processRef of children) {
      if (processRef.exitCode !== null || processRef.signalCode !== null) continue;
      const exited = once(processRef, 'exit', { signal: AbortSignal.timeout(10000) });
      processRef.kill();
      await exited;
    }
    assert.ok(children.every(ref => ref.exitCode !== null || ref.signalCode !== null));
    console.log(JSON.stringify({ fixtureChildrenExited: children.map(ref => ({ pid: ref.pid, exitCode: ref.exitCode, signalCode: ref.signalCode })) }));
  }
});

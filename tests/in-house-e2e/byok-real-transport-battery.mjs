import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fsp } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { ArchServer } from '../../node/src/server.ts';
import { buildRoutes } from '../../node/src/openapi.ts';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('BYOK real transport: consented local provider test and agent call are egress-audited', async () => {
  const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), 'aide-byok-real-'));
  const provider = http.createServer((request, response) => {
    if (request.headers.authorization !== 'Bearer test-secret') {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'bad auth' }));
      return;
    }
    if (request.url === '/models') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ data: [] }));
      return;
    }
    if (request.url === '/chat/completions') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: '<attempt_completion><result>provider completed the real task</result></attempt_completion>' } }] }));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  let archHttp;
  let providerHttp;
  try {
    providerHttp = await new Promise(resolve => provider.listen(0, '127.0.0.1', () => resolve(provider.address())));
    const port = providerHttp.port;
    const store = new Map();
    const routes = await buildRoutes(workspace, 'test', {
      agentChatFn: async () => '<attempt_completion><result>local fallback</result></attempt_completion>',
      byokSecretStore: {
        setKey: (id, key) => store.set(id, key),
        getKey: id => store.get(id) ?? null,
        deleteKey: id => store.delete(id),
        listProviderIds: () => [...store.keys()]
      },
      byokFetchImpl: fetch,
      indexEmbedFn: async texts => texts.map(() => []),
      watchIndex: false
    });
    const arch = new ArchServer(workspace, path.join(workspace, 'arch.log'));
    for (const route of routes) arch.route(route);
    archHttp = await arch.listen(0);
    const address = archHttp.address();
    assert.ok(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}`;
    const call = async (method, pathname, payload) => {
      const response = await fetch(base + pathname, {
        method,
        headers: { 'content-type': 'application/json' },
        body: payload === undefined ? undefined : JSON.stringify(payload)
      });
      return { status: response.status, body: await response.json() };
    };

    const providerSet = await call('PUT', '/api/byok/providers/set', { provider: { id: 'local-test', name: 'Local test provider', base_url: `http://127.0.0.1:${port}`, model_id: 'test-model' } });
    assert.equal(providerSet.status, 200);
    assert.equal((await call('PUT', '/api/byok/key', { provider_id: 'local-test', api_key: 'test-secret' })).status, 200);
    assert.equal((await call('PUT', '/api/byok/consent', { enabled: true })).status, 200);
    const routing = await call('PUT', '/api/byok/routing', { routing: { plan: 'local', act: { provider_id: 'local-test', model_id: 'test-model' }, utility: 'local' } });
    assert.equal(routing.status, 200);

    const tested = await call('POST', '/api/byok/test', { provider_id: 'local-test' });
    assert.equal(tested.status, 200);
    assert.equal(tested.body.data.ok, true);
    assert.equal(tested.body.data.detail, 'HTTP 200');

    const started = await call('POST', '/api/agent/start', { task: 'complete a provider-backed task', mode: 'act', chat_source: 'provider' });
    assert.equal(started.status, 200);
    const sessionId = started.body.data.session_id;
    let status;
    for (let i = 0; i < 80; i += 1) {
      const current = await call('GET', `/api/agent/status?id=${encodeURIComponent(sessionId)}`);
      status = current.body.data;
      if (status.state === 'done') break;
      await wait(25);
    }
    assert.equal(status.state, 'done');
    const egress = await fsp.readFile(path.join(workspace, '.aide', 'egress', 'journal.jsonl'), 'utf8');
    assert.match(egress, /byok-test/);
    assert.match(egress, /byok-chat/);
    assert.doesNotMatch(egress, /test-secret/);
  } finally {
    if (archHttp) await new Promise(resolve => { archHttp.closeAllConnections?.(); archHttp.close(() => resolve()); });
    if (providerHttp) await new Promise(resolve => provider.close(() => resolve()));
    for (let i = 0; i < 10; i += 1) {
      try { await fsp.rm(workspace, { recursive: true, force: true }); break; }
      catch (error) {
        if (!['EBUSY', 'ENOTEMPTY', 'EPERM'].includes(error?.code)) throw error;
        await wait(100);
      }
    }
  }
});

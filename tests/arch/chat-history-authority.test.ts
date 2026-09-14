// tests/arch/chat-history-authority.test.ts
// Wave 3B: POST /api/chat/history is a bounded conversation write owned by
// ChatStore, with a deterministic, local, subordinate memory-journal effect.
// No existing fixture owned the save route; this is the single new fixture for
// the wave.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type http from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ArchServer } from '../../node/src/server.ts';
import { buildRoutes } from '../../node/src/openapi.ts';
import { pairFixture } from './authority-fixture.ts';

test('chat history save is an authority-bound conversation write with a local subordinate journal', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-chat-history-'));
  const server = new ArchServer(workspace, path.join(workspace, 'chat-history.log'));
  let httpServer: http.Server | undefined;
  try {
    const routes = await buildRoutes(workspace, 'test', { authority: server.authority, events: server.events });
    for (const route of routes) server.route(route);
    httpServer = await server.listen(0);
    const address = httpServer.address();
    assert.ok(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}`;
    const owner = await pairFixture(server, base);

    const historyPath = path.join(workspace, '.aide', 'chat-history.json');
    const journalPath = path.join(workspace, '.aide', 'memory', 'sessions.jsonl');
    const historyRaw = () => fs.readFile(historyPath, 'utf8').catch(() => '');
    const journalRaw = () => fs.readFile(journalPath, 'utf8').catch(() => '');
    const saveBody = {
      modelId: 'house-4b',
      title: 'Authority probe',
      messages: [
        { role: 'user', content: 'Please save this conversation for the authority probe.' },
        { role: 'assistant', content: 'Saved under canonical authority.' }
      ]
    };

    const anonymous = await fetch(`${base}/api/chat/history`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(saveBody)
    });
    assert.equal(anonymous.status, 403, 'anonymous actor rejected');

    const noApproval = await owner.request('/api/chat/history', { method: 'POST', body: JSON.stringify(saveBody) });
    assert.equal(noApproval.status, 409, 'paired actor without approval fails');
    assert.equal(await historyRaw(), '', 'no conversation written without approval');

    const malformed = await owner.request('/api/chat/history', {
      method: 'POST', body: JSON.stringify({ title: 'missing model id', messages: [] })
    });
    assert.equal(malformed.status, 400, 'malformed payload fails before mutation');
    assert.equal(await historyRaw(), '', 'malformed payload writes nothing');

    const headers = await owner.approve('POST', '/api/chat/history', saveBody, 'task:chat-save');
    const changedAttempt = await owner.request('/api/chat/history', {
      method: 'POST', headers, body: JSON.stringify({ ...saveBody, title: 'Changed title' })
    });
    assert.equal(changedAttempt.status, 409, 'changed content cannot reuse approval');

    const applied = await owner.request('/api/chat/history', { method: 'POST', headers, body: JSON.stringify(saveBody) });
    assert.equal(applied.status, 200);
    const saved = (await applied.json()) as { data: { id: string; updatedAt: number } };
    assert.ok(saved.data.id.length > 0);
    assert.ok(saved.data.updatedAt > 0);

    const replay = await owner.request('/api/chat/history', { method: 'POST', headers, body: JSON.stringify(saveBody) });
    assert.equal(replay.status, 409, 'consumed save approval cannot replay');

    // Durable conversation + deterministic subordinate journal, both free of
    // authority material.
    const persisted = await historyRaw();
    assert.match(persisted, /Authority probe/);
    assert.match(persisted, /Saved under canonical authority\./);
    const journal = await journalRaw();
    assert.match(journal, /Authority probe/, 'subordinate memory journal recorded the approved turn');
    const token = owner.headers.Authorization.slice(7);
    for (const raw of [persisted, journal]) {
      assert.ok(!raw.includes(token), 'chat artifacts must not serialize bearer material');
      assert.ok(!raw.includes(owner.actorId), 'chat artifacts must not serialize actor identity');
      assert.ok(!raw.includes(headers['X-AIDE-Operation']), 'chat artifacts must not serialize operation ids');
    }

    // The enrolled read route returns the saved conversation for the same actor.
    const listed = await owner.request('/api/chat/history');
    assert.equal(listed.status, 200);
    const listedBody = (await listed.json()) as { data: { conversations: Array<{ id: string }> } };
    assert.ok(listedBody.data.conversations.some(conversation => conversation.id === saved.data.id));
  } finally {
    httpServer?.closeAllConnections();
    if (httpServer) await new Promise<void>(resolve => httpServer!.close(() => resolve()));
    server.authority.control.close();
    server.events.close();
    for (let attempt = 0; attempt < 10; attempt++) {
      try { await fs.rm(workspace, { recursive: true, force: true }); break; }
      catch (error) {
        if (!['EBUSY', 'ENOTEMPTY', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    }
  }
});

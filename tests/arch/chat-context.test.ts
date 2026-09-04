import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type http from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ArchServer } from '../../node/src/server.ts';
import { routeForChat, routeForChatStream } from '../../node/src/routes/chat.ts';
import type { ModelRouter } from '../../node/src/services/model-router.ts';
import type { ModelRuntime } from '../../node/src/services/model-runtime.ts';

type Envelope<T> = { ok: boolean; data?: T; error?: { code: string; message: string } };

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-chat-context-'));
let server: ArchServer;
let httpServer: http.Server;
let base: string;
let observedMessages: Array<{ role: string; content: string }> = [];

const router = {
  async chat(_routeId: string, messages: Array<{ role: string; content: string }>) {
    observedMessages = messages;
    return { text: 'context verified', modelId: 'local:stub', timingMs: 1 };
  },
  async chatStream(_routeId: string, messages: Array<{ role: string; content: string }>, onDelta: (delta: string) => void) {
    observedMessages = messages;
    onDelta('stream context verified');
    return { text: 'stream context verified', modelId: 'local:stub', timingMs: 1, usedApprox: 10, dropped: 0, truncatedSystem: false };
  }
};

const runtime = {
  async refreshServedContext() {},
  getEffectiveContext() { return 4096; }
};

const indexService = {
  getStatus() { return { state: 'ready' }; },
  async hybridSearch() {
    return {
      degraded: true,
      results: [
        { path: 'src/target.ts', line: 2, header: 'target function' },
        { path: '../outside.txt', line: 1, header: 'must never be read' },
        { path: 'missing.ts', line: 1, header: 'missing file' }
      ]
    };
  }
};

async function post<T>(pathName: string, payload: unknown): Promise<{ status: number; body: Envelope<T> }> {
  const response = await fetch(`${base}${pathName}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return { status: response.status, body: (await response.json()) as Envelope<T> };
}

before(async () => {
  await fs.mkdir(path.join(workspace, 'src'), { recursive: true });
  await fs.writeFile(path.join(workspace, 'src', 'target.ts'), 'export function target() {\n  return "grounded";\n}\n', 'utf8');
  await fs.writeFile(path.join(workspace, 'outside.txt'), 'outside data', 'utf8');

  server = new ArchServer(workspace, path.join(workspace, 'arch-chat-context.log'));
  server.route(routeForChat(
    router as unknown as ModelRouter,
    runtime as unknown as ModelRuntime,
    workspace,
    indexService
  ));
  server.route(routeForChatStream(
    router as unknown as ModelRouter,
    runtime as unknown as ModelRuntime,
    workspace,
    indexService
  ));
  httpServer = await server.listen(0);
  const address = httpServer.address();
  assert.ok(address && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  httpServer.closeAllConnections?.();
  await new Promise<void>(resolve => httpServer.close(() => resolve()));
  await server.logger.flush();
  await fs.rm(workspace, { recursive: true, force: true });
});

test('chat injects bounded workspace context and reports honest retrieval metadata', async () => {
  const response = await post<{
    text: string;
    harness: {
      context_hits: number;
      context_degraded: boolean;
      context_tokens: number;
      memory_recall_hits: number;
      memory_recall_tokens: number;
      memory_recall_degraded: boolean;
    };
  }>('/api/chat', {
    modelId: 'local:stub',
    messages: [{ role: 'user', content: 'Where is the grounded target function?' }]
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.data?.text, 'context verified');
  assert.equal(response.body.data?.harness.context_hits, 1);
  assert.equal(response.body.data?.harness.context_degraded, true);
  assert.ok((response.body.data?.harness.context_tokens ?? 0) > 0);

  const contextMessage = observedMessages.find(message => message.content.includes('[workspace context - retrieved'));
  assert.ok(contextMessage, 'retrieved workspace context must reach the router');
  assert.equal(contextMessage.role, 'user', 'retrieved workspace context must be a user DATA message');
  assert.match(contextMessage.content, /src\/target\.ts:2 target function/);
  assert.match(contextMessage.content, /grounded/);
  assert.doesNotMatch(contextMessage.content, /outside\.txt|must never be read|missing\.ts/);
  assert.equal(observedMessages.at(-1)?.role, 'user');
  assert.match(observedMessages.at(-1)?.content ?? '', /grounded target function/);
  assert.doesNotMatch(observedMessages[0]?.content ?? '', /workspace context|outside\.txt|target function/);
});

test('streaming chat uses the same governed context preparation and reports harness metadata', async () => {
  const response = await fetch(`${base}/api/chat/stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      modelId: 'local:stub',
      messages: [{ role: 'user', content: 'Where is the grounded target function?' }]
    })
  });
  const body = await response.text();
  assert.equal(response.status, 200);
  const payloads = body
    .split('\n')
    .filter(line => line.startsWith('data: '))
    .map(line => JSON.parse(line.slice('data: '.length)) as Record<string, unknown>);
  assert.deepEqual(payloads[0], { delta: 'stream context verified' });
  const done = payloads.find(payload => payload.done === true);
  assert.ok(done);
  const harness = done.harness as { injected: boolean; context_hits: number; context_degraded: boolean };
  assert.equal(harness.injected, true);
  assert.equal(harness.context_hits, 1);
  assert.equal(harness.context_degraded, true);
  const contextMessage = observedMessages.find(message => message.content.includes('[workspace context - retrieved'));
  assert.ok(contextMessage);
  assert.equal(contextMessage.role, 'user');
});

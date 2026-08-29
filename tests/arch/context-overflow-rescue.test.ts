import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import { ModelRuntime } from '../../node/src/services/model-runtime.ts';

// Regression tests for the 2026-08-28 audit hard-fails: the engine rejects
// an overflowing prompt with HTTP 400 and the router surfaced an empty-output
// 504 (audit tasks B3/G1/C1/D1). The runtime must refit history to the
// effective served window and retry once instead.

interface StubState {
  overflowBodyChars: number;
  requests: Array<{ path: string; bodyChars: number; overflow: boolean }>;
}

function createStubEngine(state: StubState): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8'); });
      req.on('end', () => {
        const route = req.url ?? '';
        if (route === '/v1/models') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ data: [{ id: 'stub-overflow' }] }));
          return;
        }
        if (route === '/props') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ default_generation_settings: { n_ctx: 2048 } }));
          return;
        }
        if (route === '/v1/chat/completions') {
          const overflow = body.length > state.overflowBodyChars;
          state.requests.push({ path: route, bodyChars: body.length, overflow });
          if (overflow) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'the request exceeds the available context size' } }));
            return;
          }
          let stream = false;
          try {
            stream = (JSON.parse(body) as { stream?: boolean }).stream === true;
          } catch { /* treat as non-stream */ }
          if (stream) {
            res.writeHead(200, { 'Content-Type': 'text/event-stream' });
            res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'stub ok' } }] }) + '\n\n');
            res.write('data: [DONE]\n\n');
            res.end();
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'stub ok' } }], usage: { completion_tokens: 2 } }));
          return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end('{}');
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}/v1`,
        close: () => new Promise((closeResolve, closeReject) => {
          server.close(() => closeResolve()).on('error', closeReject);
          server.closeIdleConnections?.();
        })
      });
    });
  });
}

let dir: string;
let engine: { url: string; close: () => Promise<void> };

async function makeRuntime(contextTokens: number): Promise<ModelRuntime> {
  const manifestPath = path.join(dir, `manifest-${contextTokens}.json`);
  await fs.writeFile(manifestPath, JSON.stringify({
    models: [{
      id: 'stub-overflow',
      name: 'Stub Overflow',
      status: 'ready',
      roles: ['chat'],
      endpoint: engine.url,
      model: 'stub-overflow',
      artifact_uri: 'local://stub-overflow.gguf',
      context_tokens: contextTokens,
      file: ''
    }]
  }));
  const runtime = new ModelRuntime({
    workspace: dir,
    manifestPath,
    ingestedPath: path.join(dir, 'ingested-models.json'),
    modelDir: dir,
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });
  await runtime.load();
  return runtime;
}

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-overflow-'));
  engine = await createStubEngine({ overflowBodyChars: 8000, requests: [] });
});

after(async () => {
  await engine.close();
  await fs.rm(dir, { recursive: true, force: true });
});

test('chat rescues an HTTP-400 overflow with one refit retry', async () => {
  const runtime = await makeRuntime(2048);
  const result = await runtime.chat('stub-overflow', [
    { role: 'user', content: 'x'.repeat(4000) },
    { role: 'assistant', content: 'y'.repeat(4000) },
    { role: 'user', content: 'final question' }
  ]);
  assert.equal(result.text, 'stub ok', 'refit retry succeeded instead of surfacing a 504');
  await runtime.stopAll();
});

test('chatStream rescues an HTTP-400 overflow the same way', async () => {
  const runtime = await makeRuntime(2048);
  const deltas: string[] = [];
  await runtime.chatStream('stub-overflow', [
    { role: 'user', content: 'x'.repeat(4000) },
    { role: 'assistant', content: 'y'.repeat(4000) },
    { role: 'user', content: 'final question' }
  ], delta => deltas.push(delta), new AbortController().signal);
  assert.ok(deltas.join('').includes('stub ok'), 'streamed refit retry produced deltas');
  await runtime.stopAll();
});

test('chat still fails honestly when the effective window is unknown', async () => {
  const runtime = await makeRuntime(0);
  await assert.rejects(
    () => runtime.chat('stub-overflow', [
      { role: 'user', content: 'x'.repeat(4000) },
      { role: 'assistant', content: 'y'.repeat(4000) },
      { role: 'user', content: 'final question' }
    ]),
    (error: unknown) => error instanceof Error && error.message.includes('HTTP 400')
  );
  await runtime.stopAll();
});

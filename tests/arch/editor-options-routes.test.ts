import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type http from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ArchServer } from '../../node/src/server.ts';

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-p3-arch-'));
await fs.writeFile(path.join(workspace, 'sample.ts'), 'export const answer = 42;\n');
let server: ArchServer;
let httpServer: http.Server;
let base: string;

before(async () => {
  server = new ArchServer(workspace, path.join(workspace, 'arch-test.log'));
  const { buildRoutes } = await import('../../node/src/openapi.ts');
  const routes = await buildRoutes(workspace, 'test', { events: server.events });
  for (const route of routes) server.route(route);
  httpServer = await server.listen(0);
  const address = httpServer.address();
  assert.ok(address && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  server.events.close();
  await new Promise<void>(resolve => httpServer.close(() => resolve()));
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await fs.rm(workspace, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!['EBUSY', 'ENOTEMPTY', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
});

async function putSetting(values: Record<string, unknown>) {
  return fetch(`${base}/api/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ values })
  });
}

test('editor options endpoint returns defaults inside a strict envelope', async () => {
  const response = await fetch(`${base}/api/editor/options`);
  assert.equal(response.status, 200);
  const envelope = (await response.json()) as { ok?: boolean; data?: Record<string, unknown>; error?: unknown };
  assert.equal(envelope.ok, true);
  const data = envelope.data ?? {};
  assert.equal(data.fontSize, 14);
  assert.equal(data.tabSize, 2);
  assert.equal(data.wordWrap, false);
  assert.equal(data.minimap_enabled, true);
  assert.equal(data.stickyScroll_enabled, true);
  assert.equal(data.folding_enabled, true);
  assert.equal(data.bracketPairColorization_enabled, true);
  assert.equal(data.multiCursorModifier, 'ctrlKey');
});

test('settings writes are reflected through clamped editor options', async () => {
  const put = await putSetting({
    'aide.editor.fontSize': 99,
    'aide.editor.stickyScroll': false,
    'aide.editor.multiCursorModifier': 'altKey'
  });
  assert.equal(put.status, 200);

  const response = await fetch(`${base}/api/editor/options`);
  const envelope = (await response.json()) as { data?: Record<string, unknown> };
  const data = envelope.data ?? {};
  assert.equal(data.fontSize, 48, 'fontSize clamped to documented max');
  assert.equal(data.stickyScroll_enabled, false);
  assert.equal(data.multiCursorModifier, 'altKey');
});

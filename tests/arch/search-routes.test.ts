import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type http from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ArchServer } from '../../node/src/server.ts';

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-search-routes-'));
let server: ArchServer;
let httpServer: http.Server;
let base: string;

before(async () => {
  await fs.mkdir(path.join(workspace, 'src'), { recursive: true });
  await fs.writeFile(path.join(workspace, 'needle.txt'), 'the quick brown fox\n');
  await fs.writeFile(path.join(workspace, 'src', 'other.md'), '# TODO item\n');
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
  httpServer.closeAllConnections();
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

async function post(pathName: string, payload: unknown) {
  return fetch(`${base}${pathName}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
}

test('quick-open returns envelope with fuzzy matches and rejects empty query', async () => {
  const found = await fetch(`${base}/api/rg/quick-open?q=ndl`);
  const foundBody = (await found.json()) as { data?: { files?: Array<{ path: string }> } };
  assert.equal(found.status, 200);
  assert.ok((foundBody.data?.files ?? []).some(file => file.path.includes('needle')), 'fuzzy query ndl should find needle.txt');

  const empty = await fetch(`${base}/api/rg/quick-open?q=`);
  assert.equal(empty.status, 400);
});

test('file list endpoint serves workspace-relative paths', async () => {
  const response = await fetch(`${base}/api/rg/files`);
  const body = (await response.json()) as { data?: { files?: string[] } };
  assert.equal(response.status, 200);
  const files = body.data?.files ?? [];
  assert.ok(files.includes('needle.txt'), `expected needle.txt in ${JSON.stringify(files)}`);
  assert.ok(files.every(file => !file.startsWith('/') && !file.includes('..')));
});

test('global search finds literal matches across files and reports elapsed time', async () => {
  const response = await post('/api/rg/search', { query: 'quick brown' });
  assert.equal(response.status, 200);
  const body = (await response.json()) as { data?: { matches?: Array<{ path: string; line_number: number }>; truncated?: boolean; elapsed_ms?: number } };
  assert.equal(body.data?.truncated, false);
  assert.ok((body.data?.matches?.length ?? 0) >= 1);
  assert.match(body.data?.matches?.[0]?.path ?? '', /needle\.txt$/);

  const badRegex = await post('/api/rg/search', { query: '[unclosed', isRegex: true });
  assert.equal(badRegex.status, 400);

  const contractViolation = await post('/api/rg/search', { query: '' });
  assert.equal(contractViolation.status, 400);
});

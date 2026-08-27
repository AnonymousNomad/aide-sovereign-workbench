import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type http from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ArchServer } from '../../node/src/server.ts';
import { buildRoutes } from '../../node/src/openapi.ts';

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-eval-routes-'));
let server: ArchServer;
let httpServer: http.Server;
let base: string;

before(async () => {
  server = new ArchServer(workspace, path.join(workspace, 'arch-test.log'));
  const routes = await buildRoutes(workspace, 'test', { events: server.events });
  for (const route of routes) server.route(route);
  httpServer = await server.listen(0);
  const address = httpServer.address();
  assert.ok(address && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
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

test('eval gate reports honest failure for jobs with no artifacts; export is fail-closed; list starts empty', async () => {
  const evalResponse = await post('/api/training/export-eval', { job_id: 'never-trained' });
  assert.equal(evalResponse.status, 200);
  const evaluation = (await evalResponse.json()) as { data?: { passed?: boolean; reasons?: string[] } };
  assert.equal(evaluation.data?.passed, false);
  assert.ok((evaluation.data?.reasons?.length ?? 0) > 0);

  const blocked = await post('/api/training/export', { job_id: 'never-trained' });
  assert.equal(blocked.status, 403, 'export without passing eval must be refused');

  const list = await fetch(`${base}/api/training/exports`);
  const listed = (await list.json()) as { data?: { exports?: string[] } };
  assert.deepEqual(listed.data?.exports, []);

  const badQuant = await post('/api/training/export', { job_id: 'x', quant: 'FP4' });
  assert.equal(badQuant.status, 400);
});

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type http from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ArchServer } from '../../node/src/server.ts';
import { buildRoutes } from '../../node/src/openapi.ts';
import { pairFixture } from './authority-fixture.ts';

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-eval-routes-'));
const jobId = 'job-aaaa1111';
let server: ArchServer;
let httpServer: http.Server;
let base: string;
let owner: Awaited<ReturnType<typeof pairFixture>>;

const exportsDir = () => path.join(workspace, '.aide', 'exports');
const exportsSnapshot = async () => (await fs.readdir(exportsDir()).catch(() => [])).sort();

before(async () => {
  // Real job artifacts for the canonical success path (bounded local files).
  const jobDir = path.join(workspace, '.aide', 'training', jobId);
  await fs.mkdir(path.join(jobDir, 'adapter'), { recursive: true });
  await fs.mkdir(path.join(jobDir, 'checkpoints', 'checkpoint-100'), { recursive: true });
  await fs.writeFile(path.join(jobDir, 'adapter', 'adapter_config.json'), '{"r":16}');
  await fs.writeFile(path.join(jobDir, 'adapter', 'adapter_model.safetensors'), 'weights-bytes');
  await fs.writeFile(path.join(jobDir, 'checkpoints', 'checkpoint-100', 'trainer_state.json'), JSON.stringify({ log_history: [{ loss: 1.25, epoch: 1 }] }));

  server = new ArchServer(workspace, path.join(workspace, 'arch-test.log'));
  const routes = await buildRoutes(workspace, 'test', { authority: server.authority, events: server.events });
  for (const route of routes) server.route(route);
  httpServer = await server.listen(0);
  const address = httpServer.address();
  assert.ok(address && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}`;
  owner = await pairFixture(server, base);
});

after(async () => {
  server.events.close();
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

async function mutate(urlPath: string, payload: unknown, taskId: string) {
  const headers = await owner.approve('POST', urlPath, payload, taskId);
  const response = await owner.request(urlPath, { method: 'POST', headers, body: JSON.stringify(payload) });
  return { status: response.status, body: (await response.json()) as { ok?: boolean; data?: unknown; error?: { code: string; message: string } } };
}

test('eval gate reports honest failure for jobs with no artifacts; export is fail-closed; list starts empty', async () => {
  const evalResponse = await owner.request('/api/training/export-eval', { method: 'POST', body: JSON.stringify({ job_id: 'never-trained' }) });
  assert.equal(evalResponse.status, 200);
  const evaluation = (await evalResponse.json()) as { data?: { passed?: boolean; reasons?: string[] } };
  assert.equal(evaluation.data?.passed, false);
  assert.ok((evaluation.data?.reasons?.length ?? 0) > 0);

  const blocked = await mutate('/api/training/export', { job_id: 'never-trained' }, 'task:export-blocked');
  assert.equal(blocked.status, 403, 'export without passing eval must be refused');

  const list = await owner.request('/api/training/exports');
  const listed = (await list.json()) as { data?: { exports?: string[] } };
  assert.deepEqual(listed.data?.exports, []);

  const badQuant = await owner.request('/api/training/export', { method: 'POST', body: JSON.stringify({ job_id: 'x', quant: 'FP4' }) });
  assert.equal(badQuant.status, 400);
});

test('export authority: exact job/quant binding, atomic success, replay fails, containment owned by the service', async () => {
  const anonymous = await fetch(`${base}/api/training/export`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ job_id: jobId, quant: 'Q4_K_M' })
  });
  assert.equal(anonymous.status, 403, 'anonymous actor rejected');

  const before = await exportsSnapshot();
  const noApproval = await owner.request('/api/training/export', { method: 'POST', body: JSON.stringify({ job_id: jobId, quant: 'Q4_K_M' }) });
  assert.equal(noApproval.status, 409, 'paired actor without approval fails');
  assert.deepEqual(await exportsSnapshot(), before, 'no export without approval');

  // Traversal job ids fail before authorization (descriptor normalization).
  const traversal = await owner.request('/api/authority/prepare', {
    method: 'POST',
    body: JSON.stringify({ method: 'POST', path: '/api/training/export', body: { job_id: '..\\..\\escape', quant: 'Q4_K_M' }, task_id: 'task:export-escape' })
  });
  assert.equal(traversal.status, 400, 'escaping job id fails before authorization');

  // Changed job/quant cannot reuse an approval; the exact approved export
  // writes exactly one manifest via the service's atomic temp/rename path.
  const original = { job_id: jobId, quant: 'Q4_K_M' };
  const changedQuant = { job_id: jobId, quant: 'Q8_0' };
  const headers = await owner.approve('POST', '/api/training/export', original, 'task:export-bound');
  const changedAttempt = await owner.request('/api/training/export', { method: 'POST', headers, body: JSON.stringify(changedQuant) });
  assert.equal(changedAttempt.status, 409, 'changed quant cannot reuse approval');
  const applied = await owner.request('/api/training/export', { method: 'POST', headers, body: JSON.stringify(original) });
  assert.equal(applied.status, 200);
  const manifest = ((await applied.json()) as { data?: { manifest?: { status?: string; job_id?: string } } }).data?.manifest;
  assert.equal(manifest?.status, 'passed');
  assert.equal(manifest?.job_id, jobId);
  const replay = await owner.request('/api/training/export', { method: 'POST', headers, body: JSON.stringify(original) });
  assert.equal(replay.status, 409, 'consumed export approval cannot replay');

  // Durable manifest on disk; reload lists it; no authority material inside.
  const manifestPath = path.join(exportsDir(), `${jobId}-Q4_K_M.json`);
  const raw = await fs.readFile(manifestPath, 'utf8');
  assert.match(raw, /"status": "passed"/);
  const list = await owner.request('/api/training/exports');
  const listed = (await list.json()) as { data?: { exports?: string[] } };
  assert.deepEqual(listed.data?.exports, [jobId]);
  const token = owner.headers.Authorization.slice(7);
  assert.ok(!raw.includes(token) && !raw.includes(owner.actorId), 'manifest must not serialize authority material');
  assert.ok(!raw.includes(headers['X-AIDE-Operation']), 'manifest must not serialize operation ids');
  assert.equal((await exportsSnapshot()).length, 1, 'exactly one manifest for the approved export');
});

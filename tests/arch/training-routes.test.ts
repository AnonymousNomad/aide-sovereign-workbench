import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type http from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ArchServer } from '../../node/src/server.ts';
import { buildRoutes } from '../../node/src/openapi.ts';
import { Envelope } from '../../common/errors.ts';
import { pairFixture } from './authority-fixture.ts';

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-training-routes-'));
let server: ArchServer;
let httpServer: http.Server;
let base: string;
let owner: Awaited<ReturnType<typeof pairFixture>>;

before(async () => {
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
  return owner.request(pathName, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
}

test('training presets are served with fp16 pinned for this hardware class', async () => {
  const response = await owner.request('/api/training/presets');
  assert.equal(response.status, 200);
  const envelope = Envelope.safeParse(await response.json());
  if (!envelope.success || !envelope.data.ok) return assert.fail('presets envelope broken');
  const presets = (envelope.data.data as { presets: Array<{ key: string; fp16: boolean; bf16: boolean; learning_rate: number }> }).presets;
  assert.deepEqual(presets.map(preset => preset.key), ['0.5b', '1.5b']);
  for (const preset of presets) {
    assert.equal(preset.fp16, true, `${preset.key} must pin fp16 (Pascal has no usable bf16)`);
    assert.equal(preset.bf16, false);
    assert.equal(preset.learning_rate, 0.0002);
  }
});

test('status starts idle and start refuses unapproved or unenrolled jobs with typed errors', async () => {
  const idle = await owner.request('/api/training/status');
  const idleEnvelope = Envelope.safeParse(await idle.json());
  if (!idleEnvelope.success || !idleEnvelope.data.ok) return assert.fail('status envelope broken');
  assert.deepEqual(idleEnvelope.data.data as Record<string, unknown>, { state: 'idle' });

  const unapproved = await post('/api/training/start', { dataset_id: 'whatever', approved: false });
  assert.equal(unapproved.status, 400, 'approved:false fails contract validation before the runner');

  // POST /api/training/start is migration-waived (unenrolled): the authority
  // denies the capability before any dataset lookup, so the old NOT_FOUND for
  // an unknown dataset is now the earlier fail-closed FORBIDDEN denial.
  const unknown = await post('/api/training/start', { dataset_id: 'ghost', approved: true });
  assert.equal(unknown.status, 403, 'unenrolled training start is denied at the authority boundary');
  const unknownEnvelope = Envelope.safeParse(await unknown.json());
  if (!unknownEnvelope.success || unknownEnvelope.data.ok) return assert.fail('denial envelope broken');
  assert.equal(unknownEnvelope.data.error.code, 'FORBIDDEN');

  const emptyCheckpoints = await owner.request('/api/training/checkpoints');
  const ckEnvelope = Envelope.safeParse(await emptyCheckpoints.json());
  if (!ckEnvelope.success || !ckEnvelope.data.ok) return assert.fail('checkpoints envelope broken');
  assert.deepEqual(ckEnvelope.data.data as Record<string, unknown>, { checkpoints: [] });
});

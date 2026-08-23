import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';
import { ArchServer } from '../../node/src/server.ts';
import { WorkspaceService } from '../../node/src/services/workspace.ts';
import { routeForFileRead, routeForFileWrite } from '../../node/src/routes/fs.ts';
import { Envelope } from '../../common/errors.ts';
import { FileReadResponse, FileWriteResponse } from '../../common/contracts/file.ts';

let dir: string;
let server: ArchServer;
let httpServer: http.Server;
let base: string;

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-fs-'));
  await fs.writeFile(path.join(dir, 'hello.txt'), 'hello world\n', 'utf8');
  const big = 'x'.repeat(1024 * 1024 + 1);
  await fs.writeFile(path.join(dir, 'big.bin'), big, 'utf8');
  const service = new WorkspaceService(dir);
  server = new ArchServer(dir, path.join(dir, '.aide', 'arch-test.log'));
  server.route(routeForFileRead(service)).route(routeForFileWrite(service));
  httpServer = await server.listen(0);
  const address = httpServer.address();
  assert.ok(address && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await server.logger.flush();
  httpServer.closeAllConnections();
  await new Promise<void>(resolve => httpServer.close(() => resolve()));
  await fs.rm(dir, { recursive: true, force: true });
});

test('file read returns content for an existing file', async () => {
  const response = await fetch(`${base}/api/file?path=hello.txt`);
  assert.equal(response.status, 200);
  const envelope = Envelope.safeParse(await response.json());
  assert.equal(envelope.success, true);
  if (!envelope.success || !envelope.data.ok) return;
  const payload = FileReadResponse.safeParse(envelope.data.data);
  assert.equal(payload.success, true);
  if (!payload.success) return;
  assert.equal(payload.data.content, 'hello world\n');
  assert.equal(payload.data.too_large, false);
});

test('file read returns the too_large gate for >1MiB files', async () => {
  const response = await fetch(`${base}/api/file?path=big.bin`);
  const envelope = Envelope.safeParse(await response.json());
  assert.equal(envelope.success, true);
  if (!envelope.success || !envelope.data.ok) return;
  const payload = FileReadResponse.safeParse(envelope.data.data);
  assert.equal(payload.success, true);
  if (!payload.success) return;
  assert.equal(payload.data.content, null);
  assert.equal(payload.data.too_large, true);
  assert.ok(payload.data.size > 1024 * 1024);
});

test('file read rejects containment escapes', async () => {
  for (const escape of ['../secret.txt', '../../etc/passwd', `${dir}/hello.txt`, 'sub/../../escape']) {
    const response = await fetch(`${base}/api/file?path=${encodeURIComponent(escape)}`);
    const envelope = Envelope.safeParse(await response.json());
    assert.equal(envelope.success, true, `escape ${escape}`);
    if (!envelope.success) continue;
    assert.equal(envelope.data.ok, false, `escape ${escape} must be rejected`);
    if (!envelope.data.ok) assert.equal(envelope.data.error.code, 'FORBIDDEN', `escape ${escape}`);
  }
});

test('file read returns NOT_FOUND for a missing file', async () => {
  const response = await fetch(`${base}/api/file?path=nope.txt`);
  const envelope = Envelope.safeParse(await response.json());
  assert.equal(envelope.success, true);
  if (!envelope.success || envelope.data.ok) return;
  assert.equal(envelope.data.error.code, 'NOT_FOUND');
});

test('file write requires approval', async () => {
  const response = await fetch(`${base}/api/file/write`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: 'x.txt', content: 'x', approved: false })
  });
  const envelope = Envelope.safeParse(await response.json());
  assert.equal(envelope.success, true);
  if (!envelope.success || envelope.data.ok) return;
  assert.equal(envelope.data.error.code, 'FORBIDDEN');
});

test('file write round-trips and rejects escapes', async () => {
  const response = await fetch(`${base}/api/file/write`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: 'sub/dir/new.txt', content: 'content-1', approved: true })
  });
  const envelope = Envelope.safeParse(await response.json());
  assert.equal(envelope.success, true);
  if (!envelope.success || !envelope.data.ok) return;
  const payload = FileWriteResponse.safeParse(envelope.data.data);
  assert.equal(payload.success, true);
  if (!payload.success) return;
  assert.equal(payload.data.bytes, 9);
  assert.equal(await fs.readFile(path.join(dir, 'sub', 'dir', 'new.txt'), 'utf8'), 'content-1');

  const bad = await fetch(`${base}/api/file/write`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: '../evil.txt', content: 'x', approved: true })
  });
  const badEnvelope = Envelope.safeParse(await bad.json());
  assert.equal(badEnvelope.success, true);
  if (!badEnvelope.success || badEnvelope.data.ok) return;
  assert.equal(badEnvelope.data.error.code, 'FORBIDDEN');
});

test('file write rejects a body with unknown keys (strict)', async () => {
  const response = await fetch(`${base}/api/file/write`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: 'x.txt', content: 'x', approved: true, extra: 1 })
  });
  const envelope = Envelope.safeParse(await response.json());
  assert.equal(envelope.success, true);
  if (!envelope.success || envelope.data.ok) return;
  assert.equal(envelope.data.error.code, 'BAD_REQUEST');
});
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';
import { WebSocket } from 'ws';
import { ArchServer } from '../../node/src/server.ts';
import { buildRoutes } from '../../node/src/openapi.ts';
import { Envelope } from '../../common/errors.ts';
import { HealthResponse } from '../../common/contracts/health.ts';
import { EventEnvelope } from '../../common/contracts/events.ts';

let dir: string;
let server: ArchServer;
let httpServer: http.Server;
let base: string;
let wsUrl: string;

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-ws-'));
  server = new ArchServer(dir, path.join(dir, '.aide', 'arch-test.log'));
  const routes = await buildRoutes(dir, 'test');
  for (const route of routes) server.route(route);
  httpServer = await server.listen(0);
  const address = httpServer.address();
  assert.ok(address && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}`;
  wsUrl = `ws://127.0.0.1:${address.port}/ws`;
});

after(async () => {
  server.events.close();
  await server.logger.flush();
  httpServer.closeAllConnections();
  await new Promise<void>(resolve => httpServer.close(() => resolve()));
  await fs.rm(dir, { recursive: true, force: true });
});

test('openapi.json is served raw (no envelope) with documented paths', async () => {
  const response = await fetch(`${base}/api/openapi.json`);
  assert.equal(response.status, 200);
  const doc = (await response.json()) as { openapi: string; paths: Record<string, unknown> };
  assert.equal(doc.openapi, '3.0.3');
  assert.ok(doc.paths['/api/health'] !== undefined);
  assert.ok(doc.paths['/api/search'] !== undefined);
});

test('ws client receives log events after subscribing to the log channel', async () => {
  const socket = new WebSocket(wsUrl);
  const received: unknown[] = [];
  const done = new Promise<void>(resolve => {
    socket.on('message', raw => {
      const envelope = EventEnvelope.safeParse(JSON.parse(String(raw)));
      if (!envelope.success || envelope.data.channel !== 'log') return;
      received.push(envelope.data.data);
      if (received.length >= 2) resolve();
    });
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  socket.send(JSON.stringify({ type: 'subscribe', channels: ['log'] }));

  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  const envelope = Envelope.safeParse(await health.json());
  assert.equal(envelope.success, true);
  if (!envelope.success || !envelope.data.ok) return;
  const payload = HealthResponse.safeParse(envelope.data.data);
  assert.equal(payload.success, true);
  if (!payload.success) return;
  assert.equal(payload.data.version, 'test');

  const notFound = await fetch(`${base}/api/nope`);
  assert.equal(notFound.status, 404);

  await Promise.race([done, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out waiting for ws log events')), 5000))]);
  socket.close();

  const logEvents = received as { level: string; message: string; path?: string }[];
  assert.ok(logEvents.some(event => event.message === 'request ok' && event.path === '/api/health'));
  assert.ok(logEvents.some(event => event.level === 'warn' && event.path === '/api/nope'));
});

test('ws client receives nothing on unsubscribed channels', async () => {
  const socket = new WebSocket(wsUrl);
  const received: unknown[] = [];
  socket.on('message', raw => {
    received.push(raw);
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  socket.send(JSON.stringify({ type: 'subscribe', channels: [] }));

  await fetch(`${base}/api/health`);
  await new Promise(resolve => setTimeout(resolve, 300));
  socket.close();
  assert.equal(received.length, 0);
});

test('invalid event payload is never sent (fail closed)', async () => {
  const socket = new WebSocket(wsUrl);
  const received: unknown[] = [];
  socket.on('message', raw => {
    received.push(raw);
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  socket.send(JSON.stringify({ type: 'subscribe', channels: ['log'] }));
  server.events.publish('log', { level: 'bogus' } as never);
  await new Promise(resolve => setTimeout(resolve, 300));
  socket.close();
  assert.equal(received.length, 0);
});
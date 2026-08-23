import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';
import { WebSocket } from 'ws';
import { ArchServer } from '../../node/src/server.ts';
import { buildRoutes } from '../../node/src/openapi.ts';
import { EventEnvelope } from '../../common/contracts/events.ts';
import { eventFixtures } from '../fixtures/index.ts';

let dir: string;
let server: ArchServer;
let httpServer: http.Server;
let wsUrl: string;

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-events-'));
  server = new ArchServer(dir, path.join(dir, '.aide', 'arch-test.log'));
  const routes = await buildRoutes(dir, 'test');
  for (const route of routes) server.route(route);
  httpServer = await server.listen(0);
  const address = httpServer.address();
  assert.ok(address && typeof address === 'object');
  wsUrl = `ws://127.0.0.1:${address.port}/ws`;
});

after(async () => {
  server.events.close();
  await server.logger.flush();
  httpServer.closeAllConnections();
  await new Promise<void>(resolve => httpServer.close(() => resolve()));
  await fs.rm(dir, { recursive: true, force: true });
});

async function subscribe(channel: string): Promise<{ socket: WebSocket; received: unknown[] }> {
  const socket = new WebSocket(wsUrl);
  const received: unknown[] = [];
  socket.on('message', raw => {
    received.push(JSON.parse(String(raw)));
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  socket.send(JSON.stringify({ type: 'subscribe', channels: [channel] }));
  await new Promise(resolve => setTimeout(resolve, 150));
  return { socket, received };
}

const channels: ['log' | 'model' | 'diagnostics' | 'training', keyof typeof eventFixtures][] = [
  ['log', 'log'],
  ['model', 'model'],
  ['diagnostics', 'diagnostics'],
  ['training', 'training']
];

for (const [channel, fixtureKey] of channels) {
  test(`valid ${channel} fixture is broadcast to subscribers and matches the channel schema`, async () => {
    const { socket, received } = await subscribe(channel);
    const valid = eventFixtures[fixtureKey] as Record<string, unknown>;
    server.events.publish(channel, valid.ok);
    await new Promise(resolve => setTimeout(resolve, 300));
    socket.close();
    assert.equal(received.length, 1);
    const envelope = EventEnvelope.safeParse(received[0]);
    assert.equal(envelope.success, true);
    if (!envelope.success) return;
    assert.equal(envelope.data.channel, channel);
    assert.equal(typeof envelope.data.ts, 'number');
    assert.deepEqual(envelope.data.data, valid.ok);
  });

  test(`invalid ${channel} payload is dropped by the send-site (fail closed)`, async () => {
    const { socket, received } = await subscribe(channel);
    server.events.publish(channel, (eventFixtures[fixtureKey] as Record<string, unknown>).invalid as never);
    await new Promise(resolve => setTimeout(resolve, 300));
    socket.close();
    assert.equal(received.length, 0);
  });
}

test('diagnostics fixture variant with zero markers still broadcasts', async () => {
  const { socket, received } = await subscribe('diagnostics');
  server.events.publish('diagnostics', eventFixtures.diagnostics.empty);
  await new Promise(resolve => setTimeout(resolve, 300));
  socket.close();
  assert.equal(received.length, 1);
});

test('training fixture variant without optional loss/epoch still broadcasts', async () => {
  const { socket, received } = await subscribe('training');
  server.events.publish('training', eventFixtures.training.done);
  await new Promise(resolve => setTimeout(resolve, 300));
  socket.close();
  assert.equal(received.length, 1);
});

test('an event published before subscribe is not delivered (no buffering)', async () => {
  const { socket, received } = await subscribe('model');
  socket.close();
  await new Promise(resolve => setTimeout(resolve, 100));
  server.events.publish('model', eventFixtures.model.loading);
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(received.length, 0);
});
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';
import { ArchServer } from '../../node/src/server.ts';

let workspace: string;
let server: ArchServer;
let httpServer: http.Server;
let base: string;

before(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-wb-routes-'));
  server = new ArchServer(workspace, path.join(workspace, 'wb-routes.log'));
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
    try { await fs.rm(workspace, { recursive: true, force: true }); return; }
    catch (error) {
      if (!['EBUSY', 'ENOTEMPTY', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
});

interface Envelope<T = unknown> { ok?: boolean; data?: T; error?: { code: string; message: string; detail?: unknown } }

async function post<T = unknown>(urlPath: string, body: Record<string, unknown>): Promise<{ status: number; envelope: Envelope<T> }> {
  const response = await fetch(`${base}${urlPath}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const envelope = await response.json() as Envelope<T>;
  return { status: response.status, envelope };
}

test('GET /api/workbenches lists the shipped sovereign-coder bundle', async () => {
  const response = await fetch(`${base}/api/workbenches`);
  assert.equal(response.status, 200);
  const json = (await response.json()) as Envelope<{ workbenches: Array<{ id: string; installed: boolean; validated: boolean; online_mcp_count: number }> }>;
  assert.equal(json.ok, true);
  const bundles = json.data?.workbenches ?? [];
  const bundle = bundles.find(b => b.id === 'sovereign-coder');
  assert.ok(bundle, 'sovereign-coder discoverable via the API');
  assert.equal(bundle.installed, false);
  assert.equal(bundle.validated, true);
  assert.equal(bundle.online_mcp_count, 2);
});

test('POST /api/workbenches/install installs and returns the detail with all disabled', async () => {
  const { status, envelope } = await post<{ workbench: { installed: boolean; enabled: boolean; plugins: Array<{ enabled: boolean }> } }>('/api/workbenches/install', { id: 'sovereign-coder' });
  assert.equal(status, 200);
  assert.equal(envelope.ok, true);
  assert.equal(envelope.data?.workbench.installed, true);
  assert.equal(envelope.data?.workbench.enabled, false);
  for (const plugin of envelope.data?.workbench.plugins ?? []) assert.equal(plugin.enabled, false);
});

test('trusting an online server without consent returns FORBIDDEN + CONSENT_REQUIRED', async () => {
  const { status, envelope } = await post<{ workbench: { mcp_servers: Array<{ name: string; trusted: boolean }> } }>('/api/workbenches/trust', { id: 'sovereign-coder', server: 'github', trusted: true });
  assert.equal(status, 403);
  assert.equal(envelope.error?.code, 'FORBIDDEN');
  assert.equal((envelope.error?.detail as { code?: string } | undefined)?.code, 'CONSENT_REQUIRED');
  // Server remains untrusted.
  const { envelope: detail } = await post<{ workbench: { mcp_servers: Array<{ name: string; trusted: boolean }> } }>('/api/workbenches/detail', { id: 'sovereign-coder' });
  const github = detail.data?.workbench.mcp_servers.find(s => s.name === 'github');
  assert.equal(github?.trusted, false);
});

test('trusting an offline server succeeds and the API reports trusted=true', async () => {
  const { status, envelope } = await post<{ workbench: { mcp_servers: Array<{ name: string; trusted: boolean }> } }>('/api/workbenches/trust', { id: 'sovereign-coder', server: 'filesystem', trusted: true });
  assert.equal(status, 200);
  assert.equal(envelope.ok, true);
  const filesystem = envelope.data?.workbench.mcp_servers.find(s => s.name === 'filesystem');
  assert.equal(filesystem?.trusted, true);
});

test('uninstall removes the installed state and a subsequent detail call reports installed=false', async () => {
  const { status, envelope } = await post<{ removed: string }>('/api/workbenches/uninstall', { id: 'sovereign-coder' });
  assert.equal(status, 200);
  assert.equal(envelope.data?.removed, 'sovereign-coder');
  // After uninstall, the bundle stays discoverable; detail reports installed=false.
  const after = await post<{ workbench: { installed: boolean } }>('/api/workbenches/detail', { id: 'sovereign-coder' });
  assert.equal(after.status, 200);
  assert.equal(after.envelope.ok, true);
  assert.equal(after.envelope.data?.workbench.installed, false);
});

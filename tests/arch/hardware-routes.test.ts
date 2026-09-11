import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type http from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ArchServer } from '../../node/src/server.ts';

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-hardware-'));
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

const TIER_RE = /^(S|M|L|XL)$/;
const BACKEND_RE = /^(vulkan|cuda|cpu|apple)$/;

test('hardware profile reports real RAM/CPU/VRAM with tier + backend', async () => {
  const response = await fetch(`${base}/api/hardware/profile`);
  assert.equal(response.status, 200);
  const envelope = (await response.json()) as { ok: boolean; data?: Record<string, unknown> };
  const profile = envelope.data!;
  assert.ok(profile.totalRamBytes as number > 0, 'RAM detected');
  assert.ok(profile.freeRamBytes as number >= 0, 'free RAM is a number');
  assert.ok(profile.logicalCpus as number > 0, 'CPUs detected');
  assert.match(String(profile.tier), TIER_RE, 'valid device tier');
  assert.match(String(profile.backend), BACKEND_RE, 'valid backend');
  assert.match(String(profile.vramSource), /^(nvidia-smi|none)$/);
  assert.ok(typeof profile.detectedAt === 'number' && profile.detectedAt > 0, 'detectedAt timestamp');
});

test('recommend returns exactly three roles with real pack ids and honest fit', async () => {
  const response = await fetch(`${base}/api/hardware/recommend`);
  assert.equal(response.status, 200);
  const envelope = (await response.json()) as {
    ok: boolean;
    data?: {
      device: { tier: string; backend: string; totalRamGb: number; logicalCpus: number; vramMb: number };
      recommendations: Array<{ role: string; modelId: string; name: string; parametersB: number; quant: string; onDisk: boolean; fit: string; reason: string }>;
    };
  };
  const body = envelope.data!;
  const roles = body.recommendations.map(r => r.role).sort();
  assert.deepEqual(roles, ['coder', 'planner', 'reviewer'], 'planner/coder/reviewer present');
  assert.ok(body.recommendations.every(r => r.modelId.length > 0 && r.name.length > 0 && r.reason.length > 0), 'real pack metadata');
  assert.ok(body.recommendations.every(r => typeof r.onDisk === 'boolean'), 'onDisk is honest');
  assert.match(String(body.device.tier), TIER_RE, 'device tier');
  assert.ok(body.device.totalRamGb > 0, 'ram gb reported');

  const byRole = new Map(body.recommendations.map(r => [r.role, r]));
  const planner = byRole.get('planner')!;
  const coder = byRole.get('coder')!;
  const reviewer = byRole.get('reviewer')!;
  assert.ok(planner.parametersB <= coder.parametersB, 'planner is smaller than coder');
  assert.ok(reviewer.parametersB <= coder.parametersB, 'reviewer is smaller than coder');
});

test('profile is stable across calls (deterministic probe data)', async () => {
  const a = (await (await fetch(`${base}/api/hardware/profile`)).json()) as { data: { tier: string; logicalCpus: number; totalRamBytes: number } };
  const b = (await (await fetch(`${base}/api/hardware/profile`)).json()) as { data: { tier: string; logicalCpus: number; totalRamBytes: number } };
  assert.equal(a.data.tier, b.data.tier);
  assert.equal(a.data.logicalCpus, b.data.logicalCpus);
  assert.equal(a.data.totalRamBytes, b.data.totalRamBytes);
});
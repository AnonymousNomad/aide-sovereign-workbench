// tests/arch/helix-wiring-runtime.test.ts
// Proves the FULL helix cascade is wired end-to-end through the real server:
//   X1 spine refresh -> X2 join (patterns.jsonl) -> X3 retention (months/years)
//   driven by GET /api/memory/digests refresh-on-read, and that the
//   system-map helix card reports LIVE from real artifacts (regression for
//   the historical probe that read a nonexistent .aide/memory/helix.jsonl).
// The digests route refreshes durable state, so it carries an exact
// capability.write descriptor and requires operator approval.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type http from 'node:http';
import * as fsModule from 'node:fs';
const fsp = fsModule.promises;
import os from 'node:os';
import path from 'node:path';
import { ArchServer } from '../../node/src/server.ts';
import { routesForMemory, createMemoryService } from '../../node/src/routes/memory.ts';
import { routesForSystemMap } from '../../node/src/routes/system-map.ts';
import { routesForAuthority } from '../../node/src/routes/authority.ts';
import { pairFixture } from './authority-fixture.ts';
import { httpOperationKind } from '../../common/security/operation-policy.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const spine = require('../../harness/memory-spine.mjs');

const local = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
};

async function cleanup(workspace: string, httpServer: http.Server | undefined): Promise<void> {
  const toClose = httpServer;
  if (toClose) await new Promise<void>(resolve => { toClose.close(() => resolve()); });
  for (let attempt = 0; attempt < 10; attempt++) {
    try { await fsp.rm(workspace, { recursive: true, force: true }); break; }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? '';
      if (!['EBUSY', 'ENOTEMPTY', 'EPERM'].includes(code)) throw error;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
}

test("helix cascade: memory digests drives X1+X2+X3, system map reports live", async () => {
  const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), "aide-helix-wire-"));
  // Seed one old day digest (needs approval events to become a P1 pattern
  // and an old date so X3 monthly + X1 day digests coexist).
  const oldDate = '2026-06-15';
  await spine.writeDayDigest(workspace, spine.buildDayDigest(oldDate, [
    { at: '2026-06-15T10:00:00.000Z', kind: 'approval', detail: { tool: 'write_file', pattern: 'write_file', summary: '' } },
    { at: '2026-06-15T10:00:00.000Z', kind: 'approval', detail: { tool: 'write_file', pattern: 'write_file', summary: '' } },
    { at: '2026-06-15T10:00:00.000Z', kind: 'approval', detail: { tool: 'write_file', pattern: 'write_file', summary: '' } },
    { at: '2026-06-15T10:00:00.000Z', kind: 'ship', detail: { message: 'parser hardening batch', files_count: 3 } }
  ]));
  // Regression fixture: the signal-intensity cache must never be counted
  // as an expert manifest by the micro_experts probe.
  await fsp.mkdir(path.join(workspace, '.aide', 'experts'), { recursive: true });
  await fsp.writeFile(path.join(workspace, '.aide', 'experts', 'signals.json'), JSON.stringify({ "orchestrator.intent": { "intensity": 644 } }), 'utf8');
  // Regression fixture: a real agent-loop session (so the card must be live).
  await fsp.mkdir(path.join(workspace, '.aide', 'agent-loop-sessions'), { recursive: true });
  await fsp.writeFile(path.join(workspace, '.aide', 'agent-loop-sessions', 'sess-1.json'), JSON.stringify({ id: 'sess-1' }), 'utf8');

  let httpServer: http.Server | undefined;
  try {
    const server = new ArchServer(workspace, path.join(workspace, "arch-helix.log"));
    for (const route of routesForAuthority()) server.route(route);
    for (const route of routesForMemory(createMemoryService(workspace))) server.route(route);
    for (const route of routesForSystemMap(workspace)) server.route(route);
    httpServer = await server.listen(0);
    const address = httpServer.address();
    assert.ok(address && typeof address === "object");
    const base = "http://127.0.0.1:" + address.port;
    const owner = await pairFixture(server, base);

    // 1. GET /api/memory/digests = the refresh-on-read driver for the cascade,
    //    now authorized as an exact capability.write operation.
    const digestPath = "/api/memory/digests?from=2026-06-01&to=" + local(new Date());
    const headers = await owner.approve('GET', digestPath, undefined, 'task:helix-digests');
    const digestsRes = await owner.request(digestPath, { method: 'GET', headers });
    assert.equal(digestsRes.status, 200);
    const digestEnvelope = await digestsRes.json() as { ok: boolean; data: { digests: Array<{ date: string }> } };
    assert.equal(digestEnvelope.ok, true);
    assert.ok(Array.isArray(digestEnvelope.data.digests));
    assert.ok(digestEnvelope.data.digests.some(d => d.date === '2026-06-15'));

    // 2. The cascade is async (fire-and-forget). Give it room to land.
    let patternsTxt = '';
    for (let i = 0; i < 10; i++) {
      try { patternsTxt = await fsp.readFile(path.join(workspace, '.aide', 'memory', 'patterns.jsonl'), 'utf8'); break; }
      catch { await new Promise(r => setTimeout(r, 250)); }
    }
    assert.ok(patternsTxt.trim().length > 0, "patterns.jsonl must be written by X2 join after digest read");
    assert.ok(patternsTxt.includes('write_file'), "P1 tool-affinity pattern for write_file expected");

    // 3. system map reports the subsystems LIVE from real artifacts.
    const mapRes = await owner.request("/api/system-map/snapshot");
    assert.equal(mapRes.status, 200);
    const mapEnvelope = await mapRes.json() as { ok: boolean; data: { snapshot: { subsystems: Array<{ id: string; state: string; detail: string }> } } };
    assert.equal(mapEnvelope.ok, true);
    const snap = mapEnvelope.data.snapshot.subsystems;
    const helix = snap.find(s => s.id === 'helix_memory');
    assert.ok(helix, "helix_memory card must be present");
    assert.equal(helix.state, 'live', "helix card must report live, got: " + JSON.stringify(helix));
    assert.ok(helix.detail.includes('day digests'), 'helix detail should mention day digests: ' + helix.detail);

    // Signals cache must NOT inflate the expert count (regression for the
    // signals.json-as-manifest bug).
    const experts = snap.find(s => s.id === 'micro_experts');
    assert.ok(experts, "micro_experts card must be present");
    assert.equal(experts.state, 'offline', "no expert manifests in this fixture, card must be honest");
    assert.ok(!experts.detail.includes('signals'), 'experts detail must not count signals.json: ' + experts.detail);

    // agent-loop sessions dir is the real artifact; the card must be live.
    const agentLoop = snap.find(s => s.id === 'agent_loop');
    assert.ok(agentLoop, "agent_loop card must be present");
    assert.equal(agentLoop.state, 'live', "agent_loop must report live from session store, got: " + JSON.stringify(agentLoop));
    assert.ok(agentLoop.detail.includes('1 agent-loop sessions'), 'agent_loop detail should mention session count: ' + agentLoop.detail);

    // 4. READ-ONLY probe correctness: system map never creates state files.
    const aideDir = path.join(workspace, ".aide");
    const aideEntries = await fsp.readdir(aideDir);
    const hasStateFiles = aideEntries.some(f => f.includes("onboarding") || f.includes("system-map-state"));
    assert.equal(hasStateFiles, false, "system map must not write state files");
  } finally {
    await cleanup(workspace, httpServer);
  }
});

test('GET /api/memory/digests is an authority-bound durable operation', async () => {
  const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), 'aide-helix-auth-'));
  const D1 = '2026-07-01';
  const D2 = '2026-07-02';
  await fsp.mkdir(path.join(workspace, '.aide'), { recursive: true });
  const lines: string[] = [];
  for (const date of [D1, D2]) {
    for (let i = 0; i < 3; i++) {
      lines.push(JSON.stringify({ at: `${date}T12:00:00.000Z`, type: 'approval', tool: 'probe_tool', pattern: 'probe_tool', summary: 'x' }));
    }
  }
  await fsp.writeFile(path.join(workspace, '.aide', 'cipher-state.jsonl'), lines.join('\n') + '\n', 'utf8');
  const daysDir = path.join(workspace, '.aide', 'memory', 'days');

  let httpServer: http.Server | undefined;
  try {
    const server = new ArchServer(workspace, path.join(workspace, 'arch-helix-auth.log'));
    for (const route of routesForAuthority()) server.route(route);
    for (const route of routesForMemory(createMemoryService(workspace))) server.route(route);
    httpServer = await server.listen(0);
    const address = httpServer.address();
    assert.ok(address && typeof address === 'object');
    const base = 'http://127.0.0.1:' + address.port;
    const owner = await pairFixture(server, base);
    const token = owner.headers.Authorization.slice(7);

    assert.equal((await fetch(base + '/api/memory/digests')).status, 403, 'anonymous/unpaired access must be denied');

    const blocked = await owner.request(`/api/memory/digests?from=${D1}&to=${D1}`);
    assert.equal(blocked.status, 409, 'missing approval must fail');
    assert.equal(await fsp.readdir(daysDir).catch(() => null), null, 'missing approval must write zero digests');

    const invalid = await owner.request('/api/authority/prepare', {
      method: 'POST',
      body: JSON.stringify({ method: 'GET', path: '/api/memory/digests?from=07/01/2026', task_id: 't' })
    });
    assert.equal(invalid.status, 400, 'invalid date format must fail before authorization');
    const inverted = await owner.request('/api/authority/prepare', {
      method: 'POST',
      body: JSON.stringify({ method: 'GET', path: `/api/memory/digests?from=${D2}&to=${D1}`, task_id: 't' })
    });
    assert.equal(inverted.status, 400, 'inverted range must fail before authorization');

    const path1 = `/api/memory/digests?from=${D1}&to=${D1}`;
    const headers = await owner.approve('GET', path1, undefined, 'task:memory-range');
    const applied = await owner.request(path1, { method: 'GET', headers });
    assert.equal(applied.status, 200, 'approved refresh must execute');
    assert.deepEqual(await fsp.readdir(daysDir), [`${D1}.json`], 'approved refresh must write only the bound range');

    const changed = await owner.request(`/api/memory/digests?from=${D2}&to=${D2}`, { method: 'GET', headers });
    assert.equal(changed.status, 409, 'changed range cannot reuse approval');
    assert.equal(await fsp.stat(path.join(daysDir, `${D2}.json`)).then(() => true).catch(() => false), false);
    const replay = await owner.request(path1, { method: 'GET', headers });
    assert.equal(replay.status, 409, 'consumed approval cannot replay');

    let patterns = '';
    for (let i = 0; i < 10 && patterns.trim().length === 0; i++) {
      patterns = await fsp.readFile(path.join(workspace, '.aide', 'memory', 'patterns.jsonl'), 'utf8').catch(() => '');
      if (patterns.trim().length === 0) await new Promise(r => setTimeout(r, 250));
    }
    assert.ok(patterns.includes('probe_tool'), 'Helix cascade writes must derive from the approved refresh');

    let serialized = '';
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(p);
        else serialized += await fsp.readFile(p, 'utf8').catch(() => '');
      }
    };
    await walk(path.join(workspace, '.aide', 'memory'));
    assert.ok(!serialized.includes(token), 'memory artifacts must not serialize bearer material');
    assert.ok(!serialized.includes(owner.actorId), 'memory artifacts must not serialize actor identity');
    assert.ok(!serialized.includes(headers['X-AIDE-Operation']), 'memory artifacts must not serialize operation ids');

    assert.equal(httpOperationKind('GET', '/api/memory/digests'), null, 'digests route must not be centrally enrolled');
    assert.equal(httpOperationKind('GET', '/api/hardware/profile'), 'capability.read', 'Wave 2 read enrollment stays unchanged elsewhere');
  } finally {
    await cleanup(workspace, httpServer);
  }
});

test('POST /api/memory/digest is an authority-bound workspace operation', async () => {
  const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), 'aide-helix-digest-'));
  const D = '2026-08-01';
  await fsp.mkdir(path.join(workspace, '.aide'), { recursive: true });
  await fsp.writeFile(
    path.join(workspace, '.aide', 'cipher-state.jsonl'),
    JSON.stringify({ at: `${D}T12:00:00.000Z`, type: 'ship', message: 'digest authority probe', files_count: 2 }) + '\n',
    'utf8'
  );
  const daysDir = path.join(workspace, '.aide', 'memory', 'days');

  let httpServer: http.Server | undefined;
  try {
    const server = new ArchServer(workspace, path.join(workspace, 'arch-helix-digest.log'));
    for (const route of routesForAuthority()) server.route(route);
    for (const route of routesForMemory(createMemoryService(workspace))) server.route(route);
    httpServer = await server.listen(0);
    const address = httpServer.address();
    assert.ok(address && typeof address === 'object');
    const base = 'http://127.0.0.1:' + address.port;
    const owner = await pairFixture(server, base);

    const anonymous = await fetch(base + '/api/memory/digest', { method: 'POST' });
    assert.equal(anonymous.status, 403, 'anonymous/unpaired access denied');

    const blocked = await owner.request('/api/memory/digest', { method: 'POST' });
    assert.equal(blocked.status, 409, 'missing approval must fail');
    assert.equal(await fsp.readdir(daysDir).catch(() => null), null, 'no digests written without approval');

    const headers = await owner.approve('POST', '/api/memory/digest', undefined, 'task:digest');
    const applied = await owner.request('/api/memory/digest', { method: 'POST', headers });
    assert.equal(applied.status, 200);
    const appliedBody = (await applied.json()) as { ok: boolean; data: { refreshed: string[] } };
    assert.ok(appliedBody.data.refreshed.includes(D), 'approved digest refresh covers the seeded date');
    const digestRaw = await fsp.readFile(path.join(daysDir, `${D}.json`), 'utf8');
    assert.match(digestRaw, /digest authority probe/);

    const replay = await owner.request('/api/memory/digest', { method: 'POST', headers });
    assert.equal(replay.status, 409, 'consumed digest approval cannot replay');

    const token = owner.headers.Authorization.slice(7);
    assert.ok(!digestRaw.includes(token) && !digestRaw.includes(owner.actorId), 'digest artifacts must not serialize authority material');
  } finally {
    await cleanup(workspace, httpServer);
  }
});

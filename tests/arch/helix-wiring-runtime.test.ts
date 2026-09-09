// tests/arch/helix-wiring-runtime.test.ts
// Proves the FULL helix cascade is wired end-to-end through the real server:
//   X1 spine refresh -> X2 join (patterns.jsonl) -> X3 retention (months/years)
//   driven by GET /api/memory/digests refresh-on-read, and that the
//   system-map helix card reports LIVE from real artifacts (regression for
//   the historical probe that read a nonexistent .aide/memory/helix.jsonl).
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
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const spine = require('../../harness/memory-spine.mjs');

const local = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
};

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
  let base = "";
  try {
    const server = new ArchServer(workspace, path.join(workspace, "arch-helix.log"));
    for (const route of routesForMemory(createMemoryService(workspace))) server.route(route);
    for (const route of routesForSystemMap(workspace)) server.route(route);
    httpServer = await server.listen(0);
    const address = httpServer.address();
    assert.ok(address && typeof address === "object");
    base = "http://127.0.0.1:" + address.port;

    // 1. GET /api/memory/digests = the refresh-on-read driver for the cascade.
    const digestsRes = await fetch(base + "/api/memory/digests?from=2026-06-01&to=" + local(new Date()));
    assert.equal(digestsRes.status, 200);
    const digestEnvelope = await digestsRes.json();
    assert.equal(digestEnvelope.ok, true);
    assert.ok(Array.isArray(digestEnvelope.data.digests));
    assert.ok(digestEnvelope.data.digests.some((d: { date: string }) => d.date === '2026-06-15'));

    // 2. The cascade is async (fire-and-forget). Give it room to land.
    let patternsTxt = '';
    for (let i = 0; i < 10; i++) {
      try { patternsTxt = await fsp.readFile(path.join(workspace, '.aide', 'memory', 'patterns.jsonl'), 'utf8'); break; }
      catch { await new Promise(r => setTimeout(r, 250)); }
    }
    assert.ok(patternsTxt.trim().length > 0, "patterns.jsonl must be written by X2 join after digest read");
    assert.ok(patternsTxt.includes('write_file'), "P1 tool-affinity pattern for write_file expected");

    // 3. system map reports the subsystems LIVE from real artifacts.
    const mapRes = await fetch(base + "/api/system-map/snapshot");
    assert.equal(mapRes.status, 200);
    const mapEnvelope = await mapRes.json();
    assert.equal(mapEnvelope.ok, true);
    const snap = mapEnvelope.data.snapshot.subsystems;
    const helix = snap.find((s: { id: string }) => s.id === 'helix_memory');
    assert.ok(helix, "helix_memory card must be present");
    assert.equal(helix.state, 'live', "helix card must report live, got: " + JSON.stringify(helix));
    assert.ok(helix.detail.includes('day digests'), 'helix detail should mention day digests: ' + helix.detail);

    // Signals cache must NOT inflate the expert count (regression for the
    // signals.json-as-manifest bug).
    const experts = snap.find((s: { id: string }) => s.id === 'micro_experts');
    assert.ok(experts, "micro_experts card must be present");
    assert.equal(experts.state, 'offline', "no expert manifests in this fixture, card must be honest");
    assert.ok(!experts.detail.includes('signals'), 'experts detail must not count signals.json: ' + experts.detail);

    // agent-loop sessions dir is the real artifact; the card must be live.
    const agentLoop = snap.find((s: { id: string }) => s.id === 'agent_loop');
    assert.ok(agentLoop, "agent_loop card must be present");
    assert.equal(agentLoop.state, 'live', "agent_loop must report live from session store, got: " + JSON.stringify(agentLoop));
    assert.ok(agentLoop.detail.includes('1 agent-loop sessions'), 'agent_loop detail should mention session count: ' + agentLoop.detail);

    // 4. READ-ONLY probe correctness: system map never creates state files.
    const aideDir = path.join(workspace, ".aide");
    const aideEntries = await fsp.readdir(aideDir);
    const hasStateFiles = aideEntries.some(f => f.includes("onboarding") || f.includes("system-map-state"));
    assert.equal(hasStateFiles, false, "system map must not write state files");
  } finally {
    const toClose = httpServer;
    if (toClose) {
      await new Promise<void>(resolve => { toClose.close(() => resolve()); });
    }
    for (let attempt = 0; attempt < 10; attempt++) {
      try { await fsp.rm(workspace, { recursive: true, force: true }); break; }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code ?? "";
        if (!["EBUSY", "ENOTEMPTY", "EPERM"].includes(code)) throw error;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }
});

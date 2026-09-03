// tests/arch/system-map-runtime.test.ts (cline/T4, 2026-09-03)
// PR A of aide-system-map. End-to-end: real server, 1 snapshot route,
// the 8 subsystem cards all present, read-only, snapshot shape strict.
// ONE aggregated test() per the runner-proven shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type http from 'node:http';
import * as fsModule from 'node:fs';
const fsp = fsModule.promises;
import os from 'node:os';
import path from 'node:path';
import { ArchServer } from '../../node/src/server.ts';
import { routesForSystemMap } from '../../node/src/routes/system-map.ts';
import { SystemMapSnapshot } from '../../common/contracts/system-map.ts';

test("system map: snapshot route returns all 8 subsystems (PR A)", async () => {
  const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), "aide-sysmap-"));
  let httpServer;
  let base = "";
  try {
    const server = new ArchServer(workspace, path.join(workspace, "arch-sysmap.log"));
    for (const route of routesForSystemMap(workspace)) server.route(route);
    httpServer = await server.listen(0);
    const address = httpServer.address();
    assert.ok(address && typeof address === "object");
    base = "http://127.0.0.1:" + address.port;

    // 1. GET snapshot returns 200 with a valid envelope.
    const response = await fetch(base + "/api/system-map/snapshot");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);

    // 2. The snapshot parses against the strict zod contract.
    const snapshot = SystemMapSnapshot.parse(body.data.snapshot);
    assert.equal(snapshot.subsystems.length, 8);

    // 3. The 8 card ids are present.
    const ids = snapshot.subsystems.map(s => s.id);
    for (const id of ["inhouse_model", "workbenches", "skills", "agent_loop", "micro_experts", "helix_memory", "veritas_selfheal", "byok_desktop"]) {
      assert.ok(ids.includes(id), "missing subsystem: " + id);
    }

    // 4. READ-ONLY: the workspace has no new state files (only the log).
    const aideDir = path.join(workspace, ".aide");
    let aideEntries = [];
    try { aideEntries = await fsp.readdir(aideDir); } catch { /* none */ }
    const hasStateFiles = aideEntries.some(f => f.includes("onboarding") || f.includes("system-map-state"));
    assert.equal(hasStateFiles, false, "system map must not write state files");

    // 5. Resilience: a second snapshot call works (no caching issues).
    const response2 = await fetch(base + "/api/system-map/snapshot");
    assert.equal(response2.status, 200);
  } finally {
    if (httpServer) {
      await new Promise(resolve => {
        httpServer.closeAllConnections ? httpServer.closeAllConnections() : null;
        httpServer.close(() => resolve());
      });
    }
    for (let attempt = 0; attempt < 10; attempt++) {
      try { await fsp.rm(workspace, { recursive: true, force: true }); break; }
      catch (error) {
        const code = error && error.code ? error.code : "";
        if (!["EBUSY", "ENOTEMPTY", "EPERM"].includes(code)) throw error;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }
});

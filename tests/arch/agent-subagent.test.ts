// tests/arch/agent-subagent.test.ts (cline/T4, 2026-09-02 R8-rebuild)
// Subagent dispatch surface tests (aide-subagent-dispatch skill, PR A).
// One aggregated test() matching the runner-proven shape.
// Note: the prior version was structurally corrupt; this is a clean rewrite.
// Run: node --experimental-strip-types --no-warnings --test --test-force-exit tests/arch/agent-subagent.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type http from "node:http";
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ArchServer } from "../../node/src/server.ts";
import { pairFixture } from "./authority-fixture.ts";
import {
  AgentSubagentRole,
  AgentSubagentToolPolicy,
  AgentSubagentSpawnRequest,
  AgentSubagentStatus
} from "../../common/contracts/agent.ts";
import type { AgentSubagentSpawnResponseT, AgentSubagentListResponseT } from "../../common/contracts/agent.ts";
import { routesForAgentSubagent } from "../../node/src/routes/agent.ts";

type Envelope<T> = { ok: boolean; data?: T; error?: { code: string; message: string } };

let owner: Awaited<ReturnType<typeof pairFixture>>;

async function post<T>(_base: string, pathName: string, payload: unknown): Promise<{ status: number; body: Envelope<T> }> {
  const response = await owner.request(pathName, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  return { status: response.status, body: (await response.json()) as Envelope<T> };
}

async function get<T>(_base: string, pathName: string): Promise<{ status: number; body: Envelope<T> }> {
  const response = await owner.request(pathName);
  return { status: response.status, body: (await response.json()) as Envelope<T> };
}

test("subagent dispatch: contracts + routes + integration shape (PR A)", async () => {
  // 1. Contract: tool policy defaults deny everything except read+search.
  const policy = AgentSubagentToolPolicy.parse({});
  assert.equal(policy.allow_read, true);
  assert.equal(policy.allow_search, true);
  assert.equal(policy.allow_write, false);
  assert.equal(policy.allow_edit, false);
  assert.equal(policy.allow_run_command, false);
  assert.equal(policy.allow_subagent_spawn, false);
  assert.equal(policy.allow_desktop, false);
  assert.equal(policy.allow_provider, false);
  assert.equal(policy.allow_network, false);
  assert.equal(policy.max_iterations, 8);
  assert.equal(policy.max_mistakes, 3);

  // 2. Contract: spawn request requires minimum fields.
  assert.throws(() => AgentSubagentSpawnRequest.parse({}), /parent_session_id|task|role/);
  assert.throws(() => AgentSubagentSpawnRequest.parse({ parent_session_id: "p1", task: "t1" }), /role/);

  // 3. Contract: role is one of 6 values.
  assert.throws(() => AgentSubagentRole.parse("hacker"));
  for (const role of ["researcher", "coder", "tester", "reviewer", "documenter", "custom"]) {
    assert.equal(AgentSubagentRole.parse(role), role);
  }

  // 4. Contract: status parses the full shape.
  const statusParsed = AgentSubagentStatus.parse({
    child_session_id: "c1",
    parent_session_id: "p1",
    role: "researcher",
    status: "done",
    iterations: 4,
    mistake_count: 0,
    files_changed: ["a.ts", "b.ts"],
    result_summary: "investigated the request",
    evidence: [{ kind: "grep", ref: "src/foo.ts", ok: true }],
    started_at: 1000,
    ended_at: 2000
  });
  assert.equal(statusParsed.files_changed.length, 2);
  assert.equal(statusParsed.evidence.length, 1);
  assert.equal(statusParsed.ended_at, 2000);

  // 5. Spin up a real server with the 4 routes wired.
  const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), "aide-subagent-arch-"));
  let httpServer: http.Server | undefined;
  let base = "";
  try {
    const server = new ArchServer(workspace, path.join(workspace, "arch-subagent.log"));
    for (const route of routesForAgentSubagent(null)) server.route(route);
    httpServer = await server.listen(0);
    const address = httpServer.address();
    assert.ok(address && typeof address === "object");
    base = "http://127.0.0.1:" + (address as { port: number }).port;
    owner = await pairFixture(server, base);
  
    // 6. Route: POST spawn is fail-closed at the authority edge — the route
    // has no authority policy, so no caller can authorize a spawn today.
    const spawnResult = await post<AgentSubagentSpawnResponseT>(base, "/api/agent/subagent", {
      parent_session_id: "parent-abc",
      task: "investigate the bug in parser.mjs",
      role: "researcher"
    });
    assert.equal(spawnResult.status, 403);
    assert.equal(spawnResult.body.ok, false);
    assert.equal(spawnResult.body.error?.code, "FORBIDDEN");
  
    // 7. Route: GET list is fail-closed too — the subagent family has no
    // authority policy yet, so even reads deny before the handler.
    const listResult = await get<AgentSubagentListResponseT>(base, "/api/agent/subagent?parent_session_id=parent-abc");
    assert.equal(listResult.status, 403);
    assert.equal(listResult.body.ok, false);
    assert.equal(listResult.body.error?.code, "FORBIDDEN");

    // 8. Route: GET status is likewise denied before request validation.
    const statusNoChild = await get(base, "/api/agent/subagent/status");
    assert.equal(statusNoChild.status, 400);
    assert.equal(statusNoChild.body.ok, false);

    // 9. Route: GET status with a child id denies identically.
    const statusNotReady = await get(base, "/api/agent/subagent/status?child_session_id=c-abc");
    assert.equal(statusNotReady.status, 403);
    assert.equal(statusNotReady.body.ok, false);
    assert.equal(statusNotReady.body.error?.code, "FORBIDDEN");

    // 10. Integration: the whole not-ready surface stays fail-closed.
    const spawnInt = await post(base, "/api/agent/subagent", {
      parent_session_id: "p-int",
      task: "find all uses of foo() in src/",
      role: "researcher",
      policy: { allow_write: false, allow_edit: false, max_iterations: 4 }
    });
    assert.equal(spawnInt.status, 403);
    const listInt = await get<{ subagents: unknown[] }>(base, "/api/agent/subagent?parent_session_id=p-int");
    assert.equal(listInt.status, 403);
    const statusInt = await get(base, "/api/agent/subagent/status?child_session_id=c-int");
    assert.equal(statusInt.status, 403);
  } finally {
    // Rely on the http-close-shim (loaded via --import in CI and local runs):
    // patched close() calls closeAllConnections() first. An explicit
    // closeAllConnections() here would double-close under the shim and can
    // trigger the libuv UV_HANDLE_CLOSING native assert on Windows.
    const toClose = httpServer;
    if (toClose) {
      await new Promise<void>((resolve) => {
        toClose.close(() => resolve());
      });
    }
    for (let attempt = 0; attempt < 10; attempt++) {
      try { await fsp.rm(workspace, { recursive: true, force: true }); break; }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code ?? "";
        if (!["EBUSY", "ENOTEMPTY", "EPERM"].includes(code)) throw error;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }
});

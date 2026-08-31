---
name: aide-subagent-dispatch
description: The AIDE pattern for spawning specialized sub-agents from a parent agent session — a child AgentLoopService with narrowed tool policy, its own scratch dir, the parent's session as context, and a return-as-tool-result contract. Use when implementing the /api/agent/subagent route, when designing parallel subagent dispatch in the agent loop, when reviewing subagent scoping, when debugging "subagent didn't return" or "subagent has too much privilege", and when wiring the Anthropic Task tool / Cursor Subagents / Cline Agent Teams parity surface for AIDE. Built on top of aide-agent-harness-convergence, aide-iron-suit-orchestrator (restraint ladder), aide-credo-guardrail, and aide-cipher-house-model.
---

# Subagent Dispatch — Child Agent Sessions, Narrowed Scope, Tool-Result Return

Born 2026-08-31 from the wiring audit. AIDE has every primitive a subagent needs (AgentLoopService, agent contracts, event hub, memory spine, veritas gates) but the spawn verb is missing. The 6-rival audit (Cursor, Claude Code, Cline, Windsurf/Devin, Copilot, Replit) all converge on "subagent" as table-stakes. This skill IS the wire-in: contracts, dispatch surface, scoping, return contract, tests.

## Why this matters (the user is right)

Per `aide-workflow-gap-roadmap` Gap #2: any task that touches >5 files is a subagent job today. AIDE's agent loop has an 80-message cap and serial execution. Subagents are the only way to scale. Per the user directive 2026-08-31: "if we don't have the skill it tells us how to wire it" — this is that skill.

## The AIDE subagent contract (4 hard rules)

1. **Subagent = a real AgentLoopService instance**, not a thread, not a coroutine. Same code path as the parent, with a narrowed `toolPolicy` and the parent's session_id as the parent ref. The two runtimes doctrine (arch + legacy) applies: a fix that lands in one and not the other is a regression waiting to happen.
2. **Parent → child = `subagent_spawn` tool call**, not a chat message. The child returns a summary as a `tool_result` event the parent can use. The parent's transcript never sees the child's transcript; the child never sees the parent's transcript. The connection is one tool call + one tool result.
3. **Tool policy is narrowed by default-deny**. The parent declares which tools the child may use. The child cannot call `subagent_spawn` (no grandchildren by default), `desktop_*` (no desktop control), or `provider_*` (no cloud). The child CAN call read tools, scoped write tools, and the search/index tools. Narrower is safer.
4. **Return shape is the Veritas-friendly form**: `{ ok, summary, files_changed, errors, evidence[] }`. The parent ingests this as a tool result, not as a chat message. The Veritas gate scores on the `evidence[]` array.



## Files to touch (when wiring this skill)

| File | Change |
|---|---|
| `common/contracts/agent.ts` | ADD `AgentSubagentSpawnRequest`, `AgentSubagentSpawnResponse`, `AgentSubagentStatus` zod schemas. STRICT. |
| `node/src/services/agent-loop.mjs` | EXTEND `createAgentLoop` to accept a `subagentPolicy` and a `parentSessionId`. When set, the loop refuses tools outside the policy and emits the new `subagent_done` event. |
| `node/src/services/agent-loop.d.mts` | UPDATE the type signature to include the new opts. |
| `node/src/routes/agent.ts` | ADD `POST /api/agent/subagent` (spawn), `GET /api/agent/subagent` (list), `GET /api/agent/subagent/status` (one). The existing `/api/agent/*` namespace absorbs them. |
| `tests/arch/agent-subagent.test.ts` | NEW: 6 tests (the threat matrix below). |
| `scripts/aide-bundle.cjs` | (optional) add a `subagent` command for CLI. |
| `browser/src/...` | (optional) the cockpit can show "Parent spawned 3 subagents" as a status row. |

## The contract (zod-strict, copied from existing pattern)

```ts
// in common/contracts/agent.ts

export const AgentSubagentToolPolicy = z.object({
  allow_read: z.boolean().default(true),
  allow_search: z.boolean().default(true),
  allow_write: z.boolean().default(false),  // false by default-deny
  allow_edit: z.boolean().default(false),   // false by default-deny
  allow_run_command: z.boolean().default(false),
  allow_subagent_spawn: z.boolean().default(false),  // no grandchildren
  allow_desktop: z.boolean().default(false),
  allow_provider: z.boolean().default(false),
  allow_network: z.boolean().default(false),
  max_iterations: z.number().int().gte(1).lte(20).default(8),
  max_mistakes: z.number().int().gte(1).lte(5).default(3),
  workspace_jail: z.string().regex(/^[a-z0-9_\-\/]{1,128}$/).optional()
}).strict();

export const AgentSubagentSpawnRequest = z.object({
  parent_session_id: z.string().min(1),
  task: z.string().min(1).max(8000),
  role: z.enum(['researcher', 'coder', 'tester', 'reviewer', 'documenter', 'custom']),
  policy: AgentSubagentToolPolicy.optional(),
  model: z.string().min(1).max(128).optional(),
  scratch_dir: z.string().regex(/^[a-z0-9_\-\/]{1,128}$/).optional()
}).strict();

export const AgentSubagentSpawnResponse = z.object({
  child_session_id: z.string().min(1),
  parent_session_id: z.string().min(1),
  role: z.string(),
  status: z.enum(['spawned', 'running', 'done', 'aborted', 'error'])
}).strict();

export const AgentSubagentStatus = z.object({
  child_session_id: z.string().min(1),
  parent_session_id: z.string().min(1),
  role: z.string(),
  status: z.enum(['running', 'done', 'aborted', 'error']),
  iterations: z.number().int().gte(0),
  mistake_count: z.number().int().gte(0),
  files_changed: z.array(z.string()),
  result_summary: z.string(),
  evidence: z.array(z.object({ kind: z.string(), ref: z.string(), ok: z.boolean() })),
  started_at: z.number().int(),
  ended_at: z.number().int().nullable()
}).strict();
```



## The loop integration (in `agent-loop.mjs`)

```js
// Inside the existing tool dispatch, add a new tool type:
if (tool === 'subagent_spawn') {
  // 1. Parse the spawn request (schema-validated)
  // 2. Verify the parent's policy ALLOWS subagent_spawn
  //    (the parent declared its own policy; if it didn't, false)
  // 3. Create the child AgentLoopService with:
  //    - workspace: parent's scratch_dir (created if missing)
  //    - chatFn: same parent's chatFn (or a sub-model)
  //    - maxIterations / maxMistakes: from the child's policy
  //    - subagentPolicy: from the spawn request
  //    - parentSessionId: for the spine event chain
  // 4. Start the child loop
  // 5. Await the child to terminal state (with a hard timeout, e.g. 5 min)
  // 6. Build the AgentSubagentStatus (the return shape)
  // 7. Return as a tool_result
  // 8. Spine event: kind='subagent_done', detail={parent, child, files, evidence}
  // 9. CRITICAL: do NOT inject the child's transcript into the parent's
  //    transcript. The summary is the only thing the parent sees.
}
```

## Default policies (the safest default per role)

| Role | read | search | write | edit | run_cmd | subagent | desktop | provider |
|---|---|---|---|---|---|---|---|---|
| researcher | yes | yes | no | no | no | no | no | no |
| coder | yes | yes | yes (jail) | yes (jail) | no | no | no | no |

## Threat matrix (the tests must cover these)

| Threat | Test | Pass criterion |
|---|---|---|
| Child uses tool outside policy | Inject `run_command` call from a tester-role subagent | tool_result.ok=false, status='error', error='POLICY_DENIED' |
| Child's transcript leaks into parent | Spawn a child that says secret phrase, run a final tool call from parent | parent's transcript does NOT contain the secret phrase (only the summary) |
| Grandchild via child | Child tries to call `subagent_spawn` with allow_subagent_spawn=false | rejected with POLICY_DENIED |
| Child writes outside scratch_dir | Child writes to a path outside `scratch_dir` | sandbox.mjs rejects, tool_result.ok=false |
| Parent ignores the result (no ev chain) | Spawn a child, complete a parent tool call afterward | spine has 1 subagent_done event after the parent tool_result |
| Runaway child (infinite loop) | Set max_iterations=2, child loops | status='aborted' at iteration 2, no infinite hang |

## Existing assets this skill USES (no new work, just wire)

- `node/src/services/agent-loop.mjs` → `createAgentLoop(options)` (the parent loop, 1.5K+ lines, has all the loop logic)
- `common/contracts/agent.ts` → existing `AgentStartRequest` / `AgentStreamEvent` patterns
- `harness/sandbox.mjs` → path-jail enforcement (use the existing `resolveInsideWorkspace` helper)
- `harness/cipher-state.mjs` → the event spine (append a `subagent_done` event kind)
- `harness/veritas.mjs` → `evaluateVeritas` for the evidence array scoring
- `tests/arch/agent-architect-editor.test.ts` → the test pattern (uses `createRequire`, `freshDir`, `waitForTerminalState`)

## Pitfalls (each one cost real time when I planned this)

- **Do NOT inject the child's transcript into the parent's.** The child's transcript is the child's context. The parent only sees the summary. If you inject the child's messages, you double-bill the parent on context, and the parent may try to "continue" the child's conversation.
- **Do NOT let the child call `subagent_spawn` by default.** A subagent spawning a subagent is the start of a runaway tree. Default-deny.
- **Do NOT block on the child synchronously in the request handler.** The dispatch is async; the child runs on its own timer. The parent gets the result when the child terminates (or on its own `subagent_done` event).
- **Do NOT use the parent's chatFn for the child if the role needs a different model.** The spawn request includes `model` for this reason. If absent, inherit the parent's. Never silently default to a model.
- **Do NOT skip the Veritas gate on the child's evidence array.** The parent's gate decides whether to TRUST the child's return. A child that says "done, no errors, no evidence" should NOT pass.

## The rollout (3 PRs)

### PR A — Contracts + dispatch surface (this turn)
- Add the 4 zod schemas to `common/contracts/agent.ts`
- Regenerate `common/openapi.json` via `node scripts/contracts.mjs`
- Add `routesForAgentSubagent` to `node/src/routes/agent.ts` (3 routes: spawn, list, status)
- Add the route wiring to `node/src/server.ts` (or wherever the routes aggregator lives)
- 6 arch tests in `tests/arch/agent-subagent.test.ts`
- Commit: `feat(agent): subagent dispatch surface (PR A of aide-subagent-dispatch)`

### PR B — Runtime integration
- Modify `agent-loop.mjs` to dispatch via `subagent_spawn` tool
- Add the parent-context inheritance (read parent session metadata, pass to child)
- Add the spine event emission
- 3 more arch tests
- Commit: `feat(agent): subagent runtime dispatch (PR B of aide-subagent-dispatch)`

### PR C — UI surface + bundle bridge
- Add the cockpit status row (parent shows N subagents running)
- Add the `aide-bundle.cjs subagent` command
- 1 e2e test
- Commit: `feat(ui): subagent status row in cockpit`

## Why this skill format

This skill IS the wire-in. Anyone can read this file, see the contracts, the files to touch, the tests, the threat matrix, and ship it. The skill is the SOP; the code is the execution. The 6-rival audit, the gap analysis, and the doctrine all live here so the next person doesn't have to re-research.

## References

- `aide-agent-harness-convergence` — the convergence doctrine (subagent is "a request with narrowed toolPolicy")
- `aide-iron-suit-orchestrator` — the restraint ladder (Agent Skill → Subagent → Multi-agent → Dynamic Workflow)
- `aide-credo-guardrail` — the credo + 5 oaths (subagent must inherit, never override)
- `aide-workflow-gap-roadmap` — Gap #2 (subagents as #1 rival parity)
- `aide-architect-editor-implementation` — sibling skill showing the test pattern
- Cursor Subagents, Claude Task tool, Cline Agent Teams, Copilot Subagents, Windsurf Simultaneous Cascades — the rivals this matches

| tester | yes | yes | yes (jail) | no | yes (test only) | no | no | no |
| reviewer | yes | yes | no | no | no | no | no | no |
| documenter | yes | yes | yes (jail) | no | no | no | no | no |
| custom | per-request | per-request | per-request | per-request | per-request | no default | no | no |

`jail` means the path must be inside the child's `scratch_dir` (the subagent workspace). The harness sandbox.mjs is the path-jail enforcer.

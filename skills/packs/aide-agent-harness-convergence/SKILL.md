---
name: aide-agent-harness-convergence
description: Converge AIDE's three parallel agent runtimes (legacy daemon model-manager chat + harness/orchestrator.mjs, arch-ts model-router/chat.ts + routes/agent.ts, academy/experts paths) into ONE first-class agent harness contract with VS Code 2026 parity — plan mode, permission slider, hooks, subagents, sessions/handoff, memory, tool registry, sandboxed execution — keeping the twin-orchestrator doctrine (fix both or neither). Use when improving the harness/orchestrator, adding agent modes (plan/act), wiring hooks or permission levels, building subagents, diagnosing "two orchestrators behave differently", or any change to how AIDE runs multi-step model tool loops.
---

# Agent Harness Convergence — One Harness, Three Fronts, VS Code Parity

Born 2026-08-27 gap analysis: AIDE runs THREE agent-ish runtimes without a
shared contract: (1) harness/orchestrator.mjs (mjs, test-orchestrated), (2)
arch-ts model-router.ts + chat.ts + routes/agent.ts (serves the UI), (3) legacy
daemon model-manager.chat with its own best-of-N + scaffold + drift logic. VS
Code 2026 (researched 08-27) made "agent harnesses" a FIRST-CLASS user concept:
plan work, memory, subagents, sessions & handoff, tools, hooks, plugins,
permission levels, OS-level sandboxing, review & revert. AIDE has every PIECE
(sandbox loop, memory spine, handoff, sessions, veritas gates, cipher-state
bus) but no single contract — and the twin-orchestrator doctrine says a fix
landing in one runtime and not the others is how the 409 bug lived for days.

## Research base (verified 2026-08-27)

1. VS Code agents docs (retrieved 2026-08-27): Agent Harnesses, Tools,
   Sessions & Handoff, Plan Work, Memory, Subagents, Review & Revert Changes,
   Approvals & Permissions, Hooks Reference, OpenTelemetry monitoring —
   the full 2026 parity surface.
2. Cursor 2026: Plans, Mission Control (multi-agent oversight), background
   cloud agents, rules files, checkpoints — the autonomy-slider framing
   ("Cmd+K targeted edits, or let it rip") is the UX ideal.
3. In-repo assets to converge: harness/orchestrator.mjs + sandbox.mjs
   (materialize/apply/verify/atomic), memory-spine + memory-blocks, veritas
   gates, cipher-state bus, sessions + handoff managers, blueprint, workflow,
   operators — built, tested, DISCONNECTED from each other.

## What to do (direct)

1. DEFINE THE HARNESS CONTRACT first (common/contracts/harness.ts): one
   request shape (goal, plan?, toolPolicy, permissionLevel, memory on/off),
   one event stream (plan, tool_call, tool_result, patch, verify, done) —
   both runtimes implement it; the UI renders the stream, never internals.
2. PERMISSION SLIDER (3 levels): read-only / workspace-write (jailed, gated) /
   full (desktop ops + network: explicit approval + egress audit). The slider
   is metadata on the request; every tool consults it BEFORE its own gate.
3. PLAN MODE: orchestrator gains a plan phase that emits the event stream with
   NO tool execution; UI shows the plan; "approve" re-submits as act. No new
   model path — same loop, toolPolicy=none.
4. HOOKS: pre-tool / post-tool / pre-apply / post-verify hook points read from
   harness/policy.json (exists) — repo-local, jailed, and they MUST NOT bypass
   approval gates (hook output can veto, never execute).
5. SUBAGENTS: a subagent = harness request with narrowed toolPolicy + the
   parent's scratch dir; results return as tool_result events, never as chat
   messages. Cipher-state bus stays the memory substrate.
6. CONVERGE EXECUTION: sandbox.mjs remains the ONLY patch/verify engine
   (single-implementation law); model-router and legacy chat call it; delete
   divergent copies rather than syncing them.

## Why it's done this way

- The 409 incident proved twin runtimes drift: arch and legacy paths had
  different spawn semantics and the unfixed one reintroduced the bug. A shared
  CONTRACT (not shared code — processes stay separate) is the only convergence
  that respects the process isolation that saved us.
- VS Code's 2026 surface is the market's definition of "agent IDE"; parity is
  the roadmap, and every parity item maps to an existing AIDE asset — this is
  wiring, not invention.
- The permission slider exists in fragments (desktop grants, git approval,
  agent gates); one slider field makes the safety model legible to operators.

## Dependencies / issues / bugs

- Depends on: sandbox.mjs (verify/atomic apply), memory-spine/blocks, veritas
  gates, sessions + handoff managers, events bus, contracts pattern
  (common/contracts/*, zod), harness/policy.json.
- Known repo bug-class: twin drift (this skill exists because of it); the arch
  test suite is the guardrail — contract changes need BOTH sides' tests green
  in the same commit.
- Daemon + arch-ts need restarts after contract changes (no hot reload).
- Event latency: batch contract events per tick; never emit per-token on WS.

## Threat matrix

| Threat | Signature | Defense |
|---|---|---|
| Twin drift reintroduces fixed bugs | one path fixed, other regresses | contract tests in BOTH suites, same commit; twin-orchestrator law |
| Plan-mode bypass | "plan" turns into execution via tool access | toolPolicy=none enforced by the loop, not by prompt; tools consult slider |
| Hook abuse as escape hatch | repo hook executes arbitrary commands | hooks jailed, cannot bypass approvals, output vetoes only |
| Subagent privilege creep | child inherits parent's full toolPolicy | narrowed policy is a mandatory field; default-deny |
| Memory poisoning across sessions | poisoned cipher-state persists into future tasks | cipher-state = approved patterns only; veritas gates on write |
| Approval fatigue exploit | operator rubber-stamps gates | noisy safe ops grouped under read-only; dangerous ops always individual |
| Event-stream flooding | UI freezes on huge diffs | batch + cap payloads; summary events, full diff on demand |

## Pitfalls

- Do NOT merge the runtimes into one process — process isolation is a proven
  survival trait here (see aide-engine-lifecycle-doctrine).
- Do NOT add a fourth runtime — converge, never fork.
- Do NOT let the UI talk to tools directly; the loop owns tool dispatch.
- Do NOT store plan/approval state only in the UI — sessions + handoff must
  survive restarts (they exist; use them).
- Do NOT copy VS Code terminology where AIDE concepts differ — map honestly,
  document gaps.

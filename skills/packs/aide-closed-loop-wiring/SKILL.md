---
name: aide-closed-loop-wiring
description: Wire AIDE's self-improvement loop (`scripts/selfimprove.mjs`) into the daemon lifecycle so it runs continuously, not only on manual invocation. Verifies the closed-loop wiring: audit emits in the agent loop (approval/rejection/abort), the daemon boot + periodic spawn schedule, the read-only /api/closed-loop/status contract, the hermetic AIDE_SELFIMPROVE_ROOT test override, and the Windows-safe verification battery (346/346 arch tests). Use whenever wiring or debugging the closed-loop schedule, adding a model to the loop, diagnosing "closed loop never runs", auditing the audit-emit coverage in agent-loop.mjs, or reproducing the Windows native-abort trap in node:test. Research-grounded on Auto-Dreamer, CLaaS, Sleep-Time Compute.
---

# AIDE Closed-Loop Wiring — Verified Wire-In Recipe

## Status: VERIFIED (2026-09-08)

- `scripts/selfimprove.mjs` runs OBSERVE -> DETECT -> CLUSTER -> ROUTE -> EMIT -> DELEGATE -> VERIFY -> JOURNAL on a 24h/6h schedule.
- Wired into the daemon lifecycle: boot kick (`--since=24h`) + 6h periodic spawn, env-gated by `AIDE_CLOSED_LOOP`.
- Hermetic test override `AIDE_SELFIMPROVE_ROOT` added so tests never touch real `.aide/`.
- Full arch battery green: **346/346 pass, exit 0** (Windows-safe invocation, 372s).

## What the runner watches

The state bus writes `at: new Date().toISOString()`. DETECT matches event types. Approval decisions flow through the audit layer:

- **Legacy shape** (consumed by `[learned]` injector / getPreferences / selfimprove DETECT): `type: 'approval'|'rejection'|'abort'`.
- **New `agent.approval` envelope**: `{ sessionId, tool, decision, argsPreview }`.

Because `emitApproval` writes BOTH shapes, selfimprove DETECT (which matches `e.type === 'rejection'`) needs NO change. This was the resolved DETECT-vs-audit-taxonomy decision — do not "unify" the shapes.

## Files that implement the wire-in

| File | Role |
|---|---|
| `node/src/services/agent-loop.mjs` | `createAgentLoop(...)` gained `audit = null` param + `auditSafe` fail-closed wrapper. **4 emit points** (see below). |
| `node/src/services/audit-trail.mjs` (+`.d.mts`) | `emitApproval` writes legacy shape + `agent.approval` envelope; `getPreferences` unchanged. |
| `node/src/routes/audit.ts`, `common/contracts/audit.ts` | Audit slice routes (staged with the sandbox slice). |
| `node/src/routes/closed-loop.ts`, `common/contracts/closed-loop.ts` | Read-only `GET /api/closed-loop/status` -> `ClosedLoopStatusResponse`. |
| `node/src/openapi.ts` | Instantiates audit trail, passes `audit` to `createAgentLoop`, spreads `...routesForClosedLoop(workspace)`. |
| `node/src/server.ts` `main()` | Closed-loop spawn schedule. |
| `node/src/facade` route map | `"/api/closed-loop": "ts"` prefix entry. |
| `scripts/selfimprove.mjs` | `AIDE_SELFIMPROVE_ROOT` env override (STATE_BUS / SIGNAL_DIR / LOG redirected). |

## The 4 audit emit points in agent-loop.mjs

1. **`emitAgentStart`** in `start()`: after `sessions.set(...)`, before `runSession(...)`.
2. **`emitToolCall`** beside `emit({ event:'tool_call', ... })`.
3. **`emitToolResult`** at all 3 result paths: `emitToolResult(sessionId, tool, { ok:false, error })` on error; the `switch_mode` return; and the success `{ ok:true, result }` path.
4. **`decide()`** replaced raw `bus.append` with `auditSafe.emitApproval({ sessionId, tool, decision, argsPreview })`.

Fail-closed contract: if `audit` is `null` (other callers), every call is a no-op — never throws, never writes. `createAgentLoop` has exactly ONE caller (openapi.ts `:374`), already wired with `audit: auditTrail`.

## Daemon schedule semantics (env-gated)

- `AIDE_CLOSED_LOOP === 'false'` -> runner disabled; logs `'closed-loop runner disabled (AIDE_CLOSED_LOOP=false)'`.
- Otherwise: `kickClosedLoop('24h')` at boot + `setInterval(..., 6h, unref)`.
- Spawn via `execFile` (NOT `spawn` — see native-abort trap below), `detached: true, stdio: 'ignore', windowsHide: true`, `child.unref()`, interval `.unref()`.

## Verification battery (reproduce the green path)

Windows-only trap: `node:test` with `spawn` native-asserts on close (`Assertion failed: (env_->execution_async_id()) == (0)` at `InternalCallbackScope::Close`) when the child fails synchronously. Use `execFile` + `promisify` in tests.

Windows path trap: `new URL(import.meta.url).pathname` yields `/E:/...` (leading slash, invalid path). Use `fileURLToPath(import.meta.url)` for repoRoot.

### Isolated slice
```pwsh
node --experimental-strip-types --no-warnings --import ./scripts/http-close-shim.mjs --test --test-concurrency=1 --test-timeout=240000 tests/arch/closed-loop.test.ts tests/arch/audit-routes.test.ts tests/arch/openapi-drift.test.ts
```
-> 8/8 pass, exit 0.

### Full battery (Windows-safe, NEVER `--test-force-exit` locally)
```pwsh
node --experimental-strip-types --no-warnings --import ./scripts/http-close-shim.mjs --test --test-concurrency=1 --test-timeout=240000 (tests/arch/*.test.ts)
```
-> 346/346 pass, exit 0. `scripts/run-arch.mjs` uses `--test-force-exit` (fine on CI/ubuntu, native assert on win32) — do NOT modify it.

### Included tests (closed-loop.test.ts)
- Dry run of `selfimprove.mjs --dry-run` exits 0 under `AIDE_SELFIMPROVE_ROOT`.
- Injected `rejection` bus event -> runner writes a signal file under `AIDE_SELFIMPROVE_ROOT`.
- `GET /api/closed-loop/status` via real ArchServer HTTP reflects env gate + runner state.

## Contracts (strict, exactOptionalPropertyTypes-safe)
- `ClosedLoopStatusResponse = { enabled: boolean, last_run_logged_at: string|null, signal_file_count: number, bus_event_count: number }`.
- Use `?? null` on `string | undefined` fields before returning (TS `exactOptionalPropertyTypes`).
- Route is read-only; a disabled runner reports `enabled: false` (fail-closed), never 404.

## What this wiring proves
Continuous self-improvement from real use is on by default with a verified gate. The next improvement still needs its own data + training pipeline (the fine-tune lane); this skill only guarantees capture -> signal.
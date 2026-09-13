# Phase 2A — Technical Debt

Durable record of accepted-but-unresolved engineering debt. Items here are known
issues that were deliberately not mixed into the migration commits that revealed
them.

## HOOK-EXECUTOR-DEFERRED-STATE-RACE

- **Recorded:** 2026-09-13, after Wave 3B (`c8da59a`).
- **Status:** resolved — diagnosed fixture-only (hypothesis A) and hardened;
  see Resolution below.
- **Source:** Wave 3B verification batch (hook/notification/bucket-C/b4); first
  run had one flake, immediate re-run was green (37/37).

**Observed behavior**

The deferred hook fixture (`tests/arch/hook-executor.test.ts`, "deferred hook
execution: task event produces pending operation, approval executes hook once")
can observe the authority operation while its state is still `executing`, before
the executor transitions it to `succeeded`. The marker file written by the
approved hook command is observable before the operation reaches terminal state,
so an immediate `/api/authority/operation` inspection can read `executing`.

**Disposition**

This is NOT accepted as normal permanent test behavior. A flaky authority
verification fixture must not be normalized, even when its immediate re-run is
green.

**Repair constraints**

- Do not fix with arbitrary sleeps or fixed-delay masking.
- If the contract requires awaiting terminal state, replace timing assumptions
  with a deterministic synchronization point or a terminal-state poll bounded by
  the existing test timeout.
- If production semantics are wrong (a missing awaited terminal-state guarantee
  that callers reasonably require), stop and report before changing production
  code.

**Resolution**

Diagnosis: hypothesis A — the fixture observed the operation before the contract
guarantees terminal state. The hook command writes its marker from inside the
executor callback while the operation is `executing`; `ExecutionAuthority.execute`
marks `succeeded` only after the callback resolves and before its promise
settles, and `HookExecutor` records the `succeeded` lifecycle notification only
after that await. Production semantics are correct (failure marks `failed`
before rejecting). Structural demonstration: prepared=`pending` →
post-approve=`approved` → inside executor=`executing` → concurrent observer=
`executing` → after execute resolves=`succeeded`.

Repair (fixture-only): `tests/arch/hook-executor.test.ts` now awaits the
`succeeded` lifecycle notification — the deterministic terminal-state
synchronization point — before inspecting the operation state. No sleeps, no
production changes.

Evidence: structural demo trace; standalone scenario harness 240/240;
affected hook suite 20/20 consecutive in a stable window (an earlier 20-run
window during operator workload churn produced 18/20 with failures on a
wall-clock `<5000` assertion and a 5s HTTP fixture budget — environmental
process-stall symptoms, not the state ordering); related suites
(capability-authority, route-authority coverage, b4 notifications) 14/14;
node typecheck, targeted eslint, and `git diff --check` clean.

## MODEL-RUNTIME-DETACHED-OWNERSHIP-GAP

- **Recorded:** 2026-09-12, from Wave 3E (`42ce759`).
- **Status:** open — accepted debt, not a Phase 2A blocker.
- **Owner direction:** hand to the future Harness/process-orchestration work.

`ModelRuntime` cannot use the canonical `createOwnedProcesses` primitive
(`node/src/services/owned-process.mjs`) because the primitive explicitly rejects
`detached` spawns, while model engines require `detached: true` (console-teardown
survival doctrine). ModelRuntime therefore retains its own `ChildProcess` handle
map keyed by model id. That map satisfies the same security invariants — no PID
adoption, no image/command-line scanning, no termination of an unowned process —
but it is a second ownership map.

**Direction (agreed):** extend the canonical primitive with an explicit
`detached` profile (handle-retained, no PID adoption) and converge ModelRuntime
onto it. Do NOT build a separate Harness ownership system around this exception.

## MODEL-RUNTIME-PID-FALLBACK-RISK

- **Recorded:** 2026-09-12, from Wave 3E (`42ce759`).
- **Status:** open — accepted debt, not a Phase 2A blocker.

The Windows `taskkill /T /F` fallback in `ModelRuntime.stop` ultimately targets
the numeric PID stored on the retained `ChildProcess`. The caller never controls
that PID and handle-based termination is the primary path, but PID reuse between
actual exit and observed exit is theoretically possible in the narrow window
where the fallback runs (only after a 5s SIGTERM wait with exit unobserved).

**Track it; do not claim it is mathematically eliminated.** Candidate
mitigations for a future slice: prefer handle-based kill alone; verify process
identity (creation time) before `taskkill`; or use job objects. This item is the
authority-visible half of the same convergence as
MODEL-RUNTIME-DETACHED-OWNERSHIP-GAP.

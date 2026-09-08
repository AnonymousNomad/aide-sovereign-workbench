---
name: aid-closed-loop-on-by-default
description: Wire AIDE's self-improvement loop (`scripts/selfimprove.mjs`) into the daemon lifecycle so it runs continuously, not only on manual invocation. Per the 2026 research (Auto-Dreamer, CLaaS, Sleep-Time Compute), the closed-loop that captures trajectories, clusters failures, and emits verifier-stamped signals for the fine-tune lane is the "Iron Man suit" — the model gets better from real use. This skill encodes the exact wire-in: where to hook it in the daemon, what triggers it, what the contract is, and what the verification gate proves. Use whenever the user wants the model to self-improve from real use, when adding a new model to the loop, or when the selfimprove.mjs script is sitting unused.
---

# AIDE Closed-Loop On By Default — Wire-In Recipe

## Status: PARTIAL (2026-09-03)

- `scripts/selfimprove.mjs` exists and works in `--dry-run` mode (verified: OBSERVE → DETECT → CLUSTER → ROUTE → EMIT → DELEGATE → VERIFY → JOURNAL loop runs, 0 events because AIDE stack is down).
- The runner is **NOT** yet wired into the daemon lifecycle. It only runs on manual invocation.
- The state bus `.aide/cipher-state.jsonl` exists but is empty (0 events in last 24h) because the AIDE stack is down.
- This skill encodes the exact wire-in path so the loop runs continuously.

## What this skill is

AIDE has a self-improvement runner (`scripts/selfimprove.mjs`) that reads the state bus, clusters failures, emits signals, and journals the result. The runner is the bridge between the harness (every task = a trajectory event) and the fine-tune lane (the model gets better from real use).

**The gap:** the runner only runs when manually invoked. For the model to actually self-improve, the runner must be triggered automatically — after every N trajectories, on a schedule, or on a specific event (e.g., 3 consecutive failures of the same task type).

This skill encodes:
1. **The state bus contract** — what goes in `.aide/cipher-state.jsonl`, who writes, who reads.
2. **The trigger points** — where in the daemon the runner should be invoked.
3. **The schedule** — how often to run if no trigger fires.
4. **The signal contract** — what `selfimprove.mjs` emits to `.aide/training/signal-*.jsonl` for the fine-tune lane.
5. **The verification gate** — what proves the loop is actually running and producing useful signals.

## Research base (primary sources)

1. **Auto-Dreamer (2024)** — offline memory consolidation during idle periods. The model "dreams" over trajectories during low-activity windows.
2. **CLaaS — Continual Learning as a Service (2026)** — the production model for self-improving AI: periodic fine-tune rounds on verified trajectory data, gated by a battery.
3. **Sleep-Time Compute (2026)** — use idle compute for reasoning/improvement, not just inference. The closed-loop runs during idle.
4. **MERA — Small-model improvement via execution traces (2026)** — execution traces are the best training signal for small models. The state bus captures these.
5. **AIDE built-in skills**:
   - `aid-closed-loop-self-improvement` — the master closed-loop doctrine (loaded earlier this session).
   - `post-training-closed-loop` — Stage 4 of the post-training pipeline.
   - `aide-cipher-house-model` — the in-house model lifecycle.
   - `aide-cipher-living-system` — the living system spec (cipher-state.jsonl as the unified event bus).

## The state bus contract (`.aide/cipher-state.jsonl`)

One JSON object per line. Fields:
```json
{
  "ts": "2026-09-03T17:20:01.411Z",
  "actor": "agent-loop" | "orchestrator" | "selfimprove" | "trajectory-miner",
  "type": "task.start" | "task.complete" | "task.error" | "tool.call" | "tool.result" | "evidence.write" | "adapter.registered",
  "task_id": "uuid",
  "task_type": "code-change" | "debug" | "shopify" | "fine-tune" | "...",
  "status": "accepted" | "running" | "done" | "error" | "blocked",
  "verifier": "veritas" | "execution" | "manual",
  "evidence": { "score": 0.87, "checks": { "patch-parse": true, "tests": true } },
  "skills_loaded": ["aide-arch-protocols"],
  "context_bytes": 6139,
  "duration_ms": 1234
}
```

The `actor` field identifies who wrote the event. The `selfimprove` actor writes "loop complete" events. The `trajectory-miner` actor writes mining results.

## The trigger points (where to invoke the runner)

The runner should be invoked at three places in the daemon:

1. **On a schedule** — every 6 hours during normal operation. Use `setInterval` in the daemon's startup hook. Emit a `loop.scheduled` event to the state bus.

2. **On N consecutive failures** — after 3 consecutive `task.error` events of the same `task_type`, invoke the runner immediately. The closed-loop should react to patterns, not just wait for a schedule.

3. **On daemon startup** — after the AIDE stack is healthy (all daemons responding 200), invoke the runner once. This catches any state that accumulated while the stack was down.

The daemon's startup hook is at `node/src/server.ts` (or wherever the arch daemon initializes). Add:

```ts
import { spawn } from 'node:child_process';

// In the startup hook, after daemons are healthy:
if (process.env.AIDE_CLOSED_LOOP !== 'false') {
  // Run once on startup
  spawn('node', ['scripts/selfimprove.mjs', '--since=1h'], { detached: true, stdio: 'ignore' }).unref();
  // Schedule every 6 hours
  setInterval(() => {
    spawn('node', ['scripts/selfimprove.mjs', '--since=6h'], { detached: true, stdio: 'ignore' }).unref();
  }, 6 * 60 * 60 * 1000);
}
```

## The signal contract (`.aide/training/signal-YYYY-MM-DD.jsonl`)

The runner emits signals to this path. One JSON object per signal:
```json
{
  "ts": "2026-09-03T17:20:01.570Z",
  "signal_type": "failure-cluster" | "success-pattern" | "verifier-stamp",
  "task_type": "code-change",
  "count": 3,
  "examples": ["task_id_1", "task_id_2", "task_id_3"],
  "verifier": "veritas",
  "verifier_score": 0.45,
  "recommended_action": "fine-tune-round" | "skill-update" | "no-action",
  "context": "..."
}
```

The fine-tune lane (T1's lane per the T1-T2 sync doc) reads these signals and decides whether to trigger a fine-tune round.

## The verification gate (what proves the loop is running)

1. **The state bus has events** — `.aide/cipher-state.jsonl` is non-empty after the AIDE stack has been up for 1 hour.
2. **The signal directory has signals** — `.aide/training/signal-*.jsonl` exists and is non-empty after the first loop run.
3. **The log directory has logs** — `.aide/logs/selfimprove.log` shows the loop completing at the expected cadence.
4. **A manual `--dry-run` works** — `node scripts/selfimprove.mjs --dry-run` reports the current state without writing signals.

## How to wire it in (the steps)

1. **Add the trigger points** to the daemon's startup hook (see above).
2. **Add the AIDE_CLOSED_LOOP env var** to the daemon's config so it can be disabled for testing.
3. **Add a /api/closed-loop/status route** so the cockpit can show the user that the loop is running.
4. **Write the test** at `tests/arch/closed-loop.test.ts` (new file):
   - Test 1: `scripts/selfimprove.mjs --dry-run` exits 0.
   - Test 2: the state bus file exists.
   - Test 3: a signal file is created when the runner is invoked with `--since=0h` after injecting a failure event.
5. **Verify the wire-in end-to-end**: start the daemon, wait 1 minute, check that the state bus has events and a signal file was created.

## Pitfalls (each cost a cycle in research)

1. **Spawning the runner as a child process** — the runner is a script, not a library. It must be spawned with `node scripts/selfimprove.mjs`. The daemon shouldn't import the runner directly.
2. **Running the runner in-process** — would block the daemon. Use `detached: true, stdio: 'ignore'` and `.unref()` to let the runner run independently.
3. **Not writing to the state bus** — the runner reads from the bus but doesn't write to it. The bus is written by the agent-loop and orchestrator. The closed-loop is a consumer, not a producer.
4. **Triggering the loop on every event** — too noisy. Use the schedule (every 6h) + the consecutive-failure trigger (3 of same type).
5. **Not handling the case where the stack is down** — the runner should gracefully report "0 events" when the state bus is empty or missing, not crash.
6. **Confusing the closed-loop with fine-tuning** — the closed-loop emits SIGNALS. The fine-tune lane consumes the signals and runs training. These are separate concerns.

## What NOT to do

- **Do NOT import the runner directly into the daemon** — spawn it as a child process.
- **Do NOT trigger the loop on every event** — use the schedule + consecutive-failure trigger.
- **Do NOT write to the state bus from the runner** — the runner is a consumer.
- **Do NOT block the daemon on the runner** — detached + unref.
- **Do NOT skip the verification gate** — prove the loop is actually running with real events.

## Related skills

- `aid-closed-loop-self-improvement` — the master closed-loop doctrine.
- `post-training-closed-loop` — Stage 4 of the post-training pipeline.
- `aide-cipher-house-model` — the in-house model lifecycle.
- `aide-cipher-living-system` — the living system spec.
- `aide-north-mini-code-engine` — the North 30B engine launch SOP.
- `aide-debugging-discipline` — general debugging playbook.

## Verification record (per agent-notes)

After the wire-in, append to `AGENT_NOTES.md`:

```
- [YYYY-MM-DD HH:MM] T1: Closed-loop on by default wired in (stage 8)
  - Modified E:\aide-sovereign-workbench\node\src\server.ts to spawn
    scripts/selfimprove.mjs on startup and every 6h
  - Added AIDE_CLOSED_LOOP env var to disable for testing
  - Wrote tests/arch/closed-loop.test.ts
    (verifiable: --dry-run exits 0, signal file created after injection)
  - Verified end-to-end: daemon startup -> 1 runner invocation
    -> state bus has events -> signal file created
  - check:arch delta: +3 passed -0 failed
  - Next: stage 9 - 4B cipher fine-tune pipeline
```

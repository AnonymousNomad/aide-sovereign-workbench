---
name: aide-background-tasks
description: The AIDE pattern for long-running, durable background tasks — a JSONL outbox on disk that survives daemon restarts, a drain worker that replays idempotently on reconnect, jittered backoff for retries, and a UI badge for queue depth. Use when implementing Claude Code's Routines / Desktop scheduled tasks / cloud-async tasks, when wiring "kick off a long task and check back later", when reviewing durability of any in-flight async work, or when the user asks "what happens if my laptop dies mid-task?".
---

# Background Tasks — Durable Outbox, Drain Worker, Survive Crashes

Born 2026-08-31 from the wiring audit. AIDE has no way to "kick off a long task and come back later". A `git commit` that takes 30 minutes, a `claude-style "review every PR over the weekend"` loop, a `download 50GB of model weights` — all of these need to survive daemon restarts, machine sleeps, and operator distraction. Cursor, Claude Code, Copilot all ship this. AIDE doesn't. This skill IS the wire-in.

## Why this matters

- **Real workflows are long**: training, downloading, code review, scheduled cleanup. None of these should block the user.
- **Crashes happen**: machine sleep, power loss, daemon restart. Anything in-memory is lost. Anything in the outbox survives.
- **No-Brick-Wall**: the user can close the laptop, come back tomorrow, the task is still running or has a result.
- **Cross-device**: paired with the Telegram bridge, the user starts a task on the desktop, gets a Telegram ping when it's done.

## The AIDE background-task contract (4 hard rules)

1. **A task is an idempotent JSONL entry** in `<workspace>/.aide/outbox.jsonl`. Each entry has `{idempotency_key, kind, payload, state, created_at, attempts, last_error, scheduled_for}`. Append-only.
2. **The drain worker owns execution**. It reads pending entries, executes them, writes the result back to the same entry. The worker survives crashes via `kill -9` recovery: on restart, it reads the outbox, finds `state === 'pending'` or `state === 'in_flight'`, replays them (idempotency key prevents double-execution).
3. **All outbound calls carry the idempotency key**. The same key + same payload = no double work. The same key + different payload = hash compare, the newer wins, the older is dropped.
4. **Jittered backoff on failure**. 1s, 2s, 4s, 8s, ..., capped at 5min. After 10 attempts, the entry moves to `state: 'failed'` and surfaces in the UI.

## Files to touch (when wiring)

| File | Change |
|---|---|
| `node/src/services/outbox.mjs` | NEW: `Outbox` class with `enqueue`, `claim`, `complete`, `fail`, `replay`, `list`, `purge`. |
| `node/src/routes/tasks.ts` | EXTEND: `POST /api/tasks/enqueue`, `GET /api/tasks/outbox`, `GET /api/tasks/outbox/:id`, `POST /api/tasks/outbox/:id/cancel`, `GET /api/tasks/outbox/stats`. |
| `node/src/services/drain-worker.mjs` | NEW: the worker loop. Reads the outbox every 5s, claims pending entries, dispatches by `kind`, writes the result. |
| `common/contracts/tasks.ts` | EXTEND: the 5 request/response zod schemas. |
| `node/src/server.ts` (or the routes aggregator) | Wire the new routes. Start the drain worker on boot. |
| `tests/arch/background-tasks.test.ts` | NEW: 5 tests (enqueue/claim/complete, replay after kill, backoff, dedup). |
| `scripts/aide-bundle.cjs` | (optional) `bundle task list` CLI. |
| `browser/src/...` | (optional) outbox badge in the status bar. |

## The contract (zod-strict)

```ts
// in common/contracts/tasks.ts

export const OutboxEntryKind = z.enum([
  'cloud_turn',         // long model call (e.g. opus-4.6 review)
  'download',           // HF model / file / repo download
  'training_run',       // full training job
  'agent_session',      // a long agent loop (e.g. multi-hour migration)
  'hook',               // a deferred hook call
  'desktop_action',     // a desktop control action (with grant)
  'cleanup',            // garbage collection, index rebuild
  'custom'              // user-defined
]);


## The outbox service

```js
// node/src/services/outbox.mjs
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export class Outbox {
  constructor({ workspace, file = '.aide/outbox.jsonl' }) {
    this.workspace = workspace;
    this.file = path.join(workspace, file);
  }

  // Append a new entry. Idempotency: if the same key exists in the file
  // with a hash-equal payload, return the existing entry (dedup).
  async enqueue({ kind, payload, scheduled_for, idempotency_key }) {
    const key = idempotency_key || randomUUID();
    const existing = await this.findByKey(key);
    if (existing && JSON.stringify(existing.payload) === JSON.stringify(payload)) {
      return existing;  // dedup
    }
    const entry = {
      idempotency_key: key,
      kind,
      payload,
      state: 'pending',
      created_at: Date.now(),
      scheduled_for: scheduled_for || null,
      attempts: 0,
      last_error: null,
      result: null,
      started_at: null,
      ended_at: null
    };
    await fs.appendFile(this.file, JSON.stringify(entry) + '\n', 'utf8');
    return entry;
  }

  // Claim: atomically read + mark a pending entry as in_flight.
  // Returns the claimed entry or null if none pending.
  async claim() {
    const entries = await this.readAll();
    const pending = entries.find(e => e.state === 'pending'
      && (e.scheduled_for === null || e.scheduled_for <= Date.now()));
    if (!pending) return null;
    pending.state = 'in_flight';
    pending.started_at = Date.now();
    pending.attempts += 1;
    await this.writeAll(entries);
    return pending;
  }

  async complete(idempotency_key, result) {
    const entries = await this.readAll();
    const e = entries.find(x => x.idempotency_key === idempotency_key);
    if (!e) return null;
    e.state = 'completed';
    e.result = result;
    e.ended_at = Date.now();
    await this.writeAll(entries);
    return e;
  }

  async fail(idempotency_key, error) {
    const entries = await this.readAll();
    const e = entries.find(x => x.idempotency_key === idempotency_key);
    if (!e) return null;
    e.last_error = String(error?.message ?? error);
    if (e.attempts >= 10) e.state = 'failed';
    else e.state = 'pending';  // retry
    e.ended_at = null;  // retry window open
    await this.writeAll(entries);
    return e;
  }

  async replay() {
    // On daemon restart: any in_flight entries are orphans (their worker died)
    // Move them back to pending for re-claim
    const entries = await this.readAll();
    for (const e of entries) {
      if (e.state === 'in_flight') {
        e.state = 'pending';
        e.started_at = null;
        // idempotency key prevents double-execution
      }
    }
    await this.writeAll(entries);
  }

  async list(filter = {}) {
    return (await this.readAll()).filter(e => {
      if (filter.state && e.state !== filter.state) return false;
      if (filter.kind && e.kind !== filter.kind) return false;
      return true;
    });
  }

  async stats() {
    const all = await this.readAll();
    const counts = { pending: 0, in_flight: 0, completed: 0, failed: 0, total: all.length };
    for (const e of all) counts[e.state] += 1;
    return counts;
  }
}
```

## The drain worker

```js
// node/src/services/drain-worker.mjs
import { setTimeout as sleep } from 'node:timers/promises';

export function startDrainWorker({ outbox, dispatch, intervalMs = 5000 }) {
  let stopped = false;
  let timer = null;
  async function tick() {
    if (stopped) return;
    try {
      const entry = await outbox.claim();
      if (!entry) {

## Threat matrix (the tests must cover these)

| Threat | Test | Pass criterion |
|---|---|---|
| Crashed worker duplicates work | Enqueue, claim, then kill the worker, restart | outbox.replay() moves the entry back to pending; next claim runs the same key (idempotency hash matches) — no double execution |
| Backoff caps at 5 min | Fail 10 times in a row | entry state === 'failed' after attempt 10; no further retries |
| Different payload with same key | Enqueue key=K with payload P1, then key=K with payload P2 | newer wins (P2 stored, P1 dropped) OR rejected (the spec must pick one — recommend REJECT to surface the bug) |
| Disk full | Try to enqueue with no disk space | outbox throws OutboxError with code DISK_FULL; user sees a clear message |
| Concurrent workers (multi-process) | Two daemons share the outbox file | one wins the claim, the other gets null (atomic append + read is racy; for true multi-process use file locking via `proper-lockfile` or move to sqlite) |
| Outbox grows unbounded | Enqueue 10K entries | rotation policy: every 1K completed, archive to `.aide/outbox.archive.jsonl`; UI shows archive count |

## Existing assets this skill USES

- `harness/cipher-state.mjs` → emit `outbox_enqueued`, `outbox_claimed`, `outbox_completed`, `outbox_failed` events
- `node/src/services/tasks.mjs` (existing) → the `TaskManager` for in-memory tasks; the outbox is its durable backend
- `node/src/services/telegram.mjs` (existing) → the Telegram bridge can subscribe to outbox events and notify the user
- `harness/veritas.mjs` → `evaluateVeritas` for scoring the result of long-running jobs

## Pitfalls

- **Do NOT store the outbox in memory.** Survive crashes = store on disk.
- **Do NOT use SQLite without a migration plan.** AIDE ships Node stdlib only. JSONL is the right primitive for now.
- **Do NOT block the request handler on enqueue.** `enqueue` is an append + return; the drain worker does the work async.
- **Do NOT skip the idempotency key.** Two enqueues with the same key + same payload = one execution. No key, no dedup. No dedup, no durability guarantee.
- **Do NOT use random backoff without jitter.** 100 workers retrying at the exact same second cause a thundering herd. Jitter (`Math.random() * 1000`) spreads them.
- **Do NOT let the outbox grow forever.** Rotate completed entries to an archive file. Keep the live file under 10MB.

## The rollout (2 PRs)

### PR A — Outbox service + 5 routes
- Add the outbox service to `node/src/services/outbox.mjs`
- Add the 5 zod schemas to `common/contracts/tasks.ts`
- Regenerate `common/openapi.json`
- Add the 5 routes
- 5 arch tests
- Commit: `feat(tasks): durable outbox for background tasks (PR A of aide-background-tasks)`

### PR B — Drain worker + boot wiring
- Add the drain worker to `node/src/services/drain-worker.mjs`
- Wire it on boot in the daemon
- Add the 8 dispatch handlers (one per kind)
- 2 more arch tests (replay, backoff)
- Commit: `feat(tasks): drain worker with idempotent replay (PR B of aide-background-tasks)`

## References

- `aide-resilience-orchestrator` R4 (durable outbox, the original spec)
- `aide-telegram-bridge-pattern` (cross-device notification when tasks complete)
- `aide-engine-lifecycle-doctrine` (operator owns lifecycle; the outbox survives even if the engine dies)
- `process-hygiene-sop` P7 (one model at a time, but the outbox is engine-independent)
- Claude Code Routines / Desktop scheduled tasks, Cursor Cloud Agents, Copilot background tasks — the rival patterns

        timer = setTimeout(tick, intervalMs);
        return;
      }
      try {
        const result = await dispatch(entry);  // dispatches by entry.kind
        await outbox.complete(entry.idempotency_key, result);
      } catch (error) {
        const backoff = Math.min(300_000, 1000 * 2 ** entry.attempts);  // 1s, 2s, 4s, ..., 5min
        await outbox.fail(entry.idempotency_key, error);
        timer = setTimeout(tick, backoff + Math.random() * 1000);  // jitter
        return;
      }
    } catch (e) {
      // Worker itself errored (e.g. outbox IO). Sleep and retry.
      console.error('drain-worker tick error', e);
    }
    timer = setTimeout(tick, intervalMs);
  }
  // Replay on boot: any in_flight entries go back to pending
  outbox.replay().then(tick);
  return {
    stop: () => { stopped = true; if (timer) clearTimeout(timer); }
  };
}

// Dispatcher: maps entry.kind -> async function
function makeDispatcher({ chatFn, modelManager, fileWriter, ... }) {
  return async function dispatch(entry) {
    switch (entry.kind) {
      case 'cloud_turn':    return await chatFn(entry.payload.messages, entry.payload.opts);
      case 'download':      return await modelManager.download(entry.payload.url, entry.payload.dest);
      case 'training_run':  return await runTraining(entry.payload);
      case 'agent_session': return await runAgentSession(entry.payload);
      case 'hook':          return await runHook(entry.payload);
      case 'desktop_action':return await runDesktopAction(entry.payload);
      case 'cleanup':       return await runCleanup(entry.payload);
      case 'custom':        return await runCustom(entry.payload);
      default: throw new Error(`unknown outbox kind: ${entry.kind}`);
    }
  };
}
```

export const OutboxEntryState = z.enum([
  'pending',            // not yet claimed
  'in_flight',          // claimed by a worker
  'completed',          // done, result stored
  'failed',             // exceeded retry cap
  'cancelled'           // user cancelled
]);

export const OutboxEntry = z.object({
  idempotency_key: z.string().uuid(),
  kind: OutboxEntryKind,
  payload: z.record(z.string(), z.unknown()),
  state: OutboxEntryState,
  created_at: z.number().int(),
  scheduled_for: z.number().int().nullable(),
  attempts: z.number().int().gte(0).default(0),
  last_error: z.string().nullable().optional(),
  result: z.record(z.string(), z.unknown()).nullable().optional(),
  started_at: z.number().int().nullable().optional(),
  ended_at: z.number().int().nullable().optional()
}).strict();

export const OutboxEnqueueRequest = z.object({
  kind: OutboxEntryKind,
  payload: z.record(z.string(), z.unknown()),
  scheduled_for: z.number().int().optional(),
  idempotency_key: z.string().uuid().optional()  // generated if absent
}).strict();

export const OutboxStats = z.object({
  pending: z.number().int().gte(0),
  in_flight: z.number().int().gte(0),
  completed: z.number().int().gte(0),
  failed: z.number().int().gte(0),
  total: z.number().int().gte(0)
}).strict();
```


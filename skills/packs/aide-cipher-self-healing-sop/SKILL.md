---
name: aide-cipher-self-healing-sop
description: The standard operating procedure for Project Cipher's self-healing loop — state bus, [learned] block injection, verification battery, sleep-time training cycle, operator changelog. Use when wiring any new component that touches approvals/rejections, when designing new "learned" sources, when running or extending the verification battery, when investigating why a QLoRA cycle was archived, or when the operator asks "how does Cipher get better?"
---

# Cipher Self-Healing SOP

A runbook, not a research paper. Every step is verifiable.

## What "self-healing" means here

Cipher is a static GGUF plus a fluid QLoRA adapter plus a growing
`[learned]` context block. The model **does not** retrain itself live.
What it does:

1. **Context healing** — every approval/rejection feeds a JSONL bus
   (`.aide/cipher-state.jsonl`). High-frequency patterns (>=3 occurrences,
   >=60% approved) are reformatted as `[learned]` lines and injected into
   the system scaffold on the next chat. The model gets better at your
   workflow without any weight change.

2. **Sandbox self-correction** — TASK proposals (file edits + commands)
   run against scratch copies first. Test/lint/compile results feed back
   into the model for up to 3 retries. Only verified diffs reach the
   SHIP panel. (Stage 2, not yet wired.)

3. **Sleep-time weight healing** — when idle, AIDE re-runs QLoRA over
   verified-good trajectories. The new adapter must pass the
   non-regression battery (delta >= 0) or it's archived. Operator approves
   the changelog before any swap. (Stage 3, not yet wired.)

4. **Per-failure targeted healing** — every category-FAIL in the
   capability audit becomes a curated SFT pair. Math FAIL -> math SFT
   pair. Reasoning FAIL -> enumeration SFT pair. (Stage 4, not yet wired.)

## The state bus (`.aide/cipher-state.jsonl`)

One JSON object per line. Append-only. Read by every component that
needs to know what the operator has done.

Event types in use today:

| type | when | fields |
|---|---|---|
| `approval` | operator clicks Approve in a tool prompt | `tool`, `pattern`, `summary` |
| `rejection` | operator clicks Reject | `tool`, `pattern`, `summary` |
| `abort` | operator clicks Abort on a session | `tool`, `pattern`, `summary` |
| `ship` | a commit lands | `commit_sha`, `files_count`, `intent` |
| `gate` | any veritas gate runs | `gate`, `passed`, `duration_ms` |
| `phase` | model/engine phase change | `from`, `to`, `engine` |
| `preference` | explicit pattern write | `pattern`, `direction` |
| `error` | a component throws | `source`, `message` |

**Code**: `harness/cipher-state.mjs`. Exports `createStateBus(workspace)`
returning `{ append, readState, getPreferences }`. Type declarations:
`harness/cipher-state.d.mts`.

**Failure mode**: `append` is fire-and-forget — if the file write fails,
no error bubbles. The bus is the *training* data source, not the audit
log. Audit logs go to `daemon/egress-journal.mjs` and
`harness/events.mjs`.

## The [learned] block

Composed by `createStateBus.getPreferences(minCount=3, limit=15)`:

1. Read last 500 approvals + 500 rejections
2. Group by `pattern` field
3. Keep only patterns with `count >= 3` AND `approved/count >= 0.6`
4. Sort by approval count desc
5. Take top 15
6. Emit `[learned] <pattern>` lines

**Why the 3-occurrence / 60% thresholds**: prevents one-off flukes from
poisoning the model. Pattern needs evidence.

**Why cap at 15**: the compact scaffold budget is 24 lines / 640 bytes
(micro tier). The learned block should never displace core doctrine.

**Wired where**: `node/src/routes/chat.ts` in `routeForChat` (line ~123)
calls `getPreferences(3, 10)` and appends the result to the system slot,
after memory blocks, before the [workspace context] block.

## The verification battery (non-regression gate)

Before any QLoRA cycle's adapter is promoted:

1. Run `node scripts/run-arch.mjs` against the current production
   adapter. Record composite per category.
2. Run the same battery against the candidate adapter.
3. Compute `delta = candidate - production` per category AND composite.
4. **Gate**: every category delta must be `>= -0.05` AND the composite
   delta must be `>= 0`. Else archive with reason.

The battery covers: agent loop, agent tools, agent policy, agent
contracts, byok, command registry, keybindings, settings, lsp/dap
routes, training gate, exports, handoff, memory, orchestrator,
workbench, plugin manager. See `scripts/run-arch.mjs` for the
canonical serialized run.

## The sleep-time cycle (operator approval-gated)

```
IDLE 2h
  |
1. Load last 24h of cipher-state.jsonl where type IN {approval, ship} AND
   any related gate.passed === true
  |
2. Build {prompt, verified_response} pairs from chat transcripts
  |
3. Mix 30% general instruction data (replay buffer)
  |
4. QLoRA fine-tune: rank 8, alpha 16, lr 5e-4, 2 epochs
  |
5. Convert to GGUF adapter via convert_lora_to_gguf.py
  |
6. Run verification battery against new adapter
  |
7. IF composite delta >= 0 AND every category delta >= -0.05
   -> stage adapter alongside current
   -> publish changelog to operator
   -> operator: [APPLY] [REVIEW] [SKIP]
   IF gate fails -> archive with reason, do not stage
  |
8. APPLY = hot-swap via /lora-adapters endpoint (<20ms)
   SKIP = keep current, try again tomorrow
```

## The operator changelog

A human-readable summary AIDE produces at the end of a sleep-time cycle:

```
Overnight I learned:
- 3 new approval patterns (now seen >=3 times)
- 1 trajectory pair added to my training data
- Battery delta: +0.04 composite, all categories >= -0.02

[APPLY]  [REVIEW]  [SKIP]
```

The operator has VETO. Nothing is ever auto-applied.

## Verification (per stage)

| Stage | What to verify | Command |
|---|---|---|
| 1 (state bus + [learned]) | cipher-state.jsonl exists after one approval; [learned] block present in next chat | `tail .aide/cipher-state.jsonl`, then a chat + check system slot |
| 2 (sandbox loop) | A TASK with a failing test retries up to 3x; verified-only diff reaches SHIP | manually test |
| 3 (sleep-time) | First QLoRA cycle produces an adapter; battery gate holds; changelog appears | run cycle, inspect `artifacts/` |
| 4 (per-failure SFT) | A category-FAIL audit entry produces a curated SFT pair in the next dataset | inspect `data/` |

## Threats and controls

| Threat | Control |
|---|---|
| Garbage-in flywheel | Only verified outcomes (gate passed + operator approved) enter the dataset |
| Operator forgets to approve | Changelog persists until acknowledged; "stale" badge in cockpit |
| Battery regresses silently | `delta >= 0` is a build-time gate in `npm run check:arch` |
| Adapter/base mismatch | `intermediate_size` compatibility check before `--lora` load |
| Catastrophic forgetting | 30% replay buffer in every cycle |
| Privacy (training data = source code) | Local-only, no cloud, no telemetry, purge command in cockpit |
| VRAM contention | Train during idle hours only (P7 one-job law) |

## What this skill is NOT

- It is not the doctrine of *what* Cipher is. See `aide-cipher` and
  `aide-cipher-house-model` for the vision + lifecycle.
- It is not the build spec for the state bus. See
  `aide-cipher-living-system` for the spec the code was built from.
- It is not a QLoRA tutorial. See `aide-cipher-house-model` for the
  training config + conversion pipeline.


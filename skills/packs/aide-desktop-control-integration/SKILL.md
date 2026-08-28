---
name: aide-desktop-control-integration
description: The full architecture for AIDE's desktop control — agent tool bridge, telegram /ask brain, REST routes, grants/panic/pending/verdict safety, grammar-constrained DSL, single-service law, refusal-recovery as training data. Use when wiring any new surface (agent, telegram, future UI) that drives the desktop; when the desktop service is referenced from more than one place; when a new op is added; when the panic/grants semantics need to be explained; when trajectory capture needs a new channel; or when integrating the house model into desktop act().
---

# Desktop Control × AIDE — Full Integration Doctrine

Born 2026-08-28: closed the gap between the built desktop service and the agent
loop. The desktop control surface now has THREE live drivers (REST, Telegram
`/ask`, agent `<desktop_action>`) all backed by ONE `createDesktopControl`
instance, ONE grants manifest, ONE panic state, ONE trajectory file.

## Research base (verified 2026-08-28)

1. **In-repo: desktop-control.mjs** is the bounded domain. 7 hard-coded ops
   (launch_app, open_path, list_windows, focus_window, move_file,
   outlook_create_draft, excel_generate_report), strict grants manifest, panic
   kill switch, pending/verdict long-poll, refusal-recovery as training data
   (T2 90/90 battery).
2. **telegram-brain.mjs** is the proof-of-pattern. Model proposes a single
   grammar-constrained action line; operator confirms via YES/NO; executor runs
   with full grants/panic; evidence and trajectory land in the same place.
3. **node/src/services/agent-tools.mjs** is the agent's tool factory. Each
   tool declares name/params/readOnly/execute(args). Mutating tools require
   `approved: true` at the dispatch layer.
4. **node/src/routes/agent.ts** exposes `/api/agent/tool` with the dispatchTool
   seam — a closure that takes (name, args, opts) and returns
   {ok, output, terminal}. This is the integration point.
5. **Rival context**: desktop control is an emerging 2026 surface (Cursor

## Why it's done this way

- **The differentiator is not "we can drive a desktop"** — it is "OUR OWN
  4B model drives it, locally, with operator-owned safety rails".
- **Verdict-as-labeling**: the operator is already in the loop; reusing
  those judgments as training data compounds the corpus for free.
- **Grammar-constrained actions** eliminate the #1 desktop-control failure
  mode (malformed action JSON) at the model level instead of with retries.
- **Single service** preserves the deny-by-default invariant: a grant set
  via REST must gate the agent path. Two instances breaks that contract.

## Dependencies / issues / bugs

- **Desktop-control.mjs** is the floor. The engine lifecycle doctrine does
  NOT cover the desktop service — it is in-process state, persisted in
  `.aide/desktop/grants.json` and rehydrated.
- **Pre-existing contract drift**: legacy daemon's `status()` returns
  `pending_approvals` which is NOT in `DesktopStatusResponse`. The
  `/api/desktop/status` route therefore returns `BAD_RESPONSE` on the
  current shape. Filed as a follow-up.
- **Memory coexistence**: desktop inference REUSES the cipher engine,
  never a third.
- **Test pattern**: `tests/arch/desktop-policy.test.ts` covers the parser
  (11 cases) + the agent-tool integration (10 cases) including trajectory

## Threat matrix

| Threat | Signature | Defense |
|---|---|---|
| Runaway automation | act loop types into wrong window | grants + panic; action-rate ceiling; per-category allowlist |
| Malformed actions from model | invalid JSON, phantom keys | grammar-constrained parser; strict allowlist on `op:` and `target:` |
| Privilege escalation via model | model emits `approved: true` or unknown field | UNKNOWN_FIELD rejection; approved set ONLY by dispatchTool, not the parser |
| Two services with split grants | grants set via REST don't gate agent path | SINGLE INSTANCE LAW; `desktopServiceRef` lift in `openapi.ts` |
| Model replacement drift | external API swapped into the policy hook | all-local law: endpoint must be 127.0.0.1; egress audit check in CI |
| Trajectory loss | refused actions not recorded | `recordTrajectory` called on EVERY act() — both success and refusal |
| Destructive category too early | model attempts file-delete class actions | 7-op allowlist (no `delete_file`); destructive classes need explicit-confirm card |
| Screen-content exfiltration | state serialization leaks secrets | state schema excludes password fields; all-local law |
| Coordinate/DPI drift | actions miss targets on resolution change | relative coords + window-class targeting (v2 — Phase B) |
| Panic bypass | agent calls act() after operator hits panic | tool calls `desktop.act()` which checks `panics` array, throws `PANIC` |
| NO_APPROVAL bypass at HTTP | agent calls tool without `approved: true` at the route | dispatchTool MUTATING check rejects with `VALIDATION` BEFORE the tool runs |
| NO_APPROVAL inside the tool | model fakes `approved: true` in args | tool's own `if (args.approved !== 'true' && args.approved !== true)` throws `NO_APPROVAL` |
| Status contract drift | response includes `pending_approvals`, breaks strict contract | pre-existing issue — follow-up filed |

## Pitfalls

- **Do NOT create a second `createDesktopControl`** anywhere. Two
  instances = split brain (grants, panic, trajectory all split).
- **Do NOT bypass the agent dispatchTool layer** to call `desktop.act`
  directly. The dispatchTool layer is the only place that gates
  `approved: true` at the HTTP boundary.
- **Do NOT widen the op allowlist without an eval battery run.** Each new
  op ships with: (a) trajectory rows, (b) a battery entry, (c) docs.
- **Do NOT log full screenshots to disk uncontrolled** — state text +
  hashes only.
- **Do NOT trust model confidence blindly** — thresholds measured from
  verdict data, not guessed.
- **Do NOT add a new field to the DSL without a parser test** —
  `desktop-policy.test.ts` covers all 4 valid fields + every rejection
  case. New fields must extend `KNOWN_FIELDS` and add both happy-path
  and rejection tests.

  capture and panic propagation.

   Mission Control, OS-level automation rare). AIDE's differentiator is
   **the house model driving the desktop, locally, with operator-owned
   safety rails** — same model, same engine, same chassis, no cloud.

## What to do (direct)

1. **Single desktop service instance**: every surface (REST routes, telegram
   brain, agent tool, future UI panels) must receive the SAME
   `createDesktopControl({ workspace })` object. Never create a second one.
2. **Grammar-constrained DSL** (`node/src/services/desktop-policy.mjs`):
   `<desktop_action>` blocks carry `op:`, `target:`, `destination:`, `note:`.
   Unknown fields are REJECTED (privilege-escalation guard).
3. **Permission class** is computed by `classForOp(op)` (READ | WRITE | OPEN
   | DESTRUCTIVE). The agent loop surfaces this on the approval card so
   DESTRUCTIVE actions get the explicit-confirm treatment.
4. **Trajectory capture** is the desktop service's job. Refusal-recovery
   rows are TRAINING GOLD — every refused action is recorded.
5. **All-local law**: no cloud, no telemetry, no model replacement via API.
   The model that moves the mouse must run on this machine.

# THE QUAD — Cockpit · Harness · Orchestrator · Model in Closed Loop

2026-08-25 | Author: ox-alpha | Status: architecture locked, slices S1–S5 queued

## Division of Loads (who carries what)

| Component | Carries | Never does |
|---|---|---|
| **MODEL** | cognition: reasoning, generation, tool-choice intent | self-approval, silent authority, unverified claims |
| **HARNESS** (scaffold+gates+BoN) | discipline & verification: SOP injection, mechanical scoring, provenance labels | executing tools, deciding intent |
| **ORCHESTRATOR** (agent loop+workflow) | execution & authority: tool driving, checkpoints, approvals, multi-step sequencing | grading its own outputs |
| **COCKPIT** (AIDE UI) | trust surface & telemetry: human decisions, provenance visibility, ship gates, measurement capture | generating content |

## The Three Reinforcement Loops

**Loop A — per request (seconds):**
Cockpit captures intent → Harness sizes scaffold (micro/full by served ctx,
composes credo+SOP byte-deterministically, drift-reinjects at 50%) → Model
generates (gated BoN: N samples, early-stop on clean) → Gates score
mechanically → Orchestrator applies through approval gates → Cockpit shows
provenance + diff. *Every arrow logged.*

**Loop B — per session (minutes):**
Drift telemetry calibrates reinjection threshold · delegation posture tunes
orchestrator authority · provenance chips calibrate operator trust · served-ctx
probe adapts harness to reality.

**Loop C — across sessions (the flywheel, THE MISSING PIECE):**
ships.log + battery JSONs + approved/rejected diffs + T06-class probe results →
contrastive induction (what differed between failed and passed attempts) →
`[learned]` blocks injected by the harness → the SAME model gets better with
weights frozen → accumulated verified trajectories become the fine-tune
dataset when training happens (SkillGen/EvoLib design already in veritas
skill). This is where "every model improves because of the suit" becomes real.

## What's Missing (honest audit against the loop ideal)

1. **Loop C doesn't exist yet** — outcomes are logged piecemeal (ships.log,
   batteries) but nothing distills them into `[learned]` injections. HIGHEST
   leverage missing piece.
2. **Two discipline sources**: chat scaffold composes from credocore.md, agent
   loop builds its own system prompt string. They agree today by copy-paste;
   they must compose from ONE loader (drift otherwise).
3. **Per-model SOP emphasis absent**: profiles tune samplers per model, but the
   SOP layer is identical for a 360M toy and a 7B coder. Capability-aware
   emphasis (what to stress vs omit) is unbuilt.
4. **Fast-ready offline gaps**: TS runtime lacks explicit post-spawn warmup
   ping (legacy has it); no opt-in auto-start of last engine on boot; Vulkan
   pipeline cache helps only after first run (documented, not surfaced);
   quant choice isn't benchmark-driven in-product yet (runner exists).
5. **Calibration data too thin**: drift 50% and delegation defaults are policy,
   not measurement — collection started tonight (N target 20 transcripts).

## Build Order (each slice keeps the loop closed)

- **S1 — Single discipline source**: extract `credocoreLoader()` consumed by
  BOTH chat scaffold AND agent-loop system-prompt builder; version-stamped;
  agent gains task-family SOP slice. (kills gap 2)
- **S2 — Loop C v0**: `.aide/library/events.jsonl` capture on every
  approve/reject/ship; `npm run library:distill` produces `learned.jsonl`;
  harness appends ≤5 matching lines as `[learned]` block with provenance
  count. Offline, deterministic, weights frozen. (gap 1)
- **S3 — Fast-ready pack**: TS warmup ping post-start; opt-in AUTO_START last
  engine (RAM-guard respected, session flag); MODELS panel shows backend +
  bench-verdict chip per engine; document pipeline-cache warmth. (gap 4)
- **S4 — Calibration**: after N≥20 transcripts, drift threshold + delegation
  defaults become data-derived; store per-model in profile sidecars. (gap 5)
- **S5 — Capability-aware SOP emphasis** once fine-tune lands: battery deltas
  per task-family drive which SOP lines matter for THIS model. (gap 3)

## Invariant (non-negotiable)

Every loop closes through the OPERATOR: model proposes, harness verifies,
orchestrator executes, cockpit decides. Reinforcement means each component
makes the OTHER THREE better — never bypasses them.

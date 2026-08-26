---
name: aide-the-quad
description: THE QUAD — closed-loop architecture binding Cockpit (trust+telemetry), Harness (discipline+verification), Orchestrator (execution+authority), and Model (cognition) with three reinforcement loops. Governs any feature touching component sync, the improvement flywheel, unified discipline sourcing, warm-start/offline readiness, or calibration data. Use before adding cross-component features or changing prompt/scaffold sources.
---

# THE QUAD — One System, Four Loads, Three Loops

Authoritative design: docs/THE-QUAD.md in-repo (read it first — this skill
adds the LAW layer).

## Laws

1. **Single discipline source**: chat scaffold AND agent-loop system prompts
   compose from common/harness/credocore.md via ONE loader. Two hand-written
   prompt strings = drift = forbidden.
2. **Loop C capture is mandatory**: every approve/reject/ship emits an event to
   .aide/library/events.jsonl. Features that skip capture break the flywheel.
3. **[learned] blocks are earned**: only entries with >=5 paired outcomes and
   non-negative net effect inject; provenance count always shown; operator can
   purge the library.
4. **Warm-ready is a feature**: every engine path must trigger post-spawn
   warmup; AUTO_START is opt-in, RAM-guarded, session-flagged.
5. **Calibrate, don't guess**: thresholds (drift %, delegation defaults)
   become data-derived once N>=20 transcripts per model; policy defaults until
   then are labeled as such in code comments.

## Slice map

S1 unified credo loader · S2 Loop C v0 (capture/distill/inject) · S3
fast-ready pack (warmup/auto-start/bench chips) · S4 calibration · S5
capability-aware SOP emphasis. Each slice: build -> live verify -> evidence ->
journal -> commit.

## Integration

- Consumes: credocore.md (credo-guardrail), ships.log + battery outputs,
  profile sidecars (inference-control), served-ctx probe (model-runtime).
- Feeds: fine-tune dataset builder (post-training-closed-loop format),
  MODELS panel backend/verdict chips, rail badges.
- Conflicts resolve toward: operator authority > deterministic gates >
  harness prose > model preference.

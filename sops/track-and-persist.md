---
name: track-and-persist
version: 1.0.0
category: discipline
applies_to:
  - track
  - persist
  - audit
  - provenance
tools_required:
  - read_file
sop: |
  1. Every approved trajectory is persisted to Helix with a digest.
  2. Every rejection is persisted with a reason.
  3. Every completed task writes a result to .aide/trajectories/<id>.traj.json.
  4. The journal records: which files were read, which tools were called, what the operator approved or rejected, what the model emitted, what the verdict was.
  5. The audit trail is permanent; no rolling, no truncation, no overwriting.
description: |
  Universal SOP: track and persist every action. The journal is the
  operator's safety net. Helix is the agent's learning substrate. The
  Trajectory store is the audit log. Three separate concerns, all
  persistent, all immutable. This SOP makes the closed loop real: every
  approved trajectory is the input to the next fine-tune.
failure_modes:
  - condition: trajectory not persisted after approval
    recovery: critical bug; the loop is broken
  - condition: rejection lost
    recovery: every rejection is part of the audit
  - condition: journal rolled or truncated
    recovery: the journal is append-only; never delete
success_metrics:
  - persisted-trajectories: every approved trajectory
  - audit-trail-completeness: 100%
---

# Track and Persist

Every action is recorded. The journal is append-only. Helix accumulates
approved trajectories. The Trajectory store is the audit log. Three
separate concerns, all persistent, all immutable.

## Why this SOP exists

The credo line 32: "Carry the work forward. Make changes reviewable,
reversible, documented, and usable by the next developer." The closed
loop the operator described — model, harness, orchestrator, code all
reinforce each other — REQUIRES persistence. Without persistence, the loop
is just chat.

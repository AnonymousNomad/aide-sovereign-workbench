---
name: fail-closed
version: 1.0.0
category: discipline
applies_to:
  - failure
  - error
  - close
tools_required:
  - bash
sop: |
  1. If a tool fails, surface the error verbatim; do not swallow.
  2. If a check fails, stop and report; do not continue as if it passed.
  3. If a tool returns ambiguous output, surface the ambiguity; do not guess.
  4. If the operator asks "did it work?" after a failure, the answer is "no, here's the output."
  5. "fail-closed" means: when in doubt, do not proceed. The blast radius of a wrong action is larger than the blast radius of a stopped action.
description: |
  Universal SOP: when something fails, surface the failure and stop. The
  opposite of fail-open (which guesses-and-continues). This SOP enforces
  the Veritas oath "No hidden damage" and "No buried uncertainty."
failure_modes:
  - condition: tool returns an error and the agent loop continues
    recovery: critical bug; halt the session, surface to operator
  - condition: agent loop hides a failure from the operator
    recovery: the failure must be in the trajectory
  - condition: bash command exits non-zero and the model claims success
    recovery: that is a forbidden auto-approval
success_metrics:
  - swallowed-errors: zero
  - hidden-damage: zero
---

# Fail Closed

When something fails, stop and report. The opposite of fail-open
(guessing and continuing). The blast radius of a wrong action is larger
than the blast radius of a stopped action.

## Why this SOP exists

The credo line 28: "Keep the contract. State what was done, what was
not done, and what remains uncertain." The Veritas oath "No buried
uncertainty" makes this non-negotiable.

---
name: failure-harness-trace-contract-drift
description: Diagnose and prevent stale exact trace-count assertions after intentional orchestrator or agent-loop stage additions. Use whenever a harness test reports an unexpected trace length or a chained battery stops in harness/test-orchestrator.mjs.
---

# Harness Trace Contract Drift

## Trigger

Use this skill when a harness test fails because an observed trace length differs
from its exact expected length after a legitimate orchestration stage was added.

## Procedure

1. Stop the chained battery at the first failure. Do not remove a trace stage to
   preserve an obsolete count.
2. Read the failing test and the trace-producing implementation together. Name
   the added stage, ordering, status, and whether it is present on every path.
3. Run the focused harness test and inspect the trace entries directly if the
   ordering is unclear.
4. Update only stale test expectations. Keep assertions for required stage names
   and ordering where the contract matters; avoid weakening the test to a range
   or a minimum without a reason.
5. Rerun the focused test, then restart the full battery from the beginning with
   failure-propagating `&&` semantics.
6. Verify process cleanup after the failed and successful runs before reporting
   the gate result.

## AIDE Instance

`harness/orchestrator.mjs` records `skill-detect` before `plan`. Therefore the
original five-stage first-flow expectation in `harness/test-orchestrator.mjs`
must be six while preserving the existing approval, provider, and Veritas
assertions.

## Anti-Patterns

- Removing a useful trace stage solely to make an exact count pass.
- Replacing an exact count with `>=` without proving variable stages are part of
  the intended contract.
- Rerunning the entire chain before the focused failing test is green.
- Claiming the battery passed when `&&` stopped before later commands.

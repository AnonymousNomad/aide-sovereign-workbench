# AIDE Shared Model Workflow

AIDE presents multi-model work in one visible conversation. Models do not have a
private uninspectable debate. Each handoff is a typed, reviewable artifact.

## Flow

```text
USER TASK
  -> ANALYST MODEL: constraints, files, risks, open questions
  -> USER APPROVES HANDOFF
  -> BUILDER MODEL: implementation plan or unified diff
  -> USER REVIEWS PATCH
  -> DETERMINISTIC CHECKS: parse, tests, diagnostics, security, Git diff
  -> INDEPENDENT VERIFIER
  -> OUTCOME OR ABSTENTION
```

The models can reinforce one another by seeing the structured artifact from the
previous lane. The next model never receives hidden model memory; it receives
the exact handoff shown to the user.

## Evidence Threshold

The displayed confidence is not a model opinion and is never calculated from
two models agreeing. A high-confidence outcome requires independent evidence:

- valid structured patch;
- tests required by the task pass;
- diagnostics are clear or explicitly accepted;
- security and path checks pass;
- Git diff matches the requested scope;
- an independent verifier approves with concrete reasons.

Until those checks run, AIDE displays `NOT SCORED`. A configured `98%` gate is a
release/security threshold, not a claim of universal truth. Any failed,
missing, or unverifiable check produces `ABSTAIN` and preserves the artifact for
review.

## Model Roles

- **Analyst:** investigates and constrains; does not edit.
- **Builder:** proposes implementation; does not apply.
- **Verifier:** checks evidence and execution; cannot approve its own output.
- **Operator:** executes only approved deterministic tools.

The user can use one model in multiple roles, but two independent models are
preferred when memory allows. On constrained devices AIDE runs them sequentially
and unloads the first model before loading the next.

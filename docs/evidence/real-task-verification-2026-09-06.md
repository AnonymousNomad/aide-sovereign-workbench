# Real-task verification — 2026-09-06

This record separates behavioral proof from smoke/structural checks.

## Harness task matrix

Command:

```text
node --experimental-strip-types --no-warnings --test tests/in-house-e2e/orchestrator-task-battery.mjs tests/in-house-e2e/chassis-orchestrator-battery.mjs tests/unit/test-orchestrator-card.mjs
```

Result: **12 passed, 0 failed**.

The matrix used user-shaped intents for debugging, code explanation, atomic
commits, safe refactoring, regression tests, legacy extension-host work, and
an unknown request. Each case asserted the selected skill, routing evidence,
Helix bootstrap visibility, preserved L0 safety guidance, budget compliance,
and no workspace mutation. The unknown case asserted explicit uncertainty
routing rather than a guessed skill.

During the first run, two real false positives were found: substring matching
made `it` match `git`/`commit`, and generic legacy tokens such as `service`
captured unrelated requests. The fix uses exact token/phrase matching and
filters legacy routing-noise tokens (`aide`, `task`, `service`, `phase`, and
`bN`). The regression matrix passed after the fix.

## Full daemon acceptance workflow

Command:

```text
node scripts/acceptance-real.mjs
```

Result: **REAL AIDE ACCEPTANCE PASSED**.

Observed user workflows and durable assertions:

- workspace tree and file read/write, including approval refusal;
- unified patch application and persisted file content;
- terminal command execution with captured output;
- TypeScript LSP start, initialize, open, completion, and stop;
- task execution and passed status/output;
- Git status, diff, stage, and commit;
- session persistence;
- plugin trust and real plugin execution;
- Academy course/check/complete state;
- blueprint, provider, artifact, and search state;
- invalid search inputs refused with typed failure responses.

## Not claimed

This verifies the harness, router, daemon, and local workflow mechanics. It does
not claim model-quality improvement; a model canary still needs a controlled
local engine run with prompt/output capture, latency, context fill, and
independent task grading. No model was started during this verification.

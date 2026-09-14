# Verification / Review / Truth Audit

## Repaired live agent

[AgentLoop buildExecution](../../../node/src/services/agent-loop.mjs#L579) distinguishes execution results from required artifacts/tests. Tool success is not proof of tests. Required artifact validator is unavailable after a write, incomplete without a write; required test verifier is unavailable. Terminal verification is always passed:false and incomplete/unavailable/failed/errored as appropriate.

The 29-test production-facade regression confirms: no artifacts/tests is unverified; nonzero command is execution failure; disk failure is observable; rejected verification event cannot claim publication; successful writes remain unverified. This is valuable correct behavior.

Limit: no legitimate agent task can attain passed verification today. All modes use code-change semantics, including planning and explanations. Model attempt_completion controls done and summary. Consumers must not equate done with independently verified or even fully satisfied requirements.

## Generic verifier defect (F02)

[harness/veritas.mjs:33](../../../harness/veritas.mjs#L33) accepts caller evidenceScore and checks; passed means score≥threshold and no false checks. Empty check sets pass vacuously. evaluateExecution turns any truthy execution.passed into score 1.

Actual in-memory outputs:

| Input | Actual output |
|---|---|
| execution={passed:true,checks:{},results:[]} | passed:true, status:verified, sufficient |
| execution={passed:"false",checks:{}} | passed:true, status:verified, sufficient |
| evidenceScore=1, checks={} | passed:true, status:verified |
| sandbox.runVerification([]) | passed:true |

The rule string “Model confidence is not evidence” does not enforce evidence origin or sufficiency. Consumers include standalone createHarness and report scripts. With no verificationRunner, createHarness can rely on caller context.evidenceScore and patch-parse alone; verifier-model APPROVE is not independent execution evidence.

**Reachability limit:** current AgentLoop overrides the generic result with passed:false. Do not claim these probes reproduced a positive VERIFIED through the production agent route. This remains P0 in the shared truth primitive/report path because it manufactures a definitive verification claim from invalid/missing evidence.

## Other verification authorities

- runVeritasChecks executes compile/tests/diff plus manifest/path/secret checks. Better than model opinion, but skipped non-Git diff is marked passed:true; changedFiles defaults empty; secret scan excludes many file kinds. Required-evidence applicability needs explicit policy.
- Sandbox verification uses caller-supplied commands and returns true for zero commands. Scratch is a directory, not an OS sandbox. Its real apply is not equivalent to scratch patch application.
- Desktop autoAssert is a heuristic post-check. act.ok stays true even when assertion.pass=false. It records execution separately but Telegram does not report assertion failure.
- Best-of-N is textual penalty ranking. TODO, apology, repetition and length checks are not tests or correctness.
- DesktopPolicyHook.propose labels a proposal executed based on confidence without executing it; test-only consumer found.
- Legacy Workflow verification is patch parse, not applied-code acceptance.

## Event and durable state ordering

Terminal code writes a verification snapshot with publication/audit pending, appends a verification audit row, publishes an event containing publication pending, updates in-memory publication afterward, then runs session-end callback. Later callback failure may change state to errored without rewriting the snapshot or emitting a corrected verification event. Publication acceptance, delivery and durability remain separate; the original Phase 1A fix preserves negative truth but the final evidence view is not reconciled.

EventHub validates producer shape and returns acceptance. WebSocket send callback errors log failures; there is no delivery acknowledgment/replay protocol. The production event→facade→subscriber regression passed for a subscribed fixture.

## Acceptance evidence correction

docs/HANDOFF_OPENCODE.md calls acceptance-real.mjs “real local-model acceptance.” The script exercises legacy services and has no model inference. acceptance-p0.mjs uses a hermetic scripted provider. These are valuable integration tests, not a real local-model coding-loop certificate. Historical runs were not rerun here.

Future verifier needs task-specific required checks, trusted execution receipts, applied-revision binding, skipped/unavailable/error semantics, independent acceptance oracles, and final durable state reconciliation. Reviewer opinion must remain distinct from deterministic verification.


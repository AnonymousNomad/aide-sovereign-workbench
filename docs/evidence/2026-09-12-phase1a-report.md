# Phase 1A — execution integrity review package

Baseline: `536d08996d269d86aef997c5a514cd498c5686b8`. Scope: Phase 1A only, including the explicitly approved persistence/EventHub authorities and prompt-tier test synchronization. No Phase 1B/1C, transport cutover, UI migration, role orchestration, model acquisition, corpus edits, staging, commit or push.

Status: bounded implementation and requested Phase-1A gates complete; STOPPED FOR COLLABORATOR REVIEW. This is not a production-readiness or real-model coding-acceptance claim.

## Behavioral changes

- Agent direct-tool dispatch cannot manufacture mutation authority from payload approval, model arguments, truthiness, aliases or sandbox selection. Mutating/risky tools require the existing session approval flow. Session decisions accept only the exact enum and consume pending authority once. Legitimate approved session writes and direct read-only operations remain supported. This claim covers the repaired agent execution paths, not every application API or OS privilege boundary.
- The existing async skills factory is awaited and correctly declared. Its scorer is unchanged. No match, missing provider, successful injection and loader failure are distinct. Required-context failure stops inference and is observable. The production-route regression captures the actual model-request system messages and asserts the selected skill sentinel.
- A tool returning `ok:false` is execution failure. Completion and successful commands are not independent code verification. Status distinguishes execution from verification, required evidence, persistence errors and publication receipts.
- The current loop has no trusted requirement-bound artifact/test verifier. It now reports incomplete/unavailable/failed/errored and does **not** emit affirmative VERIFIED. The passed category is represented for future use, not claimed as an implemented positive verifier. Even a successful approved code write is unverified without independent evidence.
- Verification/context/plan event contracts match their producers. EventHub returns schema acceptance or rejection; send failures are logged. A real verification producer reaches a subscribed facade WebSocket in the integration fixture. EventHub acceptance is not proof of subscriber receipt or durable persistence.
- Cipher-state and audit writes return explicit persistence results without becoming universally fatal. The agent tracks its required audit writes and awaits trajectory/evidence writes and the session-end callback before terminal state. File references are returned only after successful write, sync and close. Failures remain visible without erasing known execution results.
- Evidence JSON is a pre-publication/pre-audit snapshot with pending receipt fields. Live session status holds subsequent receipts. A file sync acknowledgment is not a universal power-loss or directory-durability guarantee. Best-effort callers outside the scoped agent path may still ignore persistence results.
- Audit reads accept the producer's legitimate `error:null` field without broadly weakening schemas. Prompt-tier teardown awaits the actual terminal event before removing its workspace; all 16 assertion lines across four tests remain unchanged, with no added sleeps, retries or ENOTEMPTY suppression.

## Exact changed source and test files

Production (13):

- `common/contracts/agent.ts`
- `common/contracts/audit.ts`
- `harness/cipher-state.mjs`
- `harness/cipher-state.d.mts`
- `node/src/events.ts`
- `node/src/openapi.ts`
- `node/src/routes/agent.ts`
- `node/src/services/agent-loop.mjs`
- `node/src/services/agent-loop.d.mts`
- `node/src/services/audit-trail.mjs`
- `node/src/services/audit-trail.d.mts`
- `node/src/services/skills-loader.mjs`
- `node/src/services/skills-loader.d.mts`

Tests (4): new `tests/arch/agent-execution-integrity.test.ts`; changed `tests/arch/audit-routes.test.ts`, `tests/arch/closed-loop-mission.test.ts`, `tests/unit/test-agent-loop-tier.mjs`.

Generated: `common/openapi.json`. Evidence/journal: dated Phase-1A files in this directory and the Phase-1A `AGENT_NOTES.md` hunk. A Phase-1A status was also appended to the untracked Phase-0 risk register, but that whole Phase-0 artifact remains excluded from this repair commit. The four pre-existing operator scripts and independent Phase-0/north-star artifacts are not part of the proposed repair commit.

Final pre-commit tracked diff: 18 files, 623 insertions / 220 deletions (includes generated OpenAPI and both Phase-0/Phase-1A journal entries). This excludes the new 293-line integrity test and untracked evidence/Phase-0 documents. `phase1a-static.json` retains per-file numstat; `phase1a-static-handoff.json` records the final static gate exit 0. The index was empty before deliberate commit assembly.

## Regression coverage

The new integrity fixture exercises omitted/false/string-false/null/number/object/true payload approval, model argument escalation, workspace and sandbox dispatch, aliases, commands and desktop dispatch; assertions prove absence of unauthorized files and sandbox directories. It also covers exact session decisions, one-shot valid approval, actual skill injection, no-match, loader failure, completion without requested code/tests, nonzero commands, real EventHub rejection, facade WebSocket delivery, audit write failure and evidence-file failure. Audit-route tests cover context rows with both null and non-null errors. Closed-loop assertions now separate successful execution from unverified code.

## Evidence by level

| Level | Observed result | Evidence |
|---|---|---|
| STATIC | Syntax and tracked-file scope checks pass; diff whitespace check passes; 16 tier assertion lines unchanged. | `phase1a-static.json` |
| TYPECHECK | Node and browser both exit 0. | `phase1a-typecheck-node-final.json`, `phase1a-typecheck-browser-final.json` |
| UNIT | Prompt-tier 4/4; contract drift 2/2; no failures, cancellations or skips. | `phase1a-tier-final.json`, `phase1a-contract-drift-final.json` |
| INTEGRATION | Integrity 29/29; affected suite 60/60; environment-focused 16/16. All zero failures/cancellations/skips on final scoped runs. | `phase1a-regression-after-1.json`, `phase1a-affected-2.json`, `phase1a-environment-focused.json` |
| RUNTIME | Full architecture: 438/438 pass, 0 fail/cancel/skip, 289,971.8675 ms. Includes real LSP, debugpy, processes and existing model lifecycle fixtures. | `phase1a-architecture-full-final.json` |
| ACCEPTANCE | `acceptance-p0` exit 0, 17.627 seconds: isolated stack boot/restart, approvals, LSP, terminal/tasks, Git, local scripted provider, agent edit, audit/memory and persisted recovery. Real local-model coding acceptance NOT RUN. | `phase1a-acceptance-p0-final.json` |

Lint exits 0 (0 errors, 65 warnings). Contract generation exits 0, producing 664,030 bytes and 203 documented routes. Exact Node arguments, timestamps, exit codes and raw output are retained in each gate JSON and consolidated by `phase1a-ledger.mjs` into `phase1a-ledger.json`. `phase1a-run.mjs <label> <node arguments>` is the local serial recorder. Environment-focused/full-final/acceptance-final runs use child-only `AIDE_PYTHON=E:\Python310\python.exe` and approved process-query permission outside the sandbox.

Counts overlap across runs and must not be added as independent coverage. Historical 405/405 is not a like-for-like count: the current full runner discovers 78 test files, including the new integrity fixture, and reports 438 tests. Scripted-provider acceptance remains integration evidence, even when its command name says acceptance.

## Failures retained and researched

- Regression-first: 8 pass / 13 fail, zero cancelled/skipped. Repaired focused integrity: 29/29 pass.
- First affected run: 57/59; audit nullability and premature tier teardown failed. Both were repaired within approved boundaries. Subsequent affected run: 60/60, zero cancelled/skipped; tier: 4/4.
- Initial node typecheck found TS7016 in the new fixture's facade import. A typed test-local adapter fixed it without production boundary expansion or compiler suppression; final node/browser typechecks pass.
- First full architecture run: 438 tests, 433 pass / 4 fail / 1 skipped / 0 cancelled, 1,048,999.8799 ms. Default `py -3` selected an inaccessible Windows Store interpreter, causing two exercise failures and a real-debugpy skip. Sandbox `tasklist` returned Access denied, causing two process-manager alive-before assertions to fail before cleanup. Two verified test-owned children (6872/6204 under worker 17692) required manual termination; zero targeted survivors were verified. This is a failed run, not a clean lifecycle pass.
- Existing `E:\Python310\python.exe` ran successfully and has debugpy installed. Child-only `AIDE_PYTHON` plus elevated process-query permission produced a focused 16/16 pass, zero skips. No Python install, global PATH edit, process-manager source change or relaxed assertion was needed.
- Lint: zero errors, 65 warnings, matching the Phase-0 warning count. Late fixture logger ENOENT warnings also remain visible in broad runs; they are outside this bounded repair and are not silently suppressed.

Raw records: `phase1a-*.json`; failure procedure: [local research skill](phase1a-execution-integrity-skill.md). The earlier [review checkpoint](phase1a-review-pause.md) is historical and not the current gate status.

## Resource/process actions

After explicit user authorization to prioritize testing, the identified corpus generator wrapper/interpreter (11180/13768) and its current model child (4324) were stopped and verified absent. No scripts, saved corpus rows, checkpoints or models were edited or deleted; an in-flight generation may have been lost. Completed-record flush behavior was inspected. They were not restarted automatically. See [process control record](phase1a-process-control.json).

The architecture battery started existing local model fixtures and verified stop behavior. Model lifecycle tests do not constitute real local-model coding acceptance. Final process inventory at 2026-09-12 04:54 +05:45 shows no test-owned runtime survivors and no matching rows for ports 4173/4777/4778/4779 or final integrity ports 59676/59677. See [final cleanup](phase1a-cleanup-final.json).

On resume, operator generation was running again under supervisor_v2.py (14332/7048 -> 17172/17212 -> model 17976 on 8081), with current Codex 17848. This agent did not restart it and left it alone because heavy testing was finished. Old test PIDs 7152/10000/11616 were reused by svchost/WMIADAP and were correctly not killed. Cleanup claims are identity-based, not PID-only.

The final full run retains six late logger ENOENT warnings (subagent, BYOK, commands, dataset, eval-export and hardware fixtures). Acceptance stderr is empty. The initial full run retained four logger warnings. They remain separate from the successful test assertions and are not suppressed.

## Remaining risks / deferred work

- Independent positive requirement-bound verification and a real local-model coding transaction remain unproven and deferred to a separately authorized gate.
- Browser/facade envelope incompatibility, default legacy launch, legacy ownership and canonical transport remain unchanged. No frontend cutover claim.
- No universal audit guarantee across every best-effort consumer, no subscriber-delivery acknowledgment protocol, and no crash/power-loss recovery guarantee were added.
- Late fixture logger teardown warnings and existing lint warnings remain. No unrelated cleanup was authorized.
- Packaging, install/upgrade/rollback, GUI acceptance, watchdog/negative push gates, model-role routing, mobile and visual redesign remain outside Phase 1A.

## Proposed commit and rollback boundary

Propose one reviewed commit: `fix(agent): enforce execution integrity and truthful evidence`, containing only the listed repair files, generated contract and explicitly selected Phase-1A evidence/journal changes. Review the pre-existing Phase-0 journal hunk separately; do not bulk-stage the worktree. Nothing is committed or pushed by this work.

Rollback should revert that specific reviewed commit in a subsequent commit, not reset the worktree or remove `.aide` state. Preserve historical evidence and operator artifacts. Reverting reintroduces the known approval and false-verification defects; disable affected agent mutation surfaces operationally if rollback is required, pending an authorized safe repair. No automatic rollback, data deletion or legacy removal is performed.

Stop for collaborator review after final evidence. Phase 1B and Phase 1C remain unauthorized.

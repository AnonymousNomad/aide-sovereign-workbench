# BOUNDARY EXPANSION REQUIRED — direct-service fixtures

Baseline: covert-production @ bdbaff6eeb435a7a9ffe18551843ed24d4f97a58.

The prior 41-file HTTP/WebSocket expansion is APPROVED and is not the stop reason. This request covers five different direct-service callers outside that list and outside the original Phase 2A test boundary. No additional production files or dependencies are requested.

## Exact requested test/battery boundary

| File | Dependency / evidence | Smallest required change |
| --- | --- | --- |
| tests/unit/test-a1-agent.mjs | Lines 179–203 construct AgentLoop without authority, call start/decide with no actor, and require a real hello.txt write. Lines 208–232 exercise rejection/abort. | Supply a real paired fixture operator, delegated task actor and exact approval to the canonical loop boundary. Preserve every existing write/no-write, parser, jail, checkpoint and rejection assertion. |
| tests/unit/test-agent-loop-tier.mjs | Lines 37–53 and 91 start real sessions without actor state. | Add only legitimate session identity/bootstrap fixture setup. Preserve all four prompt tests and the existing awaited termination cleanup. Read-only/completion probes must not require mutation approval. |
| tests/arch/agent-architect-editor.test.ts | Lines 48–49, 73–81, 104–112 and remaining cases construct/start real sessions without actor state. | Pass real authenticated/delegated fixture identity through session start. Preserve model-call counts, plan events, limits, collapse behavior and read-only mode assertions; no architecture redesign. |
| scripts/desktop-battery.mjs | Lines 58–65 construct desktop and install grants without canonical identity; act calls rely on approved:true. Lines 90 and 158 run taskkill /IM notepad.exe /F. | Pair a real fixture operator and explicitly authorize exact grants/actions. Replace unsafe image-wide process probes/termination with disposable owned-child lifecycle assertions and unrelated-process survival checks. Preserve intended denial, TTL, panic, provenance and literal-data behavior; do not run Office/operator-state-affecting probes. Record resource/side-effect-dependent gates honestly rather than falsely passing them. |
| scripts/telegram-brain-battery.mjs | Lines 42–54 call onCommand using chatId/text only and assert fake desktop mutation after plain YES; the asserted approval marker is merely a body boolean. | Use canonical adapter identity and action-bound confirmation, retaining zero calls before confirmation and exactly one after valid consumption; add wrong identity/replay cases. Keep the disposable captured executor, but do not mock away authority. |

## Why existing scope is insufficient

HTTP fixture migration cannot supply identity to tests that never call HTTP. Checkpoint D must bind AgentLoop sessions, decisions, tool dispatch, desktop grants and Telegram confirmation to the same authority. Keeping an unauthenticated in-process compatibility mode to preserve these tests would create the second authority / security bypass explicitly forbidden by the contract.

All five are tracked files. None has been modified. No service behavior was weakened to accommodate them. The desktop battery was inspected only; its image-wide termination was never executed.

## Changes and tests affected

Use the already-approved real-pairing fixture (or equivalent real composition-root pairing within the existing test file) and explicit per-action decisions. Do not add universal credentials, blanket auto-approval, skipped tests, broad catch-and-success, arbitrary sleeps, or assertion weakening.

Affected checks: these direct-service batteries plus the approved capability/agent/desktop/security regressions and architecture battery. Existing pure parser/scorer/prompt semantics are unchanged. The previously approved 41 HTTP/WS candidates remain approved, not re-requested.

## Partial evidence at this stop

See CHECKPOINT_C_RESULTS.json. Final focused run: 13 passed, 0 failed/cancelled/skipped, 1737.1744 ms. Both typechecks exit 0; targeted lint exit 0, zero errors/warnings. Git negative executor was captured, not run. WS proof is direct TS, not yet a composed facade-positive claim. Private IPC primitive is present but unintegrated/unverified.

38/38 protected files retain their baseline SHA-256 values. Checked fixture PIDs/listeners are gone. No operator processes stopped. No native changes, commit or push.

## Resume after approval

Continue C bootstrap/facade/legacy and positive composed transport; then D canonical capability/agent/service integration with these five fixtures; then E owned-process panic; then F adversarial acceptance. Do not re-run A merely for ceremony. Do not push this partial state.

Native compilation/startup remain deferred, not a blocker. Even after all non-native gates pass, native acceptance remains open.

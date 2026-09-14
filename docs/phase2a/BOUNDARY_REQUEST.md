# Phase 2A — Test Boundary Expansion Required

Checkpoint B has an isolated authority primitive and 10 passing state-machine tests. Checkpoint C is not integrated.

## Required expansion

No additional production file is requested. The accepted maximum test boundary omits existing runtime fixtures that assume unauthenticated HTTP/WS access. They must use real operator pairing and explicit operation approval after transport enforcement. Leaving them unchanged would either fail the affected architecture battery or, in tests with early-return guards, silently stop testing their intended success path.

Confirmed source examples:
- tests/arch/task-routes.test.ts: post() sends unauthenticated requests; positive tests execute real disposable tasks.
- tests/arch/agent-routes.test.ts: post()/get()/wsSubscribe() have no authenticated actor; successful agent workflows depend on these.
- tests/arch/ws-events.test.ts: unauthenticated connection subscribes to log events.
- tests/arch/events-contract.test.ts: subscribe() opens a bare socket and expects channel delivery.
- tests/arch/server.test.ts: workspace success checks can return early on an error envelope rather than assert authenticated success.

## Exact proposed maximum test expansion

- tests/arch/agent-routes.test.ts
- tests/arch/agent-subagent.test.ts
- tests/arch/audit-routes.test.ts
- tests/arch/bucket-c-routes.test.ts
- tests/arch/byok-routes.test.ts
- tests/arch/cache-routes.test.ts
- tests/arch/closed-loop-mission.test.ts
- tests/arch/closed-loop.test.ts
- tests/arch/command-routes.test.ts
- tests/arch/dap-routes.test.ts
- tests/arch/dataset-routes.test.ts
- tests/arch/editor-options-routes.test.ts
- tests/arch/eval-export-routes.test.ts
- tests/arch/events-contract.test.ts
- tests/arch/exercise-routes.test.ts
- tests/arch/file-routes.test.ts
- tests/arch/handoff-routes.test.ts
- tests/arch/hardware-routes.test.ts
- tests/arch/helix-wiring-runtime.test.ts
- tests/arch/hint-routes.test.ts
- tests/arch/index-routes.test.ts
- tests/arch/learner-routes.test.ts
- tests/arch/lsp-contract.test.ts
- tests/arch/model-register-profile.test.ts
- tests/arch/model-routes.test.ts
- tests/arch/modelhub-routes.test.ts
- tests/arch/notification-routes.test.ts
- tests/arch/onboarding-runtime.test.ts
- tests/arch/problem-routes.test.ts
- tests/arch/provider-routes.test.ts
- tests/arch/resident-routes.test.ts
- tests/arch/search-parity.test.ts
- tests/arch/search-routes.test.ts
- tests/arch/server.test.ts
- tests/arch/session-routes.test.ts
- tests/arch/system-map-runtime.test.ts
- tests/arch/task-routes.test.ts
- tests/arch/training-routes.test.ts
- tests/arch/workbench-routes.test.ts
- tests/arch/workspace-routes.test.ts
- tests/arch/ws-events.test.ts
- tests/arch/authority-fixture.ts (new shared fixture helper; not a production module)

The 41 existing files were identified by direct ArchServer/EventHub construction plus HTTP/WebSocket calls. This is an impact candidate list, not authorization to rewrite every file. Change only callers that require pairing/explicit fixture approvals. Independently preserve tests that intentionally exercise unauthenticated denial.

## Smallest proposed mutation

- Pair a fixture operator using the real supervisor-owned bootstrap API.
- Pass that actor credential through the real client/server transport.
- For each positive mutation test, explicitly prepare and approve its exact fixture operation.
- Authenticate event subscriptions using the production protocol.
- Keep original payload/result/side-effect assertions; add positive-envelope assertions where necessary to avoid early-return false greens.
- Reuse one helper to avoid copying a permissive fake authorization path across the suite.
- No global fetch monkeypatch, environment bypass, implicit test actor, arbitrary sleep, retry change or unrelated fixture cleanup.

Dependency: upcoming guards in node/src/server.ts and node/src/events.ts intentionally change every protected request's prerequisites.

Tests affected: the exact list above plus already-approved transport/agent/capability regressions. No tests outside this list are requested in this expansion.

## State at stop

- No listed out-of-boundary test modified.
- No transport guard integrated yet.
- No native source changed. Rust/Cargo absence is deferred, not this stop reason.
- No commit or push.
- Next action after approval: complete core retention/audit review, then implement checkpoint C and migrate fixture transport alongside it.


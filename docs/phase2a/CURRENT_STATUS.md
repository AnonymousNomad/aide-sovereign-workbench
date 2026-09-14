# Phase 2A — Current checkpoint

Baseline before this checkpoint: covert-production @ bdbaff6eeb435a7a9ffe18551843ed24d4f97a58.

**2026-09-13: Phase 2A route-authority checkpoint committed and pushed.** All 208 externally reachable TS routes are accounted with **0 conflicts and 0 unclassified**: PUBLIC 1, AUTHORITY_CONTROL 4, ENROLLED_CENTRAL 116, ENROLLED_DESCRIPTOR 22, MIGRATION-WAIVED 65. The permanent `tests/arch/route-authority-coverage.test.ts` enforces exactly one disposition per route (with a pinned, shrinking migration waiver) using real production route metadata and facade coverage.

Accepted and verified in this checkpoint: execution-authority core and operation policy; hook/notification/task/cache/telegram/desktop owner migrations; **onboarding atomic transitions** (caller-state TOCTOU reproduced deterministically, repaired with a per-service serialized critical section that re-reads state, compares the operator-approved precondition, and only then mutates; all onboarding writers share the boundary); **export effective filesystem containment** (safe-segment grammar + canonical workspace/root relationship + per-object realpath containment + exclusive temp-file/atomic-rename writes; junction, nested-junction, leaf-symlink, destination-symlink, destination-hardlink, root-junction and lexical-traversal matrices all proven).

Acceptance floor at checkpoint: export containment fixture PASS; focused authority/onboarding/drift/contracts suites 29/29; Node and browser typechecks PASS; eslint 0 errors; protected hashes 38/38; `git diff --check` clean; no test-owned processes/listeners.

**Next:** Wave 3A2 six-route bounded-write migration (datasets create/append, models register/profile, workbenches trust, training export). The full architecture battery remains deferred (known `git-routes.test.ts` teardown hang).

Historical stop (below) is resolved for the notification-hook slice only.
See BOUNDARY_REQUEST_NOTIFICATION_HOOKS.md. Task contract, BuildCache and b3/b5 fixtures are already approved; do not request them again.

## Exact current continuation changes

Production:
- common/contracts/tasks.ts: optional descriptive TaskAuthorityState and strict authority task event; phases command/cache-get/cache-record; states pending/executing/succeeded/denied/failed, operation reference and structured error. Existing process-status enum unchanged. No field grants authority.
- common/security/operation-policy.mjs: explicit tasks.command policy.
- node/src/services/execution-authority.mjs + .d.mts: canonical decision waiter with notifications and expiration deadline; approval/rejection/revocation/expiry observed without granting permission or polling.
- node/src/services/task-service.mjs + .d.mts: injected authority, start graph/environment descriptor, opaque start-handle consumption, delegated service actor, separately prepared/decided/consumed command and cache operations, private launch/context/child seams, truthful cache lifecycle and awaited completion, operator-bound stop.
- node/src/routes/tasks.ts: authority injection, dynamic start/cache-clear descriptors, opaque execution forwarding, canonical denials preserved.
- node/src/server.ts: optional trusted route-owned async operation description used at both prepare and execute, so changed task graphs invalidate approval.
- node/src/openapi.ts: same canonical authority passed into task service.
Generated: common/openapi.json.
Tests:
- tests/arch/authority-fixture.ts
- tests/arch/execution-authority.test.ts
- tests/arch/capability-authority.test.ts
- tests/unit/test-b3-compound.mjs
- tests/unit/test-b5-cache.mjs
Evidence only under docs/phase2a.

No notification service/route/fixture, protected file, native source, UI or Phase 2B production file changed this continuation.

## Authority lifecycle actually implemented

1. Trusted caller prepares a task-start descriptor binding current graph and environment digest; operator approves; execute re-resolves and consumes the exact descriptor.
2. TaskService delegates a service actor that can propose tasks.command/cache.mutate but cannot approve them.
3. Each command/cache get/cache record is a NEW exact canonical operation. Task state exposes its pending ID, not authority.
4. Only an owning operator's canonical decision permits consumption. A consumed start handle, copied operation object, serialized pending state or approved:true cannot substitute.
5. Mutation callbacks receive fresh active execution handles. Cache re-resolves target plans and claims its own entry once.
6. Process exit and cache outcome remain distinct: rejected recording leaves cache unchanged while the actual successful process exit stays known. Status/event exposes denial; no cache durability claimed.
7. Stop requires the same canonical owner, revokes pending work and uses retained child objects rather than taskkill PID-tree discovery.

Full compound/cache compatibility fixtures pass: sequence, parallel failure cleanup, background readiness, coordinator stop, LRU, hits/misses, content/environment invalidation, failed/background exclusion.
The fixtures explicitly inspect/approve only requested command graphs and selected cache phases. Unknown proposals are rejected. All meaningful original assertions retained; fixed sleeps used as completion proof were removed where changed. The background exclusion test waits for actual command-start evidence.

## Current evidence, by level

TASK_LIFECYCLE_RESULTS.json contains exact command and raw final output.
TASK_LIFECYCLE_INTEGRITY.json contains hashes, worktree/status and process/listener checks.

STATIC: diff check passed. Targeted lint zero errors, one pre-existing unused crypto warning in b5 fixture.
TYPECHECK: backend and browser both passed after final test changes.
UNIT/INTEGRATION/RUNTIME: final combined run **79 total; 78 passed, 1 failed, 0 skipped, 0 cancelled**, exit 1; 10089.4517 ms.
- Authority core: 14 passed.
- Original capability HTTP/WS: 3 passed.
- Cache security: 5 passed (23 path variants inside one test).
- Task lifecycle direct and real HTTP/EventHub/WS: 2 passed.
- Telegram delegation/HTTP: 6 passed.
- Desktop ownership: 6 passed.
- Composed facade/direct TS/legacy: 1 passed.
- Agent/checkpoint/tier: 25 passed.
- Compound/cache fixtures: 16 passed (8 each).
- NEW hook authority regression: 1 failed; two executor calls captured, ZERO hook processes and ZERO marker mutations.
The earlier 78/78 run before adding this assertion is historical, not current all-green evidence.

BUILD: typed frontend production build passed, 1376 modules, 24.86 seconds. Large-chunk and plugin-timing warnings remain; no UI edits.
CONTRACTS: generation passed; 685805 bytes, 207 documented routes. Second generation identical SHA256:
7f88246d31fe13abe32ddd9cba7b8c32c5271621dc3b94b69657c577149c4e4a.
This is generation/idempotence evidence, not full architecture acceptance.
FULL ACCEPTANCE: not run / not ready. Full lint and architecture battery not represented as passing.
NATIVE compilation/startup: DEFERRED — RUST TOOLCHAIN UNAVAILABLE. No installation or native runtime claim.
No real-model gate required; only scripted inference used.

## Newly confirmed blocker

Workspace-configured notification hooks are downstream of real task events in openapi.ts. NotificationService runs them outside canonical authority, including direct invocation. Their process-timeout path is also not ownership-verified. routes/notifications.ts owns hook-file persistence separately.
Requested production: notification-service.mjs, notification-service.d.mts, routes/notifications.ts.
Requested existing fixture: tests/unit/test-b4-notifications.mjs.
All remain unchanged. New assertion deliberately stays red.

## Remaining limitations before final Phase 2A sweep

- Repair notification-hook authority before asserting task end-to-end safety.
- Task stop currently proves/terminates retained direct child handles only. It no longer uses PID-tree taskkill. Arbitrary descendants created by shell/npm commands are NOT proven owned or guaranteed terminated; no full process-tree guarantee claimed.
- Session/operation revocation prevents pending/new actions; already-running arbitrary subprocess behavior after revocation needs full policy/cleanup acceptance.
- Task required-event rejection, decision audit-failure scheduling, compound branch cancellation races and longer-lived command lifetimes need broader adversarial review beyond current fixtures.
- Current task HTTP proof covers direct TS -> EventHub -> subscribed WS. Existing composed facade test is general transport evidence, not a full task-specific facade/cache workflow acceptance.
- Generic terminal integration, agent desktop/shell seams, full desktop-service failure propagation/pending status and Telegram connect/start/disconnect lifecycle remain incomplete.
- Remaining approved architecture fixtures need migration; the full final architecture/security matrix has not run.
- Checkpoint existing-store configuration/cross-instance review and portable filesystem race limitations remain as previously documented.
- Cached filesystem confinement is not an OS-level race-free directory-handle sandbox; no crash-atomic transaction claimed.
- Current UI has not been migrated to present every new task approval phase. No UI redesign authorized or attempted.
Do not deploy this partial stack.

## Integrity and next action

38/38 protected hashes match. Fixture-owned task children have observed exit/signal evidence; checked recorded PIDs/listeners and matching fixture commands are absent. No operator workload touched.
Branch/HEAD unchanged; staged list empty. No commit/push/reset/stash/protected cleanup/dependency installation.
Skills applied: developer-way, route-slice, security and process hygiene. Rejected patch was diagnosed as out-of-order hunks, then applied in source order; no assertion weakening or forced patch. Stale Windows wildcard rg lookups were corrected using rg --files/exact paths.

Await the exact notification-hook boundary decision, then continue Phase 2A only. The new red security assertion must be repaired, not skipped.

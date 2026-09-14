# Boundary expansion required — task notification-hook execution

Baseline: covert-production @ bdbaff6eeb435a7a9ffe18551843ed24d4f97a58.
Phase 2A remains BLOCKED / NOT READY.

## Exact requested files

Production:
- node/src/services/notification-service.mjs
- node/src/services/notification-service.d.mts
- node/src/routes/notifications.ts

Existing fixture:
- tests/unit/test-b4-notifications.mjs

All four files remain unchanged. tests/arch/notification-routes.test.ts is already approved; no repeat approval is requested.

## Captured bypass and actual owner

Production composition: node/src/openapi.ts buildNotificationWiredRoutes loads .aide/hooks.json, supplies TaskService's onEvent, publishes the task event, then calls notifications.ingestTaskEvent(body).
NotificationService.loadHooks reads workspace-controlled commands.
ingestTaskEvent calls runHooks for task.started/completed/failed and diagnostics.new.
runHooks calls runHookCommand, which spawns the configured executable without canonical actor/session/operation authority. The only extra check is network-token detection and a workspace-controlled network_consent flag.
Direct runHooks and runHookCommand calls have the same missing authority boundary.
The timeout uses taskkill /PID /T /F and resolves before proven termination. maybeShowOsToast is another direct process-launch seam in this same owner.
routes/notifications.ts independently persists .aide/hooks.json through fsWriteHooks and maps all nonvalidation failures to INTERNAL. It must carry canonical execution context/denial semantics when hook configuration is enrolled; configuration approval must not authorize subsequent hook execution.

## Regression-first evidence

New permanent assertion in the already-authorized tests/arch/capability-authority.test.ts:
workspace task hooks cannot reach a command executor without canonical authority.

A disposable hooks.json contains a local Node marker-write command. The test replaces only runHookCommand with a capture function; no child process is spawned.
Actual loadHooks -> ingestTaskEvent -> runHooks reaches the captured executor once.
Direct runHooks with forged approved/actor fields reaches it once more.
Expected executor calls: 0. Actual: 2.
Marker remains absent; real hook processes/mutations: 0.
The assertion fails for the intended security reason, not for fixture authentication setup.

The final focused suite is 79 total: 78 passed, 1 failed, 0 skipped, 0 cancelled. The sole failure is this hook assertion. Earlier 78/78 remains historical evidence, not a current all-green claim.

## Smallest proposed mutation

- Inject/use the existing ExecutionAuthority in the real notification/hook execution owner and matching declarations.
- No serialized task event, hook config, network_consent flag, model/request field or parent task approval may grant hook execution.
- Require fresh exact hook command/arguments/workspace/task/actor operation binding; direct service calls fail closed.
- Keep notification listing/coalescing/read behavior independent from command execution; no notification UI redesign.
- Preserve canonical denials rather than mapping to generic INTERNAL or silently falling back.
- Enforce trusted authority and confined persistence at the existing hook configuration write seam; approval to save configuration is separate from approval to run its contents.
- Await/report required outcomes instead of fire-and-forget success; keep process cleanup ownership-based and report unconfirmed termination honestly.
- Migrate the direct notification fixture to real authority for privileged cases, preserving its original notification/hook semantics and negative coverage.
- Keep ordinary observation of task events usable even when hooks lack execution authorization. Do not silently execute hooks for compatibility.

Use already-authorized core, task contract, composition and security-test files as needed. No new authority system/dependency/UI work. Request separately if another actual production owner is required.

## Test impact and stop point

tests/unit/test-b4-notifications.mjs directly constructs NotificationService and exercises hooks; it is not in previous fixture approvals.
tests/arch/notification-routes.test.ts is in the approved 41-fixture set.
Add tests for forged event/config/state, exact hook approval, changed command, expiry/revocation/replay, separate configuration versus execution authority, truthful failure and ownership-safe cleanup. Retain zero real mutation for denied cases.

Task/cache and compound fixture changes are implemented and tested, but this downstream hook bypass prevents their end-to-end safety acceptance.
No production changes were made after discovering this owner. No commit/push; native gate deferred.

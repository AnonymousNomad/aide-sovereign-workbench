# Boundary expansion required — task/cache lifecycle contract

Requested production file: **common/contracts/tasks.ts** only. It remains unchanged.

## Dependency

The already-approved task-service.mjs and routes/tasks.ts implement jobs/cache operations; the shared tasks contract owns their status and events. node/src/events.ts imports TaskEvent directly as the tasks channel validator.

Current source:
- task-service.mjs: tryRestoreFromCache calls cache.get without authority; maybeRecordToCache calls cache.record without authority.
- spawnLeafJob close handler calls job.finish before cache recording and suppresses recording failure.
- common/contracts/tasks.ts: TaskJob is strict, permits only running/exited/failed/stopped and no pending cache-operation reference; TaskEvent permits only started/output/exit/problems.
- Canonical ExecutionAuthority execution handles expire when execute's callback returns. TaskService.run returns a job ID before child completion. It cannot reuse that handle for a later, newly resolved cache eviction.

## Captured evidence

A read-only safeParse probe confirmed:
1. TaskJob rejects status awaiting_approval.
2. TaskJob rejects optional cache metadata containing an exact pending operation ID.
3. TaskEvent rejects approval_required events.

No process or mutation was needed for these probes. This does not prove every possible workaround impossible; it establishes that the existing typed task surface cannot carry the required lifecycle. Hiding JSON in output lines, defining competing route-local schemas, prematurely reporting cache completion, or granting arbitrary future cache operations would avoid rather than repair this ownership boundary.

## Smallest proposed change

Add bounded optional task-cache lifecycle metadata and a strict task authority/cache event carrying canonical operation reference, phase/state and truthful outcome/error details. Preserve existing process statuses and existing event payloads. Reuse canonical operation types where practical; no new permission policy, approval engine or token semantics.

TaskService remains a delegated actor into the existing authority. Each cache mutation is described after target resolution, separately decided by its owning operator, then single-use consumed. Pending/rejected/expired/revoked/failed cache state must be distinguishable from the child process exit result. Existing authority decision/inspection routes remain the decision authority.

The implementation should select the smallest representation; the rejected awaiting_approval status probe is evidence, not a requirement to enlarge the main status enum.

## Tests affected

Already-approved task/cache/compound fixtures, tests/arch/task-routes.test.ts, tests/arch/cache-routes.test.ts, tests/arch/capability-authority.test.ts and EventHub contract tests as needed.
Prove event/status validation, real operation-bound approvals, no self-approval, denied/revoked/replayed/changed-target zero side effects, retained LRU/hits/invalidation and task sequence/parallel/background/failure/stop behavior. Do not weaken existing assertions or use blanket approval.

Generated common/openapi.json remains an already-authorized artifact; verify generation/idempotence after contract edits. No UI changes requested.
No other production expansion, dependency or native tooling requested.

## Current checkpoint

Original LRU fixture now passes with exact authority; broader focused suite 59/59. Both typechecks pass. Full task/cache integration and compound fixture migration are incomplete.
Phase 2A: BLOCKED / NOT READY. Native gate deferred. No commit/push.

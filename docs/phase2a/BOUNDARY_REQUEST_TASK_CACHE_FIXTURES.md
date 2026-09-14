# Boundary expansion required — task/cache fixtures only

Baseline: covert-production @ bdbaff6eeb435a7a9ffe18551843ed24d4f97a58.

## Exact requested additions

- tests/unit/test-b5-cache.mjs
- tests/unit/test-b3-compound.mjs

Both files remain unchanged. No additional production file is requested.

## Dependency and captured evidence

BuildCache now requires canonical execution context for record, get (persistent hit/miss accounting), and clear. TaskService integration must carry correctly scoped, exact mutation authority into cache operations and await/report their outcomes.

test-b5-cache.mjs directly constructs BuildCache at line 154 and records without authority at line 156. The isolated existing LRU test was run unchanged:

`node --test --test-name-pattern='LRU eviction' tests/unit/test-b5-cache.mjs`

Result: 0 passed, 1 failed, 0 skipped, 0 cancelled; exit 1. FORBIDDEN: cache execution authority required. Existing k1-style keys remain valid; the failure is missing authority, not incompatible key validation. Other cases construct TaskService and cover misses/hits, content/environment invalidation, failed runs and background behavior.

test-b3-compound.mjs constructs TaskService at lines 60, 90, 114, 151 and 194, and directly invokes run/stop. It covers sequence/parallel dependencies, background readiness, failure and stop lifecycle. It needs legitimate authority fixtures for the pending task service guard. This is source-level impact evidence; it was NOT run or represented as a failing test this checkpoint.

Neither file appears in the approved fixture sets. Stop before modifying either.

## Smallest proposed mutation

Use the already-approved authority-fixture where applicable, real actor/session setup and exact operation-bound approval/consumption. Delegate task/job cache operations through the same authority; do not auto-approve arbitrary operations. Preserve existing behavioral assertions and add/retain corresponding denial/no-side-effect cases. Do not turn mutation tests into read-only tests, mock away authority, skip assertions, add universal credentials or sleeps/retries.

Production task/cache integration stays within previously approved production files. If another production dependency is needed, request it separately.

## Status

The repaired captured traversal assertion and four additional cache security/compatibility tests pass. Combined focused suite: 59 passed, 0 failed/skipped/cancelled. The separate legacy LRU failure remains explicitly open.

No commit or push. Native compilation/startup deferred, not passed. Phase 2A is NOT ACCEPTANCE-READY. Await approval of these two fixture files before continuing task/cache integration.


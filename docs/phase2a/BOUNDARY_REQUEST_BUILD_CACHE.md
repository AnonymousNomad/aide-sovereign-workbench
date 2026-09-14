# Boundary expansion required — build-cache mutation targets

Status: REQUESTED, NOT APPROVED. No edit to either requested production file.

## Exact additional production boundary

- node/src/services/build-cache.mjs
- node/src/services/build-cache.d.mts

## Dependency

The authorized TaskService constructs BuildCache (task-service.mjs:416).
run -> runSingle/compound -> maybeRecordToCache -> BuildCache.record -> enforceEviction -> removeEntry.
POST /api/tasks/cache/clear also calls tasks.cache.clear directly (routes/tasks.ts:49).

BuildCache.loadIndex trusts workspace index entries. enforceEviction selects manifest.key; logPath/problemsPath concatenate it with the cache directory. removeEntry deletes those paths and suppresses errors. No canonical-key or resolved-target confinement exists at this mutation authority.

## Captured executable evidence

New authorized security regression in tests/arch/capability-authority.test.ts:
persist index with key ../../../source; create BuildCache with maxEntries=1; record a legitimate new cache entry.
Real cache parsing/selection/path calculation requests deletion of workspace/source.log and workspace/source.problems.json, OUTSIDE .aide/cache/builds.
The fixture replaces rmSync only to capture targets. No actual deletion; victim bytes remain unchanged.
No error was reported by record().
The negative security assertion fails exactly because two out-of-cache targets reach deletion.

This is a destructive target-scope defect, not a generic Veritas/evidence-quality expansion.

## Why caller-only work is insufficient

The caller authorizes a task/cache operation, not arbitrary paths supplied through persisted cache metadata.
Target selection and eviction are internal to BuildCache and can run while recording task results. Duplicating this logic in TaskService, blindly trusting a preflight that the mutation service does not enforce, or silently disabling valid caching would not secure the actual seam.

## Smallest proposed repair

- Validate persisted and generated keys/manifests; reject unsafe keys and inconsistent index/key identities.
- Resolve and constrain cache storage and eviction/clear targets to the explicitly owned cache boundary; reject traversal and unsafe links/roots.
- Preserve ordinary valid cache hits, recording, eviction, statistics and clear behavior.
- Propagate real mutation failures instead of reporting successful removal/clear.
- Thread existing canonical execution context where the task integration requires it; no cache-local permissions/approval/credential system.
- Align existing declarations with corrected errors/context signatures.
- No cache algorithm redesign, dependency installation, general verification work or model changes.

Tests: current captured regression; approved tests/arch/cache-routes.test.ts and tests/arch/compound-tasks.test.ts; new Phase 2A security tests as already authorized. Prove zero out-of-scope deletion, valid bounded eviction, invalid persisted metadata rejection, failure visibility, replay/denial where applicable.

## State at stop

Checkpoint-service expansion accepted and initial guarded repair implemented; agent ordering and direct-service negatives passing.
Combined current suite: 54 passed, 1 failed (this captured cache regression), zero skipped/cancelled.
Both typechecks pass; targeted lint zero errors/seven warnings.
38/38 protected hashes intact; no staged changes/commit/push; checked fixture processes/listeners absent.
Phase 2A NOT ACCEPTANCE-READY. Native runtime remains deferred.

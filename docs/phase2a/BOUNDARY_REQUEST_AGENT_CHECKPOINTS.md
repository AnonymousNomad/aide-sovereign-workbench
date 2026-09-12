# Boundary expansion required: agent checkpoints

Status: REQUESTED, NOT APPROVED. Implementation stopped. Neither requested file has been modified.

Baseline: covert-production @ bdbaff6eeb435a7a9ffe18551843ed24d4f97a58.

## Exactly two additional production files

- node/src/services/agent-checkpoints.mjs
- node/src/services/agent-checkpoints.d.mts

## Dependency and evidence

node/src/openapi.ts:401 constructs createCheckpointService({ workspace }); :435 injects it into AgentLoop.
node/src/services/agent-loop.mjs:437–444 starts checkpoints.commit before a tool execution with void, does not await it, and suppresses errors.

The checkpoint service is a separate mutation seam:
- ensureInit creates a shadow repository, changes Git configuration, and writes exclusions. Even headHash initializes this state.
- withNestedReposDisabled (around lines 78–96) discovers nested repositories dynamically, renames their .git directories, and suppresses both rename and restoration errors.
- commit (around lines 99–111) stages/commits workspace content in the shadow repository.
- restore (around lines 113–120) performs reset --hard and clean. This exported capability exists; a current production caller of restore has not been demonstrated.

The declarations expose commit/restore/headHash without trusted execution context.

## Why the current boundary is insufficient

The allowed caller can await and authorize a call, but cannot enforce authority on direct service entry, constrain hidden nested metadata mutations through the current interface, or learn about restoration failures swallowed inside the service. A tool's approved write arguments do not implicitly authorize independent checkpoint Git/metadata changes.

Silently dropping checkpoints, adding a replacement service, or wrapping a falsely successful result would not preserve existing valid recovery behavior. No such workaround has been implemented.

## Smallest proposed mutation

1. Inject the existing single Execution Authority; guard mutating service entry with active opaque execution context and normalized workspace/checkpoint action descriptors. No local approval store.
2. Separate observational reads from initialization writes; a head read must not silently initialize a repository.
3. Bind snapshot/restore scope explicitly, serialize checkpoint metadata activity, and make preparation, execution and restoration failures observable. Eliminate or safely constrain temporary nested .git mutation; never invent recovery permission from a failed operation.
4. Update declarations to match runtime authority/error semantics.
5. In already-approved AgentLoop/OpenAPI callers, await the exact authorized checkpoint operation and preserve required audit outcomes. Do not grant broad authority from tool approval.

If safe preservation requires another file, dependency, broad snapshot redesign, or behavior change beyond this narrow boundary, stop again before editing it.

## Tests affected (already authorized)

- tests/unit/test-a1-agent.mjs: preserve commit/mutate/restore, user Git unchanged, and nested repository preservation assertions.
- tests/unit/test-agent-loop-tier.mjs: await real termination, preserve all prompt assertions.
- tests/arch/execution-authority.test.ts and tests/arch/agent-execution-integrity.test.ts: no implicit checkpoint authorization; absent/forged/wrong/replayed/revoked context leaves zero mutation.
- Add snapshot failure/concurrency/restore-denial coverage within authorized Phase 2A security tests; verify nested metadata restoration or truthful failure without hiding it.

## Current checkpoint

27/27 tests pass; backend/browser typechecks pass; targeted lint zero errors, seven warnings.
38/38 protected hashes unchanged. No staged changes, commit or push.
Phase 2A remains NOT ACCEPTANCE-READY. See CURRENT_STATUS.md and CHECKPOINT_DELEGATION_OWNERSHIP_RESULTS.json.

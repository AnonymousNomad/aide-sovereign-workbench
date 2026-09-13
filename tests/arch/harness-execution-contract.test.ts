import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { build } from 'vite';
import { canonicalContextJson } from '../../common/context/context-envelope.ts';
import {
  HARNESS_EXECUTION_SCHEMA_VERSION,
  HARNESS_EXECUTION_SERIALIZATION
} from '../../common/contracts/harness-execution.ts';
import {
  EXECUTION_TRANSACTION_TRANSITIONS
} from '../../common/execution/task-lifecycle.ts';
import { EXECUTION_TRANSACTION_STATES } from '../../common/contracts/task-lifecycle.ts';
import {
  canonicalHarnessJson,
  createHarnessExecutionRequest,
  createProposedHarnessTransaction,
  transitionHarnessTransaction,
  createHarnessExecutionResult,
  hasHarnessExecutionIntegrity,
  HarnessExecutionError
} from '../../common/execution/harness-transaction.ts';

type Data = Record<string, any>;

const DIGESTS = {
  operation: 'a'.repeat(64),
  target: 'b'.repeat(64),
  effect: 'c'.repeat(64),
  context: 'd'.repeat(64),
  selection: 'e'.repeat(64),
  policy: 'f'.repeat(64),
  budget: '0'.repeat(64),
  evidence: '1'.repeat(64),
  resolution: '2'.repeat(64),
  consumption: '3'.repeat(64),
  checkpoint: '4'.repeat(64),
  result: '5'.repeat(64),
  restore: '6'.repeat(64)
} as const;

const SCOPE = { workspaceId: 'workspace-1', taskId: 'task-1', taskRevision: 0 } as const;

function clone<T>(value: T): T {
  return structuredClone(value);
}

async function expectCode(action: Promise<unknown> | (() => Promise<unknown>), code: string): Promise<void> {
  await assert.rejects(action, (error: unknown) => error instanceof HarnessExecutionError && error.code === code);
}

function evidence(id: string, evidenceType: string, scope: Data = SCOPE, transactionId = 'transaction-1', attemptId = 'attempt-1', digestValue = DIGESTS.evidence): Data {
  return {
    kind: 'evidence', id, evidenceType, owner: evidenceType === 'authority-consumption' ? 'execution-authority' : 'harness',
    workspaceId: scope.workspaceId, taskId: scope.taskId, taskRevision: scope.taskRevision,
    attemptId, transactionId, digest: digestValue
  };
}

function operation(effectClass: 'mutation' | 'read_only' = 'mutation'): Data {
  const operationClass = effectClass === 'mutation' ? 'filesystem_mutation' : 'read_only';
  return {
    operation: {
      kind: 'authority-operation', id: 'operation-1', ...SCOPE,
      operationDigest: DIGESTS.operation, descriptorRevision: 1, effectClass, targetDigest: DIGESTS.target
    },
    classification: {
      effectiveClass: operationClass,
      sources: [{ source: 'descriptor', effectiveClass: operationClass, revision: 1, digest: DIGESTS.operation }],
      derivationDigest: DIGESTS.operation
    },
    operationDigest: DIGESTS.operation,
    targetDigest: DIGESTS.target,
    effectScopeDigest: DIGESTS.effect
  };
}

function target(effectClass: 'mutation' | 'read_only' = 'mutation', scope: Data = SCOPE): Data {
  return {
    kind: 'resolved-target', id: 'target-1', ...scope, operationId: 'operation-1',
    targetKind: effectClass === 'mutation' ? 'filesystem' : 'filesystem',
    targetIdentityDigest: DIGESTS.target, effectScopeDigest: DIGESTS.effect, resolverRevision: 1,
    locatorRef: 'opaque-target-reference'
  };
}

function authority(scope: Data = SCOPE, operationId = 'operation-1', operationDigest = DIGESTS.operation, targetDigest = DIGESTS.target): Data {
  return {
    kind: 'authority-decision', id: 'decision-1', ...scope, operationId, operationDigest,
    descriptorRevision: 1, targetDigest, decisionRevision: 1, actorRef: 'actor-1'
  };
}

function requestInput(effectClass: 'mutation' | 'read_only' = 'mutation'): Data {
  const op = operation(effectClass);
  return {
    schemaVersion: HARNESS_EXECUTION_SCHEMA_VERSION,
    serialization: HARNESS_EXECUTION_SERIALIZATION,
    requestId: 'request-1', ...SCOPE, attemptId: 'attempt-1', transactionId: 'transaction-1',
    correlationId: 'correlation-1', causationId: null,
    context: {
      kind: 'context-envelope', envelopeId: 'envelope-1', envelopeDigest: DIGESTS.context,
      requestId: 'request-1', ...SCOPE
    },
    methodology: { workflowRefs: [], skillRefs: [], selectionDigest: DIGESTS.selection },
    workerSelection: {
      kind: 'worker-selection', id: 'selection-1', selectionDigest: DIGESTS.selection, ...SCOPE,
      attemptId: 'attempt-1', roleIdentity: 'worker-role', modelIdentity: 'local-model', modelRevision: 'model-r1',
      provider: 'local', locality: 'local', selectionRevision: 1
    },
    operation: op,
    target: target(effectClass),
    authority: { mode: effectClass === 'mutation' ? 'decision_required' : 'not_required_by_trusted_policy', decision: authority() },
    checkpoint: {
      requestedPreference: 'no_preference',
      effectiveRequirement: effectClass === 'mutation' ? 'required' : 'not_applicable',
      policy: {
        kind: 'checkpoint-policy', id: 'policy-1', ...SCOPE,
        operationClass: effectClass === 'mutation' ? 'filesystem_mutation' : 'read_only', revision: 1, digest: DIGESTS.policy
      },
      availability: 'available'
    },
    resourceBudget: {
      kind: 'resource-budget', budgetId: 'budget-1', budgetDigest: DIGESTS.budget, ...SCOPE,
      transactionId: 'transaction-1', revision: 1,
      limits: { wallTimeMs: 10_000, outputBytes: 100_000, processCount: 1, modelContextTokens: 4_096, mutationCount: 1 },
      enforcement: 'hard'
    },
    evidence: {
      requested: ['result'], effectiveMinimum: ['result'], policyRevision: 1, policyDigest: DIGESTS.policy
    },
    cancellation: { requested: false, stopScheduling: false }
  };
}

function resolution(scope = SCOPE, operationId = 'operation-1', decisionId = 'decision-1', operationDigest = DIGESTS.operation): Data {
  return {
    kind: 'authority-resolution', id: 'resolution-1', ...scope, operationId, decisionId,
    operationDigest, resolutionDigest: DIGESTS.resolution
  };
}

function consumption(identity: Data, overrides: Data = {}): Data {
  return {
    kind: 'authority-consumption', id: 'consumption-1', workspaceId: identity.workspaceId, taskId: identity.taskId,
    taskRevision: identity.taskRevision, attemptId: identity.attemptId, transactionId: identity.transactionId,
    operationId: 'operation-1', operationDigest: DIGESTS.operation, decisionId: 'decision-1', actorRef: 'actor-1',
    consumptionDigest: DIGESTS.consumption, ...overrides
  };
}

function checkpoint(identity: Data, overrides: Data = {}): Data {
  return {
    kind: 'bound', checkpoint: {
      kind: 'transaction-checkpoint', id: 'checkpoint-1', workspaceId: identity.workspaceId, taskId: identity.taskId,
      taskRevision: identity.taskRevision, transactionId: identity.transactionId, snapshotRef: 'snapshot-before-1',
      mutationScopeDigest: DIGESTS.effect, checkpointDigest: DIGESTS.checkpoint
    }, ...overrides
  };
}

function quiescence(identity: Data, effectCertainty: string, overrides: Data = {}): Data {
  return {
    kind: 'quiescence', id: 'quiescence-1', workspaceId: identity.workspaceId, taskId: identity.taskId,
    taskRevision: identity.taskRevision, attemptId: identity.attemptId, transactionId: identity.transactionId,
    admissionStopped: true, activeWork: 'none', effectCertainty,
    reconciliationRequired: effectCertainty === 'unknown', ...overrides
  };
}

function resultRef(identity: Data, effectCertainty: string, id = 'result-1', overrides: Data = {}): Data {
  return {
    kind: 'execution-result', id, workspaceId: identity.workspaceId, taskId: identity.taskId,
    taskRevision: identity.taskRevision, attemptId: identity.attemptId, transactionId: identity.transactionId,
    effectCertainty, resultDigest: DIGESTS.result, ...overrides
  };
}

function evidenceSnapshot(identity: Data): Data {
  return {
    effectiveMinimum: ['result'],
    evidenceRefs: [evidence('effect-1', 'result', identity, identity.transactionId, identity.attemptId, DIGESTS.result)],
    manifestRef: evidence('manifest-1', 'evidence-manifest', identity, identity.transactionId, identity.attemptId, DIGESTS.evidence)
  };
}

function transitionInput(current: Data, nextState: string, data: Data, causeKind = 'worker', causeId = 'cause-1'): Data {
  return {
    aggregateId: current.identity.transactionId,
    expectedRevision: current.snapshotRevision,
    currentState: current.state,
    nextState,
    reason: `transition to ${nextState}`,
    causeRef: { kind: causeKind, id: causeId },
    correlationId: current.correlationId,
    causationId: current.causationId,
    timestamp: '2026-09-13T12:00:00.000Z',
    data
  };
}

async function makeRequest(effectClass: 'mutation' | 'read_only' = 'mutation', mutate?: (input: Data) => void): Promise<Readonly<Data>> {
  const input = requestInput(effectClass);
  mutate?.(input);
  return createHarnessExecutionRequest(input);
}

async function toAuthorized(proposed: Readonly<Data>): Promise<Readonly<Data>> {
  return transitionHarnessTransaction(proposed, transitionInput(proposed, 'authorized', { authorityResolution: resolution() }));
}

async function toCheckpointed(authorized: Readonly<Data>): Promise<Readonly<Data>> {
  return transitionHarnessTransaction(authorized, transitionInput(authorized, 'checkpointed', {
    authorityResolution: resolution(), authorityConsumption: consumption(authorized.identity), checkpoint: checkpoint(authorized.identity)
  }));
}

async function toExecuting(checkpointed: Readonly<Data>): Promise<Readonly<Data>> {
  return transitionHarnessTransaction(checkpointed, transitionInput(checkpointed, 'executing', {
    authorityResolution: resolution(), authorityConsumption: consumption(checkpointed.identity),
    admissionRef: evidence('admission-1', 'process', checkpointed.identity),
    ownershipRefs: [evidence('ownership-1', 'process', checkpointed.identity)],
    checkpoint: checkpoint(checkpointed.identity)
  }));
}

test('request creation is immutable, digest-covered, and canonical-compatible', async () => {
  const input = requestInput();
  const request = await createHarnessExecutionRequest(input);
  const reordered = requestInput();
  const reorderedOperation = reordered.operation;
  reordered.operation = { effectScopeDigest: reorderedOperation.effectScopeDigest, targetDigest: reorderedOperation.targetDigest,
    operationDigest: reorderedOperation.operationDigest, classification: reorderedOperation.classification, operation: reorderedOperation.operation };
  const requestReordered = await createHarnessExecutionRequest(reordered);
  assert.equal(request.requestDigest, requestReordered.requestDigest);
  assert.equal(canonicalHarnessJson({ b: 1, a: null }), canonicalContextJson({ a: null, b: 1 }));
  assert.equal(Object.isFrozen(request), true);
  assert.equal(Object.isFrozen(request.operation), true);
  const before = request.requestDigest;
  input.target.id = 'changed-after-build';
  input.operation.operation.id = 'changed-after-build';
  assert.equal(request.requestDigest, before);
  assert.equal(request.target.id, 'target-1');
  assert.throws(() => { (request.target as Data).id = 'attempted-mutation'; }, TypeError);
});

test('H1 projects onto the frozen transaction topology without a second state machine', () => {
  const declared = EXECUTION_TRANSACTION_STATES.reduce((count, state) => count + EXECUTION_TRANSACTION_TRANSITIONS[state].length, 0);
  assert.equal(EXECUTION_TRANSACTION_STATES.length, 11);
  assert.equal(declared, 22);
  assert.deepEqual(EXECUTION_TRANSACTION_TRANSITIONS.authorized, ['checkpointed', 'executing', 'rejected', 'failed']);
  assert.equal(EXECUTION_TRANSACTION_TRANSITIONS.executing.includes('committed'), false);
});

test('request rejects runtime, authority, and unsupported values while preserving descriptive text', async () => {
  for (const [field, value] of [
    ['approved', true], ['permission', true], ['capabilityToken', 'x'], ['executionHandle', 'x'],
    ['authorityConsumption', {}], ['checkpointResult', {}], ['effectCertainty', 'none'],
    ['processEvidence', {}], ['quiescence', {}], ['executionResult', {}], ['veritasVerdict', 'accepted']
  ] as const) {
    await expectCode(createHarnessExecutionRequest({ ...requestInput(), [field]: value }), 'UNKNOWN_REQUEST_FIELD');
  }
  await expectCode(createHarnessExecutionRequest({ ...requestInput(), operation: { ...requestInput().operation, executionHandle: 'x' } }), 'UNKNOWN_OPERATION_FIELD');
  await expectCode(createHarnessExecutionRequest({ ...requestInput(), workerSelection: { ...requestInput().workerSelection, capability: 'x' } }), 'UNKNOWN_WORKER_SELECTION_FIELD');
  const descriptive = requestInput(); descriptive.target.locatorRef = 'approved permission plan verified by operator';
  await createHarnessExecutionRequest(descriptive);
  await expectCode(createHarnessExecutionRequest({ ...requestInput(), budget: 1n }), 'UNKNOWN_REQUEST_FIELD');
  await expectCode(createHarnessExecutionRequest({ ...requestInput(), taskRevision: Number.MAX_SAFE_INTEGER + 1 }), 'INVALID_TASK_REVISION');
  await expectCode(createHarnessExecutionRequest({ ...requestInput(), taskRevision: NaN }), 'INVALID_TASK_REVISION');
});

test('operation and target scope/classification are fail-closed', async () => {
  await expectCode(createHarnessExecutionRequest({ ...requestInput(), operation: { ...requestInput().operation, classification: {
    effectiveClass: 'filesystem_mutation', sources: [
      { source: 'descriptor', effectiveClass: 'filesystem_mutation', revision: 1, digest: DIGESTS.operation },
      { source: 'route_policy', effectiveClass: 'read_only', revision: 1, digest: DIGESTS.policy }
    ], derivationDigest: DIGESTS.operation
  } } }), 'CLASSIFICATION_CONFLICT');
  await expectCode(createHarnessExecutionRequest({ ...requestInput(), target: { ...target(), targetIdentityDigest: DIGESTS.restore } }), 'OPERATION_DIGEST_MISMATCH');
  await expectCode(createHarnessExecutionRequest({ ...requestInput(), target: { ...target(), workspaceId: 'workspace-2' } }), 'SCOPE_MISMATCH');
  await expectCode(createHarnessExecutionRequest({ ...requestInput(), checkpoint: { ...requestInput().checkpoint, effectiveRequirement: 'not_applicable' } }), 'CHECKPOINT_MISSING');
  const readOnly = await makeRequest('read_only');
  assert.equal(readOnly.operation.classification.effectiveClass, 'read_only');
  await expectCode(createHarnessExecutionRequest({ ...requestInput('read_only'), operation: { ...operation('read_only'), classification: {
    effectiveClass: 'read_only', sources: [{ source: 'descriptor', effectiveClass: 'read_only', revision: 1, digest: DIGESTS.operation }], derivationDigest: DIGESTS.operation,
    callerAssertion: 'filesystem_mutation'
  } } }), 'CLASSIFICATION_CONFLICT');
});

test('authority and checkpoint phases cannot be skipped for mutation', async () => {
  const proposed = await createProposedHarnessTransaction(await makeRequest());
  const authorized = await toAuthorized(proposed);
  await expectCode(transitionHarnessTransaction(authorized, transitionInput(authorized, 'executing', {
    authorityResolution: resolution(), authorityConsumption: consumption(authorized.identity),
    admissionRef: evidence('admission-1', 'process', authorized.identity), ownershipRefs: []
  })), 'CHECKPOINT_MISSING');
  const checkpointed = await toCheckpointed(authorized);
  const executing = await toExecuting(checkpointed);
  assert.equal(executing.state, 'executing');
  await expectCode(transitionHarnessTransaction(checkpointed, transitionInput(checkpointed, 'executing', {
    authorityResolution: resolution(), authorityConsumption: consumption(checkpointed.identity),
    admissionRef: evidence('admission-1', 'process', checkpointed.identity), ownershipRefs: [], checkpoint: checkpoint(checkpointed.identity, {
      checkpoint: { ...checkpoint(checkpointed.identity).checkpoint, transactionId: 'transaction-foreign' }
    })
  })), 'CHECKPOINT_MISMATCH');
  await expectCode(transitionHarnessTransaction(authorized, transitionInput(authorized, 'checkpointed', {
    authorityResolution: resolution(), authorityConsumption: consumption(authorized.identity), checkpoint: checkpoint(authorized.identity, {
      checkpoint: { ...checkpoint(authorized.identity).checkpoint, taskId: 'task-foreign' }
    })
  })), 'CHECKPOINT_MISMATCH');
});

test('read-only execution may explicitly omit a checkpoint but cannot masquerade as mutation', async () => {
  const proposed = await createProposedHarnessTransaction(await makeRequest('read_only'));
  const authorized = await toAuthorized(proposed);
  const executing = await transitionHarnessTransaction(authorized, transitionInput(authorized, 'executing', {
    authorityResolution: resolution(), authorityConsumption: consumption(authorized.identity),
    admissionRef: evidence('admission-read', 'process', authorized.identity), ownershipRefs: []
  }));
  assert.equal(executing.state, 'executing');
  assert.equal('checkpoint' in executing, false);
  const disguised = clone(requestInput('read_only'));
  disguised.operation = operation('mutation');
  disguised.checkpoint = requestInput('read_only').checkpoint;
  await expectCode(createHarnessExecutionRequest(disguised), 'AUTHORITY_MISMATCH');
});

test('authority resolution, consumption, and target references are structurally scoped', async () => {
  const proposed = await createProposedHarnessTransaction(await makeRequest());
  const base = transitionInput(proposed, 'authorized', { authorityResolution: resolution() });
  for (const [label, change] of [
    ['workspace', { workspaceId: 'workspace-2' }],
    ['task', { taskId: 'task-2' }],
    ['revision', { taskRevision: 1 }],
    ['operation', { operationId: 'operation-2' }],
    ['decision', { decisionId: 'decision-2' }],
    ['digest', { operationDigest: DIGESTS.restore }]
  ] as const) {
    const changed = clone(base);
    changed.data.authorityResolution = { ...changed.data.authorityResolution, ...change };
    await expectCode(transitionHarnessTransaction(proposed, changed), 'AUTHORITY_MISMATCH');
    assert.equal(label.length > 0, true);
  }
});

test('quiescence is independent from effect certainty and unknown blocks clean result use', async () => {
  const proposed = await createProposedHarnessTransaction(await makeRequest());
  const authorized = await toAuthorized(proposed);
  const checkpointed = await toCheckpointed(authorized);
  const executing = await toExecuting(checkpointed);
  const unknown = quiescence(executing.identity, 'unknown');
  const pending = await transitionHarnessTransaction(executing, transitionInput(executing, 'evidence_pending', {
    authorityConsumption: consumption(executing.identity), quiescence: unknown, effectCertainty: 'unknown', evidenceRefs: []
  }));
  assert.equal((pending as Data).quiescence.effectCertainty, 'unknown');
  assert.equal((pending as Data).quiescence.reconciliationRequired, true);
  await expectCode(createHarnessExecutionResult({
    kind: 'harness-execution-result', schemaVersion: HARNESS_EXECUTION_SCHEMA_VERSION, serialization: HARNESS_EXECUTION_SERIALIZATION,
    identity: executing.identity, completion: 'cancelled', effectCertainty: 'none', resultRef: resultRef(executing.identity, 'none'), evidenceRefs: [],
    quiescence: unknown
  }), 'RESULT_SCOPE_MISMATCH');
  const unknownResult = await createHarnessExecutionResult({
    kind: 'harness-execution-result', schemaVersion: HARNESS_EXECUTION_SCHEMA_VERSION, serialization: HARNESS_EXECUTION_SERIALIZATION,
    identity: executing.identity, completion: 'timed_out', effectCertainty: 'unknown', resultRef: resultRef(executing.identity, 'unknown'), evidenceRefs: [],
    uncertaintyEvidence: evidence('uncertainty-1', 'error', executing.identity), reconciliationRequired: true,
    quiescence: unknown
  });
  assert.equal(unknownResult.effectCertainty, 'unknown');
});

test('result variants enforce effect, evidence, quiescence, and rollback consistency', async () => {
  const identity = { requestId: 'request-1', transactionId: 'transaction-1', ...SCOPE, attemptId: 'attempt-1' };
  const effectEvidence = evidence('effect-1', 'result', identity);
  const known = await createHarnessExecutionResult({
    kind: 'harness-execution-result', schemaVersion: HARNESS_EXECUTION_SCHEMA_VERSION, serialization: HARNESS_EXECUTION_SERIALIZATION,
    identity, completion: 'completed', effectCertainty: 'known_complete', resultRef: resultRef(identity, 'known_complete'),
    evidenceRefs: [effectEvidence], effectEvidence, quiescence: quiescence(identity, 'known_complete')
  });
  assert.equal(known.effectCertainty, 'known_complete');
  assert.equal(await hasHarnessExecutionIntegrity(known), true);
  const tampered = { ...known, effectCertainty: 'known_partial', resultRef: { ...known.resultRef, effectCertainty: 'known_partial' } };
  assert.equal(await hasHarnessExecutionIntegrity(tampered), false);
  await expectCode(createHarnessExecutionResult({
    kind: 'harness-execution-result', schemaVersion: HARNESS_EXECUTION_SCHEMA_VERSION, serialization: HARNESS_EXECUTION_SERIALIZATION,
    identity, completion: 'completed', effectCertainty: 'known_complete', resultRef: resultRef(identity, 'known_complete'), evidenceRefs: [],
    quiescence: quiescence(identity, 'known_complete')
  }), 'EVIDENCE_INCOMPLETE');
  await expectCode(createHarnessExecutionResult({
    kind: 'harness-execution-result', schemaVersion: HARNESS_EXECUTION_SCHEMA_VERSION, serialization: HARNESS_EXECUTION_SERIALIZATION,
    identity, completion: 'not_started', effectCertainty: 'known_complete', resultRef: resultRef(identity, 'known_complete'), evidenceRefs: [effectEvidence], effectEvidence,
    quiescence: quiescence(identity, 'known_complete')
  }), 'EXECUTION_NOT_STARTED');
  await expectCode(createHarnessExecutionResult({
    kind: 'harness-execution-result', schemaVersion: HARNESS_EXECUTION_SCHEMA_VERSION, serialization: HARNESS_EXECUTION_SERIALIZATION,
    identity, completion: 'completed', effectCertainty: 'known_complete', resultRef: resultRef(identity, 'known_partial'), evidenceRefs: [effectEvidence], effectEvidence,
    quiescence: quiescence(identity, 'known_complete')
  }), 'RESULT_SCOPE_MISMATCH');
});

test('mutation rejection retains truthful result and never implies rollback', async () => {
  const proposed = await createProposedHarnessTransaction(await makeRequest());
  const authorized = await toAuthorized(proposed);
  const checkpointed = await toCheckpointed(authorized);
  const executing = await toExecuting(checkpointed);
  const pending = await transitionHarnessTransaction(executing, transitionInput(executing, 'evidence_pending', {
    authorityConsumption: consumption(executing.identity), quiescence: quiescence(executing.identity, 'known_partial'),
    effectCertainty: 'known_partial', evidenceRefs: [evidence('effect-1', 'filesystem', executing.identity)]
  }));
  const verifying = await transitionHarnessTransaction(pending, transitionInput(pending, 'verifying', {
    authorityConsumption: consumption(pending.identity), resultRef: resultRef(pending.identity, 'known_partial'),
    evidence: evidenceSnapshot(pending.identity), quiescence: quiescence(pending.identity, 'known_partial')
  }));
  const retained = resultRef(verifying.identity, 'known_partial');
  const rejected = await transitionHarnessTransaction(verifying, transitionInput(verifying, 'rejected', {
    resultRef: resultRef(verifying.identity, 'known_partial'), retainedResult: retained, effectCertainty: 'known_partial',
    rejectionEvidence: evidence('rejection-1', 'error', verifying.identity), recoveryDisposition: 'retain_for_review'
  }));
  assert.equal(rejected.state, 'rejected');
  assert.equal(rejected.recoveryDisposition, 'retain_for_review');
  await expectCode(transitionHarnessTransaction(verifying, transitionInput(verifying, 'rejected', {
    resultRef: resultRef(verifying.identity, 'known_partial'), retainedResult: { ...retained, effectCertainty: 'known_complete' }, effectCertainty: 'known_partial',
    rejectionEvidence: evidence('rejection-1', 'error', verifying.identity), recoveryDisposition: 'rollback_required'
  })), 'RESULT_SCOPE_MISMATCH');
  assert.equal('rollback' in rejected, false);
});

test('pre-execution mutation denial can be represented as a non-effect rejection', async () => {
  const proposed = await createProposedHarnessTransaction(await makeRequest());
  const denied = await transitionHarnessTransaction(proposed, transitionInput(proposed, 'rejected', {
    resultRef: resultRef(proposed.identity, 'none'), retainedResult: resultRef(proposed.identity, 'none'), effectCertainty: 'none',
    rejectionEvidence: evidence('denial-1', 'error', proposed.identity), recoveryDisposition: 'retain_for_review'
  }));
  assert.equal(denied.state, 'rejected');
  assert.equal(denied.effectCertainty, 'none');
});

test('rollback cannot claim restored state with unknown effects, divergence, or foreign evidence', async () => {
  const proposed = await createProposedHarnessTransaction(await makeRequest());
  const authorized = await toAuthorized(proposed);
  const checkpointed = await toCheckpointed(authorized);
  const executing = await toExecuting(checkpointed);
  const pending = await transitionHarnessTransaction(executing, transitionInput(executing, 'evidence_pending', {
    authorityConsumption: consumption(executing.identity), quiescence: quiescence(executing.identity, 'known_partial'), effectCertainty: 'known_partial', evidenceRefs: []
  }));
  const verifying = await transitionHarnessTransaction(pending, transitionInput(pending, 'verifying', {
    authorityConsumption: consumption(pending.identity), resultRef: resultRef(pending.identity, 'known_partial'),
    evidence: evidenceSnapshot(pending.identity), quiescence: quiescence(pending.identity, 'known_partial')
  }));
  const rolling = await transitionHarnessTransaction(verifying, transitionInput(verifying, 'rolling_back', {
    retainedResult: resultRef(verifying.identity, 'known_partial'), rollbackAttempt: evidence('rollback-attempt', 'before-after', verifying.identity)
  }));
  const restored = await transitionHarnessTransaction(rolling, transitionInput(rolling, 'rolled_back', {
    retainedResult: resultRef(rolling.identity, 'known_partial'), restoreResult: evidence('restore-1', 'before-after', rolling.identity),
    restoredSnapshotRef: 'snapshot-restored', effectCertainty: 'known_partial', divergence: 'none'
  }));
  assert.equal(restored.state, 'rolled_back');
  await expectCode(transitionHarnessTransaction(rolling, transitionInput(rolling, 'rolled_back', {
    retainedResult: resultRef(rolling.identity, 'unknown'), restoreResult: evidence('restore-1', 'before-after', rolling.identity),
    restoredSnapshotRef: 'snapshot-restored', effectCertainty: 'known_partial', divergence: 'none'
  })), 'UNKNOWN_EFFECT');
  await expectCode(transitionHarnessTransaction(rolling, transitionInput(rolling, 'rolled_back', {
    retainedResult: resultRef(rolling.identity, 'known_partial'), restoreResult: evidence('restore-1', 'before-after', { ...rolling.identity, workspaceId: 'workspace-2' }),
    restoredSnapshotRef: 'snapshot-restored', effectCertainty: 'known_partial', divergence: 'none'
  })), 'SCOPE_MISMATCH');
});

test('retry lineage requires a fresh identity and rejects uncertain parent effects', async () => {
  const sameRevision = requestInput();
  sameRevision.requestId = 'request-2'; sameRevision.attemptId = 'attempt-2'; sameRevision.transactionId = 'transaction-2';
  sameRevision.context.requestId = 'request-2'; sameRevision.workerSelection.attemptId = 'attempt-2'; sameRevision.resourceBudget.transactionId = 'transaction-2';
  sameRevision.retry = {
    kind: 'same-task-revision-retry',
    parent: { kind: 'retry-parent', workspaceId: SCOPE.workspaceId, taskId: SCOPE.taskId, parentTaskRevision: 0, parentAttemptId: 'attempt-1', parentTransactionId: 'transaction-1', parentAuthorityDecisionId: 'decision-0', parentTerminalState: 'failed', parentEffectCertainty: 'none' },
    freshAuthorityRequired: true, freshCheckpointRequired: true, freshEvidenceRequired: true
  };
  const retry = await createHarnessExecutionRequest(sameRevision);
  assert.equal(retry.retry?.kind, 'same-task-revision-retry');
  await expectCode(createHarnessExecutionRequest({ ...sameRevision, retry: {
    ...sameRevision.retry, parent: { ...sameRevision.retry.parent, parentEffectCertainty: 'unknown' }
  } }), 'UNKNOWN_EFFECT');
  await expectCode(createHarnessExecutionRequest({ ...sameRevision, retry: {
    ...sameRevision.retry, parent: { ...sameRevision.retry.parent, parentAuthorityDecisionId: 'decision-1' }
  } }), 'AUTHORITY_REPLAY');
  await expectCode(createHarnessExecutionRequest({ ...sameRevision, retry: {
    ...sameRevision.retry, parent: { ...sameRevision.retry.parent, parentEffectCertainty: 'known_partial' }
  } }), 'UNKNOWN_EFFECT');
  await expectCode(createHarnessExecutionRequest({ ...sameRevision, retry: {
    ...sameRevision.retry, parent: { ...sameRevision.retry.parent, parentAttemptId: 'attempt-2' }
  } }), 'SCOPE_MISMATCH');
  await expectCode(createHarnessExecutionRequest({ ...sameRevision, retry: {
    ...sameRevision.retry, parent: { ...sameRevision.retry.parent, parentResultRef: resultRef({ requestId: 'request-1', ...SCOPE, attemptId: 'attempt-1', transactionId: 'transaction-other' }, 'none') }
  } }), 'RESULT_SCOPE_MISMATCH');
});

test('strict validation is accessor-safe and rejects prototypes/symbols/cycles', async () => {
  let getterCount = 0;
  const maliciousCheckpoint = Object.create(null);
  for (const key of ['requestedPreference', 'effectiveRequirement', 'policy', 'availability']) {
    Object.defineProperty(maliciousCheckpoint, key, { enumerable: true, get() { getterCount++; return 'required'; } });
  }
  await expectCode(createHarnessExecutionRequest({ ...requestInput(), checkpoint: maliciousCheckpoint }), 'INVALID_CHECKPOINT');
  assert.equal(getterCount, 0);
  let nestedGetterCount = 0;
  const maliciousTarget = { ...target() };
  Object.defineProperty(maliciousTarget, 'targetIdentityDigest', { enumerable: true, get() { nestedGetterCount++; return DIGESTS.target; } });
  await expectCode(createHarnessExecutionRequest({ ...requestInput(), target: maliciousTarget }), 'INVALID_TARGET');
  assert.equal(nestedGetterCount, 0);
  const symbolInput = requestInput(); (symbolInput as any)[Symbol('hidden')] = true;
  await expectCode(createHarnessExecutionRequest(symbolInput), 'UNKNOWN_REQUEST_FIELD');
  await expectCode(createHarnessExecutionRequest({ ...requestInput(), target: Object.create({ ...target() }) }), 'INVALID_TARGET');
  const cyclic = requestInput(); cyclic.target.cycle = cyclic;
  await expectCode(createHarnessExecutionRequest(cyclic), 'UNKNOWN_TARGET_FIELD');
});

test('snapshot transitions are immutable, deterministic, and reject stale/replayed revisions', async () => {
  const proposed = await createProposedHarnessTransaction(await makeRequest());
  const authorized = await toAuthorized(proposed);
  assert.equal(Object.isFrozen(authorized), true);
  const repeat = await transitionHarnessTransaction(proposed, transitionInput(proposed, 'authorized', { authorityResolution: resolution() }));
  assert.deepEqual(repeat, authorized);
  await expectCode(transitionHarnessTransaction(authorized, { ...transitionInput(authorized, 'checkpointed', {
    authorityResolution: resolution(), authorityConsumption: consumption(authorized.identity), checkpoint: checkpoint(authorized.identity)
  }), expectedRevision: 0 }), 'STALE_REVISION');
  await expectCode(transitionHarnessTransaction(authorized, { ...transitionInput(authorized, 'checkpointed', {
    authorityResolution: resolution(), authorityConsumption: consumption(authorized.identity), checkpoint: checkpoint(authorized.identity)
  }), currentState: 'proposed' }), 'STALE_REVISION');
  const first = await toCheckpointed(authorized);
  const second = await transitionHarnessTransaction(authorized, transitionInput(authorized, 'checkpointed', {
    authorityResolution: resolution(), authorityConsumption: consumption(authorized.identity), checkpoint: checkpoint(authorized.identity)
  }));
  assert.deepEqual(first, second);
  assert.deepEqual(first.transition, second.transition);
});

test('H1 modules bundle with browser globals and have no capability-owning imports', async () => {
  let code = '';
  await build({
    configFile: false, envFile: false, publicDir: false, logLevel: 'silent',
    build: {
      write: false, minify: false,
      lib: { entry: fileURLToPath(new URL('../../common/execution/harness-transaction.ts', import.meta.url)), name: 'CovertHarness', formats: ['iife'] }
    },
    plugins: [{
      name: 'harness-browser-assertion',
      generateBundle(_options, bundle) {
        for (const id of this.getModuleIds()) assert.doesNotMatch(id, /node:|child_process|fs\/|execution-authority|EventHub/);
        for (const chunk of Object.values(bundle)) if (chunk.type === 'chunk') code += chunk.code;
      }
    }]
  });
  assert.ok(code.length > 0);
  const result = runInNewContext(code + '\nCovertHarness.canonicalHarnessJson({ approved: "descriptive text" });', {}) as unknown;
  assert.equal(typeof result, 'string');
});

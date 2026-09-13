import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { build } from 'vite';
import {
  EXECUTION_TRANSACTION_STATES,
  TASK_STATES,
  WORKER_ATTEMPT_STATES,
  type AcceptanceEvidenceRef,
  type AuthorityResolutionRef,
  type CauseRef,
  type ExecutionTransactionAggregate,
  type ExecutionTransactionState,
  type ExecutionTransactionTransitionRequest,
  type LifecycleData,
  type OperationDescriptor,
  type ReconciliationRef,
  type RetainedExecutionResultRef,
  type TaskAggregate,
  type TaskState,
  type TaskTransitionRequest,
  type WorkerAttemptAggregate,
  type WorkerAttemptState,
  type WorkerAttemptTransitionRequest
} from '../../common/contracts/task-lifecycle.ts';
import {
  EXECUTION_TRANSACTION_TRANSITIONS,
  TASK_TRANSITIONS,
  WORKER_ATTEMPT_TRANSITIONS,
  TaskLifecycleError,
  createExecutionTransactionAggregate,
  createOperationDescriptor,
  createTaskAggregate,
  isExecutionTransactionActive,
  isExecutionTransactionTerminal,
  isTaskActive,
  isTaskTerminal,
  isWorkerAttemptActive,
  isWorkerAttemptTerminal,
  mayAccept,
  reduceExecutionTransaction,
  reduceTask,
  reduceWorkerAttempt,
  requiresOperatorDecision,
  requiresReconciliation
} from '../../common/execution/task-lifecycle.ts';

const SCOPE = { taskId: 'task-1', workspaceId: 'workspace-1' } as const;
const OTHER_SCOPE = { taskId: 'task-2', workspaceId: 'workspace-2' } as const;
const OPERATION_MUTATION: OperationDescriptor = { id: 'operation-1', ...SCOPE, revision: 7, effectClass: 'mutation' };
const OPERATION_READ_ONLY: OperationDescriptor = { id: 'operation-read-1', ...SCOPE, revision: 3, effectClass: 'read_only' };
const CAUSE: CauseRef = { kind: 'operator', id: 'cause-1' };
const TIMESTAMP = '2026-09-12T01:02:03.000Z';

function copy<T>(value: T): T {
  return structuredClone(value);
}

function expectCode(fn: () => unknown, code: string): void {
  assert.throws(fn, (error: unknown) => error instanceof TaskLifecycleError && error.code === code, code);
}

function expectOneOf(fn: () => unknown, codes: readonly string[]): void {
  assert.throws(fn, (error: unknown) => error instanceof TaskLifecycleError && codes.includes(error.code), codes.join('|'));
}

function authority(operation: OperationDescriptor = OPERATION_MUTATION, taskRevision?: number): AuthorityResolutionRef {
  const decisionId = `${operation.id}-decision`;
  const result = {
    id: `${operation.id}-resolution`,
    taskId: operation.taskId,
    workspaceId: operation.workspaceId,
    operation: copy(operation),
    decision: {
      id: decisionId,
      taskId: operation.taskId,
      workspaceId: operation.workspaceId,
      operationId: operation.id,
      proposalRevision: operation.revision
    },
    continuation: {
      id: `${operation.id}-continuation`,
      taskId: operation.taskId,
      workspaceId: operation.workspaceId,
      operationId: operation.id,
      authorityDecisionId: decisionId,
      proposalRevision: operation.revision
    }
  } as AuthorityResolutionRef;
  return taskRevision === undefined ? result : { ...result, taskRevision };
}

function retained(
  transactionId = 'transaction-1',
  attemptId = 'attempt-1',
  scope: { taskId: string; workspaceId: string } = SCOPE,
  snapshotRef = 'snapshot-2',
  effectCertainty: RetainedExecutionResultRef['effectCertainty'] = 'known_complete'
): RetainedExecutionResultRef {
  return { id: `${transactionId}-${attemptId}-result`, ...scope, transactionId, attemptId, snapshotRef, effectCertainty };
}

function evidence(
  transactionId = 'transaction-1',
  attemptId = 'attempt-1',
  scope: { taskId: string; workspaceId: string } = SCOPE,
  snapshotRef = 'snapshot-2'
): AcceptanceEvidenceRef {
  return {
    id: `${transactionId}-${attemptId}-evidence`,
    ...scope,
    transactionId,
    attemptId,
    validationPlan: { id: 'plan-1', ...scope },
    veritasVerdict: { id: 'verdict-1', ...scope },
    resultSnapshot: retained(transactionId, attemptId, scope, snapshotRef),
    evidenceManifest: { id: 'manifest-1', ...scope }
  };
}

function checkpoint(
  transactionId = 'transaction-1',
  scope: { taskId: string; workspaceId: string } = SCOPE,
  snapshotRef = 'snapshot-1'
) {
  return { id: `${transactionId}-checkpoint`, ...scope, transactionId, snapshotRef };
}

function rollback(
  transactionId = 'transaction-1',
  scope: { taskId: string; workspaceId: string } = SCOPE,
  restoreSnapshotRef = 'snapshot-1',
  effectCertainty: 'none' | 'known_partial' | 'known_complete' | 'unknown' = 'known_complete',
  outcome: 'restored' | 'partial' | 'failed' = 'restored',
  divergence: 'none' | 'resolved' | 'present' = 'none'
) {
  return {
    id: `${transactionId}-rollback`,
    ...scope,
    transactionId,
    restoreSnapshotRef,
    outcome,
    effectCertainty,
    divergence
  } as const;
}

function quiescence(
  aggregateType: 'task' | 'worker_attempt',
  aggregateId: string,
  scope: { taskId: string; workspaceId: string } = SCOPE,
  effectCertainty: 'none' | 'known_partial' | 'known_complete' = 'known_complete',
  retainedResult: RetainedExecutionResultRef | null = retained('transaction-1', 'attempt-1', scope, 'snapshot-2', effectCertainty),
  attemptId: string | null = 'attempt-1',
  transactionId: string | null = 'transaction-1'
) {
  return {
    id: `${aggregateId}-quiescence`,
    ...scope,
    aggregateType,
    aggregateId,
    attemptId,
    transactionId,
    admissionStopped: true as const,
    activeWork: 'none' as const,
    effectCertainty,
    retainedResult: effectCertainty === 'none' ? null : retainedResult
  };
}

function reconciliation(
  aggregateType: 'task' | 'worker_attempt',
  aggregateId: string,
  scope: { taskId: string; workspaceId: string } = SCOPE,
  outcome: 'reconciled' | 'unresolved' = 'reconciled',
  effectCertainty: 'none' | 'known_partial' | 'known_complete' | 'unknown' = 'known_complete'
): ReconciliationRef {
  return { id: `${aggregateId}-reconciliation`, ...scope, aggregateType, aggregateId, outcome, effectCertainty };
}

function taskData(state: TaskState, includeAuthority = false): LifecycleData {
  const data: Record<string, unknown> = {};
  if (includeAuthority) data.authorityResolution = authority(OPERATION_MUTATION, 0);
  if (state === 'accepted') data.acceptanceEvidence = evidence();
  if (state === 'resumable') data.reconciliation = reconciliation('task', 'task-1');
  if (state === 'interrupted') data.effectCertainty = 'unknown';
  if (state === 'rolled_back') data.rollbackResult = rollback();
  if (state === 'cancelled') data.quiescence = quiescence('task', 'task-1');
  return data as LifecycleData;
}

function workerData(state: WorkerAttemptState): LifecycleData {
  if (state === 'output_ready') return { output: { id: 'output-1', ...SCOPE, attemptId: 'attempt-1' } };
  if (state === 'interrupted') return { effectCertainty: 'unknown', reconciliation: reconciliation('worker_attempt', 'attempt-1', SCOPE, 'unresolved', 'unknown') };
  if (state === 'cancelled') return { quiescence: quiescence('worker_attempt', 'attempt-1') };
  return {};
}

function transactionData(state: ExecutionTransactionState, operation: OperationDescriptor): LifecycleData {
  const auth = authority(operation);
  const data: Record<string, unknown> = {};
  if (state === 'authorized') data.authorityResolution = auth;
  if (state === 'checkpointed' || state === 'evidence_pending' || state === 'verifying' || state === 'rolling_back') {
    data.authorityResolution = auth;
    data.checkpoint = operation.effectClass === 'read_only' ? { kind: 'not_applicable' } : checkpoint();
  }
  if (state === 'executing') {
    data.authorityResolution = auth;
    data.checkpoint = operation.effectClass === 'read_only' ? { kind: 'not_applicable' } : checkpoint();
  }
  if (state === 'committed') {
    data.authorityResolution = auth;
    data.checkpoint = operation.effectClass === 'read_only' ? { kind: 'not_applicable' } : checkpoint();
    data.transactionEvidence = evidence();
  }
  if (state === 'rejected') {
    data.authorityResolution = auth;
    if (operation.effectClass === 'mutation') {
      data.checkpoint = checkpoint();
      data.retainedResult = retained();
      data.transactionEvidence = evidence();
      data.recoveryDisposition = 'retain_for_review';
    } else {
      data.checkpoint = { kind: 'not_applicable' };
      data.transactionEvidence = evidence();
    }
  }
  if (state === 'rolled_back') {
    data.authorityResolution = auth;
    data.checkpoint = operation.effectClass === 'read_only' ? { kind: 'not_applicable' } : checkpoint();
    data.rollbackResult = rollback();
  }
  if (state === 'failed') data.effectCertainty = 'none';
  return data as LifecycleData;
}

function makeTask(state: TaskState, revision = 0, includeAuthority = false): TaskAggregate {
  return {
    schemaVersion: '1', aggregateType: 'task', aggregateId: 'task-1', taskId: 'task-1', workspaceId: 'workspace-1',
    parentTaskId: null, attemptId: 'attempt-1', revision, state, correlationId: 'correlation-1', causationId: null,
    data: taskData(state, includeAuthority)
  };
}

function makeWorker(state: WorkerAttemptState, revision = 0): WorkerAttemptAggregate {
  return {
    schemaVersion: '1', aggregateType: 'worker_attempt', aggregateId: 'attempt-1', attemptId: 'attempt-1', taskId: 'task-1', workspaceId: 'workspace-1',
    parentAttemptId: null, revision, state, correlationId: 'correlation-1', causationId: null, data: workerData(state)
  };
}

function makeTransaction(state: ExecutionTransactionState, operation: OperationDescriptor = OPERATION_MUTATION, revision = 0): ExecutionTransactionAggregate {
  return {
    schemaVersion: '1', aggregateType: 'execution_transaction', aggregateId: 'transaction-1', transactionId: 'transaction-1',
    taskId: 'task-1', attemptId: 'attempt-1', workspaceId: 'workspace-1', operation: copy(operation), preExecutionSnapshotRef: 'snapshot-1',
    revision, state, correlationId: 'correlation-1', causationId: null, data: transactionData(state, operation)
  };
}

function request<S extends string>(
  aggregateId: string,
  currentState: S,
  nextState: S,
  data: LifecycleData = {},
  causeRef: CauseRef = CAUSE,
  expectedRevision = 0
) {
  return {
    aggregateId, expectedRevision, currentState, nextState, reason: 'test transition', causeRef,
    correlationId: 'correlation-1', causationId: 'cause-event-1', timestamp: TIMESTAMP, data
  };
}

function taskPayload(current: TaskState, next: TaskState): LifecycleData {
  if (current === 'awaiting_authority' && next === 'scheduled') return { authorityResolution: authority(OPERATION_MUTATION, 0) };
  if (current === 'interrupted' && next === 'resumable') return { reconciliation: reconciliation('task', 'task-1') };
  if (next === 'interrupted') return { effectCertainty: 'unknown' };
  if (next === 'accepted') return { acceptanceEvidence: evidence() };
  if (next === 'cancelled') return { quiescence: quiescence('task', 'task-1') };
  if (next === 'rolled_back') return { rollbackResult: rollback() };
  return {};
}

function taskCause(current: TaskState, next: TaskState): CauseRef {
  if (current === 'awaiting_authority' && next === 'scheduled') return { kind: 'continuation', id: authority(OPERATION_MUTATION, 0).continuation.id };
  if (current === 'resumable' && next === 'contextualizing') return { kind: 'reconsideration', id: 'reconsideration-1' };
  return CAUSE;
}

function workerPayload(next: WorkerAttemptState): LifecycleData {
  if (next === 'output_ready') return { output: { id: 'output-1', ...SCOPE, attemptId: 'attempt-1' } };
  if (next === 'interrupted') return { effectCertainty: 'unknown', reconciliation: reconciliation('worker_attempt', 'attempt-1', SCOPE, 'unresolved', 'unknown') };
  if (next === 'cancelled') return { quiescence: quiescence('worker_attempt', 'attempt-1') };
  return {};
}

function transactionPayload(current: ExecutionTransactionState, next: ExecutionTransactionState, operation: OperationDescriptor): LifecycleData {
  if (next === 'authorized') return { authorityResolution: authority(operation) };
  if (next === 'checkpointed') return {
    authorityResolution: authority(operation),
    checkpoint: operation.effectClass === 'read_only' ? { kind: 'not_applicable' } : checkpoint()
  };
  if (next === 'executing') {
    if (operation.effectClass === 'read_only') return { authorityResolution: authority(operation), checkpoint: { kind: 'not_applicable' } };
    if (current === 'checkpointed') return { authorityResolution: authority(operation), checkpoint: checkpoint() };
    return { authorityResolution: authority(operation) };
  }
  if (next === 'committed') return { transactionEvidence: evidence() };
  if (next === 'rejected') {
    if (operation.effectClass === 'mutation') return { authorityResolution: authority(operation), retainedResult: retained(), transactionEvidence: evidence(), recoveryDisposition: 'retain_for_review' };
    return { authorityResolution: authority(operation), transactionEvidence: evidence() };
  }
  if (next === 'rolled_back') return { rollbackResult: rollback() };
  if (next === 'failed') return { effectCertainty: 'none' };
  return {};
}

test('task transition matrix accounts for all 16 x 16 pairs', () => {
  let legal = 0;
  let accepted = 0;
  let rejected = 0;
  for (const current of TASK_STATES) for (const next of TASK_STATES) {
    const isLegal = TASK_TRANSITIONS[current].includes(next);
    const source = makeTask(current);
    const input = request(source.aggregateId, current, next, taskPayload(current, next), taskCause(current, next));
    if (isLegal) {
      legal++;
      assert.doesNotThrow(() => reduceTask(source, input as TaskTransitionRequest), `${current} -> ${next}`);
      accepted++;
    } else {
      rejected++;
      expectCode(() => reduceTask(source, input as TaskTransitionRequest), 'ILLEGAL_TRANSITION');
    }
  }
  assert.equal(legal, 55);
  assert.equal(accepted, 55);
  assert.equal(rejected, 201);
  assert.equal(accepted + rejected, 256);
  assert.equal(isTaskTerminal('accepted'), true);
  assert.equal(isTaskActive('running'), true);
  assert.equal(isTaskActive('accepted'), false);
});

test('worker-attempt transition matrix accounts for all 11 x 11 pairs', () => {
  let legal = 0;
  let accepted = 0;
  let rejected = 0;
  for (const current of WORKER_ATTEMPT_STATES) for (const next of WORKER_ATTEMPT_STATES) {
    const isLegal = WORKER_ATTEMPT_TRANSITIONS[current].includes(next);
    const source = makeWorker(current);
    const input = request(source.aggregateId, current, next, workerPayload(next));
    if (isLegal) {
      legal++;
      assert.doesNotThrow(() => reduceWorkerAttempt(source, input as WorkerAttemptTransitionRequest), `${current} -> ${next}`);
      accepted++;
    } else {
      rejected++;
      expectCode(() => reduceWorkerAttempt(source, input as WorkerAttemptTransitionRequest), 'ILLEGAL_TRANSITION');
    }
  }
  assert.equal(legal, 32);
  assert.equal(accepted, 32);
  assert.equal(rejected, 89);
  assert.equal(accepted + rejected, 121);
  assert.equal(isWorkerAttemptTerminal('output_ready'), true);
  assert.equal(isWorkerAttemptActive('running'), true);
});

test('execution-transaction matrix accounts for all 11 x 11 pairs and blocks mutation checkpoint bypass', () => {
  let tableLegal = 0;
  let accepted = 0;
  let rejected = 0;
  let checkpointGuard = 0;
  for (const current of EXECUTION_TRANSACTION_STATES) for (const next of EXECUTION_TRANSACTION_STATES) {
    const isLegal = EXECUTION_TRANSACTION_TRANSITIONS[current].includes(next);
    const source = makeTransaction(current);
    const input = request(source.aggregateId, current, next, transactionPayload(current, next, OPERATION_MUTATION));
    if (isLegal) {
      tableLegal++;
      if (current === 'authorized' && next === 'executing') {
        expectCode(() => reduceExecutionTransaction(source, input as ExecutionTransactionTransitionRequest), 'CHECKPOINT_REQUIRED');
        checkpointGuard++;
      } else {
        assert.doesNotThrow(() => reduceExecutionTransaction(source, input as ExecutionTransactionTransitionRequest), `${current} -> ${next}`);
        accepted++;
      }
    } else {
      rejected++;
      expectCode(() => reduceExecutionTransaction(source, input as ExecutionTransactionTransitionRequest), 'ILLEGAL_TRANSITION');
    }
  }
  assert.equal(tableLegal, 22);
  assert.equal(checkpointGuard, 1);
  assert.equal(accepted, 21);
  assert.equal(rejected, 99);
  assert.equal(accepted + checkpointGuard + rejected, 121);
  assert.equal(isExecutionTransactionTerminal('committed'), true);
  assert.equal(isExecutionTransactionActive('executing'), true);
});

test('authority resolution is structurally bound to task, workspace, operation, proposal and continuation', () => {
  const source = makeTask('awaiting_authority');
  const valid = authority(OPERATION_MUTATION, 0);
  const validRequest = request('task-1', 'awaiting_authority', 'scheduled', { authorityResolution: valid }, { kind: 'continuation', id: valid.continuation.id });
  assert.equal(reduceTask(source, validRequest as TaskTransitionRequest).aggregate.state, 'scheduled');
  expectCode(() => reduceTask(source, { ...validRequest, causeRef: { kind: 'continuation', id: 'different' } } as TaskTransitionRequest), 'AUTHORITY_RESOLUTION_REQUIRED');
  expectCode(() => reduceTask(source, request('task-1', 'awaiting_authority', 'scheduled', { authorityResolution: { ...valid, taskId: 'task-2' } }, { kind: 'continuation', id: valid.continuation.id }) as TaskTransitionRequest), 'AUTHORITY_SCOPE_MISMATCH');
  expectCode(() => reduceTask(source, request('task-1', 'awaiting_authority', 'scheduled', { authorityResolution: { ...valid, workspaceId: 'workspace-2' } }, { kind: 'continuation', id: valid.continuation.id }) as TaskTransitionRequest), 'AUTHORITY_SCOPE_MISMATCH');
  const wrongOperation = copy(valid) as unknown as { decision: { operationId: string }; continuation: { proposalRevision: number } } & AuthorityResolutionRef;
  wrongOperation.decision.operationId = 'other-operation';
  expectCode(() => reduceTask(source, request('task-1', 'awaiting_authority', 'scheduled', { authorityResolution: wrongOperation }, { kind: 'continuation', id: valid.continuation.id }) as TaskTransitionRequest), 'AUTHORITY_BINDING_MISMATCH');
  const wrongProposal = copy(valid) as unknown as { continuation: { proposalRevision: number } } & AuthorityResolutionRef;
  wrongProposal.continuation.proposalRevision++;
  expectCode(() => reduceTask(source, request('task-1', 'awaiting_authority', 'scheduled', { authorityResolution: wrongProposal }, { kind: 'continuation', id: valid.continuation.id }) as TaskTransitionRequest), 'AUTHORITY_BINDING_MISMATCH');
  expectCode(() => reduceTask(source, request('task-1', 'awaiting_authority', 'scheduled') as TaskTransitionRequest), 'AUTHORITY_RESOLUTION_REQUIRED');
  expectCode(() => reduceTask(source, request('task-1', 'awaiting_authority', 'scheduled', { authorityResolution: { ...valid, id: '' } }, { kind: 'continuation', id: valid.continuation.id }) as TaskTransitionRequest), 'INVALID_AUTHORITY_RESOLUTION_ID');
});

test('reconsideration clears stale authority and rejects caller-carried authority', () => {
  const source = makeTask('resumable', 0, true);
  const resumed = reduceTask(source, request('task-1', 'resumable', 'contextualizing', {}, { kind: 'reconsideration', id: 'reconsideration-1' }) as TaskTransitionRequest).aggregate;
  assert.equal(resumed.state, 'contextualizing');
  assert.equal(Object.prototype.hasOwnProperty.call(resumed.data, 'authorityResolution'), false);
  expectCode(() => reduceTask(source, request('task-1', 'resumable', 'contextualizing', { authorityResolution: authority(OPERATION_MUTATION, 0) }, { kind: 'reconsideration', id: 'reconsideration-1' }) as TaskTransitionRequest), 'STALE_AUTHORITY_FORBIDDEN');
});

test('a cleared authority resolution cannot be reintroduced after a fresh task revision', () => {
  const source = makeTask('resumable', 0, true);
  const contextualizing = reduceTask(source, request('task-1', 'resumable', 'contextualizing', {}, { kind: 'reconsideration', id: 'reconsideration-1' }) as TaskTransitionRequest).aggregate;
  const planning = reduceTask(contextualizing, request('task-1', 'contextualizing', 'planning', {}, CAUSE, contextualizing.revision) as TaskTransitionRequest).aggregate;
  const awaiting = reduceTask(planning, request('task-1', 'planning', 'awaiting_authority', {}, CAUSE, planning.revision) as TaskTransitionRequest).aggregate;
  const old = source.data.authorityResolution as AuthorityResolutionRef;
  expectCode(() => reduceTask(awaiting, request('task-1', 'awaiting_authority', 'scheduled', { authorityResolution: old }, { kind: 'continuation', id: old.continuation.id }, awaiting.revision) as TaskTransitionRequest), 'AUTHORITY_RESOLUTION_REQUIRED');
  const fresh = authority(OPERATION_MUTATION, awaiting.revision);
  const scheduled = reduceTask(awaiting, request('task-1', 'awaiting_authority', 'scheduled', { authorityResolution: fresh }, { kind: 'continuation', id: fresh.continuation.id }, awaiting.revision) as TaskTransitionRequest).aggregate;
  assert.equal(scheduled.state, 'scheduled');
});

test('reconsideration invalidates every active execution-evidence field', () => {
  const staleData: LifecycleData = {
    authorityResolution: authority(OPERATION_MUTATION, 0),
    reconciliation: reconciliation('task', 'task-1'),
    acceptanceEvidence: evidence(),
    transactionEvidence: evidence(),
    retainedResult: retained(),
    output: { id: 'output-1', ...SCOPE, attemptId: 'attempt-1' },
    failureRef: { id: 'failure-1', ...SCOPE },
    rollbackResult: rollback(),
    checkpoint: checkpoint(),
    quiescence: quiescence('task', 'task-1'),
    effectCertainty: 'known_partial',
    recoveryDisposition: 'retain_for_review'
  };
  const source = makeTask('resumable', 0);
  const staleSource = { ...source, data: staleData };
  const contextualizing = reduceTask(staleSource, request('task-1', 'resumable', 'contextualizing', {}, { kind: 'reconsideration', id: 'reconsideration-1' }) as TaskTransitionRequest).aggregate;
  assert.deepEqual(contextualizing.data, {});
  assert.equal(Object.isFrozen(contextualizing.data), true);
  for (const field of ['reconciliation', 'acceptanceEvidence', 'transactionEvidence', 'retainedResult', 'output', 'failureRef', 'checkpoint', 'quiescence', 'rollbackResult', 'effectCertainty', 'recoveryDisposition'] as const) {
    expectCode(() => reduceTask(staleSource, request('task-1', 'resumable', 'contextualizing', { [field]: staleData[field] } as unknown as LifecycleData, { kind: 'reconsideration', id: 'reconsideration-1' }) as TaskTransitionRequest), 'STALE_EPOCH_DATA_FORBIDDEN');
  }
  expectCode(() => reduceTask(staleSource, request('task-1', 'resumable', 'contextualizing', { authorityResolution: staleData.authorityResolution } as unknown as LifecycleData, { kind: 'reconsideration', id: 'reconsideration-1' }) as TaskTransitionRequest), 'STALE_AUTHORITY_FORBIDDEN');

  const planning = reduceTask(contextualizing, request('task-1', 'contextualizing', 'planning', {}, CAUSE, contextualizing.revision) as TaskTransitionRequest).aggregate;
  const awaiting = reduceTask(planning, request('task-1', 'planning', 'awaiting_authority', {}, CAUSE, planning.revision) as TaskTransitionRequest).aggregate;
  const fresh = authority(OPERATION_MUTATION, awaiting.revision);
  const scheduled = reduceTask(awaiting, request('task-1', 'awaiting_authority', 'scheduled', { authorityResolution: fresh }, { kind: 'continuation', id: fresh.continuation.id }, awaiting.revision) as TaskTransitionRequest).aggregate;
  const running = reduceTask(scheduled, request('task-1', 'scheduled', 'running', {}, CAUSE, scheduled.revision) as TaskTransitionRequest).aggregate;
  const verifying = reduceTask(running, request('task-1', 'running', 'verifying', {}, { kind: 'worker', id: 'worker-1' }, running.revision) as TaskTransitionRequest).aggregate;
  expectCode(() => reduceTask(verifying, request('task-1', 'verifying', 'accepted', {}, { kind: 'verification', id: 'verifier-1' }, verifying.revision) as TaskTransitionRequest), 'ACCEPTANCE_EVIDENCE_REQUIRED');
});

test('operation classification is immutable and read-only checkpoint exemption is explicit', () => {
  const input = copy(OPERATION_MUTATION);
  const descriptor = createOperationDescriptor(input);
  (input as { effectClass: OperationDescriptor['effectClass'] }).effectClass = 'read_only';
  assert.equal(descriptor.effectClass, 'mutation');
  assert.equal(Object.isFrozen(descriptor), true);
  const source = makeTransaction('authorized', OPERATION_READ_ONLY);
  const readCheckpointed = reduceExecutionTransaction(source, request('transaction-1', 'authorized', 'checkpointed', { authorityResolution: authority(OPERATION_READ_ONLY), checkpoint: { kind: 'not_applicable' } }) as ExecutionTransactionTransitionRequest);
  assert.equal(readCheckpointed.aggregate.state, 'checkpointed');
  const readOnly = reduceExecutionTransaction(source, request('transaction-1', 'authorized', 'executing', { authorityResolution: authority(OPERATION_READ_ONLY), checkpoint: { kind: 'not_applicable' } }) as ExecutionTransactionTransitionRequest);
  assert.equal(readOnly.aggregate.state, 'executing');
  expectCode(() => reduceExecutionTransaction(source, request('transaction-1', 'authorized', 'executing', { authorityResolution: authority(OPERATION_READ_ONLY), checkpoint: checkpoint() }) as ExecutionTransactionTransitionRequest), 'READ_ONLY_CHECKPOINT_REQUIRED');
  const forged = copy(makeTransaction('authorized', OPERATION_READ_ONLY));
  (forged.operation as { effectClass: OperationDescriptor['effectClass'] }).effectClass = 'mutation';
  expectCode(() => createExecutionTransactionAggregate(forged), 'AUTHORITY_SCOPE_MISMATCH');
  const wrongOperation = { ...OPERATION_MUTATION, id: 'operation-other' };
  expectCode(() => createExecutionTransactionAggregate({ ...makeTransaction('authorized'), data: { authorityResolution: authority(wrongOperation) } } as never), 'AUTHORITY_OPERATION_MISMATCH');
});

test('checkpoint identity binds transaction, task, workspace and pre-execution snapshot', () => {
  const source = makeTransaction('checkpointed');
  const valid = { authorityResolution: authority(), checkpoint: checkpoint() };
  assert.equal(reduceExecutionTransaction(source, request('transaction-1', 'checkpointed', 'executing', valid) as ExecutionTransactionTransitionRequest).aggregate.state, 'executing');
  const attempts = [
    checkpoint('transaction-2'),
    checkpoint('transaction-1', OTHER_SCOPE),
    checkpoint('transaction-1', SCOPE, 'snapshot-other')
  ];
  for (const bad of attempts) expectCode(() => reduceExecutionTransaction(source, request('transaction-1', 'checkpointed', 'executing', { checkpoint: bad }) as ExecutionTransactionTransitionRequest), 'CHECKPOINT_SCOPE_MISMATCH');
  expectCode(() => reduceExecutionTransaction(makeTransaction('authorized'), request('transaction-1', 'authorized', 'executing', { checkpoint: checkpoint() }) as ExecutionTransactionTransitionRequest), 'CHECKPOINT_REQUIRED');
  expectCode(() => createExecutionTransactionAggregate({ ...makeTransaction('executing'), data: { authorityResolution: authority(), checkpoint: { id: 'belongs-to-other', taskId: 'task-1', workspaceId: 'workspace-1', transactionId: 'transaction-1', snapshotRef: 'snapshot-2' } } } as never), 'CHECKPOINT_SCOPE_MISMATCH');
});

test('cancellation requires trusted quiescence and non-unknown effects', () => {
  const source = makeTask('running');
  expectCode(() => reduceTask(source, request('task-1', 'running', 'cancelled') as TaskTransitionRequest), 'CLEAN_QUIESCENCE_REQUIRED');
  expectCode(() => reduceTask(source, request('task-1', 'running', 'cancelled', { quiescence: { ...quiescence('task', 'task-1'), admissionStopped: false } } as unknown as LifecycleData) as TaskTransitionRequest), 'QUIESCENCE_NOT_SAFE');
  expectCode(() => reduceTask(source, request('task-1', 'running', 'cancelled', { quiescence: { ...quiescence('task', 'task-1'), activeWork: 'running' } } as unknown as LifecycleData) as TaskTransitionRequest), 'QUIESCENCE_NOT_SAFE');
  expectCode(() => reduceTask(source, request('task-1', 'running', 'cancelled', { quiescence: { ...quiescence('task', 'task-1'), effectCertainty: 'unknown' } as never }) as TaskTransitionRequest), 'QUIESCENCE_EFFECT_UNKNOWN');
  expectCode(() => reduceTask(source, request('task-1', 'running', 'cancelled', { quiescence: quiescence('task', 'task-2') }) as TaskTransitionRequest), 'CLEAN_QUIESCENCE_REQUIRED');
  expectOneOf(() => reduceTask(source, request('task-1', 'running', 'cancelled', { quiescence: quiescence('task', 'task-1', SCOPE, 'known_complete', retained('transaction-1', 'attempt-2')) }) as TaskTransitionRequest), ['QUIESCENCE_SCOPE_MISMATCH', 'CLEAN_QUIESCENCE_REQUIRED']);
  expectCode(() => reduceTask(source, request('task-1', 'running', 'cancelled', { quiescence: quiescence('task', 'task-1', SCOPE, 'known_partial', retained('transaction-1', 'attempt-1', SCOPE, 'snapshot-2', 'known_complete')) }) as TaskTransitionRequest), 'QUIESCENCE_EFFECT_MISMATCH');
  const cancelled = reduceTask(source, request('task-1', 'running', 'cancelled', { quiescence: quiescence('task', 'task-1', SCOPE, 'known_partial') }) as TaskTransitionRequest).aggregate;
  assert.equal(cancelled.state, 'cancelled');
  expectCode(() => reduceWorkerAttempt(makeWorker('cancelling'), request('attempt-1', 'cancelling', 'cancelled', { quiescence: quiescence('worker_attempt', 'attempt-1', SCOPE, 'known_partial', null) }) as WorkerAttemptTransitionRequest), 'QUIESCENCE_RESULT_REQUIRED');
});

test('quiescence binds attempt and transaction scope, including explicit no-transaction state', () => {
  const source = makeTask('running');
  const foreignResult = retained('transaction-other', 'attempt-1');
  expectCode(() => reduceTask(source, request('task-1', 'running', 'cancelled', {
    quiescence: quiescence('task', 'task-1', SCOPE, 'known_complete', foreignResult)
  }) as TaskTransitionRequest), 'QUIESCENCE_SCOPE_MISMATCH');
  expectCode(() => reduceTask(source, request('task-1', 'running', 'cancelled', {
    quiescence: quiescence('task', 'task-1', SCOPE, 'known_complete', retained('transaction-1', 'attempt-1'), 'attempt-1', 'transaction-other')
  }) as TaskTransitionRequest), 'QUIESCENCE_SCOPE_MISMATCH');
  const activeTransaction = { ...source, data: { retainedResult: retained('transaction-1') } };
  expectCode(() => reduceTask(activeTransaction, request('task-1', 'running', 'cancelled', {
    quiescence: quiescence('task', 'task-1', SCOPE, 'known_complete', retained('transaction-other', 'attempt-1'), 'attempt-1', 'transaction-other')
  }) as TaskTransitionRequest), 'CLEAN_QUIESCENCE_REQUIRED');
  const noTransaction = reduceTask(source, request('task-1', 'running', 'cancelled', {
    quiescence: quiescence('task', 'task-1', SCOPE, 'none', null, 'attempt-1', null)
  }) as TaskTransitionRequest).aggregate;
  assert.equal(noTransaction.state, 'cancelled');
  assert.equal(noTransaction.data.quiescence?.transactionId, null);
});

test('interruption preserves explicit uncertainty and requires reconciliation before resumable', () => {
  expectCode(() => createTaskAggregate({ ...makeTask('interrupted'), data: {} } as never), 'INTERRUPTION_EFFECT_REQUIRED');
  const interrupted = reduceTask(makeTask('running'), request('task-1', 'running', 'interrupted', { effectCertainty: 'unknown' }) as TaskTransitionRequest).aggregate;
  assert.equal(interrupted.data.effectCertainty, 'unknown');
  for (const next of ['running', 'scheduled', 'accepted'] as const) expectCode(() => reduceTask(interrupted, request('task-1', 'interrupted', next, taskPayload('interrupted', next), CAUSE, interrupted.revision) as TaskTransitionRequest), 'ILLEGAL_TRANSITION');
  expectCode(() => reduceTask(interrupted, request('task-1', 'interrupted', 'resumable', {}, CAUSE, interrupted.revision) as TaskTransitionRequest), 'RECONCILIATION_REQUIRED');
  const resumable = reduceTask(interrupted, request('task-1', 'interrupted', 'resumable', { reconciliation: reconciliation('task', 'task-1') }, CAUSE, interrupted.revision) as TaskTransitionRequest).aggregate;
  assert.equal(resumable.state, 'resumable');
  expectCode(() => reduceWorkerAttempt(makeWorker('running'), request('attempt-1', 'running', 'interrupted', { effectCertainty: 'known_complete', reconciliation: reconciliation('worker_attempt', 'attempt-1', SCOPE, 'unresolved', 'unknown') }) as WorkerAttemptTransitionRequest), 'INTERRUPTION_EFFECT_REQUIRED');
});

test('mutation rejection retains resulting state and does not imply rollback', () => {
  const source = makeTransaction('verifying');
  const deniedReadOnly = reduceExecutionTransaction(makeTransaction('proposed', OPERATION_READ_ONLY), request('transaction-1', 'proposed', 'rejected') as ExecutionTransactionTransitionRequest).aggregate;
  assert.equal(deniedReadOnly.state, 'rejected');
  expectCode(() => reduceExecutionTransaction(source, request('transaction-1', 'verifying', 'rejected') as ExecutionTransactionTransitionRequest), 'REJECTED_RESULT_REQUIRED');
  const acceptedRejection = reduceExecutionTransaction(source, request('transaction-1', 'verifying', 'rejected', { retainedResult: retained(), transactionEvidence: evidence(), recoveryDisposition: 'retain_for_review' }) as ExecutionTransactionTransitionRequest).aggregate;
  assert.equal(acceptedRejection.state, 'rejected');
  assert.equal(acceptedRejection.data.recoveryDisposition, 'retain_for_review');
  assert.equal(acceptedRejection.data.retainedResult?.snapshotRef, 'snapshot-2');
  expectCode(() => reduceExecutionTransaction(source, request('transaction-1', 'verifying', 'rejected', { retainedResult: retained(), transactionEvidence: evidence('transaction-1', 'attempt-1', SCOPE, 'other-snapshot'), recoveryDisposition: 'retain_for_review' }) as ExecutionTransactionTransitionRequest), 'REJECTED_RESULT_MISMATCH');
  expectCode(() => createExecutionTransactionAggregate({ ...makeTransaction('rejected'), data: { ...makeTransaction('rejected').data, retainedResult: retained('transaction-1', 'attempt-1', SCOPE, 'snapshot-2', 'unknown') } } as never), 'REJECTED_RESULT_REQUIRED');
  const noAuthority = copy(makeTransaction('rejected'));
  delete (noAuthority.data as { authorityResolution?: AuthorityResolutionRef }).authorityResolution;
  expectCode(() => createExecutionTransactionAggregate(noAuthority), 'REJECTED_RESULT_REQUIRED');
  expectCode(() => reduceExecutionTransaction(source, request('transaction-1', 'verifying', 'rejected', { retainedResult: retained(), transactionEvidence: { ...evidence(), resultSnapshot: retained('transaction-1', 'attempt-1', SCOPE, 'snapshot-2', 'unknown') }, recoveryDisposition: 'retain_for_review' }) as ExecutionTransactionTransitionRequest), 'TRANSACTION_EVIDENCE_INCOMPLETE');
  expectCode(() => reduceExecutionTransaction(source, request('transaction-1', 'verifying', 'rejected', { retainedResult: retained('transaction-1', 'attempt-1', SCOPE, 'snapshot-2', 'known_partial'), transactionEvidence: evidence(), recoveryDisposition: 'retain_for_review' }) as ExecutionTransactionTransitionRequest), 'REJECTED_EFFECT_MISMATCH');
  expectCode(() => reduceExecutionTransaction(source, request('transaction-1', 'verifying', 'rejected', { retainedResult: retained('transaction-1', 'attempt-1', SCOPE, 'snapshot-2', 'none'), transactionEvidence: { ...evidence(), resultSnapshot: retained('transaction-1', 'attempt-1', SCOPE, 'snapshot-2', 'known_partial') }, recoveryDisposition: 'retain_for_review' }) as ExecutionTransactionTransitionRequest), 'REJECTED_EFFECT_MISMATCH');
  const differentResult = { ...evidence(), resultSnapshot: { ...retained(), id: 'different-result' } };
  expectCode(() => reduceExecutionTransaction(source, request('transaction-1', 'verifying', 'rejected', { retainedResult: retained(), transactionEvidence: differentResult, recoveryDisposition: 'retain_for_review' }) as ExecutionTransactionTransitionRequest), 'REJECTED_RESULT_MISMATCH');
});

test('acceptance requires complete scope-bound evidence and rejects boolean claims', () => {
  const source = makeTask('verifying');
  expectCode(() => reduceTask(source, request('task-1', 'verifying', 'accepted') as TaskTransitionRequest), 'ACCEPTANCE_EVIDENCE_REQUIRED');
  expectCode(() => reduceTask(source, request('task-1', 'verifying', 'accepted', { verified: true } as never) as TaskTransitionRequest), 'UNKNOWN_DATA_FIELD');
  expectCode(() => reduceTask(source, request('task-1', 'verifying', 'accepted', { acceptanceEvidence: evidence('transaction-1', 'attempt-2') }) as TaskTransitionRequest), 'ACCEPTANCE_SCOPE_MISMATCH');
  const mixed = evidence();
  (mixed as unknown as { resultSnapshot: RetainedExecutionResultRef }).resultSnapshot = retained('transaction-other', 'attempt-1');
  expectCode(() => reduceTask(source, request('task-1', 'verifying', 'accepted', { acceptanceEvidence: mixed }) as TaskTransitionRequest), 'EVIDENCE_SCOPE_MISMATCH');
  const accepted = reduceTask(source, request('task-1', 'verifying', 'accepted', { acceptanceEvidence: evidence() }) as TaskTransitionRequest).aggregate;
  assert.equal(accepted.state, 'accepted');
  expectCode(() => createTaskAggregate({ ...makeTask('accepted'), data: { acceptanceEvidence: { ...evidence(), validationPlan: { id: 'plan', ...OTHER_SCOPE } } } } as never), 'EVIDENCE_SCOPE_MISMATCH');
});

test('rollback requires restored, bound and certain evidence', () => {
  const source = makeTransaction('rolling_back');
  const valid = reduceExecutionTransaction(source, request('transaction-1', 'rolling_back', 'rolled_back', { rollbackResult: rollback() }) as ExecutionTransactionTransitionRequest).aggregate;
  assert.equal(valid.state, 'rolled_back');
  const variants = [
    rollback('transaction-other'),
    rollback('transaction-1', OTHER_SCOPE),
    rollback('transaction-1', SCOPE, 'snapshot-other'),
    rollback('transaction-1', SCOPE, 'snapshot-1', 'unknown'),
    rollback('transaction-1', SCOPE, 'snapshot-1', 'known_complete', 'partial'),
    rollback('transaction-1', SCOPE, 'snapshot-1', 'known_complete', 'restored', 'present')
  ];
  for (const bad of variants) expectOneOf(() => reduceExecutionTransaction(source, request('transaction-1', 'rolling_back', 'rolled_back', { rollbackResult: bad }) as ExecutionTransactionTransitionRequest), ['ROLLBACK_RESULT_REQUIRED', 'ROLLBACK_SCOPE_MISMATCH']);
  expectCode(() => reduceExecutionTransaction(source, request('transaction-1', 'rolling_back', 'rolled_back', { rollbackResult: rollback('transaction-1', SCOPE, 'snapshot-1', 'unknown') }) as ExecutionTransactionTransitionRequest), 'ROLLBACK_RESULT_REQUIRED');
});

test('revision, aggregate identity and transition replay protections are deterministic', () => {
  const source = makeTask('created');
  const firstRequest = request('task-1', 'created', 'contextualizing');
  const first = reduceTask(source, firstRequest as TaskTransitionRequest);
  assert.equal(first.aggregate.revision, 1);
  assert.throws(() => reduceTask(first.aggregate, firstRequest as TaskTransitionRequest), { code: 'STALE_REVISION' });
  expectCode(() => reduceTask({ ...source, revision: 2 }, firstRequest as TaskTransitionRequest), 'STALE_REVISION');
  expectCode(() => reduceTask(source, { ...firstRequest, currentState: 'planning' } as TaskTransitionRequest), 'STATE_MISMATCH');
  expectCode(() => reduceTask(source, { ...firstRequest, aggregateId: 'task-other' } as TaskTransitionRequest), 'AGGREGATE_ID_MISMATCH');
  expectCode(() => reduceTask(source, { ...firstRequest, correlationId: 'other-correlation' } as TaskTransitionRequest), 'CORRELATION_MISMATCH');
  const a = reduceTask(source, firstRequest as TaskTransitionRequest);
  const b = reduceTask(source, firstRequest as TaskTransitionRequest);
  assert.deepEqual(a, b);
  assert.equal(a.transition.timestamp, TIMESTAMP);
  expectCode(() => reduceTask(source, { ...firstRequest, timestamp: 'not-a-time' } as TaskTransitionRequest), 'INVALID_TIMESTAMP');
});

test('terminal aggregates reject every outgoing transition', () => {
  let taskAttempts = 0;
  for (const state of ['accepted', 'rejected', 'failed', 'cancelled', 'rolled_back'] as const) for (const next of TASK_STATES) {
    taskAttempts++;
    expectCode(() => reduceTask(makeTask(state), request('task-1', state, next, taskPayload(state, next), taskCause(state, next)) as TaskTransitionRequest), 'ILLEGAL_TRANSITION');
  }
  let workerAttempts = 0;
  for (const state of ['output_ready', 'failed', 'cancelled', 'interrupted'] as const) for (const next of WORKER_ATTEMPT_STATES) {
    workerAttempts++;
    expectCode(() => reduceWorkerAttempt(makeWorker(state), request('attempt-1', state, next, workerPayload(next)) as WorkerAttemptTransitionRequest), 'ILLEGAL_TRANSITION');
  }
  let transactionAttempts = 0;
  for (const state of ['committed', 'rejected', 'rolled_back', 'failed'] as const) for (const next of EXECUTION_TRANSACTION_STATES) {
    transactionAttempts++;
    expectCode(() => reduceExecutionTransaction(makeTransaction(state), request('transaction-1', state, next, transactionPayload(state, next, OPERATION_MUTATION)) as ExecutionTransactionTransitionRequest), 'ILLEGAL_TRANSITION');
  }
  assert.equal(taskAttempts, 80);
  assert.equal(workerAttempts, 44);
  assert.equal(transactionAttempts, 44);
});

test('unknown authority fields and non-plain aliases are rejected at every boundary', () => {
  const fields = ['approved', 'permission', 'capability', 'executionHandle', 'actorToken', 'authority', 'approvalToken', 'credential'];
  for (const field of fields) {
    expectCode(() => createTaskAggregate({ ...makeTask('created'), [field]: true } as never), 'UNKNOWN_AGGREGATE_FIELD');
    expectCode(() => reduceTask(makeTask('created'), { ...request('task-1', 'created', 'contextualizing'), [field]: true } as never), 'UNKNOWN_TRANSITION_FIELD');
    expectCode(() => reduceTask(makeTask('created'), request('task-1', 'created', 'contextualizing', { [field]: true } as never) as TaskTransitionRequest), 'UNKNOWN_DATA_FIELD');
    expectCode(() => reduceTask(makeTask('created'), request('task-1', 'created', 'contextualizing', {}, { ...CAUSE, [field]: true } as never) as TaskTransitionRequest), 'UNKNOWN_CAUSE_FIELD');
  }
  const hidden: Record<string, unknown> = {};
  Object.defineProperty(hidden, 'approved', { enumerable: false, value: true });
  expectCode(() => reduceTask(makeTask('created'), request('task-1', 'created', 'contextualizing', hidden as LifecycleData) as TaskTransitionRequest), 'UNKNOWN_DATA_FIELD');
  const symbolField = { [Symbol('authority')]: true };
  expectCode(() => reduceTask(makeTask('created'), request('task-1', 'created', 'contextualizing', symbolField as LifecycleData) as TaskTransitionRequest), 'UNKNOWN_DATA_FIELD');
  expectCode(() => createOperationDescriptor(Object.create({ id: 'inherited' }) as OperationDescriptor), 'INVALID_OPERATION');
});

test('strict validation rejects accessors before invoking them', () => {
  let getterReads = 0;
  const getterObject = <T extends object>(base: T, field: string): T => {
    const output = { ...base } as T;
    Object.defineProperty(output, field, { enumerable: true, get: () => { getterReads++; return (base as Record<string, unknown>)[field]; } });
    return output;
  };
  const expectNoGetter = (fn: () => unknown): void => {
    const before = getterReads;
    assert.throws(fn, TaskLifecycleError);
    assert.equal(getterReads, before);
  };

  const checkpointGetter = getterObject(checkpoint(), 'kind');
  expectNoGetter(() => reduceExecutionTransaction(makeTransaction('authorized'), request('transaction-1', 'authorized', 'checkpointed', { checkpoint: checkpointGetter }) as ExecutionTransactionTransitionRequest));

  const authorityGetter = { ...authority(), operation: getterObject(OPERATION_MUTATION, 'id') };
  expectNoGetter(() => reduceTask(makeTask('awaiting_authority'), request('task-1', 'awaiting_authority', 'scheduled', { authorityResolution: authorityGetter }, { kind: 'continuation', id: authorityGetter.continuation.id }) as TaskTransitionRequest));

  const acceptanceGetter = { ...evidence(), resultSnapshot: getterObject(retained(), 'id') };
  expectNoGetter(() => reduceTask(makeTask('verifying'), request('task-1', 'verifying', 'accepted', { acceptanceEvidence: acceptanceGetter }) as TaskTransitionRequest));

  const quiescenceGetter = { ...quiescence('task', 'task-1'), retainedResult: getterObject(retained(), 'id') };
  expectNoGetter(() => reduceTask(makeTask('running'), request('task-1', 'running', 'cancelled', { quiescence: quiescenceGetter }) as TaskTransitionRequest));

  const rollbackGetter = getterObject(rollback(), 'restoreSnapshotRef');
  expectNoGetter(() => reduceExecutionTransaction(makeTransaction('rolling_back'), request('transaction-1', 'rolling_back', 'rolled_back', { rollbackResult: rollbackGetter }) as ExecutionTransactionTransitionRequest));

  const retainedGetter = getterObject(retained(), 'snapshotRef');
  expectNoGetter(() => reduceExecutionTransaction(makeTransaction('verifying'), request('transaction-1', 'verifying', 'rejected', { retainedResult: retainedGetter, transactionEvidence: evidence(), recoveryDisposition: 'retain_for_review' }) as ExecutionTransactionTransitionRequest));
  assert.equal(getterReads, 0);
});

test('cross-scope substitutions are rejected across every lifecycle evidence boundary', () => {
  const attacks: Array<[string, () => unknown]> = [];
  const resolution = authority(OPERATION_MUTATION, 0);
  const addAuthority = (label: string, value: AuthorityResolutionRef): void => {
    attacks.push([`authority:${label}`, () => reduceTask(makeTask('awaiting_authority'), request('task-1', 'awaiting_authority', 'scheduled', { authorityResolution: value }, { kind: 'continuation', id: resolution.continuation.id }) as TaskTransitionRequest)]);
  };
  addAuthority('task', { ...resolution, taskId: 'task-2' });
  addAuthority('workspace', { ...resolution, workspaceId: 'workspace-2' });
  addAuthority('operation', { ...resolution, operation: { ...OPERATION_MUTATION, id: 'operation-2' } });
  addAuthority('task-revision', { ...resolution, taskRevision: 1 });
  addAuthority('continuation', { ...resolution, continuation: { ...resolution.continuation, id: 'continuation-2' } });
  addAuthority('decision', { ...resolution, decision: { ...resolution.decision, id: 'decision-2' } });

  for (const [label, value] of [
    ['task', checkpoint('transaction-1', { taskId: 'task-2', workspaceId: 'workspace-1' })],
    ['workspace', checkpoint('transaction-1', { taskId: 'task-1', workspaceId: 'workspace-2' })],
    ['transaction', checkpoint('transaction-2')],
    ['snapshot', checkpoint('transaction-1', SCOPE, 'snapshot-other')]
  ] as const) attacks.push([`checkpoint:${label}`, () => reduceExecutionTransaction(makeTransaction('checkpointed'), request('transaction-1', 'checkpointed', 'executing', { checkpoint: value }) as ExecutionTransactionTransitionRequest)]);

  attacks.push(['quiescence:task', () => reduceTask(makeTask('running'), request('task-1', 'running', 'cancelled', { quiescence: quiescence('task', 'task-2') }) as TaskTransitionRequest)]);
  attacks.push(['quiescence:workspace', () => reduceTask(makeTask('running'), request('task-1', 'running', 'cancelled', { quiescence: quiescence('task', 'task-1', { taskId: 'task-1', workspaceId: 'workspace-2' }) }) as TaskTransitionRequest)]);
  attacks.push(['quiescence:attempt', () => reduceTask(makeTask('running'), request('task-1', 'running', 'cancelled', { quiescence: quiescence('task', 'task-1', SCOPE, 'known_complete', retained('transaction-1', 'attempt-2')) }) as TaskTransitionRequest)]);
  attacks.push(['quiescence:transaction', () => reduceTask(makeTask('running'), request('task-1', 'running', 'cancelled', { quiescence: quiescence('task', 'task-1', SCOPE, 'known_complete', retained('transaction-other', 'attempt-1')) }) as TaskTransitionRequest)]);

  attacks.push(['acceptance:task', () => reduceExecutionTransaction(makeTransaction('verifying'), request('transaction-1', 'verifying', 'committed', { transactionEvidence: { ...evidence(), taskId: 'task-2' } }) as ExecutionTransactionTransitionRequest)]);
  attacks.push(['acceptance:workspace', () => reduceExecutionTransaction(makeTransaction('verifying'), request('transaction-1', 'verifying', 'committed', { transactionEvidence: { ...evidence(), workspaceId: 'workspace-2' } }) as ExecutionTransactionTransitionRequest)]);
  attacks.push(['acceptance:transaction', () => reduceExecutionTransaction(makeTransaction('verifying'), request('transaction-1', 'verifying', 'committed', { transactionEvidence: evidence('transaction-2') }) as ExecutionTransactionTransitionRequest)]);
  attacks.push(['acceptance:attempt', () => reduceExecutionTransaction(makeTransaction('verifying'), request('transaction-1', 'verifying', 'committed', { transactionEvidence: evidence('transaction-1', 'attempt-2') }) as ExecutionTransactionTransitionRequest)]);
  attacks.push(['acceptance:snapshot', () => reduceExecutionTransaction(makeTransaction('verifying'), request('transaction-1', 'verifying', 'committed', { transactionEvidence: { ...evidence(), resultSnapshot: retained('transaction-2', 'attempt-1', SCOPE, 'snapshot-foreign') } }) as ExecutionTransactionTransitionRequest)]);

  attacks.push(['rollback:task', () => reduceExecutionTransaction(makeTransaction('rolling_back'), request('transaction-1', 'rolling_back', 'rolled_back', { rollbackResult: rollback('transaction-1', { taskId: 'task-2', workspaceId: 'workspace-1' }) }) as ExecutionTransactionTransitionRequest)]);
  attacks.push(['rollback:workspace', () => reduceExecutionTransaction(makeTransaction('rolling_back'), request('transaction-1', 'rolling_back', 'rolled_back', { rollbackResult: rollback('transaction-1', { taskId: 'task-1', workspaceId: 'workspace-2' }) }) as ExecutionTransactionTransitionRequest)]);
  attacks.push(['rollback:transaction', () => reduceExecutionTransaction(makeTransaction('rolling_back'), request('transaction-1', 'rolling_back', 'rolled_back', { rollbackResult: rollback('transaction-2') }) as ExecutionTransactionTransitionRequest)]);
  attacks.push(['rollback:snapshot', () => reduceExecutionTransaction(makeTransaction('rolling_back'), request('transaction-1', 'rolling_back', 'rolled_back', { rollbackResult: rollback('transaction-1', SCOPE, 'snapshot-other') }) as ExecutionTransactionTransitionRequest)]);

  attacks.push(['retained:task', () => reduceExecutionTransaction(makeTransaction('verifying'), request('transaction-1', 'verifying', 'rejected', { retainedResult: retained('transaction-1', 'attempt-1', OTHER_SCOPE), transactionEvidence: evidence(), recoveryDisposition: 'retain_for_review' }) as ExecutionTransactionTransitionRequest)]);
  attacks.push(['retained:workspace', () => reduceExecutionTransaction(makeTransaction('verifying'), request('transaction-1', 'verifying', 'rejected', { retainedResult: retained('transaction-1', 'attempt-1', { taskId: 'task-1', workspaceId: 'workspace-2' }), transactionEvidence: evidence(), recoveryDisposition: 'retain_for_review' }) as ExecutionTransactionTransitionRequest)]);
  attacks.push(['retained:transaction', () => reduceExecutionTransaction(makeTransaction('verifying'), request('transaction-1', 'verifying', 'rejected', { retainedResult: retained('transaction-2'), transactionEvidence: evidence(), recoveryDisposition: 'retain_for_review' }) as ExecutionTransactionTransitionRequest)]);
  attacks.push(['retained:attempt', () => reduceExecutionTransaction(makeTransaction('verifying'), request('transaction-1', 'verifying', 'rejected', { retainedResult: retained('transaction-1', 'attempt-2'), transactionEvidence: evidence(), recoveryDisposition: 'retain_for_review' }) as ExecutionTransactionTransitionRequest)]);
  attacks.push(['retained:snapshot', () => reduceExecutionTransaction(makeTransaction('verifying'), request('transaction-1', 'verifying', 'rejected', { retainedResult: retained('transaction-1', 'attempt-1', SCOPE, 'snapshot-foreign'), transactionEvidence: evidence(), recoveryDisposition: 'retain_for_review' }) as ExecutionTransactionTransitionRequest)]);

  let rejected = 0;
  for (const [label, attack] of attacks) {
    assert.throws(attack, TaskLifecycleError, label);
    rejected++;
  }
  assert.equal(attacks.length, 28);
  assert.equal(rejected, 28);
});

test('reduced aggregates, nested references and transition records resist caller alias mutation', () => {
  const source = makeTask('awaiting_authority');
  const resolution = authority(OPERATION_MUTATION, 0);
  const input = request('task-1', 'awaiting_authority', 'scheduled', { authorityResolution: resolution }, { kind: 'continuation', id: resolution.continuation.id });
  const output = reduceTask(source, input as TaskTransitionRequest);
  (resolution.continuation as { id: string }).id = 'changed';
  (input.causeRef as { id: string }).id = 'changed';
  (source as { state: TaskState }).state = 'failed';
  assert.equal(output.aggregate.state, 'scheduled');
  assert.equal(output.aggregate.data.authorityResolution?.continuation.id, 'operation-1-continuation');
  assert.equal(output.transition.causeRef.id, 'operation-1-continuation');
  assert.equal(Object.isFrozen(output.aggregate), true);
  assert.equal(Object.isFrozen(output.aggregate.data.authorityResolution), true);
  assert.throws(() => { (output.aggregate as { state: string }).state = 'failed'; }, TypeError);
  assert.throws(() => { (output.aggregate.data.authorityResolution as { id: string }).id = 'changed'; }, TypeError);
});

test('projection helpers are deterministic consequences of lifecycle state', () => {
  assert.equal(requiresOperatorDecision('awaiting_authority'), true);
  assert.equal(requiresOperatorDecision('running'), false);
  assert.equal(requiresReconciliation('interrupted'), true);
  assert.equal(requiresReconciliation('rolling_back'), true);
  assert.equal(requiresReconciliation('running'), false);
  assert.equal(mayAccept('verifying'), true);
  assert.equal(mayAccept('running'), false);
});

test('lifecycle module bundles and executes with browser globals only', async () => {
  let code = '';
  await build({
    configFile: false,
    envFile: false,
    publicDir: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: { entry: fileURLToPath(new URL('../../common/execution/task-lifecycle.ts', import.meta.url)), name: 'CovertLifecycle', formats: ['iife'] }
    },
    plugins: [{
      name: 'lifecycle-browser-assertion',
      generateBundle(_options, bundle) {
        for (const id of this.getModuleIds()) assert.doesNotMatch(id, /node:|browser-external|execution-authority/);
        for (const chunk of Object.values(bundle)) if (chunk.type === 'chunk') code += chunk.code;
      }
    }]
  });
  assert.ok(code.length > 0);
  const result = runInNewContext(code + '\nCovertLifecycle.isTaskTerminal("accepted");', {}) as unknown;
  assert.equal(result, true);
});

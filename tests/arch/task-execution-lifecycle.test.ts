import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { build } from 'vite';
import {
  EXECUTION_TRANSACTION_STATES,
  TASK_STATES,
  WORKER_ATTEMPT_STATES,
  type CauseRef,
  type ExecutionTransactionAggregate,
  type ExecutionTransactionState,
  type ExecutionTransactionTransitionRequest,
  type LifecycleData,
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
  createExecutionTransactionAggregate,
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

const cause = { kind: 'operator' as const, id: 'cause-1' };
const refs = {
  validationPlanRef: 'plan-1', veritasVerdictRef: 'veritas-1',
  resultSnapshotRef: 'snapshot-1', evidenceManifestRef: 'evidence-1'
};

function taskData(state: TaskState): LifecycleData {
  if (state === 'accepted') return { acceptanceEvidence: refs, resultSnapshotRef: refs.resultSnapshotRef };
  if (state === 'resumable') return { reconciliation: { ref: 'reconciliation-1', outcome: 'reconciled' } };
  if (state === 'rolled_back') return { rollbackResult: { ref: 'rollback-1', outcome: 'restored', effectCertainty: 'known_complete' } };
  if (state === 'cancelled') return { quiescenceRef: 'quiescence-1', effectCertainty: 'known_complete' };
  return {};
}

function workerData(state: WorkerAttemptState): LifecycleData {
  if (state === 'output_ready') return { outputRef: 'output-1' };
  if (state === 'interrupted') return { reconciliation: { ref: 'reconciliation-1', outcome: 'unresolved' } };
  if (state === 'cancelled') return { quiescenceRef: 'quiescence-1', effectCertainty: 'known_complete' };
  return {};
}

function transactionData(state: ExecutionTransactionState, mutation: 'read_only' | 'mutation'): LifecycleData {
  if (state === 'authorized') return { authorityDecisionRef: 'authority-decision-1' };
  if (state === 'checkpointed') return { authorityDecisionRef: 'authority-decision-1', checkpoint: { kind: 'required', ref: 'checkpoint-1' } };
  if (state === 'executing') return mutation === 'mutation'
    ? { authorityDecisionRef: 'authority-decision-1', checkpoint: { kind: 'required', ref: 'checkpoint-1' } }
    : { authorityDecisionRef: 'authority-decision-1', checkpoint: { kind: 'not_applicable', ref: null } };
  if (state === 'committed') return { transactionEvidence: refs, resultSnapshotRef: refs.resultSnapshotRef };
  if (state === 'rolled_back') return { rollbackResult: { ref: 'rollback-1', outcome: 'restored', effectCertainty: 'known_complete' } };
  if (state === 'failed') return { effectCertainty: 'none', failureRef: 'failure-1' };
  return {};
}

function makeTask(state: TaskState, revision = 0): TaskAggregate {
  return { schemaVersion: '1', aggregateType: 'task', aggregateId: 'task-1', taskId: 'task-1', parentTaskId: null,
    attemptId: null, revision, state, correlationId: 'correlation-1', causationId: null, data: taskData(state) };
}

function makeWorker(state: WorkerAttemptState, revision = 0): WorkerAttemptAggregate {
  return { schemaVersion: '1', aggregateType: 'worker_attempt', aggregateId: 'attempt-1', attemptId: 'attempt-1', taskId: 'task-1',
    parentAttemptId: null, revision, state, correlationId: 'correlation-1', causationId: null, data: workerData(state) };
}

function makeTransaction(state: ExecutionTransactionState, mutation: 'read_only' | 'mutation' = 'mutation', revision = 0): ExecutionTransactionAggregate {
  return { schemaVersion: '1', aggregateType: 'execution_transaction', aggregateId: 'transaction-1', transactionId: 'transaction-1',
    taskId: 'task-1', attemptId: 'attempt-1', workspaceId: 'workspace-1', mutation, revision, state,
    correlationId: 'correlation-1', causationId: null, data: transactionData(state, mutation) };
}

function payload(type: 'task' | 'worker' | 'transaction', current: string, next: string, mutation: 'read_only' | 'mutation' = 'mutation'): LifecycleData {
  if (type === 'task') {
    if (current === 'awaiting_authority' && next === 'scheduled') return { continuationRef: 'continuation-1' };
    if (current === 'interrupted' && next === 'resumable') return { reconciliation: { ref: 'reconciliation-1', outcome: 'reconciled' } };
    if (current === 'resumable' && next === 'contextualizing') return {};
    if (next === 'accepted') return { acceptanceEvidence: refs, resultSnapshotRef: refs.resultSnapshotRef };
    if (next === 'cancelled') return { quiescenceRef: 'quiescence-1', effectCertainty: 'known_complete' };
    if (next === 'rolled_back') return { rollbackResult: { ref: 'rollback-1', outcome: 'restored', effectCertainty: 'known_complete' } };
    return {};
  }
  if (type === 'worker') {
    if (next === 'output_ready') return { outputRef: 'output-1' };
    if (next === 'interrupted') return { reconciliation: { ref: 'reconciliation-1', outcome: 'unresolved' } };
    if (next === 'cancelled') return { quiescenceRef: 'quiescence-1', effectCertainty: 'known_complete' };
    return {};
  }
  if (next === 'authorized') return { authorityDecisionRef: 'authority-decision-1' };
  if (next === 'checkpointed') return { checkpoint: { kind: 'required', ref: 'checkpoint-1' } };
  if (next === 'executing') return mutation === 'mutation'
    ? { checkpoint: { kind: 'required', ref: 'checkpoint-1' } }
    : { checkpoint: { kind: 'not_applicable', ref: null } };
  if (next === 'committed') return { transactionEvidence: refs, resultSnapshotRef: refs.resultSnapshotRef };
  if (next === 'rolled_back') return { rollbackResult: { ref: 'rollback-1', outcome: 'restored', effectCertainty: 'known_complete' } };
  if (next === 'failed') return current === 'rolling_back'
    ? { rollbackResult: { ref: 'rollback-1', outcome: 'partial', effectCertainty: 'known_partial' }, effectCertainty: 'known_partial' }
    : { effectCertainty: 'none', failureRef: 'failure-1' };
  return {};
}

function request<S extends string>(aggregateId: string, currentState: S, nextState: S, data: LifecycleData = {}, causeRef: CauseRef = cause): { aggregateId: string; expectedRevision: number; currentState: S; nextState: S; reason: string; causeRef: CauseRef; correlationId: string; causationId: string | null; timestamp: string; data: LifecycleData } {
  return { aggregateId, expectedRevision: 0, currentState, nextState, reason: 'test transition', causeRef,
    correlationId: 'correlation-1', causationId: 'cause-event-1', timestamp: '2026-09-12T01:02:03.000Z', data };
}

test('task transition table is exhaustive and terminal states are immutable', () => {
  for (const current of TASK_STATES) for (const next of TASK_STATES) {
    const aggregate = makeTask(current); const input = request(aggregate.aggregateId, current, next, payload('task', current, next),
      current === 'awaiting_authority' && next === 'scheduled' ? { kind: 'continuation', id: 'continuation-cause' } :
        current === 'resumable' && next === 'contextualizing' ? { kind: 'reconsideration', id: 'reconsideration-cause' } : cause);
    const legal = TASK_TRANSITIONS[current].includes(next);
    if (legal) assert.doesNotThrow(() => reduceTask(aggregate, input as TaskTransitionRequest), `${current} -> ${next}`);
    else assert.throws(() => reduceTask(aggregate, input as TaskTransitionRequest), { code: 'ILLEGAL_TRANSITION' }, `${current} -> ${next}`);
  }
  for (const state of ['accepted', 'rejected', 'failed', 'cancelled', 'rolled_back'] as const) assert.equal(isTaskTerminal(state), true);
  assert.equal(isTaskActive('running'), true); assert.equal(isTaskActive('accepted'), false);
});

test('worker-attempt transition table is exhaustive and output is not acceptance', () => {
  for (const current of WORKER_ATTEMPT_STATES) for (const next of WORKER_ATTEMPT_STATES) {
    const aggregate = makeWorker(current); const input = request(aggregate.aggregateId, current, next, payload('worker', current, next));
    const legal = WORKER_ATTEMPT_TRANSITIONS[current].includes(next);
    if (legal) assert.doesNotThrow(() => reduceWorkerAttempt(aggregate, input as WorkerAttemptTransitionRequest), `${current} -> ${next}`);
    else assert.throws(() => reduceWorkerAttempt(aggregate, input as WorkerAttemptTransitionRequest), { code: 'ILLEGAL_TRANSITION' }, `${current} -> ${next}`);
  }
  const output = reduceWorkerAttempt(makeWorker('running'), request('attempt-1', 'running', 'output_ready', { outputRef: 'output-1' }) as WorkerAttemptTransitionRequest).aggregate;
  assert.equal(output.state, 'output_ready'); assert.equal(output.data.outputRef, 'output-1');
  assert.equal(isWorkerAttemptTerminal('output_ready'), true); assert.equal(isWorkerAttemptActive('running'), true);
});

test('execution-transaction transition table is exhaustive for mutation transactions', () => {
  for (const current of EXECUTION_TRANSACTION_STATES) for (const next of EXECUTION_TRANSACTION_STATES) {
    const aggregate = makeTransaction(current); const input = request(aggregate.aggregateId, current, next, payload('transaction', current, next));
    const legal = EXECUTION_TRANSACTION_TRANSITIONS[current].includes(next) && !(current === 'authorized' && next === 'executing');
    if (legal) assert.doesNotThrow(() => reduceExecutionTransaction(aggregate, input as ExecutionTransactionTransitionRequest), `${current} -> ${next}`);
    else assert.throws(() => reduceExecutionTransaction(aggregate, input as ExecutionTransactionTransitionRequest), error => error instanceof Error && ['ILLEGAL_TRANSITION', 'CHECKPOINT_REQUIRED'].includes((error as { code?: string }).code ?? ''), `${current} -> ${next}`);
  }
  assert.equal(isExecutionTransactionTerminal('committed'), true); assert.equal(isExecutionTransactionActive('executing'), true);
});

test('read-only transactions may skip a checkpoint only explicitly', () => {
  const source = makeTransaction('authorized', 'read_only');
  const result = reduceExecutionTransaction(source, request('transaction-1', 'authorized', 'executing', { checkpoint: { kind: 'not_applicable', ref: null } }) as ExecutionTransactionTransitionRequest);
  assert.equal(result.aggregate.state, 'executing');
  assert.throws(() => reduceExecutionTransaction(source, request('transaction-1', 'authorized', 'executing') as ExecutionTransactionTransitionRequest), { code: 'READ_ONLY_CHECKPOINT_REQUIRED' });
});

test('acceptance requires verification evidence and cannot be inferred from execution', () => {
  assert.throws(() => reduceTask(makeTask('running'), request('task-1', 'running', 'accepted') as TaskTransitionRequest), { code: 'ILLEGAL_TRANSITION' });
  const noEvidence = makeTask('verifying');
  assert.throws(() => reduceTask(noEvidence, request('task-1', 'verifying', 'accepted') as TaskTransitionRequest), { code: 'ACCEPTANCE_EVIDENCE_REQUIRED' });
  assert.throws(() => reduceTask(makeTask('verifying'), request('task-1', 'verifying', 'accepted', { verified: true } as unknown as LifecycleData) as TaskTransitionRequest), { code: 'UNKNOWN_DATA_FIELD' });
  assert.throws(() => reduceTask(makeTask('verifying'), request('task-1', 'verifying', 'accepted', { acceptanceEvidence: { ...refs, resultSnapshotRef: 'different' }, resultSnapshotRef: refs.resultSnapshotRef }) as TaskTransitionRequest), { code: 'EVIDENCE_SNAPSHOT_MISMATCH' });
  const committed = reduceExecutionTransaction(makeTransaction('verifying'), request('transaction-1', 'verifying', 'committed', { transactionEvidence: refs, resultSnapshotRef: refs.resultSnapshotRef }) as ExecutionTransactionTransitionRequest);
  assert.equal(committed.aggregate.state, 'committed');
});

test('awaiting authority and recovery transitions require explicit records', () => {
  assert.throws(() => reduceTask(makeTask('awaiting_authority'), request('task-1', 'awaiting_authority', 'scheduled') as TaskTransitionRequest), { code: 'RECORDED_CONTINUATION_REQUIRED' });
  const continued = reduceTask(makeTask('awaiting_authority'), request('task-1', 'awaiting_authority', 'scheduled', { continuationRef: 'continuation-1' }, { kind: 'continuation', id: 'continuation-cause' }) as TaskTransitionRequest);
  assert.equal(continued.aggregate.state, 'scheduled');
  assert.throws(() => reduceTask(makeTask('interrupted'), request('task-1', 'interrupted', 'resumable') as TaskTransitionRequest), { code: 'RECONCILIATION_REQUIRED' });
  const resumed = reduceTask(makeTask('interrupted'), request('task-1', 'interrupted', 'resumable', { reconciliation: { ref: 'r', outcome: 'reconciled' } }) as TaskTransitionRequest);
  assert.equal(resumed.aggregate.state, 'resumable');
  assert.throws(() => reduceTask(makeTask('resumable'), request('task-1', 'resumable', 'contextualizing') as TaskTransitionRequest), { code: 'FRESH_RECONSIDERATION_REQUIRED' });
  assert.throws(() => reduceExecutionTransaction(makeTransaction('rolling_back'), request('transaction-1', 'rolling_back', 'rolled_back') as ExecutionTransactionTransitionRequest), { code: 'ROLLBACK_RESULT_REQUIRED' });
  assert.throws(() => reduceExecutionTransaction(makeTransaction('rolling_back'), request('transaction-1', 'rolling_back', 'failed', { effectCertainty: 'unknown' }) as ExecutionTransactionTransitionRequest), { code: 'ROLLBACK_FAILURE_OUTCOME_REQUIRED' });
  const rollback = reduceExecutionTransaction(makeTransaction('rolling_back'), request('transaction-1', 'rolling_back', 'failed', { rollbackResult: { ref: 'r', outcome: 'partial', effectCertainty: 'known_partial' }, effectCertainty: 'known_partial' }) as ExecutionTransactionTransitionRequest);
  assert.equal(rollback.aggregate.state, 'failed'); assert.equal(rollback.aggregate.data.effectCertainty, 'known_partial');
});

test('revision checks reject stale, skipped and replayed transitions', () => {
  const source = makeTask('created'); const firstRequest = request('task-1', 'created', 'contextualizing');
  const first = reduceTask(source, firstRequest as TaskTransitionRequest);
  assert.equal(first.aggregate.revision, 1);
  assert.throws(() => reduceTask(first.aggregate, firstRequest as TaskTransitionRequest), { code: 'STALE_REVISION' });
  assert.throws(() => reduceTask({ ...source, revision: 2 }, request('task-1', 'created', 'contextualizing') as TaskTransitionRequest), { code: 'STALE_REVISION' });
  assert.throws(() => reduceTask({ ...source, revision: 0 }, { ...firstRequest, currentState: 'planning' } as TaskTransitionRequest), { code: 'STATE_MISMATCH' });
});

test('transition records are deterministic and timestamps are caller supplied', () => {
  const source = makeTask('created'); const input = request('task-1', 'created', 'contextualizing');
  const a = reduceTask(source, input as TaskTransitionRequest); const b = reduceTask(source, input as TaskTransitionRequest);
  assert.deepEqual(a, b); assert.equal(a.transition.timestamp, input.timestamp); assert.equal(a.transition.nextRevision, 1);
  assert.throws(() => reduceTask(source, { ...input, timestamp: 'not-a-time' } as TaskTransitionRequest), { code: 'INVALID_TIMESTAMP' });
});

test('unknown authority-shaped fields are rejected at every lifecycle boundary', () => {
  const fields = ['approved', 'permission', 'capability', 'executionHandle', 'actorToken', 'authority', 'approvalToken', 'credential'];
  for (const field of fields) {
    assert.throws(() => createTaskAggregate({ ...makeTask('created'), [field]: true } as never), { code: 'UNKNOWN_AGGREGATE_FIELD' }, field);
    assert.throws(() => reduceTask(makeTask('created'), { ...request('task-1', 'created', 'contextualizing'), [field]: true } as never), { code: 'UNKNOWN_TRANSITION_FIELD' }, field);
    assert.throws(() => reduceTask(makeTask('created'), request('task-1', 'created', 'contextualizing', { [field]: true }) as TaskTransitionRequest), { code: 'UNKNOWN_DATA_FIELD' }, field);
    assert.throws(() => reduceTask(makeTask('created'), request('task-1', 'created', 'contextualizing', {}, { kind: 'operator', id: 'cause', [field]: true } as never) as TaskTransitionRequest), { code: 'UNKNOWN_CAUSE_FIELD' }, field);
  }
  assert.throws(() => reduceExecutionTransaction(makeTransaction('proposed'), request('transaction-1', 'proposed', 'authorized', { authorityDecisionRef: 'decision', approved: true } as unknown as LifecycleData) as ExecutionTransactionTransitionRequest), { code: 'UNKNOWN_DATA_FIELD' });
  const hidden: Record<string, unknown> = {};
  Object.defineProperty(hidden, 'approved', { enumerable: false, value: true });
  assert.throws(() => reduceTask(makeTask('created'), request('task-1', 'created', 'contextualizing', hidden) as TaskTransitionRequest), { code: 'UNKNOWN_DATA_FIELD' });
  const symbolField = { [Symbol('authority')]: true };
  assert.throws(() => reduceTask(makeTask('created'), request('task-1', 'created', 'contextualizing', symbolField as unknown as LifecycleData) as TaskTransitionRequest), { code: 'UNKNOWN_DATA_FIELD' });
});

test('authority decision references remain descriptive and cannot be used as credentials', () => {
  const authorized = reduceExecutionTransaction(makeTransaction('proposed'), request('transaction-1', 'proposed', 'authorized', { authorityDecisionRef: 'decision-1' }) as ExecutionTransactionTransitionRequest);
  assert.equal(authorized.aggregate.data.authorityDecisionRef, 'decision-1');
  assert.equal('executionHandle' in authorized.aggregate.data, false);
  assert.throws(() => createExecutionTransactionAggregate({ ...makeTransaction('authorized'), data: { authorityDecisionRef: 'decision-1', capability: 'grant' } } as never), { code: 'UNKNOWN_DATA_FIELD' });
});

test('cancellation cannot claim clean quiescence when effects are unknown', () => {
  assert.throws(() => reduceTask(makeTask('running'), request('task-1', 'running', 'cancelled', { quiescenceRef: 'q', effectCertainty: 'unknown' }) as TaskTransitionRequest), { code: 'CLEAN_QUIESCENCE_REQUIRED' });
  assert.throws(() => reduceWorkerAttempt(makeWorker('cancelling'), request('attempt-1', 'cancelling', 'cancelled', { quiescenceRef: 'q', effectCertainty: 'unknown' }) as WorkerAttemptTransitionRequest), { code: 'CLEAN_QUIESCENCE_REQUIRED' });
  const cancelled = reduceTask(makeTask('running'), request('task-1', 'running', 'cancelled', { quiescenceRef: 'q', effectCertainty: 'known_partial' }) as TaskTransitionRequest);
  assert.equal(cancelled.aggregate.state, 'cancelled'); assert.equal(cancelled.aggregate.data.effectCertainty, 'known_partial');
});

test('caller aliases cannot mutate reduced aggregates or transition records', () => {
  const mutable = makeTask('created'); const input = request('task-1', 'created', 'contextualizing');
  const output = reduceTask(mutable, input as TaskTransitionRequest);
  (mutable as unknown as { state: TaskState }).state = 'failed';
  (input as unknown as { reason: string }).reason = 'changed';
  (input.causeRef as unknown as { id: string }).id = 'changed';
  assert.equal(output.aggregate.state, 'contextualizing'); assert.equal(output.transition.reason, 'test transition');
  assert.equal(output.transition.causeRef.id, 'cause-1');
  assert.throws(() => { (output.aggregate as { state: string }).state = 'failed'; }, TypeError);
  assert.throws(() => { (output.transition as { reason: string }).reason = 'changed'; }, TypeError);
});

test('projection helpers are deterministic consequences of state only', () => {
  assert.equal(requiresOperatorDecision('awaiting_authority'), true); assert.equal(requiresOperatorDecision('running'), false);
  assert.equal(requiresReconciliation('interrupted'), true); assert.equal(requiresReconciliation('rolling_back'), true); assert.equal(requiresReconciliation('running'), false);
  assert.equal(mayAccept('verifying'), true); assert.equal(mayAccept('running'), false);
});

test('lifecycle module bundles and executes with browser globals only', async () => {
  let code = '';
  await build({ configFile: false, envFile: false, publicDir: false, logLevel: 'silent', build: { write: false, minify: false, lib: {
    entry: fileURLToPath(new URL('../../common/execution/task-lifecycle.ts', import.meta.url)), name: 'CovertLifecycle', formats: ['iife']
  } }, plugins: [{ name: 'lifecycle-browser-assertion', generateBundle(_options, bundle) {
    for (const id of this.getModuleIds()) assert.doesNotMatch(id, /node:|browser-external|execution-authority/);
    for (const chunk of Object.values(bundle)) if (chunk.type === 'chunk') code += chunk.code;
  } }] });
  assert.ok(code.length > 0);
  const realm = { text: JSON.stringify(makeTask('created')) };
  const result = runInNewContext(code + '\nCovertLifecycle.isTaskTerminal("accepted");', realm) as unknown;
  assert.equal(result, true);
});

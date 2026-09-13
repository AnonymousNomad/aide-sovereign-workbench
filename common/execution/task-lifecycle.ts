import {
  AGGREGATE_TYPES,
  EFFECT_CERTAINTIES,
  EXECUTION_TRANSACTION_STATES,
  LIFECYCLE_SCHEMA_VERSION,
  TASK_STATES,
  WORKER_ATTEMPT_STATES,
  type AcceptanceEvidenceRef,
  type CauseKind,
  type CauseRef,
  type CheckpointRef,
  type ExecutionTransactionAggregate,
  type ExecutionTransactionState,
  type ExecutionTransactionTransitionRequest,
  type LifecycleData,
  type LifecycleReduction,
  type ReconciliationRef,
  type RollbackResultRef,
  type TaskAggregate,
  type TaskState,
  type TaskTransitionRequest,
  type TransactionEvidenceRef,
  type TransitionRecord,
  type TransitionRequest,
  type WorkerAttemptAggregate,
  type WorkerAttemptState,
  type WorkerAttemptTransitionRequest
} from '../contracts/task-lifecycle.ts';

export class TaskLifecycleError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'TaskLifecycleError';
    this.code = code;
  }
}

const fail = (code: string): never => { throw new TaskLifecycleError(code); };

const TASK_TRANSITIONS: { readonly [K in TaskState]: readonly TaskState[] } = {
  created: ['contextualizing', 'cancelled', 'failed'],
  contextualizing: ['planning', 'awaiting_authority', 'interrupted', 'cancelled', 'failed'],
  planning: ['awaiting_authority', 'scheduled', 'waiting_dependency', 'rejected', 'interrupted', 'cancelled', 'failed'],
  awaiting_authority: ['scheduled', 'rejected', 'interrupted', 'cancelled', 'failed'],
  scheduled: ['running', 'contextualizing', 'awaiting_authority', 'waiting_dependency', 'interrupted', 'cancelled', 'failed'],
  waiting_dependency: ['contextualizing', 'scheduled', 'rejected', 'interrupted', 'cancelled', 'failed'],
  running: ['awaiting_authority', 'waiting_dependency', 'verifying', 'rolling_back', 'interrupted', 'cancelled', 'failed'],
  verifying: ['accepted', 'rejected', 'rolling_back', 'interrupted', 'failed'],
  interrupted: ['resumable', 'rolling_back', 'failed'],
  resumable: ['contextualizing', 'rolling_back', 'cancelled', 'failed'],
  rolling_back: ['rolled_back', 'interrupted', 'failed'],
  accepted: [], rejected: [], failed: [], cancelled: [], rolled_back: []
};

const WORKER_ATTEMPT_TRANSITIONS: { readonly [K in WorkerAttemptState]: readonly WorkerAttemptState[] } = {
  created: ['queued', 'cancelled', 'failed'],
  queued: ['preparing', 'cancelling', 'cancelled', 'failed'],
  preparing: ['running', 'blocked', 'cancelling', 'interrupted', 'failed'],
  running: ['waiting_tool', 'output_ready', 'blocked', 'cancelling', 'interrupted', 'failed'],
  waiting_tool: ['running', 'blocked', 'cancelling', 'interrupted', 'failed'],
  blocked: ['preparing', 'running', 'cancelling', 'cancelled', 'interrupted', 'failed'],
  cancelling: ['cancelled', 'interrupted', 'failed'],
  output_ready: [], failed: [], cancelled: [], interrupted: []
};

const EXECUTION_TRANSACTION_TRANSITIONS: { readonly [K in ExecutionTransactionState]: readonly ExecutionTransactionState[] } = {
  proposed: ['authorized', 'rejected', 'failed'],
  authorized: ['checkpointed', 'executing', 'rejected', 'failed'],
  checkpointed: ['executing', 'rejected', 'failed'],
  executing: ['evidence_pending', 'rolling_back', 'failed'],
  evidence_pending: ['verifying', 'rolling_back', 'failed'],
  verifying: ['committed', 'rejected', 'rolling_back', 'failed'],
  committed: [], rejected: [], rolling_back: ['rolled_back', 'failed'], rolled_back: [], failed: []
};

export { TASK_TRANSITIONS, WORKER_ATTEMPT_TRANSITIONS, EXECUTION_TRANSACTION_TRANSITIONS };

const TASK_TERMINAL = new Set<TaskState>(['accepted', 'rejected', 'failed', 'cancelled', 'rolled_back']);
const WORKER_TERMINAL = new Set<WorkerAttemptState>(['output_ready', 'failed', 'cancelled', 'interrupted']);
const TRANSACTION_TERMINAL = new Set<ExecutionTransactionState>(['committed', 'rejected', 'rolled_back', 'failed']);
const CAUSE_KINDS: readonly CauseKind[] = ['operator', 'continuation', 'dependency', 'worker', 'authority', 'verification', 'recovery', 'reconsideration'];

type Plain = Record<string, unknown>;

function isPlain(value: unknown): value is Plain {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function record(value: unknown, allowed: readonly string[], label: string): Plain {
  if (!isPlain(value)) return fail('INVALID_' + label);
  const allow = new Set(allowed);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allow.has(key)) return fail('UNKNOWN_' + label + '_FIELD');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return fail('INVALID_' + label);
  }
  return value;
}

function text(value: unknown, code: string, max = 512): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max) return fail(code);
  return value;
}

function nullableText(value: unknown, code: string, max = 512): string | null {
  return value === null ? null : text(value, code, max);
}

function integer(value: unknown, code: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return fail(code);
  return value;
}

function oneOf<T extends string>(value: unknown, values: readonly T[], code: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) return fail(code);
  return value as T;
}

function timestamp(value: unknown): string {
  const output = text(value, 'INVALID_TIMESTAMP', 128);
  if (!Number.isFinite(Date.parse(output))) return fail('INVALID_TIMESTAMP');
  return output;
}

function cause(value: unknown): CauseRef {
  const input = record(value, ['kind', 'id'], 'CAUSE');
  return { kind: oneOf(input.kind, CAUSE_KINDS, 'INVALID_CAUSE_KIND'), id: text(input.id, 'INVALID_CAUSE_ID') };
}

function evidence(value: unknown, label: string): AcceptanceEvidenceRef | TransactionEvidenceRef {
  const input = record(value, ['validationPlanRef', 'veritasVerdictRef', 'resultSnapshotRef', 'evidenceManifestRef'], label);
  return {
    validationPlanRef: text(input.validationPlanRef, 'INVALID_' + label + '_REF'),
    veritasVerdictRef: text(input.veritasVerdictRef, 'INVALID_' + label + '_REF'),
    resultSnapshotRef: text(input.resultSnapshotRef, 'INVALID_' + label + '_REF'),
    evidenceManifestRef: text(input.evidenceManifestRef, 'INVALID_' + label + '_REF')
  };
}

function reconciliation(value: unknown): ReconciliationRef {
  const input = record(value, ['ref', 'outcome'], 'RECONCILIATION');
  return { ref: text(input.ref, 'INVALID_RECONCILIATION_REF'), outcome: oneOf(input.outcome, ['reconciled', 'unresolved'], 'INVALID_RECONCILIATION_OUTCOME') };
}

function rollback(value: unknown): RollbackResultRef {
  const input = record(value, ['ref', 'outcome', 'effectCertainty'], 'ROLLBACK');
  return {
    ref: text(input.ref, 'INVALID_ROLLBACK_REF'),
    outcome: oneOf(input.outcome, ['restored', 'partial', 'failed'], 'INVALID_ROLLBACK_OUTCOME'),
    effectCertainty: oneOf(input.effectCertainty, EFFECT_CERTAINTIES, 'INVALID_EFFECT_CERTAINTY')
  };
}

function checkpoint(value: unknown): CheckpointRef {
  const input = record(value, ['kind', 'ref'], 'CHECKPOINT');
  const kind = oneOf(input.kind, ['required', 'not_applicable'], 'INVALID_CHECKPOINT_KIND');
  const ref = nullableText(input.ref, 'INVALID_CHECKPOINT_REF');
  if (kind === 'required' && ref === null) return fail('CHECKPOINT_REFERENCE_REQUIRED');
  if (kind === 'not_applicable' && ref !== null) return fail('CHECKPOINT_REFERENCE_NOT_APPLICABLE');
  return { kind, ref };
}

function data(value: unknown): LifecycleData {
  if (value === undefined) return {};
  const input = record(value, [
    'continuationRef', 'proposedOperationRef', 'authorityRequestRef', 'authorityDecisionRef',
    'reconciliation', 'acceptanceEvidence', 'transactionEvidence', 'resultSnapshotRef',
    'outputRef', 'failureRef', 'rollbackResult', 'checkpoint', 'effectCertainty', 'quiescenceRef'
  ], 'DATA');
  const result: Record<string, unknown> = {};
  for (const key of ['continuationRef', 'proposedOperationRef', 'authorityRequestRef', 'authorityDecisionRef', 'resultSnapshotRef', 'outputRef', 'failureRef', 'quiescenceRef']) {
    if (Object.prototype.hasOwnProperty.call(input, key)) result[key] = text(input[key], 'INVALID_DATA_REFERENCE');
  }
  if (Object.prototype.hasOwnProperty.call(input, 'reconciliation')) result.reconciliation = reconciliation(input.reconciliation);
  if (Object.prototype.hasOwnProperty.call(input, 'acceptanceEvidence')) result.acceptanceEvidence = evidence(input.acceptanceEvidence, 'ACCEPTANCE_EVIDENCE');
  if (Object.prototype.hasOwnProperty.call(input, 'transactionEvidence')) result.transactionEvidence = evidence(input.transactionEvidence, 'TRANSACTION_EVIDENCE');
  if (Object.prototype.hasOwnProperty.call(input, 'rollbackResult')) result.rollbackResult = rollback(input.rollbackResult);
  if (Object.prototype.hasOwnProperty.call(input, 'checkpoint')) result.checkpoint = checkpoint(input.checkpoint);
  if (Object.prototype.hasOwnProperty.call(input, 'effectCertainty')) result.effectCertainty = oneOf(input.effectCertainty, EFFECT_CERTAINTIES, 'INVALID_EFFECT_CERTAINTY');
  return result as LifecycleData;
}

function immutable<T>(value: T): Readonly<T> {
  if (Array.isArray(value)) {
    const copy = value.map(item => immutable(item));
    return Object.freeze(copy) as unknown as Readonly<T>;
  }
  if (isPlain(value)) {
    const copy: Record<string, unknown> = {};
    for (const key of Object.keys(value)) copy[key] = immutable(value[key]);
    return Object.freeze(copy) as Readonly<T>;
  }
  return value as Readonly<T>;
}

function aggregateBase(value: unknown, expected: 'task' | 'worker_attempt' | 'execution_transaction'): Plain {
  const allowed = expected === 'task'
    ? ['schemaVersion', 'aggregateType', 'aggregateId', 'taskId', 'parentTaskId', 'attemptId', 'revision', 'state', 'correlationId', 'causationId', 'data']
    : expected === 'worker_attempt'
      ? ['schemaVersion', 'aggregateType', 'aggregateId', 'attemptId', 'taskId', 'parentAttemptId', 'revision', 'state', 'correlationId', 'causationId', 'data']
      : ['schemaVersion', 'aggregateType', 'aggregateId', 'transactionId', 'taskId', 'attemptId', 'workspaceId', 'mutation', 'revision', 'state', 'correlationId', 'causationId', 'data'];
  const input = record(value, allowed, 'AGGREGATE');
  if (input.schemaVersion !== LIFECYCLE_SCHEMA_VERSION || input.aggregateType !== expected) return fail('INVALID_AGGREGATE_HEADER');
  if (text(input.aggregateId, 'INVALID_AGGREGATE_ID') !== input.aggregateId) return fail('INVALID_AGGREGATE_ID');
  if (integer(input.revision, 'INVALID_REVISION') !== input.revision) return fail('INVALID_REVISION');
  text(input.correlationId, 'INVALID_CORRELATION_ID');
  nullableText(input.causationId, 'INVALID_CAUSATION_ID');
  if (!Object.prototype.hasOwnProperty.call(input, 'data')) return fail('MISSING_DATA');
  data(input.data);
  return input;
}

function validateTask(value: unknown): TaskAggregate {
  const input = aggregateBase(value, 'task');
  const state = oneOf(input.state, TASK_STATES, 'INVALID_TASK_STATE');
  if (text(input.taskId, 'INVALID_TASK_ID') !== input.aggregateId) return fail('TASK_ID_MISMATCH');
  nullableText(input.parentTaskId, 'INVALID_PARENT_TASK_ID');
  nullableText(input.attemptId, 'INVALID_ATTEMPT_ID');
  const output = { ...input, state, data: data(input.data) } as TaskAggregate;
  validateTaskStateData(output.state, output.data);
  return output;
}

function validateWorker(value: unknown): WorkerAttemptAggregate {
  const input = aggregateBase(value, 'worker_attempt');
  const state = oneOf(input.state, WORKER_ATTEMPT_STATES, 'INVALID_WORKER_STATE');
  if (text(input.attemptId, 'INVALID_ATTEMPT_ID') !== input.aggregateId) return fail('ATTEMPT_ID_MISMATCH');
  text(input.taskId, 'INVALID_TASK_ID');
  nullableText(input.parentAttemptId, 'INVALID_PARENT_ATTEMPT_ID');
  const output = { ...input, state, data: data(input.data) } as WorkerAttemptAggregate;
  validateWorkerStateData(output.state, output.data);
  return output;
}

function validateTransaction(value: unknown): ExecutionTransactionAggregate {
  const input = aggregateBase(value, 'execution_transaction');
  const state = oneOf(input.state, EXECUTION_TRANSACTION_STATES, 'INVALID_TRANSACTION_STATE');
  if (text(input.transactionId, 'INVALID_TRANSACTION_ID') !== input.aggregateId) return fail('TRANSACTION_ID_MISMATCH');
  text(input.taskId, 'INVALID_TASK_ID'); text(input.attemptId, 'INVALID_ATTEMPT_ID'); text(input.workspaceId, 'INVALID_WORKSPACE_ID');
  const mutation = oneOf(input.mutation, ['read_only', 'mutation'], 'INVALID_MUTATION_CLASS');
  const output = { ...input, state, mutation, data: data(input.data) } as ExecutionTransactionAggregate;
  validateTransactionStateData(output.state, output.mutation, output.data);
  return output;
}

function validateTaskStateData(state: TaskState, value: LifecycleData): void {
  if (state === 'accepted' && !value.acceptanceEvidence) return fail('ACCEPTANCE_EVIDENCE_REQUIRED');
  if (state === 'resumable' && value.reconciliation?.outcome !== 'reconciled') return fail('RECONCILIATION_REQUIRED');
  if (state === 'rolled_back' && value.rollbackResult?.outcome !== 'restored') return fail('ROLLBACK_RESULT_REQUIRED');
  if (state === 'cancelled' && (!value.quiescenceRef || value.effectCertainty === undefined || value.effectCertainty === 'unknown')) return fail('CLEAN_QUIESCENCE_REQUIRED');
}

function validateWorkerStateData(state: WorkerAttemptState, value: LifecycleData): void {
  if (state === 'output_ready' && !value.outputRef) return fail('OUTPUT_REFERENCE_REQUIRED');
  if (state === 'interrupted' && !value.reconciliation) return fail('RECONCILIATION_REQUIRED');
  if (state === 'cancelled' && (!value.quiescenceRef || value.effectCertainty === undefined || value.effectCertainty === 'unknown')) return fail('CLEAN_QUIESCENCE_REQUIRED');
}

function validateTransactionStateData(state: ExecutionTransactionState, mutation: 'read_only' | 'mutation', value: LifecycleData): void {
  if (state === 'authorized' && !value.authorityDecisionRef) return fail('AUTHORITY_DECISION_REFERENCE_REQUIRED');
  if (state === 'checkpointed' && (!value.checkpoint || value.checkpoint.kind !== 'required')) return fail('CHECKPOINT_REQUIRED');
  if (state === 'committed' && !value.transactionEvidence) return fail('TRANSACTION_EVIDENCE_REQUIRED');
  if (state === 'rolled_back' && (!value.rollbackResult || value.rollbackResult.outcome !== 'restored' || value.rollbackResult.effectCertainty === 'unknown')) return fail('ROLLBACK_RESULT_REQUIRED');
  if (state === 'failed' && value.effectCertainty === undefined) return fail('EFFECT_CERTAINTY_REQUIRED');
  if (state === 'executing' && mutation === 'mutation' && (!value.checkpoint || value.checkpoint.kind !== 'required')) return fail('CHECKPOINT_REQUIRED');
  if (state === 'executing' && mutation === 'read_only' && (!value.checkpoint || value.checkpoint.kind !== 'not_applicable')) return fail('READ_ONLY_CHECKPOINT_REQUIRED');
}

function validateRequest(value: unknown, states: readonly string[]): TransitionRequest<string> {
  const input = record(value, ['aggregateId', 'expectedRevision', 'currentState', 'nextState', 'reason', 'causeRef', 'correlationId', 'causationId', 'timestamp', 'data'], 'TRANSITION');
  const base: TransitionRequest<string> = {
    aggregateId: text(input.aggregateId, 'INVALID_AGGREGATE_ID'),
    expectedRevision: integer(input.expectedRevision, 'INVALID_EXPECTED_REVISION'),
    currentState: oneOf(input.currentState, states, 'INVALID_CURRENT_STATE'),
    nextState: oneOf(input.nextState, states, 'INVALID_NEXT_STATE'),
    reason: text(input.reason, 'INVALID_REASON', 2048),
    causeRef: cause(input.causeRef),
    correlationId: text(input.correlationId, 'INVALID_CORRELATION_ID'),
    causationId: nullableText(input.causationId, 'INVALID_CAUSATION_ID'),
    timestamp: timestamp(input.timestamp)
  };
  return Object.prototype.hasOwnProperty.call(input, 'data') ? { ...base, data: data(input.data) } : base;
}

function mergedData(current: LifecycleData, request: TransitionRequest<string>): LifecycleData {
  return data({ ...current, ...(request.data ?? {}) });
}

function commonChecks<A extends { aggregateId: string; revision: number; state: string; correlationId: string }, S extends string>(current: A, request: TransitionRequest<S>, allowed: Readonly<Record<S, readonly S[]>>): void {
  if (request.aggregateId !== current.aggregateId) return fail('AGGREGATE_ID_MISMATCH');
  if (request.expectedRevision !== current.revision) return fail('STALE_REVISION');
  if (request.currentState !== current.state) return fail('STATE_MISMATCH');
  if (request.correlationId !== current.correlationId) return fail('CORRELATION_MISMATCH');
  if (request.nextState === current.state || !allowed[request.currentState as S]?.includes(request.nextState)) return fail('ILLEGAL_TRANSITION');
}

function transitionRecord<S extends string>(aggregateType: 'task' | 'worker_attempt' | 'execution_transaction', current: { aggregateId: string; revision: number; state: S }, request: TransitionRequest<S>): TransitionRecord<S> {
  return {
    schemaVersion: LIFECYCLE_SCHEMA_VERSION, aggregateType, aggregateId: current.aggregateId,
    previousRevision: current.revision, nextRevision: current.revision + 1,
    previousState: current.state, nextState: request.nextState, reason: request.reason,
    causeRef: request.causeRef, correlationId: request.correlationId, causationId: request.causationId,
    timestamp: request.timestamp
  };
}

function taskGuards(current: TaskAggregate, request: TaskTransitionRequest, nextData: LifecycleData): void {
  if (current.state === 'awaiting_authority' && request.nextState === 'scheduled' &&
    (request.causeRef.kind !== 'continuation' || !nextData.continuationRef)) return fail('RECORDED_CONTINUATION_REQUIRED');
  if (current.state === 'interrupted' && request.nextState === 'resumable' && nextData.reconciliation?.outcome !== 'reconciled') return fail('RECONCILIATION_REQUIRED');
  if (current.state === 'resumable' && request.nextState === 'contextualizing' && request.causeRef.kind !== 'reconsideration') return fail('FRESH_RECONSIDERATION_REQUIRED');
  if (request.nextState === 'accepted') {
    if (current.state !== 'verifying') return fail('ACCEPTANCE_REQUIRES_VERIFICATION');
    if (!nextData.acceptanceEvidence) return fail('ACCEPTANCE_EVIDENCE_REQUIRED');
    if (nextData.resultSnapshotRef && nextData.resultSnapshotRef !== nextData.acceptanceEvidence.resultSnapshotRef) return fail('EVIDENCE_SNAPSHOT_MISMATCH');
  }
  if (request.nextState === 'cancelled' && (!nextData.quiescenceRef || nextData.effectCertainty === undefined || nextData.effectCertainty === 'unknown')) return fail('CLEAN_QUIESCENCE_REQUIRED');
  validateTaskStateData(request.nextState, nextData);
}

function workerGuards(request: WorkerAttemptTransitionRequest, nextData: LifecycleData): void {
  if (request.nextState === 'cancelled' && (!nextData.quiescenceRef || nextData.effectCertainty === undefined || nextData.effectCertainty === 'unknown')) return fail('CLEAN_QUIESCENCE_REQUIRED');
  if (request.nextState === 'interrupted' && !nextData.reconciliation) return fail('RECONCILIATION_REQUIRED');
  validateWorkerStateData(request.nextState, nextData);
}

function transactionGuards(current: ExecutionTransactionAggregate, request: ExecutionTransactionTransitionRequest, nextData: LifecycleData): void {
  if (request.nextState === 'checkpointed' && (!nextData.checkpoint || nextData.checkpoint.kind !== 'required')) return fail('CHECKPOINT_REQUIRED');
  if (request.nextState === 'executing') {
    if (current.mutation === 'mutation' && (!current.data.checkpoint || current.data.checkpoint.kind !== 'required')) return fail('CHECKPOINT_REQUIRED');
    if (current.mutation === 'read_only' && (!nextData.checkpoint || nextData.checkpoint.kind !== 'not_applicable')) return fail('READ_ONLY_CHECKPOINT_REQUIRED');
  }
  if (request.nextState === 'committed') {
    if (current.state !== 'verifying' || !nextData.transactionEvidence) return fail('COMMIT_REQUIRES_VERIFICATION');
    if (nextData.resultSnapshotRef && nextData.resultSnapshotRef !== nextData.transactionEvidence.resultSnapshotRef) return fail('EVIDENCE_SNAPSHOT_MISMATCH');
  }
  if (request.nextState === 'rolled_back' && (!nextData.rollbackResult || nextData.rollbackResult.outcome !== 'restored' || nextData.rollbackResult.effectCertainty === 'unknown')) return fail('ROLLBACK_RESULT_REQUIRED');
  if (request.nextState === 'failed' && nextData.effectCertainty === undefined) return fail('EFFECT_CERTAINTY_REQUIRED');
  if (current.state === 'rolling_back' && request.nextState === 'failed' && (!nextData.rollbackResult || nextData.rollbackResult.outcome === 'restored')) return fail('ROLLBACK_FAILURE_OUTCOME_REQUIRED');
  validateTransactionStateData(request.nextState, current.mutation, nextData);
}

export function createTaskAggregate(input: TaskAggregate): Readonly<TaskAggregate> {
  return immutable(validateTask(input));
}

export function createWorkerAttemptAggregate(input: WorkerAttemptAggregate): Readonly<WorkerAttemptAggregate> {
  return immutable(validateWorker(input));
}

export function createExecutionTransactionAggregate(input: ExecutionTransactionAggregate): Readonly<ExecutionTransactionAggregate> {
  return immutable(validateTransaction(input));
}

export function reduceTask(current: TaskAggregate, rawRequest: TaskTransitionRequest): LifecycleReduction<TaskAggregate, TaskState> {
  const source = validateTask(current);
  const request = validateRequest(rawRequest, TASK_STATES) as TaskTransitionRequest;
  commonChecks(source, request, TASK_TRANSITIONS);
  const nextData = mergedData(source.data, request);
  taskGuards(source, request, nextData);
  const aggregate = immutable({ ...source, revision: source.revision + 1, state: request.nextState, causationId: request.causationId, data: nextData }) as Readonly<TaskAggregate>;
  const transition = immutable(transitionRecord('task', source, request)) as Readonly<TransitionRecord<TaskState>>;
  return { aggregate, transition };
}

export function reduceWorkerAttempt(current: WorkerAttemptAggregate, rawRequest: WorkerAttemptTransitionRequest): LifecycleReduction<WorkerAttemptAggregate, WorkerAttemptState> {
  const source = validateWorker(current);
  const request = validateRequest(rawRequest, WORKER_ATTEMPT_STATES) as WorkerAttemptTransitionRequest;
  commonChecks(source, request, WORKER_ATTEMPT_TRANSITIONS);
  const nextData = mergedData(source.data, request);
  workerGuards(request, nextData);
  const aggregate = immutable({ ...source, revision: source.revision + 1, state: request.nextState, causationId: request.causationId, data: nextData }) as Readonly<WorkerAttemptAggregate>;
  const transition = immutable(transitionRecord('worker_attempt', source, request)) as Readonly<TransitionRecord<WorkerAttemptState>>;
  return { aggregate, transition };
}

export function reduceExecutionTransaction(current: ExecutionTransactionAggregate, rawRequest: ExecutionTransactionTransitionRequest): LifecycleReduction<ExecutionTransactionAggregate, ExecutionTransactionState> {
  const source = validateTransaction(current);
  const request = validateRequest(rawRequest, EXECUTION_TRANSACTION_STATES) as ExecutionTransactionTransitionRequest;
  commonChecks(source, request, EXECUTION_TRANSACTION_TRANSITIONS);
  const nextData = mergedData(source.data, request);
  if (request.nextState === 'authorized' && !nextData.authorityDecisionRef) return fail('AUTHORITY_DECISION_REFERENCE_REQUIRED');
  transactionGuards(source, request, nextData);
  const aggregate = immutable({ ...source, revision: source.revision + 1, state: request.nextState, causationId: request.causationId, data: nextData }) as Readonly<ExecutionTransactionAggregate>;
  const transition = immutable(transitionRecord('execution_transaction', source, request)) as Readonly<TransitionRecord<ExecutionTransactionState>>;
  return { aggregate, transition };
}

export function isTaskTerminal(state: TaskState): boolean { return TASK_TERMINAL.has(state); }
export function isWorkerAttemptTerminal(state: WorkerAttemptState): boolean { return WORKER_TERMINAL.has(state); }
export function isExecutionTransactionTerminal(state: ExecutionTransactionState): boolean { return TRANSACTION_TERMINAL.has(state); }
export function isTaskActive(state: TaskState): boolean { return !isTaskTerminal(state); }
export function isWorkerAttemptActive(state: WorkerAttemptState): boolean { return !isWorkerAttemptTerminal(state); }
export function isExecutionTransactionActive(state: ExecutionTransactionState): boolean { return !isExecutionTransactionTerminal(state); }
export function requiresOperatorDecision(state: TaskState): boolean { return state === 'awaiting_authority'; }
export function requiresReconciliation(state: TaskState | WorkerAttemptState | ExecutionTransactionState): boolean {
  return state === 'interrupted' || state === 'resumable' || state === 'rolling_back';
}
export function mayAccept(state: TaskState): boolean { return state === 'verifying'; }

void AGGREGATE_TYPES;

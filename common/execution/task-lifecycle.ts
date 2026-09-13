import {
  AGGREGATE_TYPES,
  EFFECT_CERTAINTIES,
  EXECUTION_TRANSACTION_STATES,
  LIFECYCLE_SCHEMA_VERSION,
  TASK_STATES,
  WORKER_ATTEMPT_STATES,
  type AcceptanceEvidenceRef,
  type AuthorityDecisionRef,
  type AuthorityResolutionRef,
  type CauseKind,
  type CauseRef,
  type CheckpointRef,
  type ContinuationRef,
  type ExecutionTransactionAggregate,
  type ExecutionTransactionState,
  type ExecutionTransactionTransitionRequest,
  type LifecycleData,
  type LifecycleReduction,
  type NotApplicableCheckpoint,
  type OperationDescriptor,
  type OperationEffectClass,
  type ReconciliationRef,
  type RetainedExecutionResultRef,
  type RollbackResultRef,
  type ScopedReference,
  type TaskAggregate,
  type TaskState,
  type TaskTransitionRequest,
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
const EFFECT_CLASS: readonly OperationEffectClass[] = ['read_only', 'mutation'];
const EFFECT_CERTAINTY = EFFECT_CERTAINTIES;

type Plain = Record<string, unknown>;

function isPlain(value: unknown): value is Plain {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function record(value: unknown, allowed: readonly string[], label: string): Plain {
  if (!isPlain(value)) return fail('INVALID_' + label);
  const allow = new Set(allowed);
  const copy = Object.create(null) as Plain;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allow.has(key)) return fail('UNKNOWN_' + label + '_FIELD');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return fail('INVALID_' + label);
    copy[key] = descriptor.value;
  }
  return copy;
}

function text(value: unknown, code: string, max = 512): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max || value.trim().length < 1) return fail(code);
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

function scoped(value: unknown, label: string, extra: readonly string[] = []): ScopedReference & Plain {
  const input = record(value, ['id', 'taskId', 'workspaceId', ...extra], label);
  return {
    id: text(input.id, 'INVALID_' + label + '_ID'),
    taskId: text(input.taskId, 'INVALID_' + label + '_TASK_ID'),
    workspaceId: text(input.workspaceId, 'INVALID_' + label + '_WORKSPACE_ID')
  } as ScopedReference & Plain;
}

function cause(value: unknown): CauseRef {
  const input = record(value, ['kind', 'id'], 'CAUSE');
  return { kind: oneOf(input.kind, CAUSE_KINDS, 'INVALID_CAUSE_KIND'), id: text(input.id, 'INVALID_CAUSE_ID') };
}

function operation(value: unknown, label = 'OPERATION'): OperationDescriptor {
  const input = record(value, ['id', 'taskId', 'workspaceId', 'revision', 'effectClass'], label);
  return {
    id: text(input.id, 'INVALID_' + label + '_ID'),
    taskId: text(input.taskId, 'INVALID_' + label + '_TASK_ID'),
    workspaceId: text(input.workspaceId, 'INVALID_' + label + '_WORKSPACE_ID'),
    revision: integer(input.revision, 'INVALID_' + label + '_REVISION'),
    effectClass: oneOf(input.effectClass, EFFECT_CLASS, 'INVALID_' + label + '_EFFECT_CLASS')
  };
}

function authorityDecision(value: unknown): AuthorityDecisionRef {
  const input = record(value, ['id', 'taskId', 'workspaceId', 'operationId', 'proposalRevision'], 'AUTHORITY_DECISION');
  return {
    id: text(input.id, 'INVALID_AUTHORITY_DECISION_ID'), taskId: text(input.taskId, 'INVALID_AUTHORITY_DECISION_TASK_ID'),
    workspaceId: text(input.workspaceId, 'INVALID_AUTHORITY_DECISION_WORKSPACE_ID'), operationId: text(input.operationId, 'INVALID_AUTHORITY_OPERATION_ID'),
    proposalRevision: integer(input.proposalRevision, 'INVALID_AUTHORITY_PROPOSAL_REVISION')
  };
}

function continuation(value: unknown): ContinuationRef {
  const input = record(value, ['id', 'taskId', 'workspaceId', 'operationId', 'authorityDecisionId', 'proposalRevision'], 'CONTINUATION');
  return {
    id: text(input.id, 'INVALID_CONTINUATION_ID'), taskId: text(input.taskId, 'INVALID_CONTINUATION_TASK_ID'),
    workspaceId: text(input.workspaceId, 'INVALID_CONTINUATION_WORKSPACE_ID'), operationId: text(input.operationId, 'INVALID_CONTINUATION_OPERATION_ID'),
    authorityDecisionId: text(input.authorityDecisionId, 'INVALID_CONTINUATION_DECISION_ID'), proposalRevision: integer(input.proposalRevision, 'INVALID_CONTINUATION_PROPOSAL_REVISION')
  };
}

function authorityResolution(value: unknown): AuthorityResolutionRef {
  const input = record(value, ['id', 'taskId', 'workspaceId', 'taskRevision', 'operation', 'decision', 'continuation'], 'AUTHORITY_RESOLUTION');
  const id = text(input.id, 'INVALID_AUTHORITY_RESOLUTION_ID');
  const taskId = text(input.taskId, 'INVALID_AUTHORITY_RESOLUTION_TASK_ID');
  const workspaceId = text(input.workspaceId, 'INVALID_AUTHORITY_RESOLUTION_WORKSPACE_ID');
  const taskRevision = Object.prototype.hasOwnProperty.call(input, 'taskRevision') ? integer(input.taskRevision, 'INVALID_AUTHORITY_TASK_REVISION') : undefined;
  const resolvedOperation = operation(input.operation, 'PROPOSED_OPERATION');
  const decision = authorityDecision(input.decision);
  const resolvedContinuation = continuation(input.continuation);
  if (resolvedOperation.taskId !== taskId || resolvedOperation.workspaceId !== workspaceId ||
    decision.taskId !== taskId || decision.workspaceId !== workspaceId ||
    resolvedContinuation.taskId !== taskId || resolvedContinuation.workspaceId !== workspaceId) return fail('AUTHORITY_SCOPE_MISMATCH');
  if (decision.operationId !== resolvedOperation.id || decision.proposalRevision !== resolvedOperation.revision ||
    resolvedContinuation.operationId !== resolvedOperation.id || resolvedContinuation.authorityDecisionId !== decision.id ||
    resolvedContinuation.proposalRevision !== resolvedOperation.revision) return fail('AUTHORITY_BINDING_MISMATCH');
  return taskRevision === undefined
    ? { id, taskId, workspaceId, operation: resolvedOperation, decision, continuation: resolvedContinuation }
    : { id, taskId, workspaceId, taskRevision, operation: resolvedOperation, decision, continuation: resolvedContinuation };
}

function reconciliation(value: unknown): ReconciliationRef {
  const input = record(value, ['id', 'taskId', 'workspaceId', 'aggregateType', 'aggregateId', 'outcome', 'effectCertainty'], 'RECONCILIATION');
  return {
    id: text(input.id, 'INVALID_RECONCILIATION_ID'), taskId: text(input.taskId, 'INVALID_RECONCILIATION_TASK_ID'),
    workspaceId: text(input.workspaceId, 'INVALID_RECONCILIATION_WORKSPACE_ID'), aggregateType: oneOf(input.aggregateType, AGGREGATE_TYPES, 'INVALID_RECONCILIATION_TYPE'),
    aggregateId: text(input.aggregateId, 'INVALID_RECONCILIATION_AGGREGATE_ID'), outcome: oneOf(input.outcome, ['reconciled', 'unresolved'], 'INVALID_RECONCILIATION_OUTCOME'),
    effectCertainty: oneOf(input.effectCertainty, EFFECT_CERTAINTY, 'INVALID_RECONCILIATION_EFFECT')
  };
}

function retainedResult(value: unknown): RetainedExecutionResultRef {
  const input = record(value, ['id', 'taskId', 'workspaceId', 'transactionId', 'attemptId', 'snapshotRef', 'effectCertainty'], 'RETAINED_RESULT');
  return {
    id: text(input.id, 'INVALID_RETAINED_RESULT_ID'), taskId: text(input.taskId, 'INVALID_RETAINED_RESULT_TASK_ID'),
    workspaceId: text(input.workspaceId, 'INVALID_RETAINED_RESULT_WORKSPACE_ID'), transactionId: text(input.transactionId, 'INVALID_RETAINED_RESULT_TRANSACTION_ID'),
    attemptId: text(input.attemptId, 'INVALID_RETAINED_RESULT_ATTEMPT_ID'), snapshotRef: text(input.snapshotRef, 'INVALID_RETAINED_RESULT_SNAPSHOT_ID'),
    effectCertainty: oneOf(input.effectCertainty, EFFECT_CERTAINTY, 'INVALID_RETAINED_RESULT_EFFECT')
  };
}

function checkpoint(value: unknown): CheckpointRef {
  const input = record(value, ['id', 'taskId', 'workspaceId', 'transactionId', 'snapshotRef'], 'CHECKPOINT');
  return {
    id: text(input.id, 'INVALID_CHECKPOINT_ID'), taskId: text(input.taskId, 'INVALID_CHECKPOINT_TASK_ID'),
    workspaceId: text(input.workspaceId, 'INVALID_CHECKPOINT_WORKSPACE_ID'), transactionId: text(input.transactionId, 'INVALID_CHECKPOINT_TRANSACTION_ID'),
    snapshotRef: text(input.snapshotRef, 'INVALID_CHECKPOINT_SNAPSHOT_ID')
  };
}

function notApplicableCheckpoint(value: unknown): NotApplicableCheckpoint {
  const input = record(value, ['kind'], 'CHECKPOINT');
  if (input.kind !== 'not_applicable') return fail('INVALID_CHECKPOINT_KIND');
  return { kind: 'not_applicable' };
}

function ownDataFieldEquals(value: unknown, field: string, expected: unknown): boolean {
  if (!isPlain(value)) return false;
  const descriptor = Object.getOwnPropertyDescriptor(value, field);
  return Boolean(descriptor && 'value' in descriptor && descriptor.enumerable && descriptor.value === expected);
}

function output(value: unknown): LifecycleData['output'] {
  const input = record(value, ['id', 'taskId', 'workspaceId', 'attemptId'], 'OUTPUT');
  return {
    id: text(input.id, 'INVALID_OUTPUT_ID'), taskId: text(input.taskId, 'INVALID_OUTPUT_TASK_ID'),
    workspaceId: text(input.workspaceId, 'INVALID_OUTPUT_WORKSPACE_ID'), attemptId: text(input.attemptId, 'INVALID_OUTPUT_ATTEMPT_ID')
  };
}

function rollback(value: unknown): RollbackResultRef {
  const input = record(value, ['id', 'taskId', 'workspaceId', 'transactionId', 'restoreSnapshotRef', 'outcome', 'effectCertainty', 'divergence'], 'ROLLBACK');
  return {
    id: text(input.id, 'INVALID_ROLLBACK_ID'), taskId: text(input.taskId, 'INVALID_ROLLBACK_TASK_ID'), workspaceId: text(input.workspaceId, 'INVALID_ROLLBACK_WORKSPACE_ID'),
    transactionId: text(input.transactionId, 'INVALID_ROLLBACK_TRANSACTION_ID'), restoreSnapshotRef: text(input.restoreSnapshotRef, 'INVALID_ROLLBACK_SNAPSHOT_ID'),
    outcome: oneOf(input.outcome, ['restored', 'partial', 'failed'], 'INVALID_ROLLBACK_OUTCOME'), effectCertainty: oneOf(input.effectCertainty, EFFECT_CERTAINTY, 'INVALID_ROLLBACK_EFFECT'),
    divergence: oneOf(input.divergence, ['none', 'resolved', 'present'], 'INVALID_ROLLBACK_DIVERGENCE')
  };
}

function quiescence(value: unknown): NonNullable<LifecycleData['quiescence']> {
  const input = record(value, ['id', 'taskId', 'workspaceId', 'aggregateType', 'aggregateId', 'attemptId', 'transactionId', 'admissionStopped', 'activeWork', 'effectCertainty', 'retainedResult'], 'QUIESCENCE');
  const effect = oneOf(input.effectCertainty, EFFECT_CERTAINTIES, 'INVALID_QUIESCENCE_EFFECT');
  const attemptId = nullableText(input.attemptId, 'INVALID_QUIESCENCE_ATTEMPT_ID');
  const transactionId = nullableText(input.transactionId, 'INVALID_QUIESCENCE_TRANSACTION_ID');
  if (effect === 'unknown') return fail('QUIESCENCE_EFFECT_UNKNOWN');
  const result = input.retainedResult === null ? null : retainedResult(input.retainedResult);
  if (effect !== 'none' && result === null) return fail('QUIESCENCE_RESULT_REQUIRED');
  if (transactionId !== null && attemptId === null) return fail('QUIESCENCE_SCOPE_MISMATCH');
  if (result !== null && (attemptId === null || transactionId === null || result.attemptId !== attemptId || result.transactionId !== transactionId)) return fail('QUIESCENCE_SCOPE_MISMATCH');
  if (result !== null && result.effectCertainty !== effect) return fail('QUIESCENCE_EFFECT_MISMATCH');
  if (input.admissionStopped !== true || input.activeWork !== 'none') return fail('QUIESCENCE_NOT_SAFE');
  return {
    id: text(input.id, 'INVALID_QUIESCENCE_ID'), taskId: text(input.taskId, 'INVALID_QUIESCENCE_TASK_ID'), workspaceId: text(input.workspaceId, 'INVALID_QUIESCENCE_WORKSPACE_ID'),
    aggregateType: oneOf(input.aggregateType, ['task', 'worker_attempt'], 'INVALID_QUIESCENCE_TYPE'), aggregateId: text(input.aggregateId, 'INVALID_QUIESCENCE_AGGREGATE_ID'),
    attemptId, transactionId, admissionStopped: true, activeWork: 'none', effectCertainty: effect, retainedResult: result
  };
}

function evidence(value: unknown, label: string): AcceptanceEvidenceRef {
  const input = record(value, ['id', 'taskId', 'workspaceId', 'transactionId', 'attemptId', 'validationPlan', 'veritasVerdict', 'resultSnapshot', 'evidenceManifest'], label);
  return {
    id: text(input.id, 'INVALID_' + label + '_ID'), taskId: text(input.taskId, 'INVALID_' + label + '_TASK_ID'), workspaceId: text(input.workspaceId, 'INVALID_' + label + '_WORKSPACE_ID'),
    transactionId: text(input.transactionId, 'INVALID_' + label + '_TRANSACTION_ID'), attemptId: text(input.attemptId, 'INVALID_' + label + '_ATTEMPT_ID'),
    validationPlan: scoped(input.validationPlan, label + '_PLAN'), veritasVerdict: scoped(input.veritasVerdict, label + '_VERDICT'),
    resultSnapshot: retainedResult(input.resultSnapshot), evidenceManifest: scoped(input.evidenceManifest, label + '_MANIFEST')
  };
}

function recoveryDisposition(value: unknown): NonNullable<LifecycleData['recoveryDisposition']> {
  return oneOf(value, ['retain_for_review', 'rollback_required', 'repair_attempt_allowed'], 'INVALID_RECOVERY_DISPOSITION');
}

function data(value: unknown): LifecycleData {
  if (value === undefined) return {};
  const input = record(value, ['authorityResolution', 'reconciliation', 'acceptanceEvidence', 'transactionEvidence', 'retainedResult', 'output', 'failureRef', 'rollbackResult', 'checkpoint', 'quiescence', 'effectCertainty', 'recoveryDisposition'], 'DATA');
  const result: Record<string, unknown> = {};
  if (Object.prototype.hasOwnProperty.call(input, 'authorityResolution')) result.authorityResolution = authorityResolution(input.authorityResolution);
  if (Object.prototype.hasOwnProperty.call(input, 'reconciliation')) result.reconciliation = reconciliation(input.reconciliation);
  if (Object.prototype.hasOwnProperty.call(input, 'acceptanceEvidence')) result.acceptanceEvidence = evidence(input.acceptanceEvidence, 'ACCEPTANCE_EVIDENCE');
  if (Object.prototype.hasOwnProperty.call(input, 'transactionEvidence')) result.transactionEvidence = evidence(input.transactionEvidence, 'TRANSACTION_EVIDENCE');
  if (Object.prototype.hasOwnProperty.call(input, 'retainedResult')) result.retainedResult = retainedResult(input.retainedResult);
  if (Object.prototype.hasOwnProperty.call(input, 'output')) result.output = output(input.output);
  if (Object.prototype.hasOwnProperty.call(input, 'failureRef')) result.failureRef = scoped(input.failureRef, 'FAILURE');
  if (Object.prototype.hasOwnProperty.call(input, 'rollbackResult')) result.rollbackResult = rollback(input.rollbackResult);
  if (Object.prototype.hasOwnProperty.call(input, 'checkpoint')) {
    result.checkpoint = ownDataFieldEquals(input.checkpoint, 'kind', 'not_applicable') ? notApplicableCheckpoint(input.checkpoint) : checkpoint(input.checkpoint);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'quiescence')) result.quiescence = quiescence(input.quiescence);
  if (Object.prototype.hasOwnProperty.call(input, 'effectCertainty')) result.effectCertainty = oneOf(input.effectCertainty, EFFECT_CERTAINTY, 'INVALID_EFFECT_CERTAINTY');
  if (Object.prototype.hasOwnProperty.call(input, 'recoveryDisposition')) result.recoveryDisposition = recoveryDisposition(input.recoveryDisposition);
  return result as LifecycleData;
}

function immutable<T>(value: T): Readonly<T> {
  if (Array.isArray(value)) return Object.freeze(value.map(item => immutable(item))) as unknown as Readonly<T>;
  if (isPlain(value)) {
    const copy: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key === 'string') copy[key] = immutable(value[key]);
    }
    return Object.freeze(copy) as unknown as Readonly<T>;
  }
  return value as Readonly<T>;
}

function scopeMatches(ref: ScopedReference, taskId: string, workspaceId: string): boolean {
  return ref.taskId === taskId && ref.workspaceId === workspaceId;
}

function activeTransactionIds(value: LifecycleData): readonly string[] {
  const ids: string[] = [];
  if (value.retainedResult) ids.push(value.retainedResult.transactionId);
  if (value.transactionEvidence) ids.push(value.transactionEvidence.transactionId);
  if (value.checkpoint && 'transactionId' in value.checkpoint) ids.push(value.checkpoint.transactionId);
  return ids;
}

function validateQuiescenceScope(
  value: NonNullable<LifecycleData['quiescence']>,
  aggregateType: 'task' | 'worker_attempt',
  aggregateId: string,
  taskId: string,
  workspaceId: string,
  attemptId: string | null,
  currentData: LifecycleData
): void {
  if (value.aggregateType !== aggregateType || value.aggregateId !== aggregateId || !scopeMatches(value, taskId, workspaceId) || value.attemptId !== attemptId) return fail('CLEAN_QUIESCENCE_REQUIRED');
  const activeIds = activeTransactionIds(currentData);
  if (activeIds.some(id => value.transactionId !== id)) return fail('CLEAN_QUIESCENCE_REQUIRED');
  if (value.retainedResult !== null && (value.retainedResult.taskId !== taskId || value.retainedResult.workspaceId !== workspaceId || value.retainedResult.attemptId !== attemptId || value.retainedResult.transactionId !== value.transactionId)) return fail('CLEAN_QUIESCENCE_REQUIRED');
}

function validateTask(value: unknown): TaskAggregate {
  const input = record(value, ['schemaVersion', 'aggregateType', 'aggregateId', 'taskId', 'workspaceId', 'parentTaskId', 'attemptId', 'revision', 'state', 'correlationId', 'causationId', 'data'], 'AGGREGATE');
  if (input.schemaVersion !== LIFECYCLE_SCHEMA_VERSION || input.aggregateType !== 'task') return fail('INVALID_AGGREGATE_HEADER');
  const aggregateId = text(input.aggregateId, 'INVALID_AGGREGATE_ID'); const taskId = text(input.taskId, 'INVALID_TASK_ID');
  if (aggregateId !== taskId) return fail('TASK_ID_MISMATCH');
  const output = {
    schemaVersion: LIFECYCLE_SCHEMA_VERSION, aggregateType: 'task' as const, aggregateId, taskId,
    workspaceId: text(input.workspaceId, 'INVALID_WORKSPACE_ID'), parentTaskId: nullableText(input.parentTaskId, 'INVALID_PARENT_TASK_ID'),
    attemptId: nullableText(input.attemptId, 'INVALID_ATTEMPT_ID'), revision: integer(input.revision, 'INVALID_REVISION'),
    state: oneOf(input.state, TASK_STATES, 'INVALID_TASK_STATE'), correlationId: text(input.correlationId, 'INVALID_CORRELATION_ID'),
    causationId: nullableText(input.causationId, 'INVALID_CAUSATION_ID'), data: data(input.data)
  };
  validateTaskStateData(output.state, output.data, output.taskId, output.workspaceId, output.attemptId);
  return output;
}

function validateWorker(value: unknown): WorkerAttemptAggregate {
  const input = record(value, ['schemaVersion', 'aggregateType', 'aggregateId', 'attemptId', 'taskId', 'workspaceId', 'parentAttemptId', 'revision', 'state', 'correlationId', 'causationId', 'data'], 'AGGREGATE');
  if (input.schemaVersion !== LIFECYCLE_SCHEMA_VERSION || input.aggregateType !== 'worker_attempt') return fail('INVALID_AGGREGATE_HEADER');
  const aggregateId = text(input.aggregateId, 'INVALID_AGGREGATE_ID'); const attemptId = text(input.attemptId, 'INVALID_ATTEMPT_ID');
  if (aggregateId !== attemptId) return fail('ATTEMPT_ID_MISMATCH');
  const output = {
    schemaVersion: LIFECYCLE_SCHEMA_VERSION, aggregateType: 'worker_attempt' as const, aggregateId, attemptId,
    taskId: text(input.taskId, 'INVALID_TASK_ID'), workspaceId: text(input.workspaceId, 'INVALID_WORKSPACE_ID'),
    parentAttemptId: nullableText(input.parentAttemptId, 'INVALID_PARENT_ATTEMPT_ID'), revision: integer(input.revision, 'INVALID_REVISION'),
    state: oneOf(input.state, WORKER_ATTEMPT_STATES, 'INVALID_WORKER_STATE'), correlationId: text(input.correlationId, 'INVALID_CORRELATION_ID'),
    causationId: nullableText(input.causationId, 'INVALID_CAUSATION_ID'), data: data(input.data)
  };
  validateWorkerStateData(output.state, output.taskId, output.workspaceId, output.attemptId, output.data);
  return output;
}

function validateTransaction(value: unknown): ExecutionTransactionAggregate {
  const input = record(value, ['schemaVersion', 'aggregateType', 'aggregateId', 'transactionId', 'taskId', 'attemptId', 'workspaceId', 'operation', 'preExecutionSnapshotRef', 'revision', 'state', 'correlationId', 'causationId', 'data'], 'AGGREGATE');
  if (input.schemaVersion !== LIFECYCLE_SCHEMA_VERSION || input.aggregateType !== 'execution_transaction') return fail('INVALID_AGGREGATE_HEADER');
  const aggregateId = text(input.aggregateId, 'INVALID_AGGREGATE_ID'); const transactionId = text(input.transactionId, 'INVALID_TRANSACTION_ID');
  if (aggregateId !== transactionId) return fail('TRANSACTION_ID_MISMATCH');
  const taskId = text(input.taskId, 'INVALID_TASK_ID'); const workspaceId = text(input.workspaceId, 'INVALID_WORKSPACE_ID');
  const resolvedOperation = operation(input.operation);
  if (!scopeMatches(resolvedOperation, taskId, workspaceId)) return fail('OPERATION_SCOPE_MISMATCH');
  const output = {
    schemaVersion: LIFECYCLE_SCHEMA_VERSION, aggregateType: 'execution_transaction' as const, aggregateId, transactionId,
    taskId, attemptId: text(input.attemptId, 'INVALID_ATTEMPT_ID'), workspaceId, operation: resolvedOperation,
    preExecutionSnapshotRef: text(input.preExecutionSnapshotRef, 'INVALID_PRE_EXECUTION_SNAPSHOT_ID'), revision: integer(input.revision, 'INVALID_REVISION'),
    state: oneOf(input.state, EXECUTION_TRANSACTION_STATES, 'INVALID_TRANSACTION_STATE'), correlationId: text(input.correlationId, 'INVALID_CORRELATION_ID'),
    causationId: nullableText(input.causationId, 'INVALID_CAUSATION_ID'), data: data(input.data)
  };
  validateTransactionStateData(output.state, output.operation.id, output.operation.effectClass, output.taskId, output.attemptId, output.transactionId, output.workspaceId, output.preExecutionSnapshotRef, output.data);
  return output;
}

function validateTaskStateData(state: TaskState, value: LifecycleData, taskId: string, workspaceId: string, attemptId: string | null): void {
  if (value.authorityResolution && (!scopeMatches(value.authorityResolution, taskId, workspaceId) || value.authorityResolution.operation.taskId !== taskId || value.authorityResolution.taskRevision === undefined)) return fail('AUTHORITY_SCOPE_MISMATCH');
  if (state === 'accepted') {
    const e = value.acceptanceEvidence;
    if (!e || attemptId === null || e.taskId !== taskId || e.workspaceId !== workspaceId || e.attemptId !== attemptId || e.resultSnapshot.effectCertainty === 'unknown') return fail('ACCEPTANCE_EVIDENCE_REQUIRED');
    validateEvidenceScope(e, taskId, workspaceId, e.transactionId, attemptId);
  }
  if (state === 'resumable' && (!value.reconciliation || value.reconciliation.aggregateType !== 'task' || value.reconciliation.aggregateId !== taskId || !scopeMatches(value.reconciliation, taskId, workspaceId) || value.reconciliation.outcome !== 'reconciled' || value.reconciliation.effectCertainty === 'unknown')) return fail('RECONCILIATION_REQUIRED');
  if (state === 'interrupted' && value.effectCertainty === undefined) return fail('INTERRUPTION_EFFECT_REQUIRED');
  if (state === 'rolled_back' && (!value.rollbackResult || value.rollbackResult.outcome !== 'restored' || value.rollbackResult.effectCertainty === 'unknown' || value.rollbackResult.divergence === 'present' || !scopeMatches(value.rollbackResult, taskId, workspaceId))) return fail('ROLLBACK_RESULT_REQUIRED');
  if (state === 'cancelled') {
    const q = value.quiescence;
    if (!q) return fail('CLEAN_QUIESCENCE_REQUIRED');
    validateQuiescenceScope(q, 'task', taskId, taskId, workspaceId, attemptId, value);
    if (value.effectCertainty !== undefined && value.effectCertainty !== q.effectCertainty) return fail('CLEAN_QUIESCENCE_REQUIRED');
  }
}

function validateWorkerStateData(state: WorkerAttemptState, taskId: string, workspaceId: string, attemptId: string, value: LifecycleData): void {
  if (value.output && (!scopeMatches(value.output, taskId, workspaceId) || value.output.attemptId !== attemptId)) return fail('OUTPUT_SCOPE_MISMATCH');
  if (state === 'output_ready' && (!value.output || value.output.attemptId !== attemptId)) return fail('OUTPUT_REFERENCE_REQUIRED');
  if (state === 'interrupted' && (value.effectCertainty === undefined || !value.reconciliation || value.reconciliation.aggregateType !== 'worker_attempt' || value.reconciliation.aggregateId !== attemptId || !scopeMatches(value.reconciliation, taskId, workspaceId) || value.reconciliation.effectCertainty !== value.effectCertainty || (value.reconciliation.outcome === 'reconciled' && value.effectCertainty === 'unknown'))) return fail('INTERRUPTION_EFFECT_REQUIRED');
  if (state === 'cancelled') {
    const q = value.quiescence;
    if (!q) return fail('CLEAN_QUIESCENCE_REQUIRED');
    validateQuiescenceScope(q, 'worker_attempt', attemptId, taskId, workspaceId, attemptId, value);
    if (value.effectCertainty !== undefined && value.effectCertainty !== q.effectCertainty) return fail('CLEAN_QUIESCENCE_REQUIRED');
  }
}

function validateTransactionStateData(state: ExecutionTransactionState, operationId: string, effectClass: OperationEffectClass, taskId: string, attemptId: string, transactionId: string, workspaceId: string, snapshotRef: string, value: LifecycleData): void {
  if (value.authorityResolution && (!scopeMatches(value.authorityResolution, taskId, workspaceId) || value.authorityResolution.operation.taskId !== taskId || value.authorityResolution.operation.workspaceId !== workspaceId || value.authorityResolution.operation.effectClass !== effectClass)) return fail('AUTHORITY_SCOPE_MISMATCH');
  if (['authorized', 'checkpointed', 'executing', 'evidence_pending', 'verifying', 'committed', 'rolling_back', 'rolled_back'].includes(state) && !value.authorityResolution) return fail('AUTHORITY_RESOLUTION_REQUIRED');
  if (value.authorityResolution && value.authorityResolution.operation.id !== operationId && state !== 'proposed') return fail('AUTHORITY_OPERATION_MISMATCH');
  if (value.checkpoint && 'transactionId' in value.checkpoint && (value.checkpoint.transactionId !== transactionId || !scopeMatches(value.checkpoint, taskId, workspaceId) || value.checkpoint.snapshotRef !== snapshotRef)) return fail('CHECKPOINT_SCOPE_MISMATCH');
  if (value.retainedResult && (value.retainedResult.transactionId !== transactionId || value.retainedResult.attemptId !== attemptId || !scopeMatches(value.retainedResult, taskId, workspaceId))) return fail('RESULT_SCOPE_MISMATCH');
  if (value.rollbackResult && (value.rollbackResult.transactionId !== transactionId || !scopeMatches(value.rollbackResult, taskId, workspaceId))) return fail('ROLLBACK_SCOPE_MISMATCH');
  if (value.transactionEvidence) {
    validateEvidenceScope(value.transactionEvidence, taskId, workspaceId, transactionId, attemptId);
    if (['committed', 'rejected'].includes(state) && value.transactionEvidence.resultSnapshot.effectCertainty === 'unknown') return fail('TRANSACTION_EVIDENCE_INCOMPLETE');
  }
  if (state === 'authorized' && !value.authorityResolution) return fail('AUTHORITY_RESOLUTION_REQUIRED');
  if (state === 'checkpointed' && (effectClass === 'mutation'
    ? (!value.checkpoint || !('transactionId' in value.checkpoint))
    : (!value.checkpoint || !('kind' in value.checkpoint)))) return fail(effectClass === 'mutation' ? 'CHECKPOINT_REQUIRED' : 'READ_ONLY_CHECKPOINT_REQUIRED');
  if (state === 'executing') {
    if (effectClass === 'mutation' && (!value.checkpoint || !('transactionId' in value.checkpoint))) return fail('CHECKPOINT_REQUIRED');
    if (effectClass === 'read_only' && (!value.checkpoint || !('kind' in value.checkpoint))) return fail('READ_ONLY_CHECKPOINT_REQUIRED');
  }
  if (state === 'committed' && !value.transactionEvidence) return fail('TRANSACTION_EVIDENCE_REQUIRED');
  if (state === 'rejected' && effectClass === 'mutation') {
    if (!value.authorityResolution || !value.retainedResult || value.retainedResult.effectCertainty === 'unknown' || !value.transactionEvidence || !value.recoveryDisposition) return fail('REJECTED_RESULT_REQUIRED');
    if (value.transactionEvidence.resultSnapshot.id !== value.retainedResult.id || value.transactionEvidence.resultSnapshot.snapshotRef !== value.retainedResult.snapshotRef) return fail('REJECTED_RESULT_MISMATCH');
    if (value.transactionEvidence.resultSnapshot.effectCertainty !== value.retainedResult.effectCertainty) return fail('REJECTED_EFFECT_MISMATCH');
  }
  if (state === 'rolled_back' && (!value.rollbackResult || value.rollbackResult.outcome !== 'restored' || value.rollbackResult.effectCertainty === 'unknown' || value.rollbackResult.divergence === 'present' || value.rollbackResult.restoreSnapshotRef !== snapshotRef)) return fail('ROLLBACK_RESULT_REQUIRED');
  if (state === 'failed' && value.effectCertainty === undefined) return fail('EFFECT_CERTAINTY_REQUIRED');
}

function validateEvidenceScope(value: AcceptanceEvidenceRef, taskId: string, workspaceId: string, transactionId: string, attemptId: string): void {
  if (value.taskId !== taskId || value.workspaceId !== workspaceId || value.transactionId !== transactionId || value.attemptId !== attemptId ||
    !scopeMatches(value.validationPlan, taskId, workspaceId) || !scopeMatches(value.veritasVerdict, taskId, workspaceId) ||
    !scopeMatches(value.evidenceManifest, taskId, workspaceId) || !scopeMatches(value.resultSnapshot, taskId, workspaceId) ||
    value.resultSnapshot.transactionId !== transactionId || value.resultSnapshot.attemptId !== attemptId) return fail('EVIDENCE_SCOPE_MISMATCH');
}

function validateRequest(value: unknown, states: readonly string[]): TransitionRequest<string> {
  const input = record(value, ['aggregateId', 'expectedRevision', 'currentState', 'nextState', 'reason', 'causeRef', 'correlationId', 'causationId', 'timestamp', 'data'], 'TRANSITION');
  const base: TransitionRequest<string> = {
    aggregateId: text(input.aggregateId, 'INVALID_AGGREGATE_ID'), expectedRevision: integer(input.expectedRevision, 'INVALID_EXPECTED_REVISION'),
    currentState: oneOf(input.currentState, states, 'INVALID_CURRENT_STATE'), nextState: oneOf(input.nextState, states, 'INVALID_NEXT_STATE'),
    reason: text(input.reason, 'INVALID_REASON', 2048), causeRef: cause(input.causeRef), correlationId: text(input.correlationId, 'INVALID_CORRELATION_ID'),
    causationId: nullableText(input.causationId, 'INVALID_CAUSATION_ID'), timestamp: timestamp(input.timestamp)
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
    schemaVersion: LIFECYCLE_SCHEMA_VERSION, aggregateType, aggregateId: current.aggregateId, previousRevision: current.revision, nextRevision: current.revision + 1,
    previousState: current.state, nextState: request.nextState, reason: request.reason, causeRef: request.causeRef,
    correlationId: request.correlationId, causationId: request.causationId, timestamp: request.timestamp
  };
}

function taskGuards(current: TaskAggregate, request: TaskTransitionRequest, nextData: LifecycleData): LifecycleData {
  if (current.state === 'awaiting_authority' && request.nextState === 'scheduled') {
    const resolution = nextData.authorityResolution;
    if (request.causeRef.kind !== 'continuation' || !resolution || request.causeRef.id !== resolution.continuation.id ||
      !scopeMatches(resolution, current.taskId, current.workspaceId) || resolution.operation.taskId !== current.taskId || resolution.taskRevision !== current.revision) return fail('AUTHORITY_RESOLUTION_REQUIRED');
  }
  if (current.state === 'interrupted' && request.nextState === 'resumable' && nextData.reconciliation?.outcome !== 'reconciled') return fail('RECONCILIATION_REQUIRED');
  if (current.state === 'resumable' && request.nextState === 'contextualizing') {
    if (request.causeRef.kind !== 'reconsideration') return fail('FRESH_RECONSIDERATION_REQUIRED');
    const activeEpochFields: readonly (keyof LifecycleData)[] = [
      'authorityResolution', 'reconciliation', 'acceptanceEvidence', 'transactionEvidence',
      'retainedResult', 'output', 'failureRef', 'rollbackResult', 'checkpoint', 'quiescence',
      'effectCertainty', 'recoveryDisposition'
    ];
    if (request.data && Object.prototype.hasOwnProperty.call(request.data, 'authorityResolution')) return fail('STALE_AUTHORITY_FORBIDDEN');
    if (request.data && activeEpochFields.some(field => field !== 'authorityResolution' && Object.prototype.hasOwnProperty.call(request.data, field))) return fail('STALE_EPOCH_DATA_FORBIDDEN');
    // The prior aggregate and its transition records remain the historical trail;
    // no prior execution evidence remains active in the fresh epoch.
    return data({});
  }
  if (request.nextState === 'accepted') {
    if (current.state !== 'verifying' || !nextData.acceptanceEvidence) return fail('ACCEPTANCE_EVIDENCE_REQUIRED');
    if (current.attemptId === null || nextData.acceptanceEvidence.attemptId !== current.attemptId) return fail('ACCEPTANCE_SCOPE_MISMATCH');
    validateEvidenceScope(nextData.acceptanceEvidence, current.taskId, current.workspaceId, nextData.acceptanceEvidence.transactionId, current.attemptId);
  }
  if (request.nextState === 'cancelled' && (!nextData.quiescence || nextData.quiescence.aggregateType !== 'task' || nextData.quiescence.aggregateId !== current.taskId)) return fail('CLEAN_QUIESCENCE_REQUIRED');
  validateTaskStateData(request.nextState, nextData, current.taskId, current.workspaceId, current.attemptId);
  return nextData;
}

function workerGuards(current: WorkerAttemptAggregate, request: WorkerAttemptTransitionRequest, nextData: LifecycleData): void {
  if (request.nextState === 'cancelled' && (!nextData.quiescence || nextData.quiescence.aggregateType !== 'worker_attempt' || nextData.quiescence.aggregateId !== current.attemptId)) return fail('CLEAN_QUIESCENCE_REQUIRED');
  if (request.nextState === 'interrupted' && (!nextData.effectCertainty || !nextData.reconciliation)) return fail('INTERRUPTION_EFFECT_REQUIRED');
  validateWorkerStateData(request.nextState, current.taskId, current.workspaceId, current.attemptId, nextData);
}

function transactionGuards(current: ExecutionTransactionAggregate, request: ExecutionTransactionTransitionRequest, nextData: LifecycleData): void {
  if (request.nextState === 'checkpointed') {
    if (current.operation.effectClass === 'mutation' && (!nextData.checkpoint || !('transactionId' in nextData.checkpoint))) return fail('CHECKPOINT_REQUIRED');
    if (current.operation.effectClass === 'read_only' && (!nextData.checkpoint || !('kind' in nextData.checkpoint))) return fail('READ_ONLY_CHECKPOINT_REQUIRED');
  }
  if (request.nextState === 'executing') {
    if (current.operation.effectClass === 'mutation' && (current.state !== 'checkpointed' || !current.data.checkpoint || !('transactionId' in current.data.checkpoint))) return fail('CHECKPOINT_REQUIRED');
    if (current.operation.effectClass === 'read_only' && (!nextData.checkpoint || !('kind' in nextData.checkpoint))) return fail('READ_ONLY_CHECKPOINT_REQUIRED');
  }
  if (request.nextState === 'committed') {
    if (current.state !== 'verifying' || !nextData.transactionEvidence) return fail('COMMIT_REQUIRES_VERIFICATION');
    validateEvidenceScope(nextData.transactionEvidence, current.taskId, current.workspaceId, current.transactionId, current.attemptId);
  }
  if (request.nextState === 'rejected' && current.operation.effectClass === 'mutation') {
    if (!nextData.retainedResult || !nextData.transactionEvidence || !nextData.recoveryDisposition) return fail('REJECTED_RESULT_REQUIRED');
    validateEvidenceScope(nextData.transactionEvidence, current.taskId, current.workspaceId, current.transactionId, current.attemptId);
    if (nextData.transactionEvidence.resultSnapshot.effectCertainty === 'unknown') return fail('TRANSACTION_EVIDENCE_INCOMPLETE');
    if (nextData.transactionEvidence.resultSnapshot.id !== nextData.retainedResult.id || nextData.transactionEvidence.resultSnapshot.snapshotRef !== nextData.retainedResult.snapshotRef) return fail('REJECTED_RESULT_MISMATCH');
    if (nextData.transactionEvidence.resultSnapshot.effectCertainty !== nextData.retainedResult.effectCertainty) return fail('REJECTED_EFFECT_MISMATCH');
  }
  if (request.nextState === 'rolled_back' && (!nextData.rollbackResult || nextData.rollbackResult.outcome !== 'restored' || nextData.rollbackResult.effectCertainty === 'unknown' || nextData.rollbackResult.divergence === 'present')) return fail('ROLLBACK_RESULT_REQUIRED');
  if (request.nextState === 'failed' && nextData.effectCertainty === undefined) return fail('EFFECT_CERTAINTY_REQUIRED');
  validateTransactionStateData(request.nextState, current.operation.id, current.operation.effectClass, current.taskId, current.attemptId, current.transactionId, current.workspaceId, current.preExecutionSnapshotRef, nextData);
}

export function createOperationDescriptor(input: OperationDescriptor): Readonly<OperationDescriptor> {
  return immutable(operation(input));
}

export function createTaskAggregate(input: TaskAggregate): Readonly<TaskAggregate> { return immutable(validateTask(input)); }
export function createWorkerAttemptAggregate(input: WorkerAttemptAggregate): Readonly<WorkerAttemptAggregate> { return immutable(validateWorker(input)); }
export function createExecutionTransactionAggregate(input: ExecutionTransactionAggregate): Readonly<ExecutionTransactionAggregate> { return immutable(validateTransaction(input)); }

export function reduceTask(current: TaskAggregate, rawRequest: TaskTransitionRequest): LifecycleReduction<TaskAggregate, TaskState> {
  const source = validateTask(current); const request = validateRequest(rawRequest, TASK_STATES) as TaskTransitionRequest;
  commonChecks(source, request, TASK_TRANSITIONS); const nextData = taskGuards(source, request, mergedData(source.data, request));
  const aggregate = immutable({ ...source, revision: source.revision + 1, state: request.nextState, causationId: request.causationId, data: nextData }) as Readonly<TaskAggregate>;
  const transition = immutable(transitionRecord('task', source, request)) as Readonly<TransitionRecord<TaskState>>;
  return { aggregate, transition };
}

export function reduceWorkerAttempt(current: WorkerAttemptAggregate, rawRequest: WorkerAttemptTransitionRequest): LifecycleReduction<WorkerAttemptAggregate, WorkerAttemptState> {
  const source = validateWorker(current); const request = validateRequest(rawRequest, WORKER_ATTEMPT_STATES) as WorkerAttemptTransitionRequest;
  commonChecks(source, request, WORKER_ATTEMPT_TRANSITIONS); const nextData = mergedData(source.data, request); workerGuards(source, request, nextData);
  const aggregate = immutable({ ...source, revision: source.revision + 1, state: request.nextState, causationId: request.causationId, data: nextData }) as Readonly<WorkerAttemptAggregate>;
  const transition = immutable(transitionRecord('worker_attempt', source, request)) as Readonly<TransitionRecord<WorkerAttemptState>>;
  return { aggregate, transition };
}

export function reduceExecutionTransaction(current: ExecutionTransactionAggregate, rawRequest: ExecutionTransactionTransitionRequest): LifecycleReduction<ExecutionTransactionAggregate, ExecutionTransactionState> {
  const source = validateTransaction(current); const request = validateRequest(rawRequest, EXECUTION_TRANSACTION_STATES) as ExecutionTransactionTransitionRequest;
  commonChecks(source, request, EXECUTION_TRANSACTION_TRANSITIONS); const nextData = mergedData(source.data, request); transactionGuards(source, request, nextData);
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

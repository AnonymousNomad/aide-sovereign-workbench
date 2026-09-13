/**
 * Platform-neutral lifecycle contracts for Covert intelligence work.
 *
 * These records describe state. They never grant execution permission. In
 * particular, no lifecycle type contains an approval token, capability token,
 * actor credential, execution handle, or permission boolean.
 */

export const LIFECYCLE_SCHEMA_VERSION = '1' as const;

export const TASK_STATES = [
  'created', 'contextualizing', 'planning', 'awaiting_authority', 'scheduled',
  'waiting_dependency', 'running', 'verifying', 'interrupted', 'resumable',
  'rolling_back', 'accepted', 'rejected', 'failed', 'cancelled', 'rolled_back'
] as const;
export type TaskState = typeof TASK_STATES[number];

export const WORKER_ATTEMPT_STATES = [
  'created', 'queued', 'preparing', 'running', 'waiting_tool', 'blocked',
  'cancelling', 'output_ready', 'failed', 'cancelled', 'interrupted'
] as const;
export type WorkerAttemptState = typeof WORKER_ATTEMPT_STATES[number];

export const EXECUTION_TRANSACTION_STATES = [
  'proposed', 'authorized', 'checkpointed', 'executing', 'evidence_pending',
  'verifying', 'committed', 'rejected', 'rolling_back', 'rolled_back', 'failed'
] as const;
export type ExecutionTransactionState = typeof EXECUTION_TRANSACTION_STATES[number];

export const EFFECT_CERTAINTIES = ['none', 'known_partial', 'known_complete', 'unknown'] as const;
export type EffectCertainty = typeof EFFECT_CERTAINTIES[number];

export const AGGREGATE_TYPES = ['task', 'worker_attempt', 'execution_transaction'] as const;
export type AggregateType = typeof AGGREGATE_TYPES[number];

export type CauseKind =
  | 'operator'
  | 'continuation'
  | 'dependency'
  | 'worker'
  | 'authority'
  | 'verification'
  | 'recovery'
  | 'reconsideration';

/** A scope-bearing identifier. It is descriptive, never executable authority. */
export interface ScopedReference {
  readonly id: string;
  readonly taskId: string;
  readonly workspaceId: string;
}

export type OperationEffectClass = 'read_only' | 'mutation';

/** Immutable classification supplied by the trusted operation-admission owner. */
export interface OperationDescriptor extends ScopedReference {
  readonly revision: number;
  readonly effectClass: OperationEffectClass;
}

export type ProposedOperationRef = OperationDescriptor;

export interface AuthorityDecisionRef extends ScopedReference {
  readonly operationId: string;
  readonly proposalRevision: number;
}

export interface ContinuationRef extends ScopedReference {
  readonly operationId: string;
  readonly authorityDecisionId: string;
  readonly proposalRevision: number;
}

export interface AuthorityResolutionRef extends ScopedReference {
  /** Task aggregate revision at which this resolution was issued, when task-bound. */
  readonly taskRevision?: number;
  readonly operation: ProposedOperationRef;
  readonly decision: AuthorityDecisionRef;
  readonly continuation: ContinuationRef;
}

export interface CauseRef {
  readonly kind: CauseKind;
  readonly id: string;
}

export interface ReconciliationRef extends ScopedReference {
  readonly aggregateType: AggregateType;
  readonly aggregateId: string;
  readonly outcome: 'reconciled' | 'unresolved';
  readonly effectCertainty: EffectCertainty;
}

export interface RetainedExecutionResultRef extends ScopedReference {
  readonly transactionId: string;
  readonly attemptId: string;
  readonly snapshotRef: string;
  readonly effectCertainty: EffectCertainty;
}

export interface CheckpointRef extends ScopedReference {
  readonly transactionId: string;
  readonly snapshotRef: string;
}

export interface NotApplicableCheckpoint {
  readonly kind: 'not_applicable';
}

export interface QuiescenceEvidence extends ScopedReference {
  readonly aggregateType: 'task' | 'worker_attempt';
  readonly aggregateId: string;
  readonly admissionStopped: true;
  readonly activeWork: 'none';
  readonly effectCertainty: Exclude<EffectCertainty, 'unknown'>;
  readonly retainedResult: RetainedExecutionResultRef | null;
}

export interface AcceptanceEvidenceRef extends ScopedReference {
  readonly transactionId: string;
  readonly attemptId: string;
  readonly validationPlan: ScopedReference;
  readonly veritasVerdict: ScopedReference;
  readonly resultSnapshot: RetainedExecutionResultRef;
  readonly evidenceManifest: ScopedReference;
}

export type TransactionEvidenceRef = AcceptanceEvidenceRef;

export type RollbackOutcome = 'restored' | 'partial' | 'failed';
export interface RollbackResultRef extends ScopedReference {
  readonly transactionId: string;
  readonly restoreSnapshotRef: string;
  readonly outcome: RollbackOutcome;
  readonly effectCertainty: EffectCertainty;
  readonly divergence: 'none' | 'resolved' | 'present';
}

export type RecoveryDisposition = 'retain_for_review' | 'rollback_required' | 'repair_attempt_allowed';

export interface OutputRef extends ScopedReference {
  readonly attemptId: string;
}

/** State metadata is descriptive and cannot be used as execution authority. */
export interface LifecycleData {
  readonly authorityResolution?: AuthorityResolutionRef;
  readonly reconciliation?: ReconciliationRef;
  readonly acceptanceEvidence?: AcceptanceEvidenceRef;
  readonly transactionEvidence?: TransactionEvidenceRef;
  readonly retainedResult?: RetainedExecutionResultRef;
  readonly output?: OutputRef;
  readonly failureRef?: ScopedReference;
  readonly rollbackResult?: RollbackResultRef;
  readonly checkpoint?: CheckpointRef | NotApplicableCheckpoint;
  readonly quiescence?: QuiescenceEvidence;
  readonly effectCertainty?: EffectCertainty;
  readonly recoveryDisposition?: RecoveryDisposition;
}

export interface TaskAggregate {
  readonly schemaVersion: typeof LIFECYCLE_SCHEMA_VERSION;
  readonly aggregateType: 'task';
  readonly aggregateId: string;
  readonly taskId: string;
  readonly workspaceId: string;
  readonly parentTaskId: string | null;
  readonly attemptId: string | null;
  readonly revision: number;
  readonly state: TaskState;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly data: LifecycleData;
}

export interface WorkerAttemptAggregate {
  readonly schemaVersion: typeof LIFECYCLE_SCHEMA_VERSION;
  readonly aggregateType: 'worker_attempt';
  readonly aggregateId: string;
  readonly attemptId: string;
  readonly taskId: string;
  readonly workspaceId: string;
  readonly parentAttemptId: string | null;
  readonly revision: number;
  readonly state: WorkerAttemptState;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly data: LifecycleData;
}

export interface ExecutionTransactionAggregate {
  readonly schemaVersion: typeof LIFECYCLE_SCHEMA_VERSION;
  readonly aggregateType: 'execution_transaction';
  readonly aggregateId: string;
  readonly transactionId: string;
  readonly taskId: string;
  readonly attemptId: string;
  readonly workspaceId: string;
  readonly operation: OperationDescriptor;
  readonly preExecutionSnapshotRef: string;
  readonly revision: number;
  readonly state: ExecutionTransactionState;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly data: LifecycleData;
}

export interface TransitionRequest<S extends string = string> {
  readonly aggregateId: string;
  readonly expectedRevision: number;
  readonly currentState: S;
  readonly nextState: S;
  readonly reason: string;
  readonly causeRef: CauseRef;
  readonly correlationId: string;
  readonly causationId: string | null;
  /** Supplied by the caller for deterministic replay; reducers never read the clock. */
  readonly timestamp: string;
  readonly data?: LifecycleData;
}

export interface TransitionRecord<S extends string = string> {
  readonly schemaVersion: typeof LIFECYCLE_SCHEMA_VERSION;
  readonly aggregateType: AggregateType;
  readonly aggregateId: string;
  readonly previousRevision: number;
  readonly nextRevision: number;
  readonly previousState: S;
  readonly nextState: S;
  readonly reason: string;
  readonly causeRef: CauseRef;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly timestamp: string;
}

export interface LifecycleReduction<A, S extends string = string> {
  readonly aggregate: Readonly<A>;
  readonly transition: Readonly<TransitionRecord<S>>;
}

export type TaskTransitionRequest = TransitionRequest<TaskState>;
export type WorkerAttemptTransitionRequest = TransitionRequest<WorkerAttemptState>;
export type ExecutionTransactionTransitionRequest = TransitionRequest<ExecutionTransactionState>;

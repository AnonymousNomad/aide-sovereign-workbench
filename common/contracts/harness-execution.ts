/**
 * Harness H1 execution contracts.
 *
 * These are platform-neutral descriptions of one execution attempt.  They do
 * not execute work, authenticate an actor, mint permission, or decide whether
 * a result is acceptable.  Execution Authority owns permission, Harness owns
 * execution facts, and Veritas owns acceptance.
 */

import type {
  CauseRef,
  EffectCertainty,
  ExecutionTransactionState,
  TransitionRecord
} from './task-lifecycle.ts';

export const HARNESS_EXECUTION_SCHEMA_VERSION = '1' as const;
export const HARNESS_EXECUTION_SERIALIZATION = 'covert-harness-execution-json-v1' as const;

export type OpaqueId<Tag extends string> = string & { readonly __opaque: Tag };
export type HarnessExecutionRequestId = OpaqueId<'HarnessExecutionRequestId'>;
export type HarnessTransactionId = OpaqueId<'HarnessTransactionId'>;
export type TaskId = OpaqueId<'TaskId'>;
export type WorkerAttemptId = OpaqueId<'WorkerAttemptId'>;
export type WorkspaceId = OpaqueId<'WorkspaceId'>;
export type OperationId = OpaqueId<'OperationId'>;
export type AuthorityDecisionId = OpaqueId<'AuthorityDecisionId'>;
export type CheckpointId = OpaqueId<'CheckpointId'>;
export type EvidenceId = OpaqueId<'EvidenceId'>;
export type ExecutionResultId = OpaqueId<'ExecutionResultId'>;
export type Digest = string & { readonly __digest: 'sha256' };
export type SafeInteger = number & { readonly __safeInteger: true };
export type TaskRevision = SafeInteger;

export interface ExecutionScope {
  readonly workspaceId: WorkspaceId;
  readonly taskId: TaskId;
  readonly taskRevision: TaskRevision;
  readonly attemptId: WorkerAttemptId;
  readonly transactionId: HarnessTransactionId;
}

export type OperationClass =
  | 'read_only'
  | 'filesystem_mutation'
  | 'git_mutation'
  | 'process_spawn'
  | 'process_stop'
  | 'network_external'
  | 'desktop_effect'
  | 'model_lifecycle'
  | 'compound_effect';

export interface AuthorityOperationRef {
  readonly kind: 'authority-operation';
  readonly id: OperationId;
  readonly workspaceId: WorkspaceId;
  readonly taskId: TaskId;
  readonly taskRevision: TaskRevision;
  readonly operationDigest: Digest;
  readonly descriptorRevision: SafeInteger;
  readonly effectClass: 'read_only' | 'mutation';
  readonly targetDigest: Digest;
}

/** Structural identity only.  This is not an execution handle or credential. */
export interface AuthorityDecisionRef {
  readonly kind: 'authority-decision';
  readonly id: AuthorityDecisionId;
  readonly workspaceId: WorkspaceId;
  readonly taskId: TaskId;
  readonly taskRevision: TaskRevision;
  readonly operationId: OperationId;
  readonly operationDigest: Digest;
  readonly descriptorRevision: SafeInteger;
  readonly targetDigest: Digest;
  readonly decisionRevision: SafeInteger;
  readonly actorRef: string;
}

export interface AuthorityResolutionRef {
  readonly kind: 'authority-resolution';
  readonly id: string;
  readonly workspaceId: WorkspaceId;
  readonly taskId: TaskId;
  readonly taskRevision: TaskRevision;
  readonly operationId: OperationId;
  readonly decisionId: AuthorityDecisionId;
  readonly operationDigest: Digest;
  readonly resolutionDigest: Digest;
}

/** Produced by a trusted authority adapter after a one-shot handle is consumed. */
export interface AuthorityConsumptionRef {
  readonly kind: 'authority-consumption';
  readonly id: string;
  readonly workspaceId: WorkspaceId;
  readonly taskId: TaskId;
  readonly taskRevision: TaskRevision;
  readonly attemptId: WorkerAttemptId;
  readonly transactionId: HarnessTransactionId;
  readonly operationId: OperationId;
  readonly operationDigest: Digest;
  readonly decisionId: AuthorityDecisionId;
  readonly actorRef: string;
  readonly consumptionDigest: Digest;
}

export interface ClassificationSource {
  readonly source: 'descriptor' | 'route_policy' | 'target_resolver' | 'execution_policy';
  readonly effectiveClass: OperationClass;
  readonly revision: SafeInteger;
  readonly digest: Digest;
}

/** All trusted classification sources must converge on one effective class. */
export interface TrustedOperationClassification {
  readonly effectiveClass: OperationClass;
  readonly sources: readonly ClassificationSource[];
  readonly derivationDigest: Digest;
  /** Optional untrusted consistency claim; a mismatch is rejected. */
  readonly callerAssertion?: OperationClass;
}

export interface ResolvedTargetRef {
  readonly kind: 'resolved-target';
  readonly id: string;
  readonly workspaceId: WorkspaceId;
  readonly taskId: TaskId;
  readonly taskRevision: TaskRevision;
  readonly operationId: OperationId;
  readonly targetKind:
    | 'filesystem'
    | 'git-repository'
    | 'process'
    | 'network-endpoint'
    | 'desktop'
    | 'model-runtime'
    | 'compound';
  readonly targetIdentityDigest: Digest;
  readonly effectScopeDigest: Digest;
  readonly resolverRevision: SafeInteger;
  /** Opaque resolver correlation only; never a path, credential, or handle. */
  readonly locatorRef?: string;
}

export interface TrustedOperationBinding {
  readonly operation: AuthorityOperationRef;
  readonly classification: TrustedOperationClassification;
  readonly operationDigest: Digest;
  readonly targetDigest: Digest;
  readonly effectScopeDigest: Digest;
}

export interface ContextEnvelopeBinding {
  readonly kind: 'context-envelope';
  readonly envelopeId: string;
  readonly envelopeDigest: Digest;
  readonly requestId: HarnessExecutionRequestId;
  readonly workspaceId: WorkspaceId;
  readonly taskId: TaskId;
  readonly taskRevision: TaskRevision;
}

export interface MethodologyReference {
  readonly kind: 'workflow' | 'skill';
  readonly id: string;
  readonly version: string;
  readonly workspaceId: WorkspaceId;
  readonly taskId: TaskId;
  readonly taskRevision: TaskRevision;
  readonly digest: Digest;
}

export interface MethodologyBinding {
  readonly workflowRefs: readonly MethodologyReference[];
  readonly skillRefs: readonly MethodologyReference[];
  readonly selectionDigest: Digest;
}

/** Role taxonomy remains owned by Orchestrator/ModelRouter. */
export interface WorkerSelectionRef {
  readonly kind: 'worker-selection';
  readonly id: string;
  readonly selectionDigest: Digest;
  readonly workspaceId: WorkspaceId;
  readonly taskId: TaskId;
  readonly taskRevision: TaskRevision;
  readonly attemptId: WorkerAttemptId;
  readonly roleIdentity: string;
  readonly modelIdentity: string;
  readonly modelRevision: string;
  readonly provider: string;
  readonly locality: 'local' | 'remote';
  readonly selectionRevision: SafeInteger;
}

export type AuthorityMode = 'decision_required' | 'not_required_by_trusted_policy';

export interface AuthorityRequestBinding {
  readonly mode: AuthorityMode;
  readonly decision?: AuthorityDecisionRef;
}

export type CheckpointPreference = 'no_preference' | 'prefer_snapshot' | 'prefer_compensation';
export type EffectiveCheckpointRequirement = 'not_applicable' | 'required' | 'compensation_only';

export interface EffectiveCheckpointPolicyRef {
  readonly kind: 'checkpoint-policy';
  readonly id: string;
  readonly workspaceId: WorkspaceId;
  readonly taskId: TaskId;
  readonly taskRevision: TaskRevision;
  readonly operationClass: OperationClass;
  readonly revision: SafeInteger;
  readonly digest: Digest;
}

/** Pre-execution only.  It contains no checkpoint attempt or result. */
export interface CheckpointRequestBinding {
  readonly requestedPreference: CheckpointPreference;
  readonly effectiveRequirement: EffectiveCheckpointRequirement;
  readonly policy: EffectiveCheckpointPolicyRef;
  readonly availability: 'available' | 'unavailable';
}

export interface TransactionCheckpointRef {
  readonly kind: 'transaction-checkpoint';
  readonly id: CheckpointId;
  readonly workspaceId: WorkspaceId;
  readonly taskId: TaskId;
  readonly taskRevision: TaskRevision;
  readonly transactionId: HarnessTransactionId;
  readonly snapshotRef: string;
  readonly mutationScopeDigest: Digest;
  readonly checkpointDigest: Digest;
}

export interface CompensationPreparationRef {
  readonly kind: 'compensation-preparation';
  readonly id: string;
  readonly workspaceId: WorkspaceId;
  readonly taskId: TaskId;
  readonly taskRevision: TaskRevision;
  readonly transactionId: HarnessTransactionId;
  readonly mutationScopeDigest: Digest;
  readonly preparationDigest: Digest;
}

export type EvidenceType =
  | 'process'
  | 'filesystem'
  | 'git'
  | 'before-after'
  | 'checkpoint'
  | 'quiescence'
  | 'authority-consumption'
  | 'resource'
  | 'error'
  | 'result'
  | 'evidence-manifest';

export type EvidenceOwner =
  | 'harness'
  | 'execution-authority'
  | 'checkpoint-service'
  | 'resource-monitor'
  | 'worker-observer';

export interface ScopedEvidenceRef {
  readonly kind: 'evidence';
  readonly id: EvidenceId;
  readonly evidenceType: EvidenceType;
  readonly owner: EvidenceOwner;
  readonly workspaceId: WorkspaceId;
  readonly taskId: TaskId;
  readonly taskRevision: TaskRevision;
  readonly attemptId: WorkerAttemptId;
  readonly transactionId: HarnessTransactionId;
  readonly digest: Digest;
}

export interface ExecutionResultRef {
  readonly kind: 'execution-result';
  readonly id: ExecutionResultId;
  readonly workspaceId: WorkspaceId;
  readonly taskId: TaskId;
  readonly taskRevision: TaskRevision;
  readonly attemptId: WorkerAttemptId;
  readonly transactionId: HarnessTransactionId;
  readonly effectCertainty: EffectCertainty;
  /** Omitted while the referenced terminal artifact is being constructed. */
  readonly resultDigest?: Digest;
}

export interface RetryParentTransactionRef {
  readonly kind: 'retry-parent';
  readonly parentRequestId: HarnessExecutionRequestId;
  readonly workspaceId: WorkspaceId;
  readonly taskId: TaskId;
  readonly parentTaskRevision: TaskRevision;
  readonly parentAttemptId: WorkerAttemptId;
  readonly parentTransactionId: HarnessTransactionId;
  /** The prior decision identity is lineage only; it can never authorize the retry. */
  readonly parentAuthorityDecisionId: AuthorityDecisionId;
  readonly parentTerminalState: Extract<ExecutionTransactionState, 'committed' | 'rejected' | 'rolled_back' | 'failed'>;
  readonly parentEffectCertainty: EffectCertainty;
  readonly parentResultRef?: ExecutionResultRef;
}

export type RetryKind = 'same-task-revision-retry' | 'reconsidered-task-retry';

export interface RetryLineage {
  readonly kind: RetryKind;
  readonly parent: RetryParentTransactionRef;
  readonly freshAuthorityRequired: true;
  /** Computed from the trusted operation/checkpoint policy; callers may not weaken it. */
  readonly freshCheckpointRequired: boolean;
  readonly freshEvidenceRequired: true;
}

export interface ResourceBudgetBinding {
  readonly kind: 'resource-budget';
  readonly budgetId: string;
  readonly budgetDigest: Digest;
  readonly workspaceId: WorkspaceId;
  readonly taskId: TaskId;
  readonly taskRevision: TaskRevision;
  readonly transactionId: HarnessTransactionId;
  readonly revision: SafeInteger;
  readonly limits: {
    readonly wallTimeMs: SafeInteger;
    readonly outputBytes: SafeInteger;
    readonly processCount: SafeInteger;
    readonly modelContextTokens: SafeInteger;
    readonly mutationCount: SafeInteger;
  };
  readonly enforcement: 'hard' | 'advisory';
}

export type EvidenceRequirement =
  | 'authority_consumption'
  | 'process'
  | 'filesystem'
  | 'git'
  | 'before_after'
  | 'checkpoint'
  | 'quiescence'
  | 'resource'
  | 'error'
  | 'result';

export interface EvidenceRequirementBinding {
  readonly requested: readonly EvidenceRequirement[];
  readonly effectiveMinimum: readonly EvidenceRequirement[];
  readonly policyRevision: SafeInteger;
  readonly policyDigest: Digest;
}

export interface CancellationRequestIntent {
  readonly requested: boolean;
  readonly reasonRef?: string;
  readonly stopScheduling: boolean;
}

export interface CancellationObservation {
  readonly kind: 'cancellation-observation';
  readonly id: string;
  readonly workspaceId: WorkspaceId;
  readonly taskId: TaskId;
  readonly taskRevision: TaskRevision;
  readonly attemptId: WorkerAttemptId;
  readonly transactionId: HarnessTransactionId;
  readonly admission: 'open' | 'stopped';
  readonly termination: 'not_requested' | 'requested' | 'quiesced' | 'failed' | 'unknown';
  readonly effectCertainty: EffectCertainty;
  readonly quiescence?: QuiescenceRef;
  readonly observationDigest: Digest;
}

export interface QuiescenceRef {
  readonly kind: 'quiescence';
  readonly id: EvidenceId;
  readonly workspaceId: WorkspaceId;
  readonly taskId: TaskId;
  readonly taskRevision: TaskRevision;
  readonly attemptId: WorkerAttemptId;
  /** Null is reserved for a genuinely transaction-free observation. */
  readonly transactionId: HarnessTransactionId | null;
  readonly admissionStopped: true;
  readonly activeWork: 'none';
  readonly effectCertainty: EffectCertainty;
  readonly reconciliationRequired: boolean;
  readonly retainedResultRef?: ExecutionResultRef;
}

export type FailureCode =
  | 'INVALID_REQUEST'
  | 'SCOPE_MISMATCH'
  | 'STALE_REVISION'
  | 'AUTHORITY_MISMATCH'
  | 'AUTHORITY_REPLAY'
  | 'AUTHORITY_CONSUMED'
  | 'OPERATION_DIGEST_MISMATCH'
  | 'UNSUPPORTED_OPERATION_CLASS'
  | 'CHECKPOINT_MISSING'
  | 'CHECKPOINT_UNAVAILABLE'
  | 'CHECKPOINT_MISMATCH'
  | 'EXECUTION_NOT_STARTED'
  | 'INTERRUPTED'
  | 'TIMEOUT'
  | 'CANCELLATION'
  | 'PARTIAL_EFFECT'
  | 'UNKNOWN_EFFECT'
  | 'QUIESCENCE_MISSING'
  | 'EVIDENCE_INCOMPLETE'
  | 'RESULT_SCOPE_MISMATCH'
  | 'ROLLBACK_REQUIRED'
  | 'ROLLBACK_DIVERGED'
  | 'CLASSIFICATION_CONFLICT'
  | 'POLICY_CONFLICT'
  | 'INTERNAL_HARNESS_FAILURE';

export interface FailureRef {
  readonly kind: 'failure';
  readonly id: string;
  readonly code: FailureCode;
  readonly workspaceId: WorkspaceId;
  readonly taskId: TaskId;
  readonly taskRevision: TaskRevision;
  readonly attemptId: WorkerAttemptId;
  readonly transactionId: HarnessTransactionId;
  readonly evidenceRef?: ScopedEvidenceRef;
}

export interface EvidenceRequirementsSnapshot {
  /** Must include every request.evidence.effectiveMinimum item; it may only strengthen. */
  readonly effectiveMinimum: readonly EvidenceRequirement[];
  readonly evidenceRefs: readonly ScopedEvidenceRef[];
  readonly manifestRef: ScopedEvidenceRef;
}

export type RecoveryDisposition = 'retain_for_review' | 'rollback_required' | 'repair_attempt_allowed';

export interface HarnessExecutionRequest {
  readonly schemaVersion: typeof HARNESS_EXECUTION_SCHEMA_VERSION;
  readonly serialization: typeof HARNESS_EXECUTION_SERIALIZATION;
  readonly requestId: HarnessExecutionRequestId;
  readonly workspaceId: WorkspaceId;
  readonly taskId: TaskId;
  readonly taskRevision: TaskRevision;
  readonly attemptId: WorkerAttemptId;
  readonly transactionId: HarnessTransactionId;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly context: ContextEnvelopeBinding;
  readonly methodology: MethodologyBinding;
  readonly workerSelection: WorkerSelectionRef;
  readonly operation: TrustedOperationBinding;
  readonly target: ResolvedTargetRef;
  readonly authority: AuthorityRequestBinding;
  readonly checkpoint: CheckpointRequestBinding;
  readonly resourceBudget: ResourceBudgetBinding;
  readonly evidence: EvidenceRequirementBinding;
  readonly retry?: RetryLineage;
  readonly cancellation: CancellationRequestIntent;
  /** Deterministic integrity comparison only; never authentication or authority. */
  readonly requestDigest: Digest;
}

export interface HarnessExecutionRequestInput extends Omit<HarnessExecutionRequest, 'schemaVersion' | 'serialization' | 'requestDigest'> {
  readonly schemaVersion?: typeof HARNESS_EXECUTION_SCHEMA_VERSION;
  readonly serialization?: typeof HARNESS_EXECUTION_SERIALIZATION;
}

export interface HarnessTransactionIdentity {
  readonly transactionId: HarnessTransactionId;
  readonly requestId: HarnessExecutionRequestId;
  readonly workspaceId: WorkspaceId;
  readonly taskId: TaskId;
  readonly taskRevision: TaskRevision;
  readonly attemptId: WorkerAttemptId;
}

export interface HarnessTransactionSnapshotBase {
  readonly kind: 'harness-transaction-snapshot';
  readonly schemaVersion: typeof HARNESS_EXECUTION_SCHEMA_VERSION;
  readonly serialization: typeof HARNESS_EXECUTION_SERIALIZATION;
  readonly state: ExecutionTransactionState;
  readonly snapshotRevision: SafeInteger;
  readonly identity: HarnessTransactionIdentity;
  /** Immutable pre-execution handoff retained for later scope validation. */
  readonly request: HarnessExecutionRequest;
  readonly requestDigest: Digest;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly operation: TrustedOperationBinding;
  readonly target: ResolvedTargetRef;
  readonly transition: Readonly<TransitionRecord<ExecutionTransactionState>> | null;
  readonly snapshotDigest: Digest;
}

export interface ProposedSnapshot extends HarnessTransactionSnapshotBase {
  readonly state: 'proposed';
  readonly authority: {
    readonly status: 'decision_referenced';
    readonly decision?: AuthorityDecisionRef;
  };
}

export interface AuthorizedSnapshot extends HarnessTransactionSnapshotBase {
  readonly state: 'authorized';
  readonly authorityResolution: AuthorityResolutionRef;
}

export type CheckpointObservation =
  | { readonly kind: 'not_applicable'; }
  | { readonly kind: 'bound'; readonly checkpoint: TransactionCheckpointRef; }
  | { readonly kind: 'compensation_only'; readonly preparation: CompensationPreparationRef; };

export interface CheckpointedSnapshot extends HarnessTransactionSnapshotBase {
  readonly state: 'checkpointed';
  readonly authorityResolution: AuthorityResolutionRef;
  readonly authorityConsumption: AuthorityConsumptionRef;
  readonly checkpoint: CheckpointObservation;
}

export interface ExecutingSnapshot extends HarnessTransactionSnapshotBase {
  readonly state: 'executing';
  readonly authorityResolution: AuthorityResolutionRef;
  readonly authorityConsumption: AuthorityConsumptionRef;
  readonly admissionRef: ScopedEvidenceRef;
  readonly ownershipRefs: readonly ScopedEvidenceRef[];
  readonly checkpoint?: CheckpointObservation;
}

export interface EvidencePendingSnapshot extends HarnessTransactionSnapshotBase {
  readonly state: 'evidence_pending';
  readonly authorityConsumption: AuthorityConsumptionRef;
  readonly quiescence: QuiescenceRef;
  readonly cancellation?: CancellationObservation;
  readonly effectCertainty: EffectCertainty;
  readonly evidenceRefs: readonly ScopedEvidenceRef[];
}

export interface VerifyingSnapshot extends HarnessTransactionSnapshotBase {
  readonly state: 'verifying';
  readonly authorityConsumption: AuthorityConsumptionRef;
  readonly resultRef: ExecutionResultRef;
  readonly evidence: EvidenceRequirementsSnapshot;
  readonly quiescence: QuiescenceRef;
}

export interface CommittedSnapshot extends HarnessTransactionSnapshotBase {
  readonly state: 'committed';
  readonly resultRef: ExecutionResultRef;
  readonly evidence: EvidenceRequirementsSnapshot;
  readonly durableResultRef: ScopedEvidenceRef;
}

export interface RejectedSnapshot extends HarnessTransactionSnapshotBase {
  readonly state: 'rejected';
  readonly resultRef: ExecutionResultRef;
  readonly retainedResult: ExecutionResultRef;
  readonly effectCertainty: Exclude<EffectCertainty, 'unknown'>;
  readonly rejectionEvidence: ScopedEvidenceRef;
  readonly recoveryDisposition: RecoveryDisposition;
}

export interface RollingBackSnapshot extends HarnessTransactionSnapshotBase {
  readonly state: 'rolling_back';
  readonly retainedResult: ExecutionResultRef;
  readonly rollbackAttempt: ScopedEvidenceRef;
}

export interface RolledBackSnapshot extends HarnessTransactionSnapshotBase {
  readonly state: 'rolled_back';
  readonly retainedResult: ExecutionResultRef;
  readonly restoreResult: ScopedEvidenceRef;
  readonly restoredSnapshotRef: string;
  readonly effectCertainty: Exclude<EffectCertainty, 'unknown'>;
  readonly divergence: 'none' | 'resolved';
}

export interface FailedSnapshot extends HarnessTransactionSnapshotBase {
  readonly state: 'failed';
  readonly failure: FailureRef;
  readonly effectCertainty: EffectCertainty;
  readonly evidenceRefs: readonly ScopedEvidenceRef[];
}

export type HarnessTransactionSnapshot =
  | ProposedSnapshot
  | AuthorizedSnapshot
  | CheckpointedSnapshot
  | ExecutingSnapshot
  | EvidencePendingSnapshot
  | VerifyingSnapshot
  | CommittedSnapshot
  | RejectedSnapshot
  | RollingBackSnapshot
  | RolledBackSnapshot
  | FailedSnapshot;

export type CompletionClass = 'not_started' | 'completed' | 'interrupted' | 'cancelled' | 'timed_out' | 'failed';

export interface HarnessExecutionResultBase {
  readonly kind: 'harness-execution-result';
  readonly schemaVersion: typeof HARNESS_EXECUTION_SCHEMA_VERSION;
  readonly serialization: typeof HARNESS_EXECUTION_SERIALIZATION;
  readonly identity: HarnessTransactionIdentity;
  readonly completion: CompletionClass;
  readonly effectCertainty: EffectCertainty;
  readonly resultRef: ExecutionResultRef;
  readonly evidenceRefs: readonly ScopedEvidenceRef[];
  readonly quiescence?: QuiescenceRef;
  readonly checkpoint?: TransactionCheckpointRef;
  readonly rollback?: ScopedEvidenceRef;
  readonly failure?: FailureRef;
  readonly resultDigest: Digest;
}

export interface NotStartedResult extends HarnessExecutionResultBase {
  readonly completion: 'not_started';
  readonly effectCertainty: 'none';
  readonly evidenceRefs: readonly ScopedEvidenceRef[];
  readonly quiescence?: never;
  readonly checkpoint?: never;
  readonly rollback?: never;
}

export interface ObservedEffectResult extends HarnessExecutionResultBase {
  readonly completion: 'completed' | 'failed' | 'interrupted' | 'cancelled' | 'timed_out';
  readonly effectCertainty: 'known_partial' | 'known_complete';
  readonly effectEvidence: ScopedEvidenceRef;
  readonly quiescence: QuiescenceRef;
}

export interface UnknownEffectResult extends HarnessExecutionResultBase {
  readonly completion: 'interrupted' | 'cancelled' | 'timed_out' | 'failed';
  readonly effectCertainty: 'unknown';
  readonly uncertaintyEvidence: ScopedEvidenceRef;
  readonly reconciliationRequired: true;
  readonly quiescence?: QuiescenceRef;
}

export type HarnessExecutionResult = NotStartedResult | ObservedEffectResult | UnknownEffectResult;

export interface HarnessTransactionTransitionRequest {
  readonly aggregateId: HarnessTransactionId;
  readonly expectedRevision: SafeInteger;
  readonly currentState: ExecutionTransactionState;
  readonly nextState: ExecutionTransactionState;
  readonly reason: string;
  readonly causeRef: CauseRef;
  readonly correlationId: string;
  readonly causationId: string | null;
  /** Caller-supplied timestamp; reducers never read the clock. */
  readonly timestamp: string;
  readonly data: unknown;
}

export type HarnessTransactionTransitionResult = Readonly<HarnessTransactionSnapshot>;

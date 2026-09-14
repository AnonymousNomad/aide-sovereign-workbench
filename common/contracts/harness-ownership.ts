/**
 * Harness H2 process and tool ownership contracts.
 *
 * H2 describes runtime ownership facts only.  It deliberately does not own
 * H1 transaction lifecycle, Execution Authority policy, effect certainty,
 * checkpointing, compensation, or restart reconciliation.
 */

import type {
  Digest,
  HarnessExecutionRequestId,
  HarnessTransactionId,
  OperationId,
  SafeInteger,
  TaskId,
  TaskRevision,
  WorkerAttemptId,
  WorkspaceId
} from './harness-execution.ts';

export const HARNESS_OWNERSHIP_SCHEMA_VERSION = '1' as const;
export const HARNESS_OWNERSHIP_SERIALIZATION = 'covert-harness-ownership-json-v1' as const;
export const HARNESS_OWNERSHIP_DIGEST_DOMAIN = 'covert-harness-ownership-digest-v1' as const;

export type H2ExecutionKind = 'process' | 'tool';
export type H2ProcessKind = 'short_lived_process' | 'persistent_service';
export type H2ToolKind =
  | 'in_process'
  | 'rpc'
  | 'git'
  | 'filesystem'
  | 'desktop'
  | 'model_runtime'
  | 'lsp'
  | 'dap'
  | 'terminal';
export type ServiceScopeKind = 'workspace' | 'project' | 'harness-runtime' | 'explicit-shared';
export type LiveGenerationDisposition =
  | 'provisional'
  | 'published_open'
  | 'retirement_fenced'
  | 'terminal'
  | 'ownership_unresolved';
export type AdmissionState =
  | 'RESERVED'
  | 'ABORTED_PRECONSUMPTION'
  | 'CONSUMED_NO_DISPATCH'
  | 'CONSUMED_UNRESOLVED'
  | 'COMMITTED';
export type RuntimeObservationKind =
  | 'spawn_created'
  | 'start_observed'
  | 'running_observed'
  | 'termination_requested'
  | 'exit_observed'
  | 'ownership_lost'
  | 'ownership_uncertain';

/** H2-owned failures.  Authority failures remain owned by Execution Authority. */
export type H2FailureCode =
  | 'OWNERSHIP_NOT_PROVEN'
  | 'OWNERSHIP_STALE'
  | 'OWNERSHIP_SCOPE_MISMATCH'
  | 'OWNERSHIP_GENERATION_MISMATCH'
  | 'OWNERSHIP_LOST'
  | 'PROCESS_GENERATION_UNAVAILABLE'
  | 'PID_REUSE_SUSPECTED'
  | 'PORT_REUSE_SUSPECTED'
  | 'FOREIGN_PROCESS_PRESENT'
  | 'DETACHED_PROCESS_UNOWNED'
  | 'DESCENDANT_UNOWNED'
  | 'TERMINATION_NOT_CONFIRMED'
  | 'QUIESCENCE_NOT_PROVEN'
  | 'ADMISSION_NOT_STOPPED'
  | 'ACTIVE_WORK_REMAINS'
  | 'RESTART_RECONCILIATION_REQUIRED'
  | 'TOOL_INVOCATION_NOT_FOUND'
  | 'TARGET_CONFLICT'
  | 'PUBLICATION_NOT_READY'
  | 'FENCE_CONFLICT'
  | 'ADMISSION_REPLAY'
  | 'ADMISSION_CONFLICT'
  | 'BRIDGE_CAPACITY_EXHAUSTED'
  | 'BRIDGE_WATCH_CONFLICT'
  | 'BRIDGE_HEALTH_UNCERTAIN'
  | 'AUTHORITY_OBSERVATION_UNRESOLVED'
  | 'INTERNAL_HARNESS_FAILURE';

export interface ServiceScope {
  readonly kind: ServiceScopeKind;
  readonly scopeId: string;
  readonly policyDigest: Digest;
}

/** Shallow parent identity.  It is never a recursively embedded ownership tree. */
export interface ParentOwnershipRef {
  readonly kind: 'parent-ownership-ref';
  readonly ownershipId: string;
  readonly bindingGenerationId: string;
  readonly liveGenerationId: string;
  readonly workspaceId: WorkspaceId;
  readonly taskId: TaskId;
  readonly taskRevision: TaskRevision;
  readonly requestId: HarnessExecutionRequestId;
  readonly attemptId: WorkerAttemptId;
  readonly transactionId: HarnessTransactionId;
  readonly provenanceDigest: Digest;
}

/** Stable common identity for one H1-bound H2 execution generation. */
export interface OwnedExecutionRef {
  readonly kind: 'owned-execution-ref';
  readonly ownershipId: string;
  /** H1-epoch control-binding identity; intentionally not liveGenerationId. */
  readonly bindingGenerationId: string;
  readonly workspaceId: WorkspaceId;
  readonly taskId: TaskId;
  readonly taskRevision: TaskRevision;
  readonly attemptId: WorkerAttemptId;
  readonly transactionId: HarnessTransactionId;
  readonly requestId: HarnessExecutionRequestId;
  readonly operationId: OperationId;
  readonly operationDigest: Digest;
  readonly targetId: string;
  readonly targetDigest: Digest;
  readonly effectScopeDigest: Digest;
  readonly executionKind: H2ExecutionKind;
  readonly providerId: string;
  readonly providerVersion: string;
  readonly parentOwnershipRef?: ParentOwnershipRef;
  readonly provenanceDigest: Digest;
}

/** Trusted provider/OS evidence for one exact native/runtime generation. */
export interface ProviderGenerationProofRef {
  readonly kind: 'provider-generation-proof';
  readonly proofId: string;
  readonly providerId: string;
  readonly providerVersion: string;
  readonly executionKind: H2ExecutionKind;
  readonly liveGenerationId: string;
  readonly ownershipId: string;
  readonly registryEpochId: string;
  readonly workspaceId: WorkspaceId;
  readonly taskId: TaskId;
  readonly taskRevision: TaskRevision;
  readonly requestId: HarnessExecutionRequestId;
  readonly attemptId: WorkerAttemptId;
  readonly transactionId: HarnessTransactionId;
  /** Digest of provider-native generation evidence; PID alone is insufficient. */
  readonly providerGenerationEvidenceDigest: Digest;
  readonly creationObservationDigest: Digest;
  readonly handoffObservationDigest?: Digest;
  readonly proofDigest: Digest;
}

/** Stable truth for one continuously Harness-managed runtime generation. */
export interface LiveOwnedGenerationRef {
  readonly kind: 'live-owned-generation-ref';
  readonly liveGenerationId: string;
  readonly registryEpochId: string;
  readonly providerId: string;
  readonly providerVersion: string;
  readonly executionKind: H2ExecutionKind;
  readonly processKind?: H2ProcessKind;
  readonly toolKind?: H2ToolKind;
  readonly targetId: string;
  readonly targetDigest: Digest;
  readonly serviceScope: ServiceScope;
  readonly providerGenerationProofRef: ProviderGenerationProofRef;
  readonly originOwnershipId: string;
  readonly originBindingGenerationId: string;
  readonly originRequestId: HarnessExecutionRequestId;
  readonly originTransactionId: HarnessTransactionId;
  readonly creationProvenanceDigest: Digest;
  readonly liveGenerationDigest: Digest;
}

export interface ProcessDiagnosticObservation {
  readonly pid?: SafeInteger;
  readonly port?: SafeInteger;
  readonly processName?: string;
  readonly executableName?: string;
  readonly commandLineDigest?: Digest;
}

/** H1 transaction binding plus process-specific generation proof only. */
export interface OwnedProcessRef {
  readonly kind: 'owned-process-ref';
  readonly executionRef: OwnedExecutionRef;
  readonly liveGenerationRef: LiveOwnedGenerationRef;
  readonly providerGenerationProofRef: ProviderGenerationProofRef;
  readonly bindingDigest: Digest;
  readonly diagnosticObservation?: ProcessDiagnosticObservation;
}

/** H1 transaction binding for non-process tools.  It has no fake PID model. */
export interface OwnedToolInvocationRef {
  readonly kind: 'owned-tool-invocation-ref';
  readonly executionRef: OwnedExecutionRef;
  readonly liveGenerationId: string;
  readonly invocationId: string;
  readonly normalizedInputDigest: Digest;
  readonly toolKind: H2ToolKind;
  readonly toolInvocationProvenanceDigest: Digest;
  readonly bindingDigest: Digest;
}

/** Pre-authority admission identity.  A reservation is not active work. */
export interface AdmissionReservationRef {
  readonly kind: 'admission-reservation-ref';
  readonly admissionId: string;
  readonly bindingGenerationId: string;
  readonly liveGenerationId: string;
  readonly workspaceId: WorkspaceId;
  readonly taskId: TaskId;
  readonly taskRevision: TaskRevision;
  readonly requestId: HarnessExecutionRequestId;
  readonly attemptId: WorkerAttemptId;
  readonly transactionId: HarnessTransactionId;
  readonly operationId: OperationId;
  readonly operationDigest: Digest;
  readonly targetId: string;
  readonly targetDigest: Digest;
  readonly effectScopeDigest: Digest;
  readonly providerId: string;
  readonly providerVersion: string;
  readonly reservationDigest: Digest;
}

/** One specific operation that crossed H2 runtime admission. */
export interface AdmittedOperationRef {
  readonly kind: 'admitted-operation-ref';
  readonly admissionId: string;
  readonly reservationId: string;
  readonly bindingGenerationId: string;
  readonly liveGenerationId: string;
  readonly workspaceId: WorkspaceId;
  readonly taskId: TaskId;
  readonly taskRevision: TaskRevision;
  readonly requestId: HarnessExecutionRequestId;
  readonly attemptId: WorkerAttemptId;
  readonly transactionId: HarnessTransactionId;
  readonly operationId: OperationId;
  readonly operationDigest: Digest;
  readonly targetId: string;
  readonly targetDigest: Digest;
  readonly effectScopeDigest: Digest;
  readonly providerId: string;
  readonly providerVersion: string;
  readonly admissionSequence: SafeInteger;
  readonly admissionDigest: Digest;
}

/**
 * Receipt of the canonical authority consumed event.  Authority fields are
 * copied from the actual event; bridge fields are local correlation only.
 */
export interface AuthorityConsumptionRef {
  readonly kind: 'authority-consumption-ref';
  readonly authorityOperationId: string;
  readonly authorityRevision: SafeInteger;
  readonly workspaceId: string;
  readonly taskId: string;
  readonly operationKind: string;
  readonly descriptorDigest: Digest;
  readonly actorId: string;
  readonly ownerId: string;
  readonly decision: 'consumed';
  readonly consumedTimestamp: string;
  readonly bridgeEpochId: string;
  readonly bridgeReceiptId: string;
  readonly reservationId: string;
  readonly bindingGenerationId: string;
  readonly requestId: HarnessExecutionRequestId;
  readonly attemptId: WorkerAttemptId;
  readonly transactionId: HarnessTransactionId;
  readonly receiptDigest: Digest;
}

/** Registry-internal runtime truth; never a permission or process capability. */
export interface RetirementFenceRef {
  readonly kind: 'retirement-fence-ref';
  readonly liveGenerationId: string;
  readonly registryEpochId: string;
  readonly stopTransactionId: HarnessTransactionId;
  readonly bindingGenerationId: string;
  readonly admissionReservationId: string;
  readonly operationDigest: Digest;
  readonly targetDigest: Digest;
  readonly fenceGeneration: SafeInteger;
  readonly fenceDigest: Digest;
}

export interface AuthorityAuditEvent {
  readonly type: 'authority';
  readonly ts: string;
  readonly workspace: string;
  readonly operation_id: string;
  readonly actor_id: string;
  readonly owner_id: string;
  readonly task_id: string;
  readonly kind: string;
  readonly digest: Digest;
  readonly policy_revision: SafeInteger;
  readonly decision: string;
  readonly approver_id?: string;
  readonly origin?: string | number;
}

export interface AuthorityRecorderResult {
  readonly persisted: boolean;
  readonly error?: string | null;
}

export interface AuthorityConsumptionWatch {
  readonly kind: 'authority-consumption-watch';
  readonly watchId: string;
  readonly authorityOperationId: string;
  readonly authorityRevision: SafeInteger;
  readonly workspaceId: string;
  readonly taskId: string;
  readonly operationKind: string;
  readonly descriptorDigest: Digest;
  readonly actorId: string;
  readonly ownerId: string;
  readonly reservationId: string;
  readonly bindingGenerationId: string;
  readonly requestId: HarnessExecutionRequestId;
  readonly attemptId: WorkerAttemptId;
  readonly transactionId: HarnessTransactionId;
  readonly bridgeEpochId: string;
  readonly watchDigest: Digest;
}

export interface AdmissionFact {
  readonly kind: 'admission-fact';
  readonly admissionId: string;
  readonly state: AdmissionState;
  readonly observedAt: string;
  readonly reason?: string;
  readonly authorityConsumption?: AuthorityConsumptionRef;
  readonly admittedOperation?: AdmittedOperationRef;
  readonly factDigest: Digest;
}

export interface ProcessRuntimeObservation {
  readonly kind: 'process-runtime-observation';
  readonly observationId: string;
  readonly observation: RuntimeObservationKind;
  readonly ownershipId: string;
  readonly liveGenerationId: string;
  readonly registryEpochId: string;
  readonly bindingGenerationId?: string;
  readonly admissionId?: string;
  readonly workspaceId: WorkspaceId;
  readonly taskId: TaskId;
  readonly taskRevision: TaskRevision;
  readonly requestId: HarnessExecutionRequestId;
  readonly attemptId: WorkerAttemptId;
  readonly transactionId: HarnessTransactionId;
  readonly observedAt: string;
  readonly providerGenerationEvidenceDigest: Digest;
  readonly detail?: string;
  readonly observationDigest: Digest;
}

export interface ToolCompletionObservation {
  readonly kind: 'tool-completion-observation';
  readonly observationId: string;
  readonly invocationId: string;
  readonly ownershipId: string;
  readonly bindingGenerationId: string;
  readonly workspaceId: WorkspaceId;
  readonly taskId: TaskId;
  readonly taskRevision: TaskRevision;
  readonly requestId: HarnessExecutionRequestId;
  readonly attemptId: WorkerAttemptId;
  readonly transactionId: HarnessTransactionId;
  readonly registryEpochId: string;
  readonly outcome: 'completed' | 'interrupted' | 'terminal' | 'uncertain';
  readonly providerProvesInactive: boolean;
  readonly observedAt: string;
  readonly observationDigest: Digest;
}

export interface TerminationObservation {
  readonly kind: 'termination-observation';
  readonly observationId: string;
  readonly ownershipId: string;
  readonly liveGenerationId: string;
  readonly registryEpochId: string;
  readonly admissionId: string;
  readonly workspaceId: WorkspaceId;
  readonly taskId: TaskId;
  readonly taskRevision: TaskRevision;
  readonly requestId: HarnessExecutionRequestId;
  readonly attemptId: WorkerAttemptId;
  readonly transactionId: HarnessTransactionId;
  readonly outcome: 'requested' | 'exact_generation_exited' | 'already_exited' | 'survived' | 'unconfirmed' | 'not_started';
  readonly dispatchStarted: boolean;
  readonly exactGenerationProven: boolean;
  readonly observedAt: string;
  readonly observationDigest: Digest;
}

export interface OwnershipLossObservation {
  readonly kind: 'ownership-loss-observation';
  readonly observationId: string;
  readonly ownershipId: string;
  readonly liveGenerationId: string;
  readonly registryEpochId: string;
  readonly workspaceId: WorkspaceId;
  readonly taskId: TaskId;
  readonly taskRevision: TaskRevision;
  readonly requestId: HarnessExecutionRequestId;
  readonly attemptId: WorkerAttemptId;
  readonly transactionId: HarnessTransactionId;
  readonly reason: string;
  readonly observedAt: string;
  readonly observationDigest: Digest;
}

export interface LiveGenerationHandoffObservation {
  readonly kind: 'live-generation-handoff-observation';
  readonly observationId: string;
  readonly originOwnershipId: string;
  readonly originBindingGenerationId: string;
  readonly liveGenerationId: string;
  readonly registryEpochId: string;
  readonly workspaceId: WorkspaceId;
  readonly taskId: TaskId;
  readonly taskRevision: TaskRevision;
  readonly requestId: HarnessExecutionRequestId;
  readonly attemptId: WorkerAttemptId;
  readonly originTransactionId: HarnessTransactionId;
  readonly targetId: string;
  readonly providerGenerationEvidenceDigest: Digest;
  readonly noUnresolvedLaunchWork: true;
  readonly noUnresolvedDescendants: true;
  readonly responsibilityTransferred: true;
  readonly published: boolean;
  readonly observedAt: string;
  readonly observationDigest: Digest;
}

/** Aggregate inactivity evidence for one H1 transaction; no effect certainty. */
export interface QuiescenceObservation {
  readonly kind: 'quiescence-observation';
  readonly observationId: string;
  readonly registryEpochId: string;
  readonly workspaceId: WorkspaceId;
  readonly taskId: TaskId;
  readonly taskRevision: TaskRevision;
  readonly requestId: HarnessExecutionRequestId;
  readonly attemptId: WorkerAttemptId;
  readonly transactionId: HarnessTransactionId;
  readonly admissionCutoff: true;
  readonly registryCompleteness: true;
  readonly registeredAdmissionIds: readonly string[];
  readonly closedAdmissionIds: readonly string[];
  readonly activeAdmissionIds: readonly string[];
  readonly unresolvedAdmissionIds: readonly string[];
  readonly unresolvedDescendantIds: readonly string[];
  readonly quiescent: boolean;
  readonly observationDigest: Digest;
}

export interface H2OwnershipFailure {
  readonly kind: 'h2-ownership-failure';
  readonly code: H2FailureCode;
  readonly message: string;
  readonly registryEpochId?: string;
  readonly liveGenerationId?: string;
  readonly transactionId?: HarnessTransactionId;
  readonly admissionId?: string;
  readonly failureDigest: Digest;
}

/**
 * Pure H1 Harness request/transaction contract implementation.
 *
 * This module validates and freezes inert data, projects the frozen execution
 * transaction lifecycle, and computes deterministic integrity digests.  It
 * never spawns processes, reads files, talks to Execution Authority, persists
 * state, or decides Veritas acceptance.
 */

import { canonicalContextJson } from '../context/context-envelope.ts';
import { EXECUTION_TRANSACTION_TRANSITIONS } from './task-lifecycle.ts';
import {
  HARNESS_EXECUTION_SCHEMA_VERSION,
  HARNESS_EXECUTION_SERIALIZATION
} from '../contracts/harness-execution.ts';
import {
  EXECUTION_TRANSACTION_STATES,
  type CauseRef,
  type EffectCertainty,
  type ExecutionTransactionState,
  type TransitionRecord
} from '../contracts/task-lifecycle.ts';
import type {
  AuthorityConsumptionRef,
  AuthorityDecisionRef,
  AuthorityDecisionId,
  AuthorityMode,
  AuthorityOperationRef,
  AuthorityRequestBinding,
  AuthorityResolutionRef,
  CancellationObservation,
  CancellationRequestIntent,
  CheckpointObservation,
  CheckpointPreference,
  CheckpointRequestBinding,
  CompensationPreparationRef,
  ContextEnvelopeBinding,
  Digest,
  EffectiveCheckpointPolicyRef,
  EvidenceOwner,
  EvidenceRequirement,
  EvidenceRequirementBinding,
  EvidenceRequirementsSnapshot,
  EvidenceType,
  ExecutionResultId,
  ExecutionResultRef,
  FailureCode,
  FailureRef,
  HarnessExecutionRequest,
  HarnessExecutionRequestInput,
  HarnessExecutionResult,
  HarnessTransactionId,
  HarnessTransactionIdentity,
  HarnessTransactionSnapshot,
  HarnessTransactionSnapshotBase,
  HarnessTransactionTransitionRequest,
  MethodologyBinding,
  MethodologyReference,
  ObservedEffectResult,
  OperationClass,
  OperationId,
  ProposedSnapshot,
  AuthorizedSnapshot,
  CheckpointedSnapshot,
  ExecutingSnapshot,
  EvidencePendingSnapshot,
  VerifyingSnapshot,
  CommittedSnapshot,
  RejectedSnapshot,
  RollingBackSnapshot,
  FailedSnapshot,
  ResolvedTargetRef,
  ResourceBudgetBinding,
  RetryLineage,
  RetryParentTransactionRef,
  RolledBackSnapshot,
  SafeInteger,
  ScopedEvidenceRef,
  TaskId,
  TaskRevision,
  TrustedOperationBinding,
  TrustedOperationClassification,
  TransactionCheckpointRef,
  UnknownEffectResult,
  WorkerAttemptId,
  WorkerSelectionRef,
  WorkspaceId
} from '../contracts/harness-execution.ts';

export class HarnessExecutionError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'HarnessExecutionError';
    this.code = code;
  }
}

const fail = (code: string): never => { throw new HarnessExecutionError(code); };
type Plain = Record<string, unknown>;

const OPERATION_CLASSES: readonly OperationClass[] = [
  'read_only', 'filesystem_mutation', 'git_mutation', 'process_spawn',
  'process_stop', 'network_external', 'desktop_effect', 'model_lifecycle',
  'compound_effect'
];
const TARGET_KINDS = ['filesystem', 'git-repository', 'process', 'network-endpoint', 'desktop', 'model-runtime', 'compound'] as const;
const EFFECT_CLASSES = ['read_only', 'mutation'] as const;
const AUTHORITY_MODES: readonly AuthorityMode[] = ['decision_required', 'not_required_by_trusted_policy'];
const CHECKPOINT_PREFERENCES: readonly CheckpointPreference[] = ['no_preference', 'prefer_snapshot', 'prefer_compensation'];
const CHECKPOINT_REQUIREMENTS = ['not_applicable', 'required', 'compensation_only'] as const;
const EVIDENCE_TYPES: readonly EvidenceType[] = [
  'process', 'filesystem', 'git', 'before-after', 'checkpoint', 'quiescence',
  'authority-consumption', 'resource', 'error', 'result', 'evidence-manifest'
];
const EVIDENCE_OWNERS: readonly EvidenceOwner[] = [
  'harness', 'execution-authority', 'checkpoint-service', 'resource-monitor', 'worker-observer'
];
const EVIDENCE_REQUIREMENTS: readonly EvidenceRequirement[] = [
  'authority_consumption', 'process', 'filesystem', 'git', 'before_after',
  'checkpoint', 'quiescence', 'resource', 'error', 'result'
];
const FAILURE_CODES: readonly FailureCode[] = [
  'INVALID_REQUEST', 'SCOPE_MISMATCH', 'STALE_REVISION', 'AUTHORITY_MISMATCH',
  'AUTHORITY_REPLAY', 'AUTHORITY_CONSUMED', 'OPERATION_DIGEST_MISMATCH',
  'UNSUPPORTED_OPERATION_CLASS', 'CHECKPOINT_MISSING', 'CHECKPOINT_UNAVAILABLE',
  'CHECKPOINT_MISMATCH', 'EXECUTION_NOT_STARTED', 'INTERRUPTED', 'TIMEOUT',
  'CANCELLATION', 'PARTIAL_EFFECT', 'UNKNOWN_EFFECT', 'QUIESCENCE_MISSING',
  'EVIDENCE_INCOMPLETE', 'RESULT_SCOPE_MISMATCH', 'ROLLBACK_REQUIRED',
  'ROLLBACK_DIVERGED', 'CLASSIFICATION_CONFLICT', 'POLICY_CONFLICT',
  'INTERNAL_HARNESS_FAILURE'
];
const COMPLETION_CLASSES = ['not_started', 'completed', 'interrupted', 'cancelled', 'timed_out', 'failed'] as const;
const RETRY_KINDS = ['same-task-revision-retry', 'reconsidered-task-retry'] as const;
const REASON_MAX = 2048;

function isPlain(value: unknown): value is Plain {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Read descriptors before values.  This is intentionally repeated at every
 * boundary so accessor-bearing input is rejected without invoking a getter.
 */
function record(value: unknown, allowed: readonly string[], label: string): Plain {
  if (!isPlain(value)) return fail('INVALID_' + label);
  const allow = new Set(allowed);
  const output = Object.create(null) as Plain;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') return fail('UNKNOWN_' + label + '_FIELD');
    if (!allow.has(key)) return fail('UNKNOWN_' + label + '_FIELD');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return fail('INVALID_' + label);
    output[key] = descriptor.value;
  }
  return output;
}

function list(value: unknown, label: string, max: number): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return fail('INVALID_' + label);
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== 'string')) return fail('INVALID_' + label);
  if (value.length > max || keys.length !== value.length + 1) return fail('INVALID_' + label);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const lengthDescriptor = descriptors.length;
  const lengthValue = lengthDescriptor && Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value')
    ? (lengthDescriptor as { readonly value?: unknown }).value
    : undefined;
  if (lengthValue !== (value as unknown[]).length) return fail('INVALID_' + label);
  const output: unknown[] = [];
  for (let index = 0; index < value.length; index++) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return fail('INVALID_' + label);
    output.push(descriptor.value);
  }
  return output;
}

function has(value: Plain, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function text(value: unknown, code: string, max = 512): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max || value.trim().length < 1) return fail(code);
  return value;
}

function optionalText(input: Plain, key: string, code: string, max = 512): string | undefined {
  if (!has(input, key)) return undefined;
  return text(input[key], code, max);
}

function nullableText(value: unknown, code: string, max = 512): string | null {
  return value === null ? null : text(value, code, max);
}

function safeInteger(value: unknown, code: string, min = 0, max = Number.MAX_SAFE_INTEGER): SafeInteger {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) return fail(code);
  return value as SafeInteger;
}

function positiveRevision(value: unknown, code: string): SafeInteger {
  return safeInteger(value, code, 1, 10_000_000);
}

function revision(value: unknown, code: string): TaskRevision {
  return safeInteger(value, code, 0, 10_000_000) as TaskRevision;
}

function oneOf<T extends string>(value: unknown, choices: readonly T[], code: string): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) return fail(code);
  return value as T;
}

function digest(value: unknown, code: string): Digest {
  const output = text(value, code, 64);
  if (!/^[a-f0-9]{64}$/.test(output)) return fail(code);
  return output as Digest;
}

function timestamp(value: unknown): string {
  const output = text(value, 'INVALID_TIMESTAMP', 128);
  if (!Number.isFinite(Date.parse(output))) return fail('INVALID_TIMESTAMP');
  return output;
}

function unique<T>(values: readonly T[], code: string): readonly T[] {
  if (new Set(values).size !== values.length) return fail(code);
  return values;
}

function immutable<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as object)) immutable(child);
    Object.freeze(value);
  }
  return value as Readonly<T>;
}

function expectedTargetKind(operationClass: OperationClass): ResolvedTargetRef['targetKind'] | null {
  switch (operationClass) {
    case 'filesystem_mutation': return 'filesystem';
    case 'git_mutation': return 'git-repository';
    case 'process_spawn':
    case 'process_stop': return 'process';
    case 'network_external': return 'network-endpoint';
    case 'desktop_effect': return 'desktop';
    case 'model_lifecycle': return 'model-runtime';
    case 'compound_effect': return 'compound';
    case 'read_only': return null;
  }
}

function parseAuthorityOperation(value: unknown): AuthorityOperationRef {
  const input = record(value, ['kind', 'id', 'workspaceId', 'taskId', 'taskRevision', 'operationDigest', 'descriptorRevision', 'effectClass', 'targetDigest'], 'AUTHORITY_OPERATION');
  if (input.kind !== 'authority-operation') return fail('INVALID_OPERATION_KIND');
  return {
    kind: 'authority-operation',
    id: text(input.id, 'INVALID_OPERATION_ID') as OperationId,
    workspaceId: text(input.workspaceId, 'INVALID_OPERATION_WORKSPACE') as WorkspaceId,
    taskId: text(input.taskId, 'INVALID_OPERATION_TASK') as TaskId,
    taskRevision: revision(input.taskRevision, 'INVALID_OPERATION_TASK_REVISION'),
    operationDigest: digest(input.operationDigest, 'INVALID_OPERATION_DIGEST'),
    descriptorRevision: positiveRevision(input.descriptorRevision, 'INVALID_DESCRIPTOR_REVISION'),
    effectClass: oneOf(input.effectClass, EFFECT_CLASSES, 'INVALID_OPERATION_EFFECT_CLASS'),
    targetDigest: digest(input.targetDigest, 'INVALID_OPERATION_TARGET_DIGEST')
  };
}

function parseAuthorityDecision(value: unknown): AuthorityDecisionRef {
  const input = record(value, [
    'kind', 'id', 'workspaceId', 'taskId', 'taskRevision', 'operationId', 'operationDigest',
    'descriptorRevision', 'targetDigest', 'decisionRevision', 'actorRef'
  ], 'AUTHORITY_DECISION');
  if (input.kind !== 'authority-decision') return fail('INVALID_AUTHORITY_DECISION_KIND');
  return {
    kind: 'authority-decision',
    id: text(input.id, 'INVALID_AUTHORITY_DECISION_ID') as AuthorityDecisionId,
    workspaceId: text(input.workspaceId, 'INVALID_AUTHORITY_DECISION_WORKSPACE') as WorkspaceId,
    taskId: text(input.taskId, 'INVALID_AUTHORITY_DECISION_TASK') as TaskId,
    taskRevision: revision(input.taskRevision, 'INVALID_AUTHORITY_DECISION_TASK_REVISION'),
    operationId: text(input.operationId, 'INVALID_AUTHORITY_DECISION_OPERATION') as OperationId,
    operationDigest: digest(input.operationDigest, 'INVALID_AUTHORITY_DECISION_DIGEST'),
    descriptorRevision: positiveRevision(input.descriptorRevision, 'INVALID_AUTHORITY_DECISION_DESCRIPTOR_REVISION'),
    targetDigest: digest(input.targetDigest, 'INVALID_AUTHORITY_DECISION_TARGET_DIGEST'),
    decisionRevision: positiveRevision(input.decisionRevision, 'INVALID_AUTHORITY_DECISION_REVISION'),
    actorRef: text(input.actorRef, 'INVALID_AUTHORITY_ACTOR', 512)
  };
}

function parseAuthorityResolution(value: unknown): AuthorityResolutionRef {
  const input = record(value, [
    'kind', 'id', 'workspaceId', 'taskId', 'taskRevision', 'operationId', 'decisionId',
    'operationDigest', 'resolutionDigest'
  ], 'AUTHORITY_RESOLUTION');
  if (input.kind !== 'authority-resolution') return fail('INVALID_AUTHORITY_RESOLUTION_KIND');
  return {
    kind: 'authority-resolution',
    id: text(input.id, 'INVALID_AUTHORITY_RESOLUTION_ID'),
    workspaceId: text(input.workspaceId, 'INVALID_AUTHORITY_RESOLUTION_WORKSPACE') as WorkspaceId,
    taskId: text(input.taskId, 'INVALID_AUTHORITY_RESOLUTION_TASK') as TaskId,
    taskRevision: revision(input.taskRevision, 'INVALID_AUTHORITY_RESOLUTION_TASK_REVISION'),
    operationId: text(input.operationId, 'INVALID_AUTHORITY_RESOLUTION_OPERATION') as OperationId,
    decisionId: text(input.decisionId, 'INVALID_AUTHORITY_RESOLUTION_DECISION') as AuthorityDecisionId,
    operationDigest: digest(input.operationDigest, 'INVALID_AUTHORITY_RESOLUTION_DIGEST'),
    resolutionDigest: digest(input.resolutionDigest, 'INVALID_AUTHORITY_RESOLUTION_RESULT_DIGEST')
  };
}

function parseAuthorityConsumption(value: unknown): AuthorityConsumptionRef {
  const input = record(value, [
    'kind', 'id', 'workspaceId', 'taskId', 'taskRevision', 'attemptId', 'transactionId',
    'operationId', 'operationDigest', 'decisionId', 'actorRef', 'consumptionDigest'
  ], 'AUTHORITY_CONSUMPTION');
  if (input.kind !== 'authority-consumption') return fail('INVALID_AUTHORITY_CONSUMPTION_KIND');
  return {
    kind: 'authority-consumption',
    id: text(input.id, 'INVALID_AUTHORITY_CONSUMPTION_ID'),
    workspaceId: text(input.workspaceId, 'INVALID_AUTHORITY_CONSUMPTION_WORKSPACE') as WorkspaceId,
    taskId: text(input.taskId, 'INVALID_AUTHORITY_CONSUMPTION_TASK') as TaskId,
    taskRevision: revision(input.taskRevision, 'INVALID_AUTHORITY_CONSUMPTION_TASK_REVISION'),
    attemptId: text(input.attemptId, 'INVALID_AUTHORITY_CONSUMPTION_ATTEMPT') as WorkerAttemptId,
    transactionId: text(input.transactionId, 'INVALID_AUTHORITY_CONSUMPTION_TRANSACTION') as HarnessTransactionId,
    operationId: text(input.operationId, 'INVALID_AUTHORITY_CONSUMPTION_OPERATION') as OperationId,
    operationDigest: digest(input.operationDigest, 'INVALID_AUTHORITY_CONSUMPTION_DIGEST'),
    decisionId: text(input.decisionId, 'INVALID_AUTHORITY_CONSUMPTION_DECISION') as AuthorityDecisionId,
    actorRef: text(input.actorRef, 'INVALID_AUTHORITY_CONSUMPTION_ACTOR', 512),
    consumptionDigest: digest(input.consumptionDigest, 'INVALID_AUTHORITY_CONSUMPTION_RESULT_DIGEST')
  };
}

function parseClassificationSource(value: unknown): TrustedOperationClassification['sources'][number] {
  const input = record(value, ['source', 'effectiveClass', 'revision', 'digest'], 'CLASSIFICATION_SOURCE');
  return {
    source: oneOf(input.source, ['descriptor', 'route_policy', 'target_resolver', 'execution_policy'], 'INVALID_CLASSIFICATION_SOURCE'),
    effectiveClass: oneOf(input.effectiveClass, OPERATION_CLASSES, 'INVALID_CLASSIFICATION_CLASS'),
    revision: positiveRevision(input.revision, 'INVALID_CLASSIFICATION_REVISION'),
    digest: digest(input.digest, 'INVALID_CLASSIFICATION_DIGEST')
  };
}

function parseClassification(value: unknown): TrustedOperationClassification {
  const input = record(value, ['effectiveClass', 'sources', 'derivationDigest', 'callerAssertion'], 'CLASSIFICATION');
  const sourceValues = list(input.sources, 'CLASSIFICATION_SOURCES', 8).map(item => parseClassificationSource(item));
  if (sourceValues.length < 1) return fail('INVALID_CLASSIFICATION_SOURCES');
  unique(sourceValues.map(source => source.source), 'DUPLICATE_CLASSIFICATION_SOURCE');
  const effectiveClass = oneOf(input.effectiveClass, OPERATION_CLASSES, 'INVALID_CLASSIFICATION_CLASS');
  if (sourceValues.some(source => source.effectiveClass !== effectiveClass)) return fail('CLASSIFICATION_CONFLICT');
  const callerAssertion = has(input, 'callerAssertion') ? oneOf(input.callerAssertion, OPERATION_CLASSES, 'INVALID_CLASSIFICATION_ASSERTION') : undefined;
  if (callerAssertion !== undefined && callerAssertion !== effectiveClass) return fail('CLASSIFICATION_CONFLICT');
  return {
    effectiveClass,
    sources: sourceValues,
    derivationDigest: digest(input.derivationDigest, 'INVALID_CLASSIFICATION_DERIVATION_DIGEST'),
    ...(callerAssertion === undefined ? {} : { callerAssertion })
  };
}

function parseOperation(value: unknown): TrustedOperationBinding {
  const input = record(value, ['operation', 'classification', 'operationDigest', 'targetDigest', 'effectScopeDigest'], 'OPERATION');
  const operation = parseAuthorityOperation(input.operation);
  const classification = parseClassification(input.classification);
  const operationDigest = digest(input.operationDigest, 'INVALID_OPERATION_BINDING_DIGEST');
  const targetDigest = digest(input.targetDigest, 'INVALID_OPERATION_BINDING_TARGET_DIGEST');
  const effectScopeDigest = digest(input.effectScopeDigest, 'INVALID_OPERATION_EFFECT_SCOPE_DIGEST');
  if (operationDigest !== operation.operationDigest || targetDigest !== operation.targetDigest) return fail('OPERATION_DIGEST_MISMATCH');
  const isReadOnly = classification.effectiveClass === 'read_only';
  if ((isReadOnly && operation.effectClass !== 'read_only') || (!isReadOnly && operation.effectClass !== 'mutation')) return fail('CLASSIFICATION_CONFLICT');
  return { operation, classification, operationDigest, targetDigest, effectScopeDigest };
}

function parseTarget(value: unknown): ResolvedTargetRef {
  const input = record(value, [
    'kind', 'id', 'workspaceId', 'taskId', 'taskRevision', 'operationId', 'targetKind',
    'targetIdentityDigest', 'effectScopeDigest', 'resolverRevision', 'locatorRef'
  ], 'TARGET');
  if (input.kind !== 'resolved-target') return fail('INVALID_TARGET_KIND');
  const locatorRef = optionalText(input, 'locatorRef', 'INVALID_TARGET_LOCATOR', 512);
  return {
    kind: 'resolved-target',
    id: text(input.id, 'INVALID_TARGET_ID'),
    workspaceId: text(input.workspaceId, 'INVALID_TARGET_WORKSPACE') as WorkspaceId,
    taskId: text(input.taskId, 'INVALID_TARGET_TASK') as TaskId,
    taskRevision: revision(input.taskRevision, 'INVALID_TARGET_TASK_REVISION'),
    operationId: text(input.operationId, 'INVALID_TARGET_OPERATION') as OperationId,
    targetKind: oneOf(input.targetKind, TARGET_KINDS, 'INVALID_TARGET_KIND'),
    targetIdentityDigest: digest(input.targetIdentityDigest, 'INVALID_TARGET_IDENTITY_DIGEST'),
    effectScopeDigest: digest(input.effectScopeDigest, 'INVALID_TARGET_EFFECT_SCOPE_DIGEST'),
    resolverRevision: positiveRevision(input.resolverRevision, 'INVALID_TARGET_RESOLVER_REVISION'),
    ...(locatorRef === undefined ? {} : { locatorRef })
  };
}

function parseContext(value: unknown): ContextEnvelopeBinding {
  const input = record(value, [
    'kind', 'envelopeId', 'envelopeDigest', 'requestId', 'workspaceId', 'taskId', 'taskRevision'
  ], 'CONTEXT');
  if (input.kind !== 'context-envelope') return fail('INVALID_CONTEXT_KIND');
  return {
    kind: 'context-envelope',
    envelopeId: text(input.envelopeId, 'INVALID_CONTEXT_ENVELOPE_ID'),
    envelopeDigest: digest(input.envelopeDigest, 'INVALID_CONTEXT_ENVELOPE_DIGEST'),
    requestId: text(input.requestId, 'INVALID_CONTEXT_REQUEST') as HarnessExecutionRequest['requestId'],
    workspaceId: text(input.workspaceId, 'INVALID_CONTEXT_WORKSPACE') as WorkspaceId,
    taskId: text(input.taskId, 'INVALID_CONTEXT_TASK') as TaskId,
    taskRevision: revision(input.taskRevision, 'INVALID_CONTEXT_TASK_REVISION')
  };
}

function parseMethodologyReference(value: unknown): MethodologyReference {
  const input = record(value, ['kind', 'id', 'version', 'workspaceId', 'taskId', 'taskRevision', 'digest'], 'METHODOLOGY_REFERENCE');
  return {
    kind: oneOf(input.kind, ['workflow', 'skill'], 'INVALID_METHODOLOGY_KIND'),
    id: text(input.id, 'INVALID_METHODOLOGY_ID'),
    version: text(input.version, 'INVALID_METHODOLOGY_VERSION', 128),
    workspaceId: text(input.workspaceId, 'INVALID_METHODOLOGY_WORKSPACE') as WorkspaceId,
    taskId: text(input.taskId, 'INVALID_METHODOLOGY_TASK') as TaskId,
    taskRevision: revision(input.taskRevision, 'INVALID_METHODOLOGY_TASK_REVISION'),
    digest: digest(input.digest, 'INVALID_METHODOLOGY_DIGEST')
  };
}

function parseMethodology(value: unknown): MethodologyBinding {
  const input = record(value, ['workflowRefs', 'skillRefs', 'selectionDigest'], 'METHODOLOGY');
  const workflowRefs = list(input.workflowRefs, 'WORKFLOW_REFERENCES', 128).map(parseMethodologyReference);
  const skillRefs = list(input.skillRefs, 'SKILL_REFERENCES', 256).map(parseMethodologyReference);
  if (workflowRefs.some(ref => ref.kind !== 'workflow') || skillRefs.some(ref => ref.kind !== 'skill')) return fail('METHODOLOGY_KIND_MISMATCH');
  unique([...workflowRefs, ...skillRefs].map(ref => `${ref.kind}\u0000${ref.id}\u0000${ref.version}`), 'DUPLICATE_METHODOLOGY_REFERENCE');
  return { workflowRefs, skillRefs, selectionDigest: digest(input.selectionDigest, 'INVALID_METHODOLOGY_SELECTION_DIGEST') };
}

function parseWorkerSelection(value: unknown): WorkerSelectionRef {
  const input = record(value, [
    'kind', 'id', 'selectionDigest', 'workspaceId', 'taskId', 'taskRevision', 'attemptId',
    'roleIdentity', 'modelIdentity', 'modelRevision', 'provider', 'locality', 'selectionRevision'
  ], 'WORKER_SELECTION');
  if (input.kind !== 'worker-selection') return fail('INVALID_WORKER_SELECTION_KIND');
  return {
    kind: 'worker-selection',
    id: text(input.id, 'INVALID_WORKER_SELECTION_ID'),
    selectionDigest: digest(input.selectionDigest, 'INVALID_WORKER_SELECTION_DIGEST'),
    workspaceId: text(input.workspaceId, 'INVALID_WORKER_SELECTION_WORKSPACE') as WorkspaceId,
    taskId: text(input.taskId, 'INVALID_WORKER_SELECTION_TASK') as TaskId,
    taskRevision: revision(input.taskRevision, 'INVALID_WORKER_SELECTION_TASK_REVISION'),
    attemptId: text(input.attemptId, 'INVALID_WORKER_SELECTION_ATTEMPT') as WorkerAttemptId,
    roleIdentity: text(input.roleIdentity, 'INVALID_WORKER_ROLE', 256),
    modelIdentity: text(input.modelIdentity, 'INVALID_WORKER_MODEL', 256),
    modelRevision: text(input.modelRevision, 'INVALID_WORKER_MODEL_REVISION', 256),
    provider: text(input.provider, 'INVALID_WORKER_PROVIDER', 256),
    locality: oneOf(input.locality, ['local', 'remote'], 'INVALID_WORKER_LOCALITY'),
    selectionRevision: positiveRevision(input.selectionRevision, 'INVALID_WORKER_SELECTION_REVISION')
  };
}

function parseAuthority(value: unknown): AuthorityRequestBinding {
  const input = record(value, ['mode', 'decision'], 'AUTHORITY');
  const mode = oneOf(input.mode, AUTHORITY_MODES, 'INVALID_AUTHORITY_MODE');
  // Even read-only execution is represented by a canonical decision/reference
  // (normally an automatically resolved read policy).  "Not required" means
  // no operator approval ceremony, never no authority record.
  if (!has(input, 'decision')) return fail('AUTHORITY_MISMATCH');
  return { mode, decision: parseAuthorityDecision(input.decision) };
}

function parsePolicyRef(value: unknown): EffectiveCheckpointPolicyRef {
  const input = record(value, ['kind', 'id', 'workspaceId', 'taskId', 'taskRevision', 'operationClass', 'revision', 'digest'], 'CHECKPOINT_POLICY');
  if (input.kind !== 'checkpoint-policy') return fail('INVALID_CHECKPOINT_POLICY_KIND');
  return {
    kind: 'checkpoint-policy',
    id: text(input.id, 'INVALID_CHECKPOINT_POLICY_ID'),
    workspaceId: text(input.workspaceId, 'INVALID_CHECKPOINT_POLICY_WORKSPACE') as WorkspaceId,
    taskId: text(input.taskId, 'INVALID_CHECKPOINT_POLICY_TASK') as TaskId,
    taskRevision: revision(input.taskRevision, 'INVALID_CHECKPOINT_POLICY_TASK_REVISION'),
    operationClass: oneOf(input.operationClass, OPERATION_CLASSES, 'INVALID_CHECKPOINT_POLICY_CLASS'),
    revision: positiveRevision(input.revision, 'INVALID_CHECKPOINT_POLICY_REVISION'),
    digest: digest(input.digest, 'INVALID_CHECKPOINT_POLICY_DIGEST')
  };
}

function parseCheckpoint(value: unknown): CheckpointRequestBinding {
  const input = record(value, ['requestedPreference', 'effectiveRequirement', 'policy', 'availability'], 'CHECKPOINT');
  return {
    requestedPreference: oneOf(input.requestedPreference, CHECKPOINT_PREFERENCES, 'INVALID_CHECKPOINT_PREFERENCE'),
    effectiveRequirement: oneOf(input.effectiveRequirement, CHECKPOINT_REQUIREMENTS, 'INVALID_CHECKPOINT_REQUIREMENT'),
    policy: parsePolicyRef(input.policy),
    availability: oneOf(input.availability, ['available', 'unavailable'], 'INVALID_CHECKPOINT_AVAILABILITY')
  };
}

function parseBudget(value: unknown): ResourceBudgetBinding {
  const input = record(value, [
    'kind', 'budgetId', 'budgetDigest', 'workspaceId', 'taskId', 'taskRevision',
    'transactionId', 'revision', 'limits', 'enforcement'
  ], 'RESOURCE_BUDGET');
  if (input.kind !== 'resource-budget') return fail('INVALID_BUDGET_KIND');
  const limits = record(input.limits, ['wallTimeMs', 'outputBytes', 'processCount', 'modelContextTokens', 'mutationCount'], 'RESOURCE_LIMITS');
  return {
    kind: 'resource-budget',
    budgetId: text(input.budgetId, 'INVALID_BUDGET_ID'),
    budgetDigest: digest(input.budgetDigest, 'INVALID_BUDGET_DIGEST'),
    workspaceId: text(input.workspaceId, 'INVALID_BUDGET_WORKSPACE') as WorkspaceId,
    taskId: text(input.taskId, 'INVALID_BUDGET_TASK') as TaskId,
    taskRevision: revision(input.taskRevision, 'INVALID_BUDGET_TASK_REVISION'),
    transactionId: text(input.transactionId, 'INVALID_BUDGET_TRANSACTION') as HarnessTransactionIdentity['transactionId'],
    revision: positiveRevision(input.revision, 'INVALID_BUDGET_REVISION'),
    limits: {
      wallTimeMs: safeInteger(limits.wallTimeMs, 'INVALID_BUDGET_WALL_TIME', 1, 604_800_000),
      outputBytes: safeInteger(limits.outputBytes, 'INVALID_BUDGET_OUTPUT_BYTES', 0, 1_000_000_000),
      processCount: safeInteger(limits.processCount, 'INVALID_BUDGET_PROCESS_COUNT', 0, 10_000),
      modelContextTokens: safeInteger(limits.modelContextTokens, 'INVALID_BUDGET_CONTEXT_TOKENS', 0, 100_000_000),
      mutationCount: safeInteger(limits.mutationCount, 'INVALID_BUDGET_MUTATION_COUNT', 0, 1_000_000)
    },
    enforcement: oneOf(input.enforcement, ['hard', 'advisory'], 'INVALID_BUDGET_ENFORCEMENT')
  };
}

function parseEvidenceRequirements(value: unknown): EvidenceRequirementBinding {
  const input = record(value, ['requested', 'effectiveMinimum', 'policyRevision', 'policyDigest'], 'EVIDENCE_REQUIREMENTS');
  const requested = unique(list(input.requested, 'REQUESTED_EVIDENCE', 32).map(item => oneOf(item, EVIDENCE_REQUIREMENTS, 'INVALID_REQUESTED_EVIDENCE')), 'DUPLICATE_REQUESTED_EVIDENCE');
  const effectiveMinimum = unique(list(input.effectiveMinimum, 'EFFECTIVE_EVIDENCE', 32).map(item => oneOf(item, EVIDENCE_REQUIREMENTS, 'INVALID_EFFECTIVE_EVIDENCE')), 'DUPLICATE_EFFECTIVE_EVIDENCE');
  if (requested.some(item => !effectiveMinimum.includes(item))) return fail('POLICY_CONFLICT');
  return {
    requested,
    effectiveMinimum,
    policyRevision: positiveRevision(input.policyRevision, 'INVALID_EVIDENCE_POLICY_REVISION'),
    policyDigest: digest(input.policyDigest, 'INVALID_EVIDENCE_POLICY_DIGEST')
  };
}

function parseCancellation(value: unknown): CancellationRequestIntent {
  const input = record(value, ['requested', 'reasonRef', 'stopScheduling'], 'CANCELLATION');
  const reasonRef = optionalText(input, 'reasonRef', 'INVALID_CANCELLATION_REASON', 512);
  return {
    requested: input.requested === true ? true : input.requested === false ? false : fail('INVALID_CANCELLATION_REQUEST'),
    stopScheduling: input.stopScheduling === true ? true : input.stopScheduling === false ? false : fail('INVALID_CANCELLATION_SCHEDULING'),
    ...(reasonRef === undefined ? {} : { reasonRef })
  };
}

function parseRetryParent(value: unknown): RetryParentTransactionRef {
  const input = record(value, [
    'kind', 'parentRequestId', 'workspaceId', 'taskId', 'parentTaskRevision', 'parentAttemptId', 'parentTransactionId',
    'parentAuthorityDecisionId', 'parentTerminalState', 'parentEffectCertainty', 'parentResultRef'
  ], 'RETRY_PARENT');
  if (input.kind !== 'retry-parent') return fail('INVALID_RETRY_PARENT_KIND');
  const parentResultRef = has(input, 'parentResultRef') ? parseResultRef(input.parentResultRef, 'PARENT_RESULT') : undefined;
  return {
    kind: 'retry-parent',
    parentRequestId: text(input.parentRequestId, 'INVALID_RETRY_PARENT_REQUEST') as HarnessExecutionRequest['requestId'],
    workspaceId: text(input.workspaceId, 'INVALID_RETRY_PARENT_WORKSPACE') as WorkspaceId,
    taskId: text(input.taskId, 'INVALID_RETRY_PARENT_TASK') as TaskId,
    parentTaskRevision: revision(input.parentTaskRevision, 'INVALID_RETRY_PARENT_REVISION'),
    parentAttemptId: text(input.parentAttemptId, 'INVALID_RETRY_PARENT_ATTEMPT') as WorkerAttemptId,
    parentTransactionId: text(input.parentTransactionId, 'INVALID_RETRY_PARENT_TRANSACTION') as HarnessTransactionIdentity['transactionId'],
    parentAuthorityDecisionId: text(input.parentAuthorityDecisionId, 'INVALID_RETRY_PARENT_AUTHORITY') as AuthorityDecisionId,
    parentTerminalState: oneOf(input.parentTerminalState, ['committed', 'rejected', 'rolled_back', 'failed'], 'INVALID_RETRY_PARENT_STATE'),
    parentEffectCertainty: oneOf(input.parentEffectCertainty, ['none', 'known_partial', 'known_complete', 'unknown'], 'INVALID_RETRY_PARENT_EFFECT'),
    ...(parentResultRef === undefined ? {} : { parentResultRef })
  };
}

function parseRetry(value: unknown): RetryLineage {
  const input = record(value, ['kind', 'parent', 'freshAuthorityRequired', 'freshCheckpointRequired', 'freshEvidenceRequired'], 'RETRY');
  if (input.freshAuthorityRequired !== true || input.freshEvidenceRequired !== true) return fail('INVALID_RETRY_FRESHNESS');
  return {
    kind: oneOf(input.kind, RETRY_KINDS, 'INVALID_RETRY_KIND'),
    parent: parseRetryParent(input.parent),
    freshAuthorityRequired: true,
    freshCheckpointRequired: input.freshCheckpointRequired === true ? true : input.freshCheckpointRequired === false ? false : fail('INVALID_RETRY_CHECKPOINT_FRESHNESS'),
    freshEvidenceRequired: true
  };
}

function validateOperationAndTarget(operation: TrustedOperationBinding, target: ResolvedTargetRef, scope: { workspaceId: WorkspaceId; taskId: TaskId; taskRevision: TaskRevision }): void {
  if (operation.operation.workspaceId !== scope.workspaceId || operation.operation.taskId !== scope.taskId || operation.operation.taskRevision !== scope.taskRevision) return fail('SCOPE_MISMATCH');
  if (target.workspaceId !== scope.workspaceId || target.taskId !== scope.taskId || target.taskRevision !== scope.taskRevision) return fail('SCOPE_MISMATCH');
  if (target.operationId !== operation.operation.id || operation.operation.targetDigest !== target.targetIdentityDigest || operation.targetDigest !== target.targetIdentityDigest || operation.effectScopeDigest !== target.effectScopeDigest) return fail('OPERATION_DIGEST_MISMATCH');
  const expectedKind = expectedTargetKind(operation.classification.effectiveClass);
  if (expectedKind !== null && target.targetKind !== expectedKind) return fail('SCOPE_MISMATCH');
}

function validateAuthority(authority: AuthorityRequestBinding, operation: TrustedOperationBinding, scope: { workspaceId: WorkspaceId; taskId: TaskId; taskRevision: TaskRevision }): void {
  const isMutation = operation.operation.effectClass === 'mutation';
  if (isMutation && authority.mode !== 'decision_required') return fail('AUTHORITY_MISMATCH');
  if (!authority.decision) return;
  const decision = authority.decision;
  if (decision.workspaceId !== scope.workspaceId || decision.taskId !== scope.taskId || decision.taskRevision !== scope.taskRevision || decision.operationId !== operation.operation.id || decision.operationDigest !== operation.operationDigest || decision.targetDigest !== operation.targetDigest || decision.descriptorRevision !== operation.operation.descriptorRevision) return fail('AUTHORITY_MISMATCH');
}

function validateCheckpointRequest(checkpoint: CheckpointRequestBinding, operation: TrustedOperationBinding, scope: { workspaceId: WorkspaceId; taskId: TaskId; taskRevision: TaskRevision }): void {
  if (checkpoint.policy.workspaceId !== scope.workspaceId || checkpoint.policy.taskId !== scope.taskId || checkpoint.policy.taskRevision !== scope.taskRevision || checkpoint.policy.operationClass !== operation.classification.effectiveClass) return fail('CHECKPOINT_MISMATCH');
  if (operation.operation.effectClass === 'mutation' && checkpoint.effectiveRequirement === 'not_applicable') return fail('CHECKPOINT_MISSING');
  if (checkpoint.availability === 'unavailable' && checkpoint.effectiveRequirement !== 'not_applicable') return fail('CHECKPOINT_UNAVAILABLE');
}

function validateBudget(budget: ResourceBudgetBinding, identity: { workspaceId: WorkspaceId; taskId: TaskId; taskRevision: TaskRevision; transactionId: HarnessTransactionIdentity['transactionId'] }): void {
  if (budget.workspaceId !== identity.workspaceId || budget.taskId !== identity.taskId || budget.taskRevision !== identity.taskRevision || budget.transactionId !== identity.transactionId) return fail('SCOPE_MISMATCH');
}

function validateRetry(retry: RetryLineage | undefined, identity: HarnessTransactionIdentity): void {
  if (!retry) return;
  const parent = retry.parent;
  if (parent.parentRequestId === identity.requestId || parent.workspaceId !== identity.workspaceId || parent.taskId !== identity.taskId || parent.parentAttemptId === identity.attemptId || parent.parentTransactionId === identity.transactionId) return fail('SCOPE_MISMATCH');
  if (retry.kind === 'same-task-revision-retry' && parent.parentTaskRevision !== identity.taskRevision) return fail('STALE_REVISION');
  if (retry.kind === 'reconsidered-task-retry' && parent.parentTaskRevision >= identity.taskRevision) return fail('STALE_REVISION');
  if (parent.parentEffectCertainty !== 'none' && parent.parentTerminalState !== 'rolled_back') return fail('UNKNOWN_EFFECT');
  if (parent.parentEffectCertainty !== 'none' && !parent.parentResultRef) return fail('RESULT_SCOPE_MISMATCH');
  if (parent.parentResultRef && (parent.parentResultRef.workspaceId !== identity.workspaceId || parent.parentResultRef.taskId !== identity.taskId || parent.parentResultRef.taskRevision !== parent.parentTaskRevision || parent.parentResultRef.attemptId !== parent.parentAttemptId || parent.parentResultRef.transactionId !== parent.parentTransactionId)) return fail('RESULT_SCOPE_MISMATCH');
  if (parent.parentResultRef && parent.parentResultRef.effectCertainty !== parent.parentEffectCertainty) return fail('RESULT_SCOPE_MISMATCH');
}

function parseRequest(value: unknown, withDigest: boolean): HarnessExecutionRequest {
  const allowed = [
    'schemaVersion', 'serialization', 'requestId', 'workspaceId', 'taskId', 'taskRevision', 'attemptId', 'transactionId',
    'correlationId', 'causationId', 'context', 'methodology', 'workerSelection', 'operation', 'target', 'authority',
    'checkpoint', 'resourceBudget', 'evidence', 'retry', 'cancellation', ...(withDigest ? ['requestDigest'] : [])
  ];
  const input = record(value, allowed, 'REQUEST');
  if (input.schemaVersion !== HARNESS_EXECUTION_SCHEMA_VERSION || input.serialization !== HARNESS_EXECUTION_SERIALIZATION) return fail('INVALID_REQUEST_HEADER');
  if (withDigest && !has(input, 'requestDigest')) return fail('REQUEST_DIGEST_MISSING');
  if (!withDigest && has(input, 'requestDigest')) return fail('REQUEST_RUNTIME_FIELD');
  const requestId = text(input.requestId, 'INVALID_REQUEST_ID') as HarnessExecutionRequest['requestId'];
  const workspaceId = text(input.workspaceId, 'INVALID_WORKSPACE_ID') as WorkspaceId;
  const taskId = text(input.taskId, 'INVALID_TASK_ID') as TaskId;
  const taskRevision = revision(input.taskRevision, 'INVALID_TASK_REVISION');
  const attemptId = text(input.attemptId, 'INVALID_ATTEMPT_ID') as WorkerAttemptId;
  const transactionId = text(input.transactionId, 'INVALID_TRANSACTION_ID') as HarnessTransactionIdentity['transactionId'];
  const context = parseContext(input.context);
  const methodology = parseMethodology(input.methodology);
  const workerSelection = parseWorkerSelection(input.workerSelection);
  const operation = parseOperation(input.operation);
  const target = parseTarget(input.target);
  const authority = parseAuthority(input.authority);
  const checkpoint = parseCheckpoint(input.checkpoint);
  const resourceBudget = parseBudget(input.resourceBudget);
  const evidence = parseEvidenceRequirements(input.evidence);
  const retry = has(input, 'retry') ? parseRetry(input.retry) : undefined;
  const cancellation = parseCancellation(input.cancellation);
  const scope = { workspaceId, taskId, taskRevision };
  validateOperationAndTarget(operation, target, scope);
  validateAuthority(authority, operation, scope);
  validateCheckpointRequest(checkpoint, operation, scope);
  validateBudget(resourceBudget, { ...scope, transactionId });
  if (context.requestId !== requestId || context.workspaceId !== workspaceId || context.taskId !== taskId || context.taskRevision !== taskRevision) return fail('SCOPE_MISMATCH');
  if (workerSelection.workspaceId !== workspaceId || workerSelection.taskId !== taskId || workerSelection.taskRevision !== taskRevision || workerSelection.attemptId !== attemptId) return fail('SCOPE_MISMATCH');
  for (const ref of [...methodology.workflowRefs, ...methodology.skillRefs]) {
    if (ref.workspaceId !== workspaceId || ref.taskId !== taskId || ref.taskRevision !== taskRevision) return fail('SCOPE_MISMATCH');
  }
  validateRetry(retry, { workspaceId, taskId, taskRevision, attemptId, transactionId, requestId });
  if (retry && authority.decision && retry.parent.parentAuthorityDecisionId === authority.decision.id) return fail('AUTHORITY_REPLAY');
  const base: Omit<HarnessExecutionRequest, 'requestDigest'> = {
    schemaVersion: HARNESS_EXECUTION_SCHEMA_VERSION,
    serialization: HARNESS_EXECUTION_SERIALIZATION,
    requestId, workspaceId, taskId, taskRevision, attemptId, transactionId,
    correlationId: text(input.correlationId, 'INVALID_CORRELATION_ID'),
    causationId: nullableText(input.causationId, 'INVALID_CAUSATION_ID'),
    context, methodology, workerSelection, operation, target, authority, checkpoint, resourceBudget, evidence,
    ...(retry === undefined ? {} : { retry }),
    cancellation
  };
  if (!withDigest) return base as HarnessExecutionRequest;
  const supplied = digest(input.requestDigest, 'INVALID_REQUEST_DIGEST');
  return { ...base, requestDigest: supplied };
}

function withoutRequestDigest(request: HarnessExecutionRequest): Omit<HarnessExecutionRequest, 'requestDigest'> {
  const { requestDigest: _requestDigest, ...unsigned } = request;
  void _requestDigest;
  return unsigned;
}

async function sha256(value: string): Promise<Digest> {
  if (!globalThis.crypto?.subtle) return fail('CRYPTO_UNAVAILABLE');
  const bytes = new TextEncoder().encode(value);
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('') as Digest;
}

function parseEvidenceRef(value: unknown, label = 'EVIDENCE'): ScopedEvidenceRef {
  const input = record(value, [
    'kind', 'id', 'evidenceType', 'owner', 'workspaceId', 'taskId', 'taskRevision',
    'attemptId', 'transactionId', 'digest'
  ], label);
  if (input.kind !== 'evidence') return fail('INVALID_' + label + '_KIND');
  return {
    kind: 'evidence',
    id: text(input.id, 'INVALID_' + label + '_ID') as import('../contracts/harness-execution.ts').EvidenceId,
    evidenceType: oneOf(input.evidenceType, EVIDENCE_TYPES, 'INVALID_' + label + '_TYPE'),
    owner: oneOf(input.owner, EVIDENCE_OWNERS, 'INVALID_' + label + '_OWNER'),
    workspaceId: text(input.workspaceId, 'INVALID_' + label + '_WORKSPACE') as WorkspaceId,
    taskId: text(input.taskId, 'INVALID_' + label + '_TASK') as TaskId,
    taskRevision: revision(input.taskRevision, 'INVALID_' + label + '_TASK_REVISION'),
    attemptId: text(input.attemptId, 'INVALID_' + label + '_ATTEMPT') as WorkerAttemptId,
    transactionId: text(input.transactionId, 'INVALID_' + label + '_TRANSACTION') as HarnessTransactionIdentity['transactionId'],
    digest: digest(input.digest, 'INVALID_' + label + '_DIGEST')
  };
}

function parseResultRef(value: unknown, label = 'RESULT_REFERENCE'): ExecutionResultRef {
  const input = record(value, [
    'kind', 'id', 'workspaceId', 'taskId', 'taskRevision', 'attemptId', 'transactionId',
    'effectCertainty', 'resultDigest'
  ], label);
  if (input.kind !== 'execution-result') return fail('INVALID_' + label + '_KIND');
  const resultDigest = has(input, 'resultDigest') ? digest(input.resultDigest, 'INVALID_' + label + '_DIGEST') : undefined;
  return {
    kind: 'execution-result',
    id: text(input.id, 'INVALID_' + label + '_ID') as ExecutionResultId,
    workspaceId: text(input.workspaceId, 'INVALID_' + label + '_WORKSPACE') as WorkspaceId,
    taskId: text(input.taskId, 'INVALID_' + label + '_TASK') as TaskId,
    taskRevision: revision(input.taskRevision, 'INVALID_' + label + '_TASK_REVISION'),
    attemptId: text(input.attemptId, 'INVALID_' + label + '_ATTEMPT') as WorkerAttemptId,
    transactionId: text(input.transactionId, 'INVALID_' + label + '_TRANSACTION') as HarnessTransactionIdentity['transactionId'],
    effectCertainty: oneOf(input.effectCertainty, ['none', 'known_partial', 'known_complete', 'unknown'], 'INVALID_' + label + '_EFFECT'),
    ...(resultDigest === undefined ? {} : { resultDigest })
  };
}

function parseCheckpointObservation(value: unknown): CheckpointObservation {
  const input = record(value, ['kind', 'checkpoint', 'preparation'], 'CHECKPOINT_OBSERVATION');
  const kind = oneOf(input.kind, ['not_applicable', 'bound', 'compensation_only'], 'INVALID_CHECKPOINT_OBSERVATION_KIND');
  const keys = Object.keys(input);
  if (kind === 'not_applicable') {
    if (keys.some(key => key !== 'kind')) return fail('INVALID_CHECKPOINT_OBSERVATION_FIELDS');
    return { kind };
  }
  if (kind === 'bound') {
    if (keys.some(key => key !== 'kind' && key !== 'checkpoint') || !has(input, 'checkpoint')) return fail('INVALID_CHECKPOINT_OBSERVATION_FIELDS');
    return { kind, checkpoint: parseTransactionCheckpoint(input.checkpoint) };
  }
  if (keys.some(key => key !== 'kind' && key !== 'preparation') || !has(input, 'preparation')) return fail('INVALID_CHECKPOINT_OBSERVATION_FIELDS');
  return { kind, preparation: parseCompensationPreparation(input.preparation) };
}

function parseTransactionCheckpoint(value: unknown): TransactionCheckpointRef {
  const input = record(value, [
    'kind', 'id', 'workspaceId', 'taskId', 'taskRevision', 'transactionId', 'snapshotRef',
    'mutationScopeDigest', 'checkpointDigest'
  ], 'TRANSACTION_CHECKPOINT');
  if (input.kind !== 'transaction-checkpoint') return fail('INVALID_TRANSACTION_CHECKPOINT_KIND');
  return {
    kind: 'transaction-checkpoint',
    id: text(input.id, 'INVALID_TRANSACTION_CHECKPOINT_ID') as import('../contracts/harness-execution.ts').CheckpointId,
    workspaceId: text(input.workspaceId, 'INVALID_TRANSACTION_CHECKPOINT_WORKSPACE') as WorkspaceId,
    taskId: text(input.taskId, 'INVALID_TRANSACTION_CHECKPOINT_TASK') as TaskId,
    taskRevision: revision(input.taskRevision, 'INVALID_TRANSACTION_CHECKPOINT_TASK_REVISION'),
    transactionId: text(input.transactionId, 'INVALID_TRANSACTION_CHECKPOINT_TRANSACTION') as HarnessTransactionIdentity['transactionId'],
    snapshotRef: text(input.snapshotRef, 'INVALID_TRANSACTION_CHECKPOINT_SNAPSHOT'),
    mutationScopeDigest: digest(input.mutationScopeDigest, 'INVALID_TRANSACTION_CHECKPOINT_SCOPE_DIGEST'),
    checkpointDigest: digest(input.checkpointDigest, 'INVALID_TRANSACTION_CHECKPOINT_DIGEST')
  };
}

function parseCompensationPreparation(value: unknown): CompensationPreparationRef {
  const input = record(value, [
    'kind', 'id', 'workspaceId', 'taskId', 'taskRevision', 'transactionId',
    'mutationScopeDigest', 'preparationDigest'
  ], 'COMPENSATION_PREPARATION');
  if (input.kind !== 'compensation-preparation') return fail('INVALID_COMPENSATION_KIND');
  return {
    kind: 'compensation-preparation',
    id: text(input.id, 'INVALID_COMPENSATION_ID'),
    workspaceId: text(input.workspaceId, 'INVALID_COMPENSATION_WORKSPACE') as WorkspaceId,
    taskId: text(input.taskId, 'INVALID_COMPENSATION_TASK') as TaskId,
    taskRevision: revision(input.taskRevision, 'INVALID_COMPENSATION_TASK_REVISION'),
    transactionId: text(input.transactionId, 'INVALID_COMPENSATION_TRANSACTION') as HarnessTransactionIdentity['transactionId'],
    mutationScopeDigest: digest(input.mutationScopeDigest, 'INVALID_COMPENSATION_SCOPE_DIGEST'),
    preparationDigest: digest(input.preparationDigest, 'INVALID_COMPENSATION_DIGEST')
  };
}

function parseEvidenceSnapshot(value: unknown): EvidenceRequirementsSnapshot {
  const input = record(value, ['effectiveMinimum', 'evidenceRefs', 'manifestRef'], 'EVIDENCE_SNAPSHOT');
  const effectiveMinimum = unique(list(input.effectiveMinimum, 'SNAPSHOT_EFFECTIVE_EVIDENCE', 32).map(item => oneOf(item, EVIDENCE_REQUIREMENTS, 'INVALID_SNAPSHOT_EVIDENCE')), 'DUPLICATE_SNAPSHOT_EVIDENCE');
  const evidenceRefs = list(input.evidenceRefs, 'SNAPSHOT_EVIDENCE_REFS', 256).map(item => parseEvidenceRef(item, 'SNAPSHOT_EVIDENCE'));
  const manifestRef = parseEvidenceRef(input.manifestRef, 'SNAPSHOT_MANIFEST');
  if (manifestRef.evidenceType !== 'evidence-manifest') return fail('EVIDENCE_INCOMPLETE');
  return { effectiveMinimum, evidenceRefs, manifestRef };
}

function parseFailure(value: unknown): FailureRef {
  const input = record(value, ['kind', 'id', 'code', 'workspaceId', 'taskId', 'taskRevision', 'attemptId', 'transactionId', 'evidenceRef'], 'FAILURE');
  if (input.kind !== 'failure') return fail('INVALID_FAILURE_KIND');
  const evidenceRef = has(input, 'evidenceRef') ? parseEvidenceRef(input.evidenceRef, 'FAILURE_EVIDENCE') : undefined;
  return {
    kind: 'failure', id: text(input.id, 'INVALID_FAILURE_ID'), code: oneOf(input.code, FAILURE_CODES, 'INVALID_FAILURE_CODE'),
    workspaceId: text(input.workspaceId, 'INVALID_FAILURE_WORKSPACE') as WorkspaceId,
    taskId: text(input.taskId, 'INVALID_FAILURE_TASK') as TaskId,
    taskRevision: revision(input.taskRevision, 'INVALID_FAILURE_TASK_REVISION'),
    attemptId: text(input.attemptId, 'INVALID_FAILURE_ATTEMPT') as WorkerAttemptId,
    transactionId: text(input.transactionId, 'INVALID_FAILURE_TRANSACTION') as HarnessTransactionIdentity['transactionId'],
    ...(evidenceRef === undefined ? {} : { evidenceRef })
  };
}

function parseQuiescence(value: unknown): import('../contracts/harness-execution.ts').QuiescenceRef {
  const input = record(value, [
    'kind', 'id', 'workspaceId', 'taskId', 'taskRevision', 'attemptId', 'transactionId',
    'admissionStopped', 'activeWork', 'effectCertainty', 'reconciliationRequired', 'retainedResultRef'
  ], 'QUIESCENCE');
  if (input.kind !== 'quiescence') return fail('INVALID_QUIESCENCE_KIND');
  const retainedResultRef = has(input, 'retainedResultRef') ? parseResultRef(input.retainedResultRef, 'QUIESCENCE_RESULT') : undefined;
  const effectCertainty = oneOf(input.effectCertainty, ['none', 'known_partial', 'known_complete', 'unknown'], 'INVALID_QUIESCENCE_EFFECT');
  if (input.admissionStopped !== true || input.activeWork !== 'none') return fail('QUIESCENCE_MISSING');
  if (effectCertainty === 'unknown' && input.reconciliationRequired !== true) return fail('UNKNOWN_EFFECT');
  if (effectCertainty !== 'unknown' && input.reconciliationRequired !== false) return fail('QUIESCENCE_MISSING');
  const result = {
    kind: 'quiescence' as const,
    id: text(input.id, 'INVALID_QUIESCENCE_ID') as import('../contracts/harness-execution.ts').EvidenceId,
    workspaceId: text(input.workspaceId, 'INVALID_QUIESCENCE_WORKSPACE') as WorkspaceId,
    taskId: text(input.taskId, 'INVALID_QUIESCENCE_TASK') as TaskId,
    taskRevision: revision(input.taskRevision, 'INVALID_QUIESCENCE_TASK_REVISION'),
    attemptId: text(input.attemptId, 'INVALID_QUIESCENCE_ATTEMPT') as WorkerAttemptId,
    transactionId: input.transactionId === null ? null : text(input.transactionId, 'INVALID_QUIESCENCE_TRANSACTION') as HarnessTransactionIdentity['transactionId'],
    admissionStopped: true as const,
    activeWork: 'none' as const,
    effectCertainty,
    reconciliationRequired: input.reconciliationRequired as boolean,
    ...(retainedResultRef === undefined ? {} : { retainedResultRef })
  };
  if (retainedResultRef && (retainedResultRef.workspaceId !== result.workspaceId || retainedResultRef.taskId !== result.taskId || retainedResultRef.taskRevision !== result.taskRevision || retainedResultRef.attemptId !== result.attemptId || retainedResultRef.transactionId !== result.transactionId || retainedResultRef.effectCertainty !== effectCertainty)) return fail('RESULT_SCOPE_MISMATCH');
  return result;
}

function parseCancellationObservation(value: unknown): CancellationObservation {
  const input = record(value, [
    'kind', 'id', 'workspaceId', 'taskId', 'taskRevision', 'attemptId', 'transactionId',
    'admission', 'termination', 'effectCertainty', 'quiescence', 'observationDigest'
  ], 'CANCELLATION_OBSERVATION');
  if (input.kind !== 'cancellation-observation') return fail('INVALID_CANCELLATION_OBSERVATION_KIND');
  const quiescence = has(input, 'quiescence') ? parseQuiescence(input.quiescence) : undefined;
  const workspaceId = text(input.workspaceId, 'INVALID_CANCELLATION_OBSERVATION_WORKSPACE') as WorkspaceId;
  const taskId = text(input.taskId, 'INVALID_CANCELLATION_OBSERVATION_TASK') as TaskId;
  const taskRevision = revision(input.taskRevision, 'INVALID_CANCELLATION_OBSERVATION_TASK_REVISION');
  const attemptId = text(input.attemptId, 'INVALID_CANCELLATION_OBSERVATION_ATTEMPT') as WorkerAttemptId;
  const transactionId = text(input.transactionId, 'INVALID_CANCELLATION_OBSERVATION_TRANSACTION') as HarnessTransactionIdentity['transactionId'];
  const admission = oneOf(input.admission, ['open', 'stopped'], 'INVALID_CANCELLATION_ADMISSION');
  const termination = oneOf(input.termination, ['not_requested', 'requested', 'quiesced', 'failed', 'unknown'], 'INVALID_CANCELLATION_TERMINATION');
  const effectCertainty = oneOf(input.effectCertainty, ['none', 'known_partial', 'known_complete', 'unknown'], 'INVALID_CANCELLATION_EFFECT');
  if (termination === 'quiesced' && !quiescence) return fail('QUIESCENCE_MISSING');
  if (quiescence && (admission !== 'stopped' || termination !== 'quiesced' || quiescence.workspaceId !== workspaceId || quiescence.taskId !== taskId || quiescence.taskRevision !== taskRevision || quiescence.attemptId !== attemptId || quiescence.transactionId !== transactionId || quiescence.effectCertainty !== effectCertainty)) return fail('QUIESCENCE_MISSING');
  return {
    kind: 'cancellation-observation', id: text(input.id, 'INVALID_CANCELLATION_OBSERVATION_ID'),
    workspaceId,
    taskId,
    taskRevision,
    attemptId,
    transactionId,
    admission,
    termination,
    effectCertainty,
    ...(quiescence === undefined ? {} : { quiescence }),
    observationDigest: digest(input.observationDigest, 'INVALID_CANCELLATION_OBSERVATION_DIGEST')
  };
}

function sameScope(ref: { workspaceId: WorkspaceId; taskId: TaskId; taskRevision: TaskRevision; attemptId?: WorkerAttemptId; transactionId?: HarnessTransactionIdentity['transactionId'] | null }, identity: HarnessTransactionIdentity): boolean {
  return ref.workspaceId === identity.workspaceId && ref.taskId === identity.taskId && ref.taskRevision === identity.taskRevision && (ref.attemptId === undefined || ref.attemptId === identity.attemptId) && (ref.transactionId === undefined || ref.transactionId === identity.transactionId);
}

function validateAuthorityResolution(ref: AuthorityResolutionRef, request: HarnessExecutionRequest, identity: HarnessTransactionIdentity): void {
  if (!sameScope(ref, identity) || ref.operationId !== request.operation.operation.id || ref.operationDigest !== request.operation.operationDigest || !request.authority.decision || ref.decisionId !== request.authority.decision.id) return fail('AUTHORITY_MISMATCH');
  if (request.authority.decision.operationId !== ref.operationId || request.authority.decision.operationDigest !== ref.operationDigest || request.authority.decision.taskRevision !== ref.taskRevision) return fail('AUTHORITY_MISMATCH');
}

function validateAuthorityConsumption(ref: AuthorityConsumptionRef, request: HarnessExecutionRequest, identity: HarnessTransactionIdentity): void {
  if (!sameScope(ref, identity) || ref.operationId !== request.operation.operation.id || ref.operationDigest !== request.operation.operationDigest || !request.authority.decision || ref.decisionId !== request.authority.decision.id) return fail('AUTHORITY_MISMATCH');
  if (request.authority.decision.actorRef !== ref.actorRef) return fail('AUTHORITY_MISMATCH');
}

function validateCheckpointObservation(observation: CheckpointObservation, request: HarnessExecutionRequest, identity: HarnessTransactionIdentity): void {
  const requirement = request.checkpoint.effectiveRequirement;
  if (requirement === 'not_applicable') {
    if (observation.kind !== 'not_applicable') return fail('CHECKPOINT_MISMATCH');
    return;
  }
  if (observation.kind === 'not_applicable') return fail('CHECKPOINT_MISSING');
  if (observation.kind === 'bound') {
    const ref = observation.checkpoint;
    if (!sameScope(ref, identity) || ref.mutationScopeDigest !== request.operation.effectScopeDigest || ref.taskRevision !== identity.taskRevision) return fail('CHECKPOINT_MISMATCH');
    return;
  }
  if (requirement !== 'compensation_only') return fail('CHECKPOINT_MISSING');
  const prep = observation.preparation;
  if (!sameScope(prep, identity) || prep.mutationScopeDigest !== request.operation.effectScopeDigest) return fail('CHECKPOINT_MISMATCH');
}

function validateEvidenceRef(ref: ScopedEvidenceRef, identity: HarnessTransactionIdentity): void {
  if (!sameScope(ref, identity)) return fail('SCOPE_MISMATCH');
}

function validateResultRef(ref: ExecutionResultRef, identity: HarnessTransactionIdentity): void {
  if (!sameScope(ref, identity) || ref.transactionId !== identity.transactionId || ref.attemptId !== identity.attemptId) return fail('RESULT_SCOPE_MISMATCH');
}

function validateEvidenceSnapshot(evidence: EvidenceRequirementsSnapshot, identity: HarnessTransactionIdentity): void {
  validateEvidenceRef(evidence.manifestRef, identity);
  if (evidence.manifestRef.evidenceType !== 'evidence-manifest') return fail('EVIDENCE_INCOMPLETE');
  for (const ref of evidence.evidenceRefs) validateEvidenceRef(ref, identity);
}

function transitionRecord(current: HarnessTransactionSnapshot, request: HarnessTransactionTransitionRequest): Readonly<TransitionRecord<ExecutionTransactionState>> {
  return {
    schemaVersion: '1', aggregateType: 'execution_transaction', aggregateId: current.identity.transactionId,
    previousRevision: current.snapshotRevision, nextRevision: (current.snapshotRevision + 1) as SafeInteger,
    previousState: current.state, nextState: request.nextState, reason: request.reason,
    causeRef: request.causeRef, correlationId: request.correlationId, causationId: request.causationId,
    timestamp: request.timestamp
  };
}

function snapshotBase(request: HarnessExecutionRequest, state: ExecutionTransactionState, snapshotRevision: SafeInteger, transition: Readonly<TransitionRecord<ExecutionTransactionState>> | null, causationId: string | null): Omit<HarnessTransactionSnapshotBase, 'snapshotDigest'> {
  return {
    kind: 'harness-transaction-snapshot', schemaVersion: HARNESS_EXECUTION_SCHEMA_VERSION,
    serialization: HARNESS_EXECUTION_SERIALIZATION, state, snapshotRevision,
    identity: {
      transactionId: request.transactionId, requestId: request.requestId, workspaceId: request.workspaceId,
      taskId: request.taskId, taskRevision: request.taskRevision, attemptId: request.attemptId
    },
    request, requestDigest: request.requestDigest, correlationId: request.correlationId, causationId,
    operation: request.operation, target: request.target, transition
  };
}

function parseIdentity(value: unknown): HarnessTransactionIdentity {
  const input = record(value, ['transactionId', 'requestId', 'workspaceId', 'taskId', 'taskRevision', 'attemptId'], 'SNAPSHOT_IDENTITY');
  return {
    transactionId: text(input.transactionId, 'INVALID_SNAPSHOT_TRANSACTION') as HarnessTransactionIdentity['transactionId'],
    requestId: text(input.requestId, 'INVALID_SNAPSHOT_REQUEST') as HarnessExecutionRequest['requestId'],
    workspaceId: text(input.workspaceId, 'INVALID_SNAPSHOT_WORKSPACE') as WorkspaceId,
    taskId: text(input.taskId, 'INVALID_SNAPSHOT_TASK') as TaskId,
    taskRevision: revision(input.taskRevision, 'INVALID_SNAPSHOT_TASK_REVISION'),
    attemptId: text(input.attemptId, 'INVALID_SNAPSHOT_ATTEMPT') as WorkerAttemptId
  };
}

function parseTransition(value: unknown): Readonly<TransitionRecord<ExecutionTransactionState>> | null {
  if (value === null) return null;
  const input = record(value, [
    'schemaVersion', 'aggregateType', 'aggregateId', 'previousRevision', 'nextRevision',
    'previousState', 'nextState', 'reason', 'causeRef', 'correlationId', 'causationId', 'timestamp'
  ], 'SNAPSHOT_TRANSITION');
  if (input.schemaVersion !== '1' || input.aggregateType !== 'execution_transaction') return fail('INVALID_SNAPSHOT_TRANSITION');
  const causeInput = record(input.causeRef, ['kind', 'id'], 'SNAPSHOT_CAUSE');
  const causeKind = oneOf(causeInput.kind, ['operator', 'continuation', 'dependency', 'worker', 'authority', 'verification', 'recovery', 'reconsideration'], 'INVALID_SNAPSHOT_CAUSE_KIND');
  return {
    schemaVersion: '1', aggregateType: 'execution_transaction',
    aggregateId: text(input.aggregateId, 'INVALID_SNAPSHOT_TRANSITION_ID'),
    previousRevision: safeInteger(input.previousRevision, 'INVALID_SNAPSHOT_PREVIOUS_REVISION'),
    nextRevision: safeInteger(input.nextRevision, 'INVALID_SNAPSHOT_NEXT_REVISION'),
    previousState: oneOf(input.previousState, EXECUTION_TRANSACTION_STATES, 'INVALID_SNAPSHOT_PREVIOUS_STATE'),
    nextState: oneOf(input.nextState, EXECUTION_TRANSACTION_STATES, 'INVALID_SNAPSHOT_NEXT_STATE'),
    reason: text(input.reason, 'INVALID_SNAPSHOT_REASON', REASON_MAX),
    causeRef: { kind: causeKind as CauseRef['kind'], id: text(causeInput.id, 'INVALID_SNAPSHOT_CAUSE_ID') },
    correlationId: text(input.correlationId, 'INVALID_SNAPSHOT_CORRELATION'),
    causationId: nullableText(input.causationId, 'INVALID_SNAPSHOT_CAUSATION'),
    timestamp: timestamp(input.timestamp)
  };
}

async function parseSnapshot(value: unknown): Promise<HarnessTransactionSnapshot> {
  if (!isPlain(value)) return fail('INVALID_SNAPSHOT');
  const stateDescriptor = Object.getOwnPropertyDescriptor(value, 'state');
  if (!stateDescriptor || !('value' in stateDescriptor) || !stateDescriptor.enumerable) return fail('INVALID_SNAPSHOT');
  const state = oneOf(stateDescriptor.value, EXECUTION_TRANSACTION_STATES, 'INVALID_SNAPSHOT_STATE');
  const variantFields: Record<ExecutionTransactionState, readonly string[]> = {
    proposed: ['authority'],
    authorized: ['authorityResolution'],
    checkpointed: ['authorityResolution', 'authorityConsumption', 'checkpoint'],
    executing: ['authorityResolution', 'authorityConsumption', 'admissionRef', 'ownershipRefs', 'checkpoint'],
    evidence_pending: ['authorityConsumption', 'quiescence', 'cancellation', 'effectCertainty', 'evidenceRefs'],
    verifying: ['authorityConsumption', 'resultRef', 'evidence', 'quiescence'],
    committed: ['resultRef', 'evidence', 'durableResultRef'],
    rejected: ['resultRef', 'retainedResult', 'effectCertainty', 'rejectionEvidence', 'recoveryDisposition'],
    rolling_back: ['retainedResult', 'rollbackAttempt'],
    rolled_back: ['retainedResult', 'restoreResult', 'restoredSnapshotRef', 'effectCertainty', 'divergence'],
    failed: ['failure', 'effectCertainty', 'evidenceRefs']
  };
  const baseFields = ['kind', 'schemaVersion', 'serialization', 'state', 'snapshotRevision', 'identity', 'request', 'requestDigest', 'correlationId', 'causationId', 'operation', 'target', 'transition', 'snapshotDigest'];
  const stateFields = variantFields[state];
  if (!stateFields) return fail('INVALID_SNAPSHOT_STATE');
  const input = record(value, [...baseFields, ...stateFields], 'SNAPSHOT');
  if (input.kind !== 'harness-transaction-snapshot' || input.schemaVersion !== HARNESS_EXECUTION_SCHEMA_VERSION || input.serialization !== HARNESS_EXECUTION_SERIALIZATION) return fail('INVALID_SNAPSHOT_HEADER');
  const identity = parseIdentity(input.identity);
  const request = parseRequest(input.request, true);
  const requestExpectedDigest = await sha256(canonicalContextJson(withoutRequestDigest(request)));
  if (request.requestDigest !== requestExpectedDigest) return fail('REQUEST_DIGEST_MISMATCH');
  if (request.requestId !== identity.requestId || request.workspaceId !== identity.workspaceId || request.taskId !== identity.taskId || request.taskRevision !== identity.taskRevision || request.attemptId !== identity.attemptId || request.transactionId !== identity.transactionId) return fail('SCOPE_MISMATCH');
  const operation = parseOperation(input.operation);
  const target = parseTarget(input.target);
  const requestDigest = digest(input.requestDigest, 'INVALID_SNAPSHOT_REQUEST_DIGEST');
  const base = {
    kind: 'harness-transaction-snapshot' as const, schemaVersion: HARNESS_EXECUTION_SCHEMA_VERSION,
    serialization: HARNESS_EXECUTION_SERIALIZATION, state: state as ExecutionTransactionState, snapshotRevision: safeInteger(input.snapshotRevision, 'INVALID_SNAPSHOT_REVISION'),
    identity, request, requestDigest, correlationId: text(input.correlationId, 'INVALID_SNAPSHOT_CORRELATION'),
    causationId: nullableText(input.causationId, 'INVALID_SNAPSHOT_CAUSATION'), operation, target,
    transition: parseTransition(input.transition)
  };
  if (request.requestDigest !== requestDigest) return fail('SCOPE_MISMATCH');
  const output = parseSnapshotVariant(state, input, base);
  validateSnapshotScope(output, request);
  // Re-run the state-specific guards against the parsed variant.  Snapshot
  // digests provide integrity comparison, but a caller can always recompute a
  // digest; structural scope and phase invariants therefore remain mandatory
  // when an externally supplied snapshot is accepted.
  parseData(state, snapshotVariantData(output), request, identity);
  const supplied = digest(input.snapshotDigest, 'INVALID_SNAPSHOT_DIGEST');
  const expected = await sha256(canonicalContextJson(output));
  if (expected !== supplied) return fail('SNAPSHOT_DIGEST_MISMATCH');
  return { ...output, snapshotDigest: supplied } as HarnessTransactionSnapshot;
}

type ParsedSnapshotBase = Omit<HarnessTransactionSnapshotBase, 'snapshotDigest'>;

function parseSnapshotVariant(state: ExecutionTransactionState, input: Plain, base: ParsedSnapshotBase): HarnessTransactionSnapshot {
  switch (state) {
    case 'proposed': {
      const authorityInput = record(input.authority, ['status', 'decision'], 'SNAPSHOT_AUTHORITY');
      if (authorityInput.status !== 'decision_referenced') return fail('AUTHORITY_MISMATCH');
      const decision = has(authorityInput, 'decision') ? parseAuthorityDecision(authorityInput.decision) : undefined;
      return { ...base, state, authority: decision === undefined ? { status: 'decision_referenced' } : { status: 'decision_referenced', decision } } as ProposedSnapshot;
    }
    case 'authorized': {
      const authorityResolution = parseAuthorityResolution(input.authorityResolution);
      return { ...base, state, authorityResolution } as AuthorizedSnapshot;
    }
    case 'checkpointed': {
      const authorityResolution = parseAuthorityResolution(input.authorityResolution);
      const authorityConsumption = parseAuthorityConsumption(input.authorityConsumption);
      const checkpoint = parseCheckpointObservation(input.checkpoint);
      return { ...base, state, authorityResolution, authorityConsumption, checkpoint } as CheckpointedSnapshot;
    }
    case 'executing': {
      const authorityResolution = parseAuthorityResolution(input.authorityResolution);
      const authorityConsumption = parseAuthorityConsumption(input.authorityConsumption);
      const admissionRef = parseEvidenceRef(input.admissionRef, 'ADMISSION');
      const ownershipRefs = list(input.ownershipRefs, 'OWNERSHIP_REFS', 64).map(item => parseEvidenceRef(item, 'OWNERSHIP'));
      const checkpoint = has(input, 'checkpoint') ? parseCheckpointObservation(input.checkpoint) : undefined;
      return { ...base, state, authorityResolution, authorityConsumption, admissionRef, ownershipRefs, ...(checkpoint === undefined ? {} : { checkpoint }) } as unknown as ExecutingSnapshot;
    }
    case 'evidence_pending': {
      const authorityConsumption = parseAuthorityConsumption(input.authorityConsumption);
      const quiescence = parseQuiescence(input.quiescence);
      const cancellation = has(input, 'cancellation') ? parseCancellationObservation(input.cancellation) : undefined;
      const effectCertainty = oneOf(input.effectCertainty, ['none', 'known_partial', 'known_complete', 'unknown'], 'INVALID_SNAPSHOT_EFFECT');
      const evidenceRefs = list(input.evidenceRefs, 'EVIDENCE_REFS', 256).map(item => parseEvidenceRef(item, 'EVIDENCE'));
      return { ...base, state, authorityConsumption, quiescence, effectCertainty, evidenceRefs, ...(cancellation === undefined ? {} : { cancellation }) } as unknown as EvidencePendingSnapshot;
    }
    case 'verifying': {
      const authorityConsumption = parseAuthorityConsumption(input.authorityConsumption);
      const resultRef = parseResultRef(input.resultRef);
      const evidence = parseEvidenceSnapshot(input.evidence);
      const quiescence = parseQuiescence(input.quiescence);
      return { ...base, state, authorityConsumption, resultRef, evidence, quiescence } as VerifyingSnapshot;
    }
    case 'committed': {
      const resultRef = parseResultRef(input.resultRef);
      const evidence = parseEvidenceSnapshot(input.evidence);
      const durableResultRef = parseEvidenceRef(input.durableResultRef, 'DURABLE_RESULT');
      return { ...base, state, resultRef, evidence, durableResultRef } as CommittedSnapshot;
    }
    case 'rejected': {
      const resultRef = parseResultRef(input.resultRef);
      const retainedResult = parseResultRef(input.retainedResult, 'RETAINED_RESULT');
      const effectCertainty = oneOf(input.effectCertainty, ['none', 'known_partial', 'known_complete'], 'INVALID_REJECTED_EFFECT');
      const rejectionEvidence = parseEvidenceRef(input.rejectionEvidence, 'REJECTION_EVIDENCE');
      const recoveryDisposition = oneOf(input.recoveryDisposition, ['retain_for_review', 'rollback_required', 'repair_attempt_allowed'], 'INVALID_RECOVERY_DISPOSITION');
      return { ...base, state, resultRef, retainedResult, effectCertainty, rejectionEvidence, recoveryDisposition } as RejectedSnapshot;
    }
    case 'rolling_back': {
      const retainedResult = parseResultRef(input.retainedResult, 'ROLLBACK_RETAINED_RESULT');
      const rollbackAttempt = parseEvidenceRef(input.rollbackAttempt, 'ROLLBACK_ATTEMPT');
      return { ...base, state, retainedResult, rollbackAttempt } as RollingBackSnapshot;
    }
    case 'rolled_back': {
      const retainedResult = parseResultRef(input.retainedResult, 'ROLLED_BACK_RETAINED_RESULT');
      const restoreResult = parseEvidenceRef(input.restoreResult, 'RESTORE_RESULT');
      const restoredSnapshotRef = text(input.restoredSnapshotRef, 'INVALID_RESTORED_SNAPSHOT');
      const effectCertainty = oneOf(input.effectCertainty, ['none', 'known_partial', 'known_complete'], 'INVALID_ROLLED_BACK_EFFECT');
      const divergence = oneOf(input.divergence, ['none', 'resolved'], 'INVALID_ROLLED_BACK_DIVERGENCE');
      return { ...base, state, retainedResult, restoreResult, restoredSnapshotRef, effectCertainty, divergence } as RolledBackSnapshot;
    }
    case 'failed': {
      const failure = parseFailure(input.failure);
      const effectCertainty = oneOf(input.effectCertainty, ['none', 'known_partial', 'known_complete', 'unknown'], 'INVALID_FAILED_EFFECT');
      const evidenceRefs = list(input.evidenceRefs, 'FAILED_EVIDENCE', 256).map(item => parseEvidenceRef(item, 'FAILED_EVIDENCE'));
      return { ...base, state, failure, effectCertainty, evidenceRefs } as unknown as FailedSnapshot;
    }
  }
  return fail('INVALID_SNAPSHOT_STATE');
}

function validateSnapshotScope(snapshot: HarnessTransactionSnapshot, request: HarnessExecutionRequest): void {
  const identity = snapshot.identity;
  if (identity.requestId !== request.requestId || identity.workspaceId !== request.workspaceId || identity.taskId !== request.taskId || identity.taskRevision !== request.taskRevision || identity.attemptId !== request.attemptId || identity.transactionId !== request.transactionId || snapshot.requestDigest !== request.requestDigest) return fail('SCOPE_MISMATCH');
  validateOperationAndTarget(snapshot.operation, snapshot.target, { workspaceId: identity.workspaceId, taskId: identity.taskId, taskRevision: identity.taskRevision });
  if (canonicalContextJson(snapshot.operation) !== canonicalContextJson(request.operation) || canonicalContextJson(snapshot.target) !== canonicalContextJson(request.target)) return fail('SCOPE_MISMATCH');
  if (snapshot.transition) {
    const transition = snapshot.transition;
    if (transition.aggregateId !== identity.transactionId || transition.correlationId !== snapshot.correlationId || transition.causationId !== snapshot.causationId || transition.nextState !== snapshot.state || transition.nextRevision !== snapshot.snapshotRevision || transition.previousRevision + 1 !== transition.nextRevision || transition.previousState === transition.nextState || !EXECUTION_TRANSACTION_TRANSITIONS[transition.previousState].includes(transition.nextState)) return fail('INVALID_SNAPSHOT_TRANSITION');
  } else if (snapshot.snapshotRevision !== 0 || snapshot.state !== 'proposed') {
    return fail('INVALID_SNAPSHOT_TRANSITION');
  }
}

function snapshotVariantData(snapshot: HarnessTransactionSnapshot): Plain {
  switch (snapshot.state) {
    case 'proposed': return { authority: snapshot.authority };
    case 'authorized': return { authorityResolution: snapshot.authorityResolution };
    case 'checkpointed': return { authorityResolution: snapshot.authorityResolution, authorityConsumption: snapshot.authorityConsumption, checkpoint: snapshot.checkpoint };
    case 'executing': return {
      authorityResolution: snapshot.authorityResolution,
      authorityConsumption: snapshot.authorityConsumption,
      admissionRef: snapshot.admissionRef,
      ownershipRefs: snapshot.ownershipRefs,
      ...(snapshot.checkpoint === undefined ? {} : { checkpoint: snapshot.checkpoint })
    };
    case 'evidence_pending': return {
      authorityConsumption: snapshot.authorityConsumption,
      quiescence: snapshot.quiescence,
      ...(snapshot.cancellation === undefined ? {} : { cancellation: snapshot.cancellation }),
      effectCertainty: snapshot.effectCertainty,
      evidenceRefs: snapshot.evidenceRefs
    };
    case 'verifying': return { authorityConsumption: snapshot.authorityConsumption, resultRef: snapshot.resultRef, evidence: snapshot.evidence, quiescence: snapshot.quiescence };
    case 'committed': return { resultRef: snapshot.resultRef, evidence: snapshot.evidence, durableResultRef: snapshot.durableResultRef };
    case 'rejected': return { resultRef: snapshot.resultRef, retainedResult: snapshot.retainedResult, effectCertainty: snapshot.effectCertainty, rejectionEvidence: snapshot.rejectionEvidence, recoveryDisposition: snapshot.recoveryDisposition };
    case 'rolling_back': return { retainedResult: snapshot.retainedResult, rollbackAttempt: snapshot.rollbackAttempt };
    case 'rolled_back': return { retainedResult: snapshot.retainedResult, restoreResult: snapshot.restoreResult, restoredSnapshotRef: snapshot.restoredSnapshotRef, effectCertainty: snapshot.effectCertainty, divergence: snapshot.divergence };
    case 'failed': return { failure: snapshot.failure, effectCertainty: snapshot.effectCertainty, evidenceRefs: snapshot.evidenceRefs };
  }
}

function stateDataForRequest(state: ExecutionTransactionState, data: unknown): Plain {
  const allowedByState: Record<ExecutionTransactionState, readonly string[]> = {
    proposed: ['authority'],
    authorized: ['authorityResolution'],
    checkpointed: ['authorityResolution', 'authorityConsumption', 'checkpoint'],
    executing: ['authorityResolution', 'authorityConsumption', 'admissionRef', 'ownershipRefs', 'checkpoint'],
    evidence_pending: ['authorityConsumption', 'quiescence', 'cancellation', 'effectCertainty', 'evidenceRefs'],
    verifying: ['authorityConsumption', 'resultRef', 'evidence', 'quiescence'],
    committed: ['resultRef', 'evidence', 'durableResultRef'],
    rejected: ['resultRef', 'retainedResult', 'effectCertainty', 'rejectionEvidence', 'recoveryDisposition'],
    rolling_back: ['retainedResult', 'rollbackAttempt'],
    rolled_back: ['retainedResult', 'restoreResult', 'restoredSnapshotRef', 'effectCertainty', 'divergence'],
    failed: ['failure', 'effectCertainty', 'evidenceRefs']
  };
  return record(data, allowedByState[state], 'TRANSITION_DATA');
}

function parseData(state: ExecutionTransactionState, data: Plain, request: HarnessExecutionRequest, identity: HarnessTransactionIdentity): Record<string, unknown> {
  const scope = { workspaceId: identity.workspaceId, taskId: identity.taskId, taskRevision: identity.taskRevision };
  switch (state) {
    case 'proposed': {
      const authorityInput = record(data.authority, ['status', 'decision'], 'TRANSITION_AUTHORITY');
      if (authorityInput.status !== 'decision_referenced') return fail('AUTHORITY_MISMATCH');
      const decision = parseAuthorityDecision(authorityInput.decision);
      validateAuthority({ mode: request.authority.mode, decision }, request.operation, scope);
      if (!request.authority.decision || decision.id !== request.authority.decision.id) return fail('AUTHORITY_MISMATCH');
      return { authority: { status: 'decision_referenced', decision } };
    }
    case 'authorized': {
      const authorityResolution = parseAuthorityResolution(data.authorityResolution);
      validateAuthorityResolution(authorityResolution, request, identity);
      return { authorityResolution };
    }
    case 'checkpointed': {
      const authorityResolution = parseAuthorityResolution(data.authorityResolution);
      validateAuthorityResolution(authorityResolution, request, identity);
      const authorityConsumption = parseAuthorityConsumption(data.authorityConsumption);
      validateAuthorityConsumption(authorityConsumption, request, identity);
      const checkpoint = parseCheckpointObservation(data.checkpoint);
      validateCheckpointObservation(checkpoint, request, identity);
      return { authorityResolution, authorityConsumption, checkpoint };
    }
    case 'executing': {
      const authorityResolution = parseAuthorityResolution(data.authorityResolution);
      validateAuthorityResolution(authorityResolution, request, identity);
      const authorityConsumption = parseAuthorityConsumption(data.authorityConsumption);
      validateAuthorityConsumption(authorityConsumption, request, identity);
      const admissionRef = parseEvidenceRef(data.admissionRef, 'ADMISSION');
      validateEvidenceRef(admissionRef, identity);
      const ownershipRefs = list(data.ownershipRefs, 'OWNERSHIP_REFS', 64).map(item => parseEvidenceRef(item, 'OWNERSHIP'));
      ownershipRefs.forEach(ref => validateEvidenceRef(ref, identity));
      const checkpoint = has(data, 'checkpoint') ? parseCheckpointObservation(data.checkpoint) : undefined;
      if (request.operation.operation.effectClass === 'mutation') {
        if (request.checkpoint.effectiveRequirement === 'not_applicable') return fail('CHECKPOINT_MISSING');
        if (!checkpoint) return fail('CHECKPOINT_MISSING');
        validateCheckpointObservation(checkpoint, request, identity);
      } else if (checkpoint !== undefined) {
        validateCheckpointObservation(checkpoint, request, identity);
      }
      return { authorityResolution, authorityConsumption, admissionRef, ownershipRefs, ...(checkpoint === undefined ? {} : { checkpoint }) };
    }
    case 'evidence_pending': {
      const authorityConsumption = parseAuthorityConsumption(data.authorityConsumption);
      validateAuthorityConsumption(authorityConsumption, request, identity);
      const quiescence = parseQuiescence(data.quiescence);
      if (!sameScope(quiescence, identity) || (quiescence.retainedResultRef && !sameScope(quiescence.retainedResultRef, identity))) return fail('SCOPE_MISMATCH');
      const effectCertainty = oneOf(data.effectCertainty, ['none', 'known_partial', 'known_complete', 'unknown'], 'INVALID_TRANSITION_EFFECT');
      if (effectCertainty !== quiescence.effectCertainty) return fail('UNKNOWN_EFFECT');
      const cancellation = has(data, 'cancellation') ? parseCancellationObservation(data.cancellation) : undefined;
      if (cancellation && (!sameScope(cancellation, identity) || cancellation.effectCertainty !== effectCertainty)) return fail('SCOPE_MISMATCH');
      const evidenceRefs = list(data.evidenceRefs, 'EVIDENCE_REFS', 256).map(item => parseEvidenceRef(item, 'EVIDENCE'));
      evidenceRefs.forEach(ref => validateEvidenceRef(ref, identity));
      return { authorityConsumption, quiescence, effectCertainty, evidenceRefs, ...(cancellation === undefined ? {} : { cancellation }) };
    }
    case 'verifying': {
      const authorityConsumption = parseAuthorityConsumption(data.authorityConsumption);
      const resultRef = parseResultRef(data.resultRef);
      const evidence = parseEvidenceSnapshot(data.evidence);
      const quiescence = parseQuiescence(data.quiescence);
      validateResultRef(resultRef, identity); validateEvidenceSnapshot(evidence, identity);
      if (!sameScope(authorityConsumption, identity) || !sameScope(quiescence, identity) || (quiescence.retainedResultRef && !sameScope(quiescence.retainedResultRef, identity)) || resultRef.effectCertainty !== quiescence.effectCertainty) return fail('RESULT_SCOPE_MISMATCH');
      return { authorityConsumption, resultRef, evidence, quiescence };
    }
    case 'committed': {
      const resultRef = parseResultRef(data.resultRef);
      const evidence = parseEvidenceSnapshot(data.evidence);
      const durableResultRef = parseEvidenceRef(data.durableResultRef, 'DURABLE_RESULT');
      validateResultRef(resultRef, identity); validateEvidenceSnapshot(evidence, identity); validateEvidenceRef(durableResultRef, identity);
      if (resultRef.effectCertainty === 'unknown') return fail('EVIDENCE_INCOMPLETE');
      return { resultRef, evidence, durableResultRef };
    }
    case 'rejected': {
      const resultRef = parseResultRef(data.resultRef);
      const retainedResult = parseResultRef(data.retainedResult, 'RETAINED_RESULT');
      const effectCertainty = oneOf(data.effectCertainty, ['none', 'known_partial', 'known_complete'], 'INVALID_REJECTED_EFFECT');
      const rejectionEvidence = parseEvidenceRef(data.rejectionEvidence, 'REJECTION_EVIDENCE');
      const recoveryDisposition = oneOf(data.recoveryDisposition, ['retain_for_review', 'rollback_required', 'repair_attempt_allowed'], 'INVALID_RECOVERY_DISPOSITION');
      validateResultRef(resultRef, identity); validateResultRef(retainedResult, identity); validateEvidenceRef(rejectionEvidence, identity);
      if (retainedResult.effectCertainty !== effectCertainty || resultRef.effectCertainty !== effectCertainty) return fail('RESULT_SCOPE_MISMATCH');
      // A mutation may be rejected before it starts (for example by the
      // authority owner), in which case a not-started/none result is truthful.
      // Once an effect exists, the exact retained result and certainty are
      // still required above; neither form implies rollback.
      if (request.operation.operation.effectClass === 'mutation' && !has(data, 'retainedResult')) return fail('EVIDENCE_INCOMPLETE');
      return { resultRef, retainedResult, effectCertainty, rejectionEvidence, recoveryDisposition };
    }
    case 'rolling_back': {
      const retainedResult = parseResultRef(data.retainedResult, 'ROLLBACK_RETAINED_RESULT');
      const rollbackAttempt = parseEvidenceRef(data.rollbackAttempt, 'ROLLBACK_ATTEMPT');
      validateResultRef(retainedResult, identity); validateEvidenceRef(rollbackAttempt, identity);
      return { retainedResult, rollbackAttempt };
    }
    case 'rolled_back': {
      const retainedResult = parseResultRef(data.retainedResult, 'ROLLED_BACK_RETAINED_RESULT');
      const restoreResult = parseEvidenceRef(data.restoreResult, 'RESTORE_RESULT');
      const restoredSnapshotRef = text(data.restoredSnapshotRef, 'INVALID_RESTORED_SNAPSHOT');
      const effectCertainty = oneOf(data.effectCertainty, ['none', 'known_partial', 'known_complete'], 'INVALID_ROLLED_BACK_EFFECT');
      const divergence = oneOf(data.divergence, ['none', 'resolved'], 'INVALID_ROLLED_BACK_DIVERGENCE');
      validateResultRef(retainedResult, identity); validateEvidenceRef(restoreResult, identity);
      if (restoreResult.evidenceType !== 'before-after' && restoreResult.evidenceType !== 'result') return fail('ROLLBACK_REQUIRED');
      if (retainedResult.effectCertainty === 'unknown') return fail('UNKNOWN_EFFECT');
      return { retainedResult, restoreResult, restoredSnapshotRef, effectCertainty, divergence };
    }
    case 'failed': {
      const failure = parseFailure(data.failure);
      const effectCertainty = oneOf(data.effectCertainty, ['none', 'known_partial', 'known_complete', 'unknown'], 'INVALID_FAILED_EFFECT');
      const evidenceRefs = list(data.evidenceRefs, 'FAILED_EVIDENCE', 256).map(item => parseEvidenceRef(item, 'FAILED_EVIDENCE'));
      if (!sameScope(failure, identity)) return fail('SCOPE_MISMATCH');
      evidenceRefs.forEach(ref => validateEvidenceRef(ref, identity));
      return { failure, effectCertainty, evidenceRefs };
    }
  }
  return fail('INVALID_TRANSITION_DATA');
}

function validateResultObject(result: HarnessExecutionResult): void {
  const identity = result.identity;
  const certainty: EffectCertainty = result.effectCertainty;
  const q = 'quiescence' in result ? result.quiescence : undefined;
  validateResultRef(result.resultRef, identity);
  if (result.resultRef.effectCertainty !== certainty) return fail('RESULT_SCOPE_MISMATCH');
  for (const ref of result.evidenceRefs) validateEvidenceRef(ref, identity);
  if (result.checkpoint && !sameScope(result.checkpoint, identity)) return fail('SCOPE_MISMATCH');
  if (result.rollback) validateEvidenceRef(result.rollback, identity);
  if (result.failure) {
    if (!sameScope(result.failure, identity)) return fail('SCOPE_MISMATCH');
    if (result.failure.evidenceRef) validateEvidenceRef(result.failure.evidenceRef, identity);
  }
  if (result.completion === 'not_started') {
    if (certainty !== 'none' || q || result.checkpoint || result.rollback || 'effectEvidence' in result || 'uncertaintyEvidence' in result) return fail('EXECUTION_NOT_STARTED');
  }
  if (certainty === 'known_partial' || certainty === 'known_complete') {
    const effectEvidence = (result as ObservedEffectResult).effectEvidence;
    if (!effectEvidence) return fail('EVIDENCE_INCOMPLETE');
    if ('uncertaintyEvidence' in result || ('reconciliationRequired' in result && result.reconciliationRequired !== undefined)) return fail('RESULT_SCOPE_MISMATCH');
    validateEvidenceRef(effectEvidence, identity);
    if (!q || !sameScope(q, identity) || q.effectCertainty !== certainty || q.reconciliationRequired) return fail('QUIESCENCE_MISSING');
  }
  if (certainty === 'unknown') {
    const unknown = result as UnknownEffectResult;
    if ('effectEvidence' in result) return fail('RESULT_SCOPE_MISMATCH');
    validateEvidenceRef(unknown.uncertaintyEvidence, identity);
    if (unknown.reconciliationRequired !== true) return fail('UNKNOWN_EFFECT');
    if (result.completion !== 'interrupted' && result.completion !== 'cancelled' && result.completion !== 'timed_out' && result.completion !== 'failed') return fail('UNKNOWN_EFFECT');
  }
  if (q) {
    if (!sameScope(q, identity)) return fail('SCOPE_MISMATCH');
    if (q.effectCertainty !== certainty) return fail('RESULT_SCOPE_MISMATCH');
  }
  if (certainty === 'none' && 'reconciliationRequired' in result && result.reconciliationRequired === true) return fail('UNKNOWN_EFFECT');
  if (result.completion === 'cancelled' || result.completion === 'timed_out') {
    if (certainty === 'none' && (!q || q.reconciliationRequired)) return fail('QUIESCENCE_MISSING');
    if (result.rollback && certainty !== 'known_complete') return fail('ROLLBACK_REQUIRED');
  }
}

function withoutResultDigest(result: HarnessExecutionResult): Omit<HarnessExecutionResult, 'resultDigest'> {
  const { resultDigest: _resultDigest, ...unsigned } = result;
  void _resultDigest;
  return unsigned;
}

function parseResultInput(value: unknown): Omit<HarnessExecutionResult, 'resultDigest'> {
  const input = record(value, [
    'kind', 'schemaVersion', 'serialization', 'identity', 'completion', 'effectCertainty', 'resultRef',
    'evidenceRefs', 'quiescence', 'checkpoint', 'rollback', 'failure', 'effectEvidence', 'uncertaintyEvidence',
    'reconciliationRequired'
  ], 'RESULT');
  if (input.kind !== 'harness-execution-result' || input.schemaVersion !== HARNESS_EXECUTION_SCHEMA_VERSION || input.serialization !== HARNESS_EXECUTION_SERIALIZATION) return fail('INVALID_RESULT_HEADER');
  const identity = parseIdentity(input.identity);
  const resultRef = parseResultRef(input.resultRef);
  const evidenceRefs = list(input.evidenceRefs, 'RESULT_EVIDENCE', 256).map(item => parseEvidenceRef(item, 'RESULT_EVIDENCE'));
  const quiescence = has(input, 'quiescence') ? parseQuiescence(input.quiescence) : undefined;
  const checkpoint = has(input, 'checkpoint') ? parseTransactionCheckpoint(input.checkpoint) : undefined;
  const rollback = has(input, 'rollback') ? parseEvidenceRef(input.rollback, 'RESULT_ROLLBACK') : undefined;
  const failure = has(input, 'failure') ? parseFailure(input.failure) : undefined;
  const effectEvidence = has(input, 'effectEvidence') ? parseEvidenceRef(input.effectEvidence, 'RESULT_EFFECT') : undefined;
  const uncertaintyEvidence = has(input, 'uncertaintyEvidence') ? parseEvidenceRef(input.uncertaintyEvidence, 'RESULT_UNCERTAINTY') : undefined;
  const completion = oneOf(input.completion, COMPLETION_CLASSES, 'INVALID_RESULT_COMPLETION');
  const effectCertainty = oneOf(input.effectCertainty, ['none', 'known_partial', 'known_complete', 'unknown'], 'INVALID_RESULT_EFFECT');
  const reconciliationRequired = has(input, 'reconciliationRequired')
    ? (typeof input.reconciliationRequired === 'boolean' ? input.reconciliationRequired : fail('INVALID_RESULT_RECONCILIATION'))
    : undefined;
  return {
    kind: 'harness-execution-result', schemaVersion: HARNESS_EXECUTION_SCHEMA_VERSION, serialization: HARNESS_EXECUTION_SERIALIZATION,
    identity, completion, effectCertainty, resultRef, evidenceRefs,
    ...(quiescence === undefined ? {} : { quiescence }), ...(checkpoint === undefined ? {} : { checkpoint }),
    ...(rollback === undefined ? {} : { rollback }), ...(failure === undefined ? {} : { failure }),
    ...(effectEvidence === undefined ? {} : { effectEvidence }), ...(uncertaintyEvidence === undefined ? {} : { uncertaintyEvidence }),
    ...(reconciliationRequired === undefined ? {} : { reconciliationRequired })
  } as Omit<HarnessExecutionResult, 'resultDigest'>;
}

export function canonicalHarnessJson(value: unknown): string {
  return canonicalContextJson(value);
}

export async function createHarnessExecutionRequest(input: unknown): Promise<Readonly<HarnessExecutionRequest>> {
  const parsed = parseRequest(input, false);
  const unsigned = immutable(parsed) as HarnessExecutionRequest;
  const requestDigest = await sha256(canonicalContextJson(withoutRequestDigest(unsigned)));
  return immutable({ ...unsigned, requestDigest });
}

export function isHarnessExecutionRequest(value: unknown): value is HarnessExecutionRequest {
  try {
    parseRequest(value, true);
    return true;
  } catch (error) {
    if (error instanceof HarnessExecutionError) return false;
    throw error;
  }
}

export async function createProposedHarnessTransaction(requestValue: unknown): Promise<Readonly<HarnessTransactionSnapshot>> {
  const request = parseRequest(requestValue, true);
  const expectedDigest = await sha256(canonicalContextJson(withoutRequestDigest(request)));
  if (request.requestDigest !== expectedDigest) return fail('REQUEST_DIGEST_MISMATCH');
  const base = snapshotBase(request, 'proposed', 0 as SafeInteger, null, request.causationId);
  const authority = request.authority.decision === undefined ? { status: 'decision_referenced' as const } : { status: 'decision_referenced' as const, decision: request.authority.decision };
  const unsigned = { ...base, authority } as Omit<ProposedSnapshot, 'snapshotDigest'>;
  const snapshotDigest = await sha256(canonicalContextJson(unsigned));
  return immutable({ ...unsigned, snapshotDigest });
}

export async function transitionHarnessTransaction(currentValue: unknown, rawRequest: unknown): Promise<Readonly<HarnessTransactionSnapshot>> {
  const current = await parseSnapshot(currentValue);
  const request = current.request;
  const raw = record(rawRequest, ['aggregateId', 'expectedRevision', 'currentState', 'nextState', 'reason', 'causeRef', 'correlationId', 'causationId', 'timestamp', 'data'], 'TRANSITION');
  const aggregateId = text(raw.aggregateId, 'INVALID_TRANSITION_AGGREGATE') as HarnessTransactionIdentity['transactionId'];
  const expectedRevision = safeInteger(raw.expectedRevision, 'INVALID_TRANSITION_REVISION');
  const currentState = oneOf(raw.currentState, EXECUTION_TRANSACTION_STATES, 'INVALID_TRANSITION_CURRENT_STATE');
  const nextState = oneOf(raw.nextState, EXECUTION_TRANSACTION_STATES, 'INVALID_TRANSITION_NEXT_STATE');
  const reason = text(raw.reason, 'INVALID_TRANSITION_REASON', REASON_MAX);
  const causeInput = record(raw.causeRef, ['kind', 'id'], 'TRANSITION_CAUSE');
  const causeRef: CauseRef = { kind: oneOf(causeInput.kind, ['operator', 'continuation', 'dependency', 'worker', 'authority', 'verification', 'recovery', 'reconsideration'], 'INVALID_TRANSITION_CAUSE_KIND'), id: text(causeInput.id, 'INVALID_TRANSITION_CAUSE_ID') };
  const correlationId = text(raw.correlationId, 'INVALID_TRANSITION_CORRELATION');
  const causationId = nullableText(raw.causationId, 'INVALID_TRANSITION_CAUSATION');
  const transitionTimestamp = timestamp(raw.timestamp);
  if (aggregateId !== current.identity.transactionId || expectedRevision !== current.snapshotRevision || currentState !== current.state || correlationId !== current.correlationId) return fail('STALE_REVISION');
  if (nextState === current.state || !EXECUTION_TRANSACTION_TRANSITIONS[current.state].includes(nextState)) return fail('ILLEGAL_TRANSITION');
  const data = stateDataForRequest(nextState, raw.data);
  const parsedData = parseData(nextState, data, request, current.identity);
  if (nextState === 'executing' && request.operation.operation.effectClass === 'mutation' && current.state !== 'checkpointed') return fail('CHECKPOINT_MISSING');
  if (nextState === 'committed' && current.state !== 'verifying') return fail('EVIDENCE_INCOMPLETE');
  if (nextState === 'verifying' && current.state !== 'evidence_pending') return fail('EVIDENCE_INCOMPLETE');
  if (nextState === 'rolled_back' && current.state !== 'rolling_back') return fail('ROLLBACK_REQUIRED');
  const transition = transitionRecord(current, { aggregateId, expectedRevision, currentState, nextState, reason, causeRef, correlationId, causationId, timestamp: transitionTimestamp, data: parsedData });
  const base = snapshotBase(request, nextState, (current.snapshotRevision + 1) as SafeInteger, transition, causationId);
  const unsigned = { ...base, ...parsedData } as Omit<HarnessTransactionSnapshot, 'snapshotDigest'>;
  const snapshotDigest = await sha256(canonicalContextJson(unsigned));
  return immutable({ ...unsigned, snapshotDigest }) as Readonly<HarnessTransactionSnapshot>;
}

export async function createHarnessExecutionResult(value: unknown): Promise<Readonly<HarnessExecutionResult>> {
  const parsed = parseResultInput(value);
  const result = immutable(parsed) as Omit<HarnessExecutionResult, 'resultDigest'>;
  validateResultObject(result as HarnessExecutionResult);
  const resultDigest = await sha256(canonicalContextJson(withoutResultDigest(result as HarnessExecutionResult)));
  return immutable({ ...result, resultDigest }) as Readonly<HarnessExecutionResult>;
}

export async function hasHarnessExecutionIntegrity(value: unknown): Promise<boolean> {
  try {
    const input = record(value, ['kind', 'schemaVersion', 'serialization', 'identity', 'completion', 'effectCertainty', 'resultRef', 'evidenceRefs', 'quiescence', 'checkpoint', 'rollback', 'failure', 'effectEvidence', 'uncertaintyEvidence', 'reconciliationRequired', 'resultDigest'], 'RESULT');
    const supplied = digest(input.resultDigest, 'INVALID_RESULT_DIGEST');
    const unsigned = Object.create(null) as Plain;
    for (const key of Object.keys(input)) if (key !== 'resultDigest') unsigned[key] = input[key];
    const parsed = await createHarnessExecutionResult(unsigned);
    return parsed.resultDigest === supplied;
  } catch (error) {
    if (error instanceof HarnessExecutionError) return false;
    throw error;
  }
}

export type {
  AuthorityConsumptionRef,
  AuthorityDecisionRef,
  AuthorityResolutionRef,
  CancellationObservation,
  CheckpointObservation,
  ContextEnvelopeBinding,
  Digest,
  EffectCertainty,
  ExecutionResultRef,
  FailureRef,
  HarnessExecutionRequest,
  HarnessExecutionRequestInput,
  HarnessExecutionResult,
  HarnessTransactionSnapshot,
  HarnessTransactionTransitionRequest,
  OperationClass,
  ResolvedTargetRef,
  RetryLineage,
  ScopedEvidenceRef,
  TaskRevision,
  TrustedOperationBinding,
  TransactionCheckpointRef,
  WorkerSelectionRef
};

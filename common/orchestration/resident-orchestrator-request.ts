import { canonicalContextJson } from '../context/context-envelope.ts';
import {
  AMBIGUITY_POLICIES,
  AUTONOMY_LEVELS,
  CONFIRMATION_POLICIES,
  DELIVERABLE_KINDS,
  DETAIL_LEVELS,
  EXECUTION_INTERACTION_POLICIES,
  FILE_MUTATION_INTENTS,
  MODEL_ROLES,
  MUTATION_CONCURRENCY_POLICIES,
  OPTIONAL_EXECUTION_INTENTS,
  REQUESTED_RISK_CLASSES,
  RESIDENT_ORCHESTRATOR_SCHEMA_VERSION,
  RESIDENT_ORCHESTRATOR_SERIALIZATION,
  RESOURCE_PRESSURE_CLASSES,
  SOVEREIGNTY_POLICIES,
  TASK_CLASSES,
  TASK_SHAPES,
  VALIDATION_REQUIREMENTS,
  type AcceptanceRequirements,
  type AmbiguityPolicy,
  type AutonomyLevel,
  type CompletionPolicy,
  type ConfirmationPolicy,
  type ConstraintSet,
  type ContextEnvelopeReference,
  type DetailLevel,
  type ExecutionInteractionPolicy,
  type GoalSpec,
  type HardConstraints,
  type MethodologyRequirements,
  type ModelRole,
  type ModelRoleRequirements,
  type MutationConcurrencyPolicy,
  type OperatorPolicyProjection,
  type OperatorPolicyReference,
  type OrchestratorRequestProjection,
  type RequestedEffectEnvelope,
  type RequestedRiskClass,
  type RequestHints,
  type ResourceConstraints,
  type ResidentOrchestratorAnyRequest,
  type ResidentOrchestratorDraft,
  type ResidentOrchestratorRequest,
  type ResidentOrchestratorRequestFields,
  type ResourcePressureClass,
  type SovereigntyPolicy,
  type TaskShape
} from '../contracts/resident-orchestrator.ts';

export class ResidentOrchestratorRequestError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'ResidentOrchestratorRequestError';
    this.code = code;
  }
}

const fail = (code: string): never => { throw new ResidentOrchestratorRequestError(code); };
type Plain = Record<string, unknown>;

function isPlain(value: unknown): value is Plain {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Strict descriptor-first parsing prevents getters from running before rejection. */
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

function values(value: unknown, label: string, max: number): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > max) return fail('INVALID_' + label);
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== 'string') || keys.length !== value.length + 1) return fail('INVALID_' + label);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  if (!lengthDescriptor || !('value' in lengthDescriptor) || lengthDescriptor.value !== value.length) return fail('INVALID_' + label);
  const output: unknown[] = [];
  for (let index = 0; index < value.length; index++) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return fail('INVALID_' + label);
    output.push(descriptor.value);
  }
  return output;
}

function text(value: unknown, code: string, max = 512): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max || value.trim().length < 1) return fail(code);
  return value;
}

function nullableText(value: unknown, code: string, max = 512): string | null {
  return value === null ? null : text(value, code, max);
}

function integer(value: unknown, code: string, max = 10_000_000): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) return fail(code);
  return value;
}

function positiveInteger(value: unknown, code: string, max = 10_000_000): number {
  const parsed = integer(value, code, max);
  if (parsed < 1) return fail(code);
  return parsed;
}

function booleanValue(value: unknown, code: string): boolean {
  if (typeof value !== 'boolean') return fail(code);
  return value;
}

function oneOf<T extends string>(value: unknown, choices: readonly T[], code: string): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) return fail(code);
  return value as T;
}

function stringList(value: unknown, label: string, max: number, itemMax = 256, min = 0): readonly string[] {
  const input = values(value, label, max);
  if (input.length < min) return fail('INVALID_' + label);
  const output = input.map(item => text(item, 'INVALID_' + label + '_ITEM', itemMax));
  if (new Set(output).size !== output.length) return fail('DUPLICATE_' + label);
  return output;
}

function enumList<T extends string>(value: unknown, choices: readonly T[], label: string, max: number, min = 0): readonly T[] {
  const input = values(value, label, max);
  if (input.length < min) return fail('INVALID_' + label);
  const output = input.map(item => oneOf(item, choices, 'INVALID_' + label + '_ITEM'));
  if (new Set(output).size !== output.length) return fail('DUPLICATE_' + label);
  return output;
}

function digest(value: unknown, code: string): string {
  const output = text(value, code, 64);
  if (!/^[a-f0-9]{64}$/.test(output)) return fail(code);
  return output;
}

function scopedReference(value: unknown, label: string): import('../contracts/resident-orchestrator.ts').ScopedRequestReference {
  const input = record(value, ['id', 'version', 'requestId', 'workspaceId'], label);
  return {
    id: text(input.id, 'INVALID_' + label + '_ID'),
    version: text(input.version, 'INVALID_' + label + '_VERSION', 128),
    requestId: text(input.requestId, 'INVALID_' + label + '_REQUEST_ID'),
    workspaceId: text(input.workspaceId, 'INVALID_' + label + '_WORKSPACE_ID')
  };
}

function contextReference(value: unknown): ContextEnvelopeReference {
  const input = record(value, ['id', 'digest', 'requestId', 'workspaceId', 'taskId', 'snapshotRef'], 'CONTEXT');
  return {
    id: text(input.id, 'INVALID_CONTEXT_ID'), digest: digest(input.digest, 'INVALID_CONTEXT_DIGEST'),
    requestId: text(input.requestId, 'INVALID_CONTEXT_REQUEST_ID'), workspaceId: text(input.workspaceId, 'INVALID_CONTEXT_WORKSPACE_ID'),
    taskId: text(input.taskId, 'INVALID_CONTEXT_TASK_ID'), snapshotRef: text(input.snapshotRef, 'INVALID_CONTEXT_SNAPSHOT_ID')
  };
}

function operatorPolicyReference(value: unknown): OperatorPolicyReference {
  const input = record(value, ['id', 'revision', 'requestId', 'workspaceId'], 'OPERATOR_POLICY_REFERENCE');
  return {
    id: text(input.id, 'INVALID_OPERATOR_POLICY_ID'), revision: integer(input.revision, 'INVALID_OPERATOR_POLICY_REVISION'),
    requestId: text(input.requestId, 'INVALID_OPERATOR_POLICY_REQUEST_ID'), workspaceId: text(input.workspaceId, 'INVALID_OPERATOR_POLICY_WORKSPACE_ID')
  };
}

function goal(value: unknown): GoalSpec {
  const input = record(value, ['statement', 'taskClass', 'deliverables'], 'GOAL');
  return {
    statement: text(input.statement, 'INVALID_GOAL_STATEMENT', 16_384),
    taskClass: oneOf(input.taskClass, TASK_CLASSES, 'INVALID_TASK_CLASS'),
    deliverables: enumList(input.deliverables, DELIVERABLE_KINDS, 'GOAL_DELIVERABLES', 6, 1)
  };
}

function operatorPolicy(value: unknown): OperatorPolicyProjection {
  const input = record(value, ['reference', 'autonomy', 'detail', 'confirmation', 'interactionDuringExecution', 'taskShape'], 'OPERATOR_POLICY');
  return {
    reference: operatorPolicyReference(input.reference),
    autonomy: oneOf(input.autonomy, AUTONOMY_LEVELS, 'INVALID_AUTONOMY') as AutonomyLevel,
    detail: oneOf(input.detail, DETAIL_LEVELS, 'INVALID_DETAIL') as DetailLevel,
    confirmation: oneOf(input.confirmation, CONFIRMATION_POLICIES, 'INVALID_CONFIRMATION') as ConfirmationPolicy,
    interactionDuringExecution: oneOf(input.interactionDuringExecution, EXECUTION_INTERACTION_POLICIES, 'INVALID_EXECUTION_INTERACTION') as ExecutionInteractionPolicy,
    taskShape: oneOf(input.taskShape, TASK_SHAPES, 'INVALID_TASK_SHAPE') as TaskShape
  };
}

function hardConstraints(value: unknown): HardConstraints {
  const input = record(value, ['excludedPaths', 'preserveApiCompatibility', 'maxRiskClass', 'destructiveEffects', 'requiredValidation', 'noUnrelatedChanges'], 'HARD_CONSTRAINTS');
  return {
    excludedPaths: stringList(input.excludedPaths, 'EXCLUDED_PATHS', 256, 2048),
    preserveApiCompatibility: booleanValue(input.preserveApiCompatibility, 'INVALID_PRESERVE_API_COMPATIBILITY'),
    maxRiskClass: oneOf(input.maxRiskClass, REQUESTED_RISK_CLASSES, 'INVALID_MAX_RISK_CLASS') as RequestedRiskClass,
    destructiveEffects: oneOf(input.destructiveEffects, ['forbidden', 'operator_decision'], 'INVALID_DESTRUCTIVE_POLICY'),
    requiredValidation: enumList(input.requiredValidation, VALIDATION_REQUIREMENTS, 'REQUIRED_VALIDATION', 6),
    noUnrelatedChanges: booleanValue(input.noUnrelatedChanges, 'INVALID_NO_UNRELATED_CHANGES')
  };
}

function hints(value: unknown): RequestHints {
  const input = record(value, ['preferExistingTests', 'preferLocalModel', 'preferMinimalDiff', 'workflowFamilies', 'skillFamilies'], 'REQUEST_HINTS');
  return {
    preferExistingTests: booleanValue(input.preferExistingTests, 'INVALID_PREFER_EXISTING_TESTS'),
    preferLocalModel: booleanValue(input.preferLocalModel, 'INVALID_PREFER_LOCAL_MODEL'),
    preferMinimalDiff: booleanValue(input.preferMinimalDiff, 'INVALID_PREFER_MINIMAL_DIFF'),
    workflowFamilies: stringList(input.workflowFamilies, 'WORKFLOW_FAMILIES', 32),
    skillFamilies: stringList(input.skillFamilies, 'SKILL_FAMILIES', 64)
  };
}

function methodology(value: unknown): MethodologyRequirements {
  const input = record(value, ['requiredWorkflows', 'preferredWorkflows', 'requiredSkills', 'preferredSkills'], 'METHODOLOGY');
  const requiredWorkflows = values(input.requiredWorkflows, 'REQUIRED_WORKFLOWS', 64).map(item => scopedReference(item, 'WORKFLOW'));
  const preferredWorkflows = values(input.preferredWorkflows, 'PREFERRED_WORKFLOWS', 64).map(item => scopedReference(item, 'WORKFLOW'));
  const requiredSkills = values(input.requiredSkills, 'REQUIRED_SKILLS', 128).map(item => scopedReference(item, 'SKILL'));
  const preferredSkills = values(input.preferredSkills, 'PREFERRED_SKILLS', 128).map(item => scopedReference(item, 'SKILL'));
  const refs = [...requiredWorkflows, ...preferredWorkflows, ...requiredSkills, ...preferredSkills];
  if (new Set(refs.map(ref => `${ref.requestId}\u0000${ref.workspaceId}\u0000${ref.id}\u0000${ref.version}`)).size !== refs.length) return fail('DUPLICATE_METHODOLOGY_REFERENCE');
  return { requiredWorkflows, preferredWorkflows, requiredSkills, preferredSkills };
}

function roles(value: unknown): ModelRoleRequirements {
  const input = record(value, ['requiredRoles', 'independentReviewer', 'localOnlyModel', 'maxModelCount', 'preferredModelFamilies'], 'ROLES');
  return {
    requiredRoles: enumList(input.requiredRoles, MODEL_ROLES, 'REQUIRED_ROLES', 5, 1) as readonly ModelRole[],
    independentReviewer: booleanValue(input.independentReviewer, 'INVALID_INDEPENDENT_REVIEWER'),
    localOnlyModel: booleanValue(input.localOnlyModel, 'INVALID_LOCAL_ONLY_MODEL'),
    maxModelCount: positiveInteger(input.maxModelCount, 'INVALID_MAX_MODEL_COUNT', 16),
    preferredModelFamilies: stringList(input.preferredModelFamilies, 'PREFERRED_MODEL_FAMILIES', 16, 256)
  };
}

function resources(value: unknown): ResourceConstraints {
  const input = record(value, ['maxParallelWorkers', 'maxWallClockMs', 'maxModelInputTokens', 'maxModelOutputTokens', 'resourcePressure', 'mutationConcurrency'], 'RESOURCES');
  return {
    maxParallelWorkers: positiveInteger(input.maxParallelWorkers, 'INVALID_MAX_PARALLEL_WORKERS', 64),
    maxWallClockMs: positiveInteger(input.maxWallClockMs, 'INVALID_MAX_WALL_CLOCK_MS', 604_800_000),
    maxModelInputTokens: positiveInteger(input.maxModelInputTokens, 'INVALID_MAX_MODEL_INPUT_TOKENS'),
    maxModelOutputTokens: positiveInteger(input.maxModelOutputTokens, 'INVALID_MAX_MODEL_OUTPUT_TOKENS'),
    resourcePressure: oneOf(input.resourcePressure, RESOURCE_PRESSURE_CLASSES, 'INVALID_RESOURCE_PRESSURE') as ResourcePressureClass,
    mutationConcurrency: oneOf(input.mutationConcurrency, MUTATION_CONCURRENCY_POLICIES, 'INVALID_MUTATION_CONCURRENCY') as MutationConcurrencyPolicy
  };
}

function requestedEffects(value: unknown): RequestedEffectEnvelope {
  const input = record(value, ['riskClass', 'fileMutation', 'processExecution', 'externalEgress', 'destructiveEffects'], 'REQUESTED_EFFECTS');
  return {
    riskClass: oneOf(input.riskClass, REQUESTED_RISK_CLASSES, 'INVALID_REQUESTED_RISK_CLASS') as RequestedRiskClass,
    fileMutation: oneOf(input.fileMutation, FILE_MUTATION_INTENTS, 'INVALID_FILE_MUTATION'),
    processExecution: oneOf(input.processExecution, OPTIONAL_EXECUTION_INTENTS, 'INVALID_PROCESS_EXECUTION'),
    externalEgress: oneOf(input.externalEgress, OPTIONAL_EXECUTION_INTENTS, 'INVALID_EXTERNAL_EGRESS'),
    destructiveEffects: oneOf(input.destructiveEffects, OPTIONAL_EXECUTION_INTENTS, 'INVALID_DESTRUCTIVE_EFFECTS')
  };
}

function acceptance(value: unknown): AcceptanceRequirements {
  const input = record(value, ['id', 'revision', 'requestId', 'workspaceId', 'validationPlanRequired', 'requiredChecks', 'independentReview', 'evidenceRequired', 'noRegressionRequired', 'operatorConfirmation', 'deliverables'], 'ACCEPTANCE');
  return {
    id: text(input.id, 'INVALID_ACCEPTANCE_ID'), revision: integer(input.revision, 'INVALID_ACCEPTANCE_REVISION'),
    requestId: text(input.requestId, 'INVALID_ACCEPTANCE_REQUEST_ID'), workspaceId: text(input.workspaceId, 'INVALID_ACCEPTANCE_WORKSPACE_ID'),
    validationPlanRequired: booleanValue(input.validationPlanRequired, 'INVALID_VALIDATION_PLAN_REQUIRED'),
    requiredChecks: enumList(input.requiredChecks, VALIDATION_REQUIREMENTS, 'ACCEPTANCE_CHECKS', 6),
    independentReview: oneOf(input.independentReview, ['required', 'optional', 'not_required'], 'INVALID_ACCEPTANCE_REVIEW'),
    evidenceRequired: booleanValue(input.evidenceRequired, 'INVALID_EVIDENCE_REQUIRED'),
    noRegressionRequired: booleanValue(input.noRegressionRequired, 'INVALID_NO_REGRESSION_REQUIRED'),
    operatorConfirmation: oneOf(input.operatorConfirmation, ['required', 'optional', 'not_required'], 'INVALID_OPERATOR_CONFIRMATION'),
    deliverables: enumList(input.deliverables, DELIVERABLE_KINDS, 'ACCEPTANCE_DELIVERABLES', 6, 1)
  };
}

function completion(value: unknown): CompletionPolicy {
  const input = record(value, ['stopAfterPlanning', 'stopBeforeMutation', 'stopOnFirstBlocker', 'boundedRepairAllowed', 'maxRepairAttempts', 'onAmbiguity'], 'COMPLETION');
  return {
    stopAfterPlanning: booleanValue(input.stopAfterPlanning, 'INVALID_STOP_AFTER_PLANNING'),
    stopBeforeMutation: booleanValue(input.stopBeforeMutation, 'INVALID_STOP_BEFORE_MUTATION'),
    stopOnFirstBlocker: booleanValue(input.stopOnFirstBlocker, 'INVALID_STOP_ON_FIRST_BLOCKER'),
    boundedRepairAllowed: booleanValue(input.boundedRepairAllowed, 'INVALID_BOUNDED_REPAIR'),
    maxRepairAttempts: integer(input.maxRepairAttempts, 'INVALID_MAX_REPAIR_ATTEMPTS', 100),
    onAmbiguity: oneOf(input.onAmbiguity, AMBIGUITY_POLICIES, 'INVALID_AMBIGUITY_POLICY') as AmbiguityPolicy
  };
}

function validateScope(value: ResidentOrchestratorRequestFields): void {
  if (value.context.requestId !== value.requestId || value.context.workspaceId !== value.workspaceId) return fail('CONTEXT_SCOPE_MISMATCH');
  if (value.operatorPolicy.reference.requestId !== value.requestId || value.operatorPolicy.reference.workspaceId !== value.workspaceId) return fail('OPERATOR_POLICY_SCOPE_MISMATCH');
  const methodologyRefs = [
    ...value.methodology.requiredWorkflows, ...value.methodology.preferredWorkflows,
    ...value.methodology.requiredSkills, ...value.methodology.preferredSkills
  ];
  if (methodologyRefs.some(ref => ref.requestId !== value.requestId || ref.workspaceId !== value.workspaceId)) return fail('METHODOLOGY_SCOPE_MISMATCH');
  if (value.acceptance.requestId !== value.requestId || value.acceptance.workspaceId !== value.workspaceId) return fail('ACCEPTANCE_SCOPE_MISMATCH');
}

function parse(value: unknown, expectedStatus: 'draft' | 'finalized'): ResidentOrchestratorAnyRequest {
  const allowed = [
    'schemaVersion', 'serialization', 'status', 'requestId', 'workspaceId', 'correlationId', 'causationId',
    'operatorIntentId', 'parentRequestId', 'requestRevision', 'goal', 'context', 'operatorPolicy',
    'sovereignty', 'constraints', 'methodology', 'roles', 'resources', 'requestedEffects', 'acceptance', 'completion',
    ...(expectedStatus === 'finalized' ? ['digest'] : [])
  ];
  const input = record(value, allowed, 'REQUEST');
  if (input.schemaVersion !== RESIDENT_ORCHESTRATOR_SCHEMA_VERSION || input.serialization !== RESIDENT_ORCHESTRATOR_SERIALIZATION) return fail('INVALID_REQUEST_HEADER');
  if (input.status !== expectedStatus) return fail(expectedStatus === 'draft' ? 'FINALIZED_REQUEST_IMMUTABLE' : 'REQUEST_NOT_FINALIZED');
  const base: ResidentOrchestratorRequestFields = {
    schemaVersion: RESIDENT_ORCHESTRATOR_SCHEMA_VERSION,
    serialization: RESIDENT_ORCHESTRATOR_SERIALIZATION,
    requestId: text(input.requestId, 'INVALID_REQUEST_ID'),
    workspaceId: text(input.workspaceId, 'INVALID_WORKSPACE_ID'),
    correlationId: text(input.correlationId, 'INVALID_CORRELATION_ID'),
    causationId: nullableText(input.causationId, 'INVALID_CAUSATION_ID'),
    operatorIntentId: text(input.operatorIntentId, 'INVALID_OPERATOR_INTENT_ID'),
    parentRequestId: nullableText(input.parentRequestId, 'INVALID_PARENT_REQUEST_ID'),
    requestRevision: integer(input.requestRevision, 'INVALID_REQUEST_REVISION'),
    goal: goal(input.goal), context: contextReference(input.context), operatorPolicy: operatorPolicy(input.operatorPolicy),
    sovereignty: oneOf(input.sovereignty, SOVEREIGNTY_POLICIES, 'INVALID_SOVEREIGNTY_POLICY') as SovereigntyPolicy,
    constraints: (() => {
      const constraints = record(input.constraints, ['hard', 'hints'], 'CONSTRAINTS');
      return { hard: hardConstraints(constraints.hard), hints: hints(constraints.hints) } as ConstraintSet;
    })(),
    methodology: methodology(input.methodology), roles: roles(input.roles), resources: resources(input.resources),
    requestedEffects: requestedEffects(input.requestedEffects), acceptance: acceptance(input.acceptance), completion: completion(input.completion)
  };
  validateScope(base);
  if (expectedStatus === 'draft') return { ...base, status: 'draft' };
  return { ...base, status: 'finalized', digest: digest(input.digest, 'INVALID_REQUEST_DIGEST') };
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

function withoutDigest(value: ResidentOrchestratorRequest): Omit<ResidentOrchestratorRequest, 'digest'> {
  const { digest: _digest, ...unsigned } = value;
  void _digest;
  return unsigned;
}

async function sha256(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) return fail('CRYPTO_UNAVAILABLE');
  const bytes = new TextEncoder().encode(value);
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function canonicalResidentOrchestratorJson(value: unknown): string {
  return canonicalContextJson(value);
}

export function createResidentRequestDraft(value: unknown): Readonly<ResidentOrchestratorDraft> {
  return freezeDeep(parse(value, 'draft') as ResidentOrchestratorDraft);
}

export function reviseResidentRequest(currentValue: unknown, nextValue: unknown, expectedRevision: number): Readonly<ResidentOrchestratorDraft> {
  if (isResidentRequestFinalized(currentValue)) return fail('FINALIZED_REQUEST_IMMUTABLE');
  const current = parse(currentValue, 'draft') as ResidentOrchestratorDraft;
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== current.requestRevision) return fail('STALE_REQUEST_REVISION');
  const next = parse(nextValue, 'draft') as ResidentOrchestratorDraft;
  if (next.requestId !== current.requestId || next.workspaceId !== current.workspaceId || next.operatorIntentId !== current.operatorIntentId) return fail('REQUEST_IDENTITY_MISMATCH');
  if (next.requestRevision !== current.requestRevision + 1) return fail('REQUEST_REVISION_SEQUENCE');
  return freezeDeep(next);
}

export async function finalizeResidentRequest(value: unknown): Promise<Readonly<ResidentOrchestratorRequest>> {
  const draft = parse(value, 'draft') as ResidentOrchestratorDraft;
  const unsigned = { ...draft, status: 'finalized' as const };
  const requestDigest = await sha256(canonicalContextJson(unsigned));
  return freezeDeep({ ...unsigned, digest: requestDigest });
}

/** A finalized request is the immutable, normalized projection consumed by the Orchestrator. */
export async function toOrchestratorProjection(value: unknown): Promise<Readonly<OrchestratorRequestProjection>> {
  const parsed = parse(value, 'finalized') as ResidentOrchestratorRequest;
  const expected = await sha256(canonicalContextJson(withoutDigest(parsed)));
  if (parsed.digest !== expected) return fail('REQUEST_DIGEST_MISMATCH');
  return freezeDeep(parsed);
}

export async function hasResidentRequestIntegrity(value: unknown): Promise<boolean> {
  try {
    await toOrchestratorProjection(value);
    return true;
  } catch (error) {
    if (error instanceof ResidentOrchestratorRequestError) return false;
    throw error;
  }
}

export function isResidentRequestFinalized(value: unknown): boolean {
  if (!isPlain(value)) return false;
  const descriptor = Object.getOwnPropertyDescriptor(value, 'status');
  return Boolean(descriptor && 'value' in descriptor && descriptor.enumerable && descriptor.value === 'finalized');
}

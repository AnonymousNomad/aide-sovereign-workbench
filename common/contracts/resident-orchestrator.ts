/**
 * Platform-neutral Resident -> Orchestrator request contracts.
 *
 * These records describe operator intent, constraints and acceptance
 * expectations. They never grant execution authority, select workers, create
 * a plan, or establish a verification result.
 */

export const RESIDENT_ORCHESTRATOR_SCHEMA_VERSION = '1' as const;
export const RESIDENT_ORCHESTRATOR_SERIALIZATION = 'covert-resident-orchestrator-json-v1' as const;

export const REQUEST_STATUSES = ['draft', 'finalized'] as const;
export type RequestStatus = typeof REQUEST_STATUSES[number];

export const TASK_CLASSES = [
  'investigate', 'explain', 'plan', 'modify', 'verify', 'debug', 'review', 'research', 'operate'
] as const;
export type TaskClass = typeof TASK_CLASSES[number];

export const DELIVERABLE_KINDS = ['explanation', 'plan', 'code_change', 'test_evidence', 'report', 'artifact'] as const;
export type DeliverableKind = typeof DELIVERABLE_KINDS[number];

export const SOVEREIGNTY_POLICIES = ['local_only', 'remote_allowed', 'remote_requires_approval'] as const;
export type SovereigntyPolicy = typeof SOVEREIGNTY_POLICIES[number];

export const AUTONOMY_LEVELS = ['manual', 'guided', 'bounded'] as const;
export type AutonomyLevel = typeof AUTONOMY_LEVELS[number];

export const DETAIL_LEVELS = ['concise', 'standard', 'detailed'] as const;
export type DetailLevel = typeof DETAIL_LEVELS[number];

export const CONFIRMATION_POLICIES = ['always', 'on_risk', 'on_ambiguity'] as const;
export type ConfirmationPolicy = typeof CONFIRMATION_POLICIES[number];

export const EXECUTION_INTERACTION_POLICIES = ['allowed', 'disallowed'] as const;
export type ExecutionInteractionPolicy = typeof EXECUTION_INTERACTION_POLICIES[number];

export const TASK_SHAPES = ['exploratory', 'bounded'] as const;
export type TaskShape = typeof TASK_SHAPES[number];

export const MODEL_ROLES = ['planner', 'coder', 'reviewer', 'security', 'research'] as const;
export type ModelRole = typeof MODEL_ROLES[number];

export const RESOURCE_PRESSURE_CLASSES = ['normal', 'constrained', 'critical'] as const;
export type ResourcePressureClass = typeof RESOURCE_PRESSURE_CLASSES[number];

export const MUTATION_CONCURRENCY_POLICIES = ['forbidden', 'serial', 'bounded'] as const;
export type MutationConcurrencyPolicy = typeof MUTATION_CONCURRENCY_POLICIES[number];

export const REQUESTED_RISK_CLASSES = [
  'read_only', 'workspace_mutation', 'process_execution', 'external_egress', 'destructive'
] as const;
export type RequestedRiskClass = typeof REQUESTED_RISK_CLASSES[number];

export const FILE_MUTATION_INTENTS = ['none', 'expected', 'possible'] as const;
export type FileMutationIntent = typeof FILE_MUTATION_INTENTS[number];

export const OPTIONAL_EXECUTION_INTENTS = ['forbidden', 'possible'] as const;
export type OptionalExecutionIntent = typeof OPTIONAL_EXECUTION_INTENTS[number];

export const VALIDATION_REQUIREMENTS = [
  'tests', 'lint', 'typecheck', 'independent_review', 'evidence', 'no_regression'
] as const;
export type ValidationRequirement = typeof VALIDATION_REQUIREMENTS[number];

export const OPERATOR_CONFIRMATION_REQUIREMENTS = ['required', 'optional', 'not_required'] as const;
export type OperatorConfirmationRequirement = typeof OPERATOR_CONFIRMATION_REQUIREMENTS[number];

export const AMBIGUITY_POLICIES = ['ask_operator', 'stop', 'continue_within_constraints'] as const;
export type AmbiguityPolicy = typeof AMBIGUITY_POLICIES[number];

/** Opaque and request/workspace-scoped; this reference is not executable. */
export interface ScopedRequestReference {
  readonly id: string;
  readonly version: string;
  readonly requestId: string;
  readonly workspaceId: string;
}

/** A binding to an already governed Context Envelope, never raw context. */
export interface ContextEnvelopeReference {
  readonly id: string;
  readonly digest: string;
  readonly requestId: string;
  readonly workspaceId: string;
  readonly taskId: string;
  readonly snapshotRef: string;
}

export interface OperatorPolicyReference {
  readonly id: string;
  readonly revision: number;
  readonly requestId: string;
  readonly workspaceId: string;
}

/** Minimal interaction projection; profile history and sensitive preferences stay elsewhere. */
export interface OperatorPolicyProjection {
  readonly reference: OperatorPolicyReference;
  readonly autonomy: AutonomyLevel;
  readonly detail: DetailLevel;
  readonly confirmation: ConfirmationPolicy;
  readonly interactionDuringExecution: ExecutionInteractionPolicy;
  readonly taskShape: TaskShape;
}

export interface GoalSpec {
  readonly statement: string;
  readonly taskClass: TaskClass;
  readonly deliverables: readonly DeliverableKind[];
}

export interface HardConstraints {
  readonly excludedPaths: readonly string[];
  readonly preserveApiCompatibility: boolean;
  readonly maxRiskClass: RequestedRiskClass;
  readonly destructiveEffects: 'forbidden' | 'operator_decision';
  readonly requiredValidation: readonly ValidationRequirement[];
  readonly noUnrelatedChanges: boolean;
}

export interface RequestHints {
  readonly preferExistingTests: boolean;
  readonly preferLocalModel: boolean;
  readonly preferMinimalDiff: boolean;
  readonly workflowFamilies: readonly string[];
  readonly skillFamilies: readonly string[];
}

export interface ConstraintSet {
  readonly hard: HardConstraints;
  readonly hints: RequestHints;
}

export interface MethodologyRequirements {
  readonly requiredWorkflows: readonly ScopedRequestReference[];
  readonly preferredWorkflows: readonly ScopedRequestReference[];
  readonly requiredSkills: readonly ScopedRequestReference[];
  readonly preferredSkills: readonly ScopedRequestReference[];
}

export interface ModelRoleRequirements {
  readonly requiredRoles: readonly ModelRole[];
  readonly independentReviewer: boolean;
  readonly localOnlyModel: boolean;
  readonly maxModelCount: number;
  readonly preferredModelFamilies: readonly string[];
}

export interface ResourceConstraints {
  readonly maxParallelWorkers: number;
  readonly maxWallClockMs: number;
  readonly maxModelInputTokens: number;
  readonly maxModelOutputTokens: number;
  readonly resourcePressure: ResourcePressureClass;
  readonly mutationConcurrency: MutationConcurrencyPolicy;
}

/** Declared planning/risk intent; it never authorizes the described effects. */
export interface RequestedEffectEnvelope {
  readonly riskClass: RequestedRiskClass;
  readonly fileMutation: FileMutationIntent;
  readonly processExecution: OptionalExecutionIntent;
  readonly externalEgress: OptionalExecutionIntent;
  readonly destructiveEffects: OptionalExecutionIntent;
}

/** Requirements for future Veritas; no field in this type is a verdict. */
export interface AcceptanceRequirements {
  readonly id: string;
  readonly revision: number;
  readonly requestId: string;
  readonly workspaceId: string;
  readonly validationPlanRequired: boolean;
  readonly requiredChecks: readonly ValidationRequirement[];
  readonly independentReview: 'required' | 'optional' | 'not_required';
  readonly evidenceRequired: boolean;
  readonly noRegressionRequired: boolean;
  readonly operatorConfirmation: OperatorConfirmationRequirement;
  readonly deliverables: readonly DeliverableKind[];
}

export interface CompletionPolicy {
  readonly stopAfterPlanning: boolean;
  readonly stopBeforeMutation: boolean;
  readonly stopOnFirstBlocker: boolean;
  readonly boundedRepairAllowed: boolean;
  readonly maxRepairAttempts: number;
  readonly onAmbiguity: AmbiguityPolicy;
}

export interface ResidentOrchestratorRequestFields {
  readonly schemaVersion: typeof RESIDENT_ORCHESTRATOR_SCHEMA_VERSION;
  readonly serialization: typeof RESIDENT_ORCHESTRATOR_SERIALIZATION;
  readonly requestId: string;
  readonly workspaceId: string;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly operatorIntentId: string;
  readonly parentRequestId: string | null;
  readonly requestRevision: number;
  readonly goal: GoalSpec;
  readonly context: ContextEnvelopeReference;
  readonly operatorPolicy: OperatorPolicyProjection;
  readonly sovereignty: SovereigntyPolicy;
  readonly constraints: ConstraintSet;
  readonly methodology: MethodologyRequirements;
  readonly roles: ModelRoleRequirements;
  readonly resources: ResourceConstraints;
  readonly requestedEffects: RequestedEffectEnvelope;
  readonly acceptance: AcceptanceRequirements;
  readonly completion: CompletionPolicy;
}

export interface ResidentOrchestratorDraft extends ResidentOrchestratorRequestFields {
  readonly status: 'draft';
}

export interface ResidentOrchestratorRequest extends ResidentOrchestratorRequestFields {
  readonly status: 'finalized';
  /** Deterministic integrity comparison only; never authentication or authority. */
  readonly digest: string;
}

/** Finalized requests are already normalized projections for the Orchestrator. */
export type OrchestratorRequestProjection = ResidentOrchestratorRequest;
export type ResidentOrchestratorAnyRequest = ResidentOrchestratorDraft | ResidentOrchestratorRequest;

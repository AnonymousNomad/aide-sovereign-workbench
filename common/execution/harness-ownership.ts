/**
 * H2 ownership kernel.
 *
 * This module is intentionally an architecture-only runtime.  It does not
 * spawn or terminate a native process and it does not call Execution
 * Authority.  Platform adapters provide an unforgeable native capability to
 * the registry, while H2 records the exact identity, admission and
 * quiescence facts around that capability.
 */

import { canonicalContextJson } from '../context/context-envelope.ts';
import type {
  AdmissionFact,
  AdmissionReservationRef,
  AdmissionState,
  AdmittedOperationRef,
  AuthorityAuditEvent,
  AuthorityConsumptionRef,
  AuthorityConsumptionWatch,
  AuthorityRecorderResult,
  H2ExecutionKind,
  H2FailureCode,
  H2OwnershipFailure,
  H2ProcessKind,
  H2ToolKind,
  LiveGenerationDisposition,
  LiveGenerationHandoffObservation,
  LiveOwnedGenerationRef,
  OwnedExecutionRef,
  OwnedProcessRef,
  OwnedToolInvocationRef,
  OwnershipLossObservation,
  ParentOwnershipRef,
  ProcessDiagnosticObservation,
  ProcessRuntimeObservation,
  ProviderGenerationProofRef,
  QuiescenceObservation,
  RetirementFenceRef,
  ServiceScope,
  TerminationObservation,
  ToolCompletionObservation,
} from '../contracts/harness-ownership.ts';
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
} from '../contracts/harness-execution.ts';

export { HARNESS_OWNERSHIP_DIGEST_DOMAIN, HARNESS_OWNERSHIP_SCHEMA_VERSION, HARNESS_OWNERSHIP_SERIALIZATION } from '../contracts/harness-ownership.ts';
export type * from '../contracts/harness-ownership.ts';
export type {
  Digest,
  HarnessExecutionRequestId,
  HarnessTransactionId,
  OperationId,
  SafeInteger,
  TaskId,
  TaskRevision,
  WorkerAttemptId,
  WorkspaceId
} from '../contracts/harness-execution.ts';

export class HarnessOwnershipError extends Error {
  readonly code: string;

  constructor(code: string, message = code) {
    super(message);
    this.name = 'HarnessOwnershipError';
    this.code = code;
  }
}

const fail = (code: string, message = code): never => { throw new HarnessOwnershipError(code, message); };
const H2_DOMAIN = 'covert-harness-ownership-digest-v1';
const DIGEST_RE = /^[a-f0-9]{64}$/;
const MAX_TEXT = 4096;
const MAX_ITEMS = 100_000;
const MAX_WATCHES = 4096;
const MAX_RECEIPTS = 8192;
const MAX_TOMBSTONES = 16_384;
type Plain = Record<string, unknown>;

function plain(value: unknown): value is Plain {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Walk descriptors only; no accessor is ever invoked. */
function scanInert(value: unknown, ancestors = new Set<object>(), nodes = { count: 0 }): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('NON_JSON_NUMBER');
    return;
  }
  if (typeof value !== 'object') fail('NON_JSON_VALUE');
  if (++nodes.count > MAX_ITEMS) fail('OBJECT_LIMIT');
  const objectValue = value as object;
  if (ancestors.has(objectValue)) fail('JSON_CYCLE');
  const isArray = Array.isArray(objectValue);
  const proto = Object.getPrototypeOf(objectValue);
  if (isArray ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) fail('UNSUPPORTED_OBJECT');
  const keys = Reflect.ownKeys(objectValue);
  if (keys.some(key => typeof key !== 'string')) fail('SYMBOL_KEY');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (isArray) {
    const length = descriptors.length;
    const arrayLength = (objectValue as readonly unknown[]).length;
    if (!length || !('value' in length) || length.value !== arrayLength || keys.length !== arrayLength + 1) fail('INVALID_ARRAY');
    for (let index = 0; index < arrayLength; index++) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) fail('INVALID_ARRAY');
    }
  }
  ancestors.add(objectValue);
  try {
    for (const key of keys) {
      if (isArray && key === 'length') continue;
      if (typeof key !== 'string') return fail('SYMBOL_KEY');
      const descriptor = descriptors[key];
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) fail('ACCESSOR_OR_HIDDEN_PROPERTY');
      const dataDescriptor = descriptor as PropertyDescriptor & { readonly value: unknown };
      scanInert(dataDescriptor.value, ancestors, nodes);
    }
  } finally {
    ancestors.delete(objectValue);
  }
}

function record(value: unknown, allowed: readonly string[], label: string): Plain {
  if (!plain(value)) return fail('INVALID_' + label);
  const allow = new Set(allowed);
  const output = Object.create(null) as Plain;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allow.has(key)) return fail('UNKNOWN_' + label + '_FIELD');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return fail('INVALID_' + label);
    output[key] = descriptor.value;
  }
  return output;
}

function has(value: Plain, key: string): boolean { return Object.prototype.hasOwnProperty.call(value, key); }

function text(value: unknown, code: string, max = MAX_TEXT): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max || value.trim().length < 1) return fail(code);
  return value;
}

function optionalText(input: Plain, key: string, code: string, max = MAX_TEXT): string | undefined {
  return has(input, key) ? text(input[key], code, max) : undefined;
}

function integer(value: unknown, code: string, min = 0): SafeInteger {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) return fail(code);
  return value as SafeInteger;
}

function digest(value: unknown, code: string): Digest {
  const output = text(value, code, 64);
  if (!DIGEST_RE.test(output)) return fail(code);
  return output as Digest;
}

function timestamp(value: unknown, code = 'INVALID_TIMESTAMP'): string {
  const output = text(value, code, 128);
  if (!Number.isFinite(Date.parse(output))) return fail(code);
  return output;
}

function oneOf<T extends string>(value: unknown, values: readonly T[], code: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) return fail(code);
  return value as T;
}

function cloneInert(value: unknown, ancestors = new Set<object>()): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (ancestors.has(value)) return fail('JSON_CYCLE');
  const array = Array.isArray(value);
  const proto = Object.getPrototypeOf(value);
  if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) return fail('UNSUPPORTED_OBJECT');
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== 'string')) return fail('SYMBOL_KEY');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const target: Plain | unknown[] = array ? [] : Object.create(null) as Plain;
  if (array) {
    const length = descriptors.length;
    if (!length || !('value' in length) || keys.length !== (value as readonly unknown[]).length + 1) return fail('INVALID_ARRAY');
  }
  ancestors.add(value);
  try {
    if (array) {
      for (let index = 0; index < (value as readonly unknown[]).length; index++) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return fail('INVALID_ARRAY');
        (target as unknown[]).push(cloneInert(descriptor.value, ancestors));
      }
    } else {
      for (const key of keys) {
        if (typeof key !== 'string') return fail('SYMBOL_KEY');
        const descriptor = descriptors[key];
        if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return fail('ACCESSOR_OR_HIDDEN_PROPERTY');
        (target as Plain)[key] = cloneInert(descriptor.value, ancestors);
      }
    }
  } finally {
    ancestors.delete(value);
  }
  return target;
}

function freezeDeep<T>(value: T, ancestors = new Set<object>()): Readonly<T> {
  if (value !== null && typeof value === 'object') {
    if (ancestors.has(value as object)) return fail('JSON_CYCLE');
    ancestors.add(value as object);
    for (const child of Object.values(value as object)) freezeDeep(child, ancestors);
    ancestors.delete(value as object);
    Object.freeze(value);
  }
  return value as Readonly<T>;
}

function detached<T>(value: T): Readonly<T> {
  scanInert(value);
  return freezeDeep(cloneInert(value) as T);
}

async function sha256Text(value: string): Promise<Digest> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return fail('CRYPTO_UNAVAILABLE');
  const bytes = new TextEncoder().encode(value);
  const hash = await subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('') as Digest;
}

/** Frozen Context/H1 canonicalizer plus H2 domain separation. */
export function canonicalHarnessOwnershipJson(value: unknown): string {
  return canonicalContextJson(value);
}

export async function h2Digest(artifactKind: string, payload: unknown): Promise<Digest> {
  return sha256Text(canonicalContextJson({ domain: H2_DOMAIN, artifactKind, payload }));
}

async function digestArtifact(kind: string, value: Plain, digestField: string): Promise<Digest> {
  const unsigned = Object.create(null) as Plain;
  for (const key of Object.keys(value)) if (key !== digestField) unsigned[key] = value[key];
  return h2Digest(kind, unsigned);
}

function scopeFields(input: Plain, label: string): {
  workspaceId: WorkspaceId;
  taskId: TaskId;
  taskRevision: TaskRevision;
  requestId: HarnessExecutionRequestId;
  attemptId: WorkerAttemptId;
  transactionId: HarnessTransactionId;
} {
  return {
    workspaceId: text(input.workspaceId, 'INVALID_' + label + '_WORKSPACE') as WorkspaceId,
    taskId: text(input.taskId, 'INVALID_' + label + '_TASK') as TaskId,
    taskRevision: integer(input.taskRevision, 'INVALID_' + label + '_REVISION'),
    requestId: text(input.requestId, 'INVALID_' + label + '_REQUEST') as HarnessExecutionRequestId,
    attemptId: text(input.attemptId, 'INVALID_' + label + '_ATTEMPT') as WorkerAttemptId,
    transactionId: text(input.transactionId, 'INVALID_' + label + '_TRANSACTION') as HarnessTransactionId
  };
}

const EXECUTION_KINDS = ['process', 'tool'] as const;
const PROCESS_KINDS = ['short_lived_process', 'persistent_service'] as const;
const TOOL_KINDS = ['in_process', 'rpc', 'git', 'filesystem', 'desktop', 'model_runtime', 'lsp', 'dap', 'terminal'] as const;
const SERVICE_SCOPES = ['workspace', 'project', 'harness-runtime', 'explicit-shared'] as const;
const RUNTIME_OBSERVATIONS = ['spawn_created', 'start_observed', 'running_observed', 'termination_requested', 'exit_observed', 'ownership_lost', 'ownership_uncertain'] as const;
const TERMINATION_OUTCOMES = ['requested', 'exact_generation_exited', 'already_exited', 'survived', 'unconfirmed', 'not_started'] as const;
const TOOL_OUTCOMES = ['completed', 'interrupted', 'terminal', 'uncertain'] as const;
const FAILURE_CODES = ['OWNERSHIP_NOT_PROVEN', 'OWNERSHIP_STALE', 'OWNERSHIP_SCOPE_MISMATCH', 'OWNERSHIP_GENERATION_MISMATCH', 'OWNERSHIP_LOST', 'PROCESS_GENERATION_UNAVAILABLE', 'PID_REUSE_SUSPECTED', 'PORT_REUSE_SUSPECTED', 'FOREIGN_PROCESS_PRESENT', 'DETACHED_PROCESS_UNOWNED', 'DESCENDANT_UNOWNED', 'TERMINATION_NOT_CONFIRMED', 'QUIESCENCE_NOT_PROVEN', 'ADMISSION_NOT_STOPPED', 'ACTIVE_WORK_REMAINS', 'RESTART_RECONCILIATION_REQUIRED', 'TOOL_INVOCATION_NOT_FOUND', 'TARGET_CONFLICT', 'PUBLICATION_NOT_READY', 'FENCE_CONFLICT', 'ADMISSION_REPLAY', 'ADMISSION_CONFLICT', 'BRIDGE_CAPACITY_EXHAUSTED', 'BRIDGE_WATCH_CONFLICT', 'BRIDGE_HEALTH_UNCERTAIN', 'AUTHORITY_OBSERVATION_UNRESOLVED', 'INTERNAL_HARNESS_FAILURE'] as const;
function parseServiceScope(value: unknown): ServiceScope {
  const input = record(value, ['kind', 'scopeId', 'policyDigest'], 'SERVICE_SCOPE');
  return { kind: oneOf(input.kind, SERVICE_SCOPES, 'INVALID_SERVICE_SCOPE_KIND'), scopeId: text(input.scopeId, 'INVALID_SERVICE_SCOPE_ID'), policyDigest: digest(input.policyDigest, 'INVALID_SERVICE_SCOPE_POLICY') };
}

function parseParent(value: unknown): ParentOwnershipRef {
  const input = record(value, ['kind', 'ownershipId', 'bindingGenerationId', 'liveGenerationId', 'workspaceId', 'taskId', 'taskRevision', 'requestId', 'attemptId', 'transactionId', 'provenanceDigest'], 'PARENT_OWNERSHIP');
  if (input.kind !== 'parent-ownership-ref') return fail('INVALID_PARENT_OWNERSHIP_KIND');
  return { kind: 'parent-ownership-ref', ownershipId: text(input.ownershipId, 'INVALID_PARENT_OWNERSHIP_ID'), bindingGenerationId: text(input.bindingGenerationId, 'INVALID_PARENT_BINDING'), liveGenerationId: text(input.liveGenerationId, 'INVALID_PARENT_LIVE_GENERATION'), workspaceId: text(input.workspaceId, 'INVALID_PARENT_OWNERSHIP_WORKSPACE') as WorkspaceId, taskId: text(input.taskId, 'INVALID_PARENT_OWNERSHIP_TASK') as TaskId, taskRevision: integer(input.taskRevision, 'INVALID_PARENT_OWNERSHIP_REVISION'), requestId: text(input.requestId, 'INVALID_PARENT_OWNERSHIP_REQUEST') as HarnessExecutionRequestId, attemptId: text(input.attemptId, 'INVALID_PARENT_OWNERSHIP_ATTEMPT') as WorkerAttemptId, transactionId: text(input.transactionId, 'INVALID_PARENT_OWNERSHIP_TRANSACTION') as HarnessTransactionId, provenanceDigest: digest(input.provenanceDigest, 'INVALID_PARENT_PROVENANCE') };
}

function parseExecution(value: unknown): OwnedExecutionRef {
  const input = record(value, ['kind', 'ownershipId', 'bindingGenerationId', 'workspaceId', 'taskId', 'taskRevision', 'attemptId', 'transactionId', 'requestId', 'operationId', 'operationDigest', 'targetId', 'targetDigest', 'effectScopeDigest', 'executionKind', 'providerId', 'providerVersion', 'parentOwnershipRef', 'provenanceDigest'], 'OWNED_EXECUTION');
  const scope = scopeFields(input, 'OWNED_EXECUTION');
  if (input.kind !== 'owned-execution-ref') return fail('INVALID_OWNED_EXECUTION_KIND');
  const parentOwnershipRef = has(input, 'parentOwnershipRef') ? parseParent(input.parentOwnershipRef) : undefined;
  if (parentOwnershipRef !== undefined &&
      (parentOwnershipRef.workspaceId !== scope.workspaceId ||
       parentOwnershipRef.taskId !== scope.taskId ||
       parentOwnershipRef.taskRevision !== scope.taskRevision ||
       parentOwnershipRef.requestId !== scope.requestId ||
       parentOwnershipRef.attemptId !== scope.attemptId ||
       parentOwnershipRef.transactionId !== scope.transactionId)) return fail('OWNERSHIP_SCOPE_MISMATCH');
  return { kind: 'owned-execution-ref', ownershipId: text(input.ownershipId, 'INVALID_OWNERSHIP_ID'), bindingGenerationId: text(input.bindingGenerationId, 'INVALID_BINDING_GENERATION'), ...scope, operationId: text(input.operationId, 'INVALID_OPERATION_ID') as OperationId, operationDigest: digest(input.operationDigest, 'INVALID_OPERATION_DIGEST'), targetId: text(input.targetId, 'INVALID_TARGET_ID'), targetDigest: digest(input.targetDigest, 'INVALID_TARGET_DIGEST'), effectScopeDigest: digest(input.effectScopeDigest, 'INVALID_EFFECT_SCOPE_DIGEST'), executionKind: oneOf(input.executionKind, EXECUTION_KINDS, 'INVALID_EXECUTION_KIND'), providerId: text(input.providerId, 'INVALID_PROVIDER_ID'), providerVersion: text(input.providerVersion, 'INVALID_PROVIDER_VERSION'), ...(parentOwnershipRef === undefined ? {} : { parentOwnershipRef }), provenanceDigest: digest(input.provenanceDigest, 'INVALID_PROVENANCE_DIGEST') };
}

function parseProviderProof(value: unknown): ProviderGenerationProofRef {
  const input = record(value, ['kind', 'proofId', 'providerId', 'providerVersion', 'executionKind', 'liveGenerationId', 'ownershipId', 'registryEpochId', 'workspaceId', 'taskId', 'taskRevision', 'requestId', 'attemptId', 'transactionId', 'providerGenerationEvidenceDigest', 'creationObservationDigest', 'handoffObservationDigest', 'proofDigest'], 'PROVIDER_PROOF');
  if (input.kind !== 'provider-generation-proof') return fail('INVALID_PROVIDER_PROOF_KIND');
  const handoffObservationDigest = optionalText(input, 'handoffObservationDigest', 'INVALID_HANDOFF_DIGEST', 64);
  if (handoffObservationDigest !== undefined && !DIGEST_RE.test(handoffObservationDigest)) return fail('INVALID_HANDOFF_DIGEST');
  return { kind: 'provider-generation-proof', proofId: text(input.proofId, 'INVALID_PROOF_ID'), providerId: text(input.providerId, 'INVALID_PROVIDER_ID'), providerVersion: text(input.providerVersion, 'INVALID_PROVIDER_VERSION'), executionKind: oneOf(input.executionKind, EXECUTION_KINDS, 'INVALID_PROOF_EXECUTION_KIND'), liveGenerationId: text(input.liveGenerationId, 'INVALID_LIVE_GENERATION_ID'), ownershipId: text(input.ownershipId, 'INVALID_PROOF_OWNERSHIP_ID'), registryEpochId: text(input.registryEpochId, 'INVALID_REGISTRY_EPOCH'), workspaceId: text(input.workspaceId, 'INVALID_PROVIDER_PROOF_WORKSPACE') as WorkspaceId, taskId: text(input.taskId, 'INVALID_PROVIDER_PROOF_TASK') as TaskId, taskRevision: integer(input.taskRevision, 'INVALID_PROVIDER_PROOF_REVISION'), requestId: text(input.requestId, 'INVALID_PROVIDER_PROOF_REQUEST') as HarnessExecutionRequestId, attemptId: text(input.attemptId, 'INVALID_PROVIDER_PROOF_ATTEMPT') as WorkerAttemptId, transactionId: text(input.transactionId, 'INVALID_PROVIDER_PROOF_TRANSACTION') as HarnessTransactionId, providerGenerationEvidenceDigest: digest(input.providerGenerationEvidenceDigest, 'INVALID_PROVIDER_GENERATION_EVIDENCE'), creationObservationDigest: digest(input.creationObservationDigest, 'INVALID_CREATION_OBSERVATION'), ...(handoffObservationDigest === undefined ? {} : { handoffObservationDigest: handoffObservationDigest as Digest }), proofDigest: digest(input.proofDigest, 'INVALID_PROOF_DIGEST') };
}

function parseLive(value: unknown): LiveOwnedGenerationRef {
  const input = record(value, ['kind', 'liveGenerationId', 'registryEpochId', 'providerId', 'providerVersion', 'executionKind', 'processKind', 'toolKind', 'targetId', 'targetDigest', 'serviceScope', 'providerGenerationProofRef', 'originOwnershipId', 'originBindingGenerationId', 'originRequestId', 'originTransactionId', 'creationProvenanceDigest', 'liveGenerationDigest'], 'LIVE_GENERATION');
  if (input.kind !== 'live-owned-generation-ref') return fail('INVALID_LIVE_GENERATION_KIND');
  const processKind = optionalText(input, 'processKind', 'INVALID_PROCESS_KIND');
  const toolKind = optionalText(input, 'toolKind', 'INVALID_TOOL_KIND');
  if (processKind !== undefined && !PROCESS_KINDS.includes(processKind as H2ProcessKind)) return fail('INVALID_PROCESS_KIND');
  if (toolKind !== undefined && !TOOL_KINDS.includes(toolKind as H2ToolKind)) return fail('INVALID_TOOL_KIND');
  if (input.executionKind === 'process' && processKind === undefined) return fail('PROCESS_KIND_REQUIRED');
  if (input.executionKind === 'tool' && toolKind === undefined) return fail('TOOL_KIND_REQUIRED');
  if (processKind !== undefined && toolKind !== undefined) return fail('LIVE_KIND_CONFLICT');
  const liveGenerationId = text(input.liveGenerationId, 'INVALID_LIVE_GENERATION_ID');
  const registryEpochId = text(input.registryEpochId, 'INVALID_REGISTRY_EPOCH');
  const providerId = text(input.providerId, 'INVALID_PROVIDER_ID');
  const providerVersion = text(input.providerVersion, 'INVALID_PROVIDER_VERSION');
  const executionKind = oneOf(input.executionKind, EXECUTION_KINDS, 'INVALID_LIVE_EXECUTION_KIND');
  const targetId = text(input.targetId, 'INVALID_TARGET_ID');
  const targetDigest = digest(input.targetDigest, 'INVALID_TARGET_DIGEST');
  const providerGenerationProofRef = parseProviderProof(input.providerGenerationProofRef);
  if (providerGenerationProofRef.liveGenerationId !== liveGenerationId ||
      providerGenerationProofRef.registryEpochId !== registryEpochId ||
      providerGenerationProofRef.providerId !== providerId ||
      providerGenerationProofRef.providerVersion !== providerVersion ||
      providerGenerationProofRef.executionKind !== executionKind ||
      providerGenerationProofRef.ownershipId !== input.originOwnershipId ||
      providerGenerationProofRef.requestId !== input.originRequestId ||
      providerGenerationProofRef.transactionId !== input.originTransactionId) return fail('OWNERSHIP_SCOPE_MISMATCH');
  return { kind: 'live-owned-generation-ref', liveGenerationId, registryEpochId, providerId, providerVersion, executionKind, ...(processKind === undefined ? {} : { processKind: processKind as H2ProcessKind }), ...(toolKind === undefined ? {} : { toolKind: toolKind as H2ToolKind }), targetId, targetDigest, serviceScope: parseServiceScope(input.serviceScope), providerGenerationProofRef, originOwnershipId: text(input.originOwnershipId, 'INVALID_ORIGIN_OWNERSHIP'), originBindingGenerationId: text(input.originBindingGenerationId, 'INVALID_ORIGIN_BINDING'), originRequestId: text(input.originRequestId, 'INVALID_ORIGIN_REQUEST') as HarnessExecutionRequestId, originTransactionId: text(input.originTransactionId, 'INVALID_ORIGIN_TRANSACTION') as HarnessTransactionId, creationProvenanceDigest: digest(input.creationProvenanceDigest, 'INVALID_CREATION_PROVENANCE'), liveGenerationDigest: digest(input.liveGenerationDigest, 'INVALID_LIVE_DIGEST') };
}

function parseDiagnostic(value: unknown): ProcessDiagnosticObservation {
  const input = record(value, ['pid', 'port', 'processName', 'executableName', 'commandLineDigest'], 'PROCESS_DIAGNOSTIC');
  const output: ProcessDiagnosticObservation = {};
  if (has(input, 'pid')) (output as { pid: SafeInteger }).pid = integer(input.pid, 'INVALID_PID', 1);
  if (has(input, 'port')) (output as { port: SafeInteger }).port = integer(input.port, 'INVALID_PORT', 1);
  if (has(input, 'processName')) (output as { processName: string }).processName = text(input.processName, 'INVALID_PROCESS_NAME');
  if (has(input, 'executableName')) (output as { executableName: string }).executableName = text(input.executableName, 'INVALID_EXECUTABLE_NAME');
  if (has(input, 'commandLineDigest')) (output as { commandLineDigest: Digest }).commandLineDigest = digest(input.commandLineDigest, 'INVALID_COMMAND_DIGEST');
  return output;
}

function parseProcess(value: unknown): OwnedProcessRef {
  const input = record(value, ['kind', 'executionRef', 'liveGenerationRef', 'providerGenerationProofRef', 'bindingDigest', 'diagnosticObservation'], 'OWNED_PROCESS');
  if (input.kind !== 'owned-process-ref') return fail('INVALID_OWNED_PROCESS_KIND');
  const executionRef = parseExecution(input.executionRef);
  const liveGenerationRef = parseLive(input.liveGenerationRef);
  const providerGenerationProofRef = parseProviderProof(input.providerGenerationProofRef);
  if (executionRef.executionKind !== 'process' || liveGenerationRef.executionKind !== 'process' ||
      liveGenerationRef.liveGenerationId !== providerGenerationProofRef.liveGenerationId ||
      liveGenerationRef.registryEpochId !== providerGenerationProofRef.registryEpochId ||
      liveGenerationRef.providerId !== providerGenerationProofRef.providerId ||
      liveGenerationRef.providerVersion !== providerGenerationProofRef.providerVersion ||
      executionRef.providerId !== liveGenerationRef.providerId ||
      executionRef.providerVersion !== liveGenerationRef.providerVersion ||
      executionRef.targetId !== liveGenerationRef.targetId ||
      executionRef.targetDigest !== liveGenerationRef.targetDigest ||
      providerGenerationProofRef.ownershipId !== liveGenerationRef.originOwnershipId ||
      providerGenerationProofRef.requestId !== liveGenerationRef.originRequestId ||
      providerGenerationProofRef.transactionId !== liveGenerationRef.originTransactionId) return fail('OWNERSHIP_SCOPE_MISMATCH');
  const diagnosticObservation = has(input, 'diagnosticObservation') ? parseDiagnostic(input.diagnosticObservation) : undefined;
  return { kind: 'owned-process-ref', executionRef, liveGenerationRef, providerGenerationProofRef, bindingDigest: digest(input.bindingDigest, 'INVALID_PROCESS_BINDING_DIGEST'), ...(diagnosticObservation === undefined ? {} : { diagnosticObservation }) };
}

function parseTool(value: unknown): OwnedToolInvocationRef {
  const input = record(value, ['kind', 'executionRef', 'liveGenerationId', 'invocationId', 'normalizedInputDigest', 'toolKind', 'toolInvocationProvenanceDigest', 'bindingDigest'], 'OWNED_TOOL');
  if (input.kind !== 'owned-tool-invocation-ref') return fail('INVALID_OWNED_TOOL_KIND');
  const executionRef = parseExecution(input.executionRef);
  const toolKind = oneOf(input.toolKind, TOOL_KINDS, 'INVALID_TOOL_KIND');
  if (executionRef.executionKind !== 'tool') return fail('OWNERSHIP_SCOPE_MISMATCH');
  return { kind: 'owned-tool-invocation-ref', executionRef, liveGenerationId: text(input.liveGenerationId, 'INVALID_LIVE_GENERATION_ID'), invocationId: text(input.invocationId, 'INVALID_INVOCATION_ID'), normalizedInputDigest: digest(input.normalizedInputDigest, 'INVALID_TOOL_INPUT_DIGEST'), toolKind, toolInvocationProvenanceDigest: digest(input.toolInvocationProvenanceDigest, 'INVALID_TOOL_PROVENANCE'), bindingDigest: digest(input.bindingDigest, 'INVALID_TOOL_BINDING_DIGEST') };
}

function parseReservation(value: unknown): AdmissionReservationRef {
  const input = record(value, ['kind', 'admissionId', 'bindingGenerationId', 'liveGenerationId', 'workspaceId', 'taskId', 'taskRevision', 'requestId', 'attemptId', 'transactionId', 'operationId', 'operationDigest', 'targetId', 'targetDigest', 'effectScopeDigest', 'providerId', 'providerVersion', 'reservationDigest'], 'RESERVATION');
  const scope = scopeFields(input, 'RESERVATION');
  if (input.kind !== 'admission-reservation-ref') return fail('INVALID_RESERVATION_KIND');
  return { kind: 'admission-reservation-ref', admissionId: text(input.admissionId, 'INVALID_ADMISSION_ID'), bindingGenerationId: text(input.bindingGenerationId, 'INVALID_BINDING_GENERATION'), liveGenerationId: text(input.liveGenerationId, 'INVALID_LIVE_GENERATION_ID'), ...scope, operationId: text(input.operationId, 'INVALID_OPERATION_ID') as OperationId, operationDigest: digest(input.operationDigest, 'INVALID_OPERATION_DIGEST'), targetId: text(input.targetId, 'INVALID_TARGET_ID'), targetDigest: digest(input.targetDigest, 'INVALID_TARGET_DIGEST'), effectScopeDigest: digest(input.effectScopeDigest, 'INVALID_EFFECT_SCOPE_DIGEST'), providerId: text(input.providerId, 'INVALID_PROVIDER_ID'), providerVersion: text(input.providerVersion, 'INVALID_PROVIDER_VERSION'), reservationDigest: digest(input.reservationDigest, 'INVALID_RESERVATION_DIGEST') };
}

function parseAdmitted(value: unknown): AdmittedOperationRef {
  const input = record(value, ['kind', 'admissionId', 'reservationId', 'bindingGenerationId', 'liveGenerationId', 'workspaceId', 'taskId', 'taskRevision', 'requestId', 'attemptId', 'transactionId', 'operationId', 'operationDigest', 'targetId', 'targetDigest', 'effectScopeDigest', 'providerId', 'providerVersion', 'admissionSequence', 'admissionDigest'], 'ADMITTED_OPERATION');
  const scope = scopeFields(input, 'ADMITTED_OPERATION');
  if (input.kind !== 'admitted-operation-ref') return fail('INVALID_ADMITTED_OPERATION_KIND');
  return { kind: 'admitted-operation-ref', admissionId: text(input.admissionId, 'INVALID_ADMISSION_ID'), reservationId: text(input.reservationId, 'INVALID_RESERVATION_ID'), bindingGenerationId: text(input.bindingGenerationId, 'INVALID_BINDING_GENERATION'), liveGenerationId: text(input.liveGenerationId, 'INVALID_LIVE_GENERATION_ID'), ...scope, operationId: text(input.operationId, 'INVALID_OPERATION_ID') as OperationId, operationDigest: digest(input.operationDigest, 'INVALID_OPERATION_DIGEST'), targetId: text(input.targetId, 'INVALID_TARGET_ID'), targetDigest: digest(input.targetDigest, 'INVALID_TARGET_DIGEST'), effectScopeDigest: digest(input.effectScopeDigest, 'INVALID_EFFECT_SCOPE_DIGEST'), providerId: text(input.providerId, 'INVALID_PROVIDER_ID'), providerVersion: text(input.providerVersion, 'INVALID_PROVIDER_VERSION'), admissionSequence: integer(input.admissionSequence, 'INVALID_ADMISSION_SEQUENCE', 1), admissionDigest: digest(input.admissionDigest, 'INVALID_ADMISSION_DIGEST') };
}

function parseFence(value: unknown): RetirementFenceRef {
  const input = record(value, ['kind', 'liveGenerationId', 'registryEpochId', 'stopTransactionId', 'bindingGenerationId', 'admissionReservationId', 'operationDigest', 'targetDigest', 'fenceGeneration', 'fenceDigest'], 'RETIREMENT_FENCE');
  if (input.kind !== 'retirement-fence-ref') return fail('INVALID_RETIREMENT_FENCE_KIND');
  return { kind: 'retirement-fence-ref', liveGenerationId: text(input.liveGenerationId, 'INVALID_LIVE_GENERATION_ID'), registryEpochId: text(input.registryEpochId, 'INVALID_REGISTRY_EPOCH'), stopTransactionId: text(input.stopTransactionId, 'INVALID_STOP_TRANSACTION') as HarnessTransactionId, bindingGenerationId: text(input.bindingGenerationId, 'INVALID_BINDING_GENERATION'), admissionReservationId: text(input.admissionReservationId, 'INVALID_RESERVATION_ID'), operationDigest: digest(input.operationDigest, 'INVALID_OPERATION_DIGEST'), targetDigest: digest(input.targetDigest, 'INVALID_TARGET_DIGEST'), fenceGeneration: integer(input.fenceGeneration, 'INVALID_FENCE_GENERATION', 1), fenceDigest: digest(input.fenceDigest, 'INVALID_FENCE_DIGEST') };
}

function parseAuthorityReceipt(value: unknown): AuthorityConsumptionRef {
  const input = record(value, ['kind', 'authorityOperationId', 'authorityRevision', 'workspaceId', 'taskId', 'operationKind', 'descriptorDigest', 'actorId', 'ownerId', 'decision', 'consumedTimestamp', 'bridgeEpochId', 'bridgeReceiptId', 'reservationId', 'bindingGenerationId', 'requestId', 'attemptId', 'transactionId', 'receiptDigest'], 'AUTHORITY_RECEIPT');
  if (input.kind !== 'authority-consumption-ref') return fail('INVALID_AUTHORITY_RECEIPT_KIND');
  return { kind: 'authority-consumption-ref', authorityOperationId: text(input.authorityOperationId, 'INVALID_AUTHORITY_OPERATION'), authorityRevision: integer(input.authorityRevision, 'INVALID_AUTHORITY_REVISION', 1), workspaceId: text(input.workspaceId, 'INVALID_AUTHORITY_WORKSPACE'), taskId: text(input.taskId, 'INVALID_AUTHORITY_TASK'), operationKind: text(input.operationKind, 'INVALID_AUTHORITY_KIND'), descriptorDigest: digest(input.descriptorDigest, 'INVALID_AUTHORITY_DESCRIPTOR_DIGEST'), actorId: text(input.actorId, 'INVALID_AUTHORITY_ACTOR'), ownerId: text(input.ownerId, 'INVALID_AUTHORITY_OWNER'), decision: input.decision === 'consumed' ? 'consumed' : fail('INVALID_AUTHORITY_DECISION'), consumedTimestamp: timestamp(input.consumedTimestamp, 'INVALID_CONSUMED_TIMESTAMP'), bridgeEpochId: text(input.bridgeEpochId, 'INVALID_BRIDGE_EPOCH'), bridgeReceiptId: text(input.bridgeReceiptId, 'INVALID_BRIDGE_RECEIPT'), reservationId: text(input.reservationId, 'INVALID_RESERVATION_ID'), bindingGenerationId: text(input.bindingGenerationId, 'INVALID_BINDING_GENERATION'), requestId: text(input.requestId, 'INVALID_AUTHORITY_REQUEST') as HarnessExecutionRequestId, attemptId: text(input.attemptId, 'INVALID_AUTHORITY_ATTEMPT') as WorkerAttemptId, transactionId: text(input.transactionId, 'INVALID_AUTHORITY_TRANSACTION') as HarnessTransactionId, receiptDigest: digest(input.receiptDigest, 'INVALID_RECEIPT_DIGEST') };
}

function eventFingerprint(event: AuthorityAuditEvent): string {
  return canonicalContextJson({ type: event.type, ts: event.ts, workspace: event.workspace, operation_id: event.operation_id, actor_id: event.actor_id, owner_id: event.owner_id, task_id: event.task_id, kind: event.kind, digest: event.digest, policy_revision: event.policy_revision, decision: event.decision, approver_id: event.approver_id ?? null, origin: event.origin ?? null });
}

function sameReceiptIdentity(a: AuthorityConsumptionRef, b: AuthorityConsumptionRef): boolean {
  return a.kind === b.kind &&
    a.authorityOperationId === b.authorityOperationId &&
    a.authorityRevision === b.authorityRevision &&
    a.workspaceId === b.workspaceId &&
    a.taskId === b.taskId &&
    a.operationKind === b.operationKind &&
    a.descriptorDigest === b.descriptorDigest &&
    a.actorId === b.actorId &&
    a.ownerId === b.ownerId &&
    a.decision === b.decision &&
    a.consumedTimestamp === b.consumedTimestamp &&
    a.bridgeEpochId === b.bridgeEpochId &&
    a.bridgeReceiptId === b.bridgeReceiptId &&
    a.reservationId === b.reservationId &&
    a.bindingGenerationId === b.bindingGenerationId &&
    a.requestId === b.requestId &&
    a.attemptId === b.attemptId &&
    a.transactionId === b.transactionId &&
    a.receiptDigest === b.receiptDigest;
}

function validateAuthorityEvent(value: unknown): AuthorityAuditEvent {
  const input = record(value, ['type', 'ts', 'workspace', 'operation_id', 'actor_id', 'owner_id', 'task_id', 'kind', 'digest', 'policy_revision', 'decision', 'approver_id', 'origin'], 'AUTHORITY_EVENT');
  const approverId = optionalText(input, 'approver_id', 'INVALID_AUTHORITY_APPROVER');
  const origin = has(input, 'origin') ? (typeof input.origin === 'number' || typeof input.origin === 'string' ? input.origin : fail('INVALID_AUTHORITY_ORIGIN')) : undefined;
  if (input.type !== 'authority') return fail('INVALID_AUTHORITY_EVENT_TYPE');
  return { type: 'authority', ts: timestamp(input.ts), workspace: text(input.workspace, 'INVALID_AUTHORITY_EVENT_WORKSPACE'), operation_id: text(input.operation_id, 'INVALID_AUTHORITY_EVENT_OPERATION'), actor_id: text(input.actor_id, 'INVALID_AUTHORITY_EVENT_ACTOR'), owner_id: text(input.owner_id, 'INVALID_AUTHORITY_EVENT_OWNER'), task_id: text(input.task_id, 'INVALID_AUTHORITY_EVENT_TASK'), kind: text(input.kind, 'INVALID_AUTHORITY_EVENT_KIND'), digest: digest(input.digest, 'INVALID_AUTHORITY_EVENT_DIGEST'), policy_revision: integer(input.policy_revision, 'INVALID_AUTHORITY_EVENT_REVISION', 1), decision: text(input.decision, 'INVALID_AUTHORITY_EVENT_DECISION'), ...(approverId === undefined ? {} : { approver_id: approverId }), ...(origin === undefined ? {} : { origin }) };
}

function peekStringField(value: unknown, key: string): string | undefined {
  if (!plain(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'string') return undefined;
  return descriptor.value;
}

function parseWatch(value: unknown): AuthorityConsumptionWatch {
  const input = record(value, ['kind', 'watchId', 'authorityOperationId', 'authorityRevision', 'workspaceId', 'taskId', 'operationKind', 'descriptorDigest', 'actorId', 'ownerId', 'reservationId', 'bindingGenerationId', 'requestId', 'attemptId', 'transactionId', 'bridgeEpochId', 'watchDigest'], 'AUTHORITY_WATCH');
  if (input.kind !== 'authority-consumption-watch') return fail('INVALID_WATCH_KIND');
  return { kind: 'authority-consumption-watch', watchId: text(input.watchId, 'INVALID_WATCH_ID'), authorityOperationId: text(input.authorityOperationId, 'INVALID_AUTHORITY_OPERATION'), authorityRevision: integer(input.authorityRevision, 'INVALID_AUTHORITY_REVISION', 1), workspaceId: text(input.workspaceId, 'INVALID_WATCH_WORKSPACE'), taskId: text(input.taskId, 'INVALID_WATCH_TASK'), operationKind: text(input.operationKind, 'INVALID_WATCH_OPERATION_KIND'), descriptorDigest: digest(input.descriptorDigest, 'INVALID_WATCH_DIGEST'), actorId: text(input.actorId, 'INVALID_WATCH_ACTOR'), ownerId: text(input.ownerId, 'INVALID_WATCH_OWNER'), reservationId: text(input.reservationId, 'INVALID_WATCH_RESERVATION'), bindingGenerationId: text(input.bindingGenerationId, 'INVALID_WATCH_BINDING'), requestId: text(input.requestId, 'INVALID_WATCH_REQUEST') as HarnessExecutionRequestId, attemptId: text(input.attemptId, 'INVALID_WATCH_ATTEMPT') as WorkerAttemptId, transactionId: text(input.transactionId, 'INVALID_WATCH_TRANSACTION') as HarnessTransactionId, bridgeEpochId: text(input.bridgeEpochId, 'INVALID_WATCH_EPOCH'), watchDigest: digest(input.watchDigest, 'INVALID_WATCH_ARTIFACT_DIGEST') };
}

function parseProcessRuntimeObservation(value: unknown): Omit<ProcessRuntimeObservation, 'kind' | 'observationDigest'> {
  const input = record(value, ['observationId', 'observation', 'ownershipId', 'liveGenerationId', 'registryEpochId', 'bindingGenerationId', 'admissionId', 'workspaceId', 'taskId', 'taskRevision', 'requestId', 'attemptId', 'transactionId', 'observedAt', 'providerGenerationEvidenceDigest', 'detail'], 'PROCESS_OBSERVATION');
  const scope = scopeFields(input, 'PROCESS_OBSERVATION');
  const bindingGenerationId = optionalText(input, 'bindingGenerationId', 'INVALID_BINDING_GENERATION');
  const admissionId = optionalText(input, 'admissionId', 'INVALID_ADMISSION_ID');
  const detail = optionalText(input, 'detail', 'INVALID_OBSERVATION_DETAIL');
  return { observationId: text(input.observationId, 'INVALID_OBSERVATION_ID'), observation: oneOf(input.observation, RUNTIME_OBSERVATIONS, 'INVALID_RUNTIME_OBSERVATION'), ownershipId: text(input.ownershipId, 'INVALID_OWNERSHIP_ID'), liveGenerationId: text(input.liveGenerationId, 'INVALID_LIVE_GENERATION_ID'), registryEpochId: text(input.registryEpochId, 'INVALID_REGISTRY_EPOCH'), ...(bindingGenerationId === undefined ? {} : { bindingGenerationId }), ...(admissionId === undefined ? {} : { admissionId }), ...scope, observedAt: timestamp(input.observedAt), providerGenerationEvidenceDigest: digest(input.providerGenerationEvidenceDigest, 'INVALID_PROVIDER_GENERATION_EVIDENCE'), ...(detail === undefined ? {} : { detail }) } as Omit<ProcessRuntimeObservation, 'kind' | 'observationDigest'>;
}

function parseToolCompletionObservation(value: unknown): Omit<ToolCompletionObservation, 'kind' | 'observationDigest'> {
  const input = record(value, ['observationId', 'invocationId', 'ownershipId', 'bindingGenerationId', 'workspaceId', 'taskId', 'taskRevision', 'requestId', 'attemptId', 'transactionId', 'registryEpochId', 'outcome', 'providerProvesInactive', 'observedAt'], 'TOOL_OBSERVATION');
  const scope = scopeFields(input, 'TOOL_OBSERVATION');
  if (typeof input.providerProvesInactive !== 'boolean') return fail('INVALID_TOOL_INACTIVE_PROOF');
  return { observationId: text(input.observationId, 'INVALID_OBSERVATION_ID'), invocationId: text(input.invocationId, 'INVALID_INVOCATION_ID'), ownershipId: text(input.ownershipId, 'INVALID_OWNERSHIP_ID'), bindingGenerationId: text(input.bindingGenerationId, 'INVALID_BINDING_GENERATION'), ...scope, registryEpochId: text(input.registryEpochId, 'INVALID_REGISTRY_EPOCH'), outcome: oneOf(input.outcome, TOOL_OUTCOMES, 'INVALID_TOOL_OUTCOME'), providerProvesInactive: input.providerProvesInactive, observedAt: timestamp(input.observedAt) };
}

function parseTerminationObservation(value: unknown): Omit<TerminationObservation, 'kind' | 'observationDigest'> {
  const input = record(value, ['observationId', 'ownershipId', 'liveGenerationId', 'registryEpochId', 'admissionId', 'workspaceId', 'taskId', 'taskRevision', 'requestId', 'attemptId', 'transactionId', 'outcome', 'dispatchStarted', 'exactGenerationProven', 'observedAt'], 'TERMINATION_OBSERVATION');
  const scope = scopeFields(input, 'TERMINATION_OBSERVATION');
  if (typeof input.dispatchStarted !== 'boolean' || typeof input.exactGenerationProven !== 'boolean') return fail('INVALID_TERMINATION_OBSERVATION');
  return { observationId: text(input.observationId, 'INVALID_OBSERVATION_ID'), ownershipId: text(input.ownershipId, 'INVALID_OWNERSHIP_ID'), liveGenerationId: text(input.liveGenerationId, 'INVALID_LIVE_GENERATION_ID'), registryEpochId: text(input.registryEpochId, 'INVALID_REGISTRY_EPOCH'), admissionId: text(input.admissionId, 'INVALID_ADMISSION_ID'), ...scope, outcome: oneOf(input.outcome, TERMINATION_OUTCOMES, 'INVALID_TERMINATION_OUTCOME'), dispatchStarted: input.dispatchStarted, exactGenerationProven: input.exactGenerationProven, observedAt: timestamp(input.observedAt) };
}

function parseOwnershipLossObservation(value: unknown): Omit<OwnershipLossObservation, 'kind' | 'observationDigest'> {
  const input = record(value, ['observationId', 'ownershipId', 'liveGenerationId', 'registryEpochId', 'workspaceId', 'taskId', 'taskRevision', 'requestId', 'attemptId', 'transactionId', 'reason', 'observedAt'], 'OWNERSHIP_LOSS_OBSERVATION');
  const scope = scopeFields(input, 'OWNERSHIP_LOSS_OBSERVATION');
  return { observationId: text(input.observationId, 'INVALID_OBSERVATION_ID'), ownershipId: text(input.ownershipId, 'INVALID_OWNERSHIP_ID'), liveGenerationId: text(input.liveGenerationId, 'INVALID_LIVE_GENERATION_ID'), registryEpochId: text(input.registryEpochId, 'INVALID_REGISTRY_EPOCH'), ...scope, reason: text(input.reason, 'INVALID_OWNERSHIP_LOSS_REASON'), observedAt: timestamp(input.observedAt) };
}

function parseHandoffObservation(value: unknown): Omit<LiveGenerationHandoffObservation, 'kind' | 'observationDigest'> {
  const input = record(value, ['observationId', 'originOwnershipId', 'originBindingGenerationId', 'liveGenerationId', 'registryEpochId', 'workspaceId', 'taskId', 'taskRevision', 'requestId', 'attemptId', 'originTransactionId', 'targetId', 'providerGenerationEvidenceDigest', 'noUnresolvedLaunchWork', 'noUnresolvedDescendants', 'responsibilityTransferred', 'published', 'observedAt'], 'HANDOFF_OBSERVATION');
  const scope = scopeFields({ ...input, transactionId: input.originTransactionId }, 'HANDOFF_OBSERVATION');
  if (input.noUnresolvedLaunchWork !== true || input.noUnresolvedDescendants !== true || input.responsibilityTransferred !== true || input.published !== true) return fail('PUBLICATION_NOT_READY');
  return { observationId: text(input.observationId, 'INVALID_OBSERVATION_ID'), originOwnershipId: text(input.originOwnershipId, 'INVALID_ORIGIN_OWNERSHIP'), originBindingGenerationId: text(input.originBindingGenerationId, 'INVALID_ORIGIN_BINDING'), liveGenerationId: text(input.liveGenerationId, 'INVALID_LIVE_GENERATION_ID'), registryEpochId: text(input.registryEpochId, 'INVALID_REGISTRY_EPOCH'), workspaceId: scope.workspaceId, taskId: scope.taskId, taskRevision: scope.taskRevision, requestId: scope.requestId, attemptId: scope.attemptId, originTransactionId: text(input.originTransactionId, 'INVALID_HANDOFF_TRANSACTION') as HarnessTransactionId, targetId: text(input.targetId, 'INVALID_TARGET_ID'), providerGenerationEvidenceDigest: digest(input.providerGenerationEvidenceDigest, 'INVALID_PROVIDER_GENERATION_EVIDENCE'), noUnresolvedLaunchWork: true, noUnresolvedDescendants: true, responsibilityTransferred: true, published: true, observedAt: timestamp(input.observedAt) };
}

async function makeDigestArtifact<T extends Plain>(kind: string, value: T, field: string): Promise<Readonly<T>> {
  const copy = detached(value) as T;
  const digestValue = await digestArtifact(kind, copy, field);
  const withDigest = { ...copy, [field]: digestValue } as T;
  return detached(withDigest);
}

function validateShape<T>(value: unknown, parser: (value: unknown) => T): Readonly<T> {
  scanInert(value);
  return detached(parser(value));
}

async function validateIntegrity<T>(value: unknown, parser: (value: unknown) => T, kind: string, field: string): Promise<boolean> {
  try {
    scanInert(value);
    const parsed = parser(value);
    const supplied = (parsed as unknown as Plain)[field];
    if (typeof supplied !== 'string' || !DIGEST_RE.test(supplied)) return false;
    return supplied === await digestArtifact(kind, parsed as unknown as Plain, field);
  } catch (error) {
    if (error instanceof HarnessOwnershipError) return false;
    throw error;
  }
}

export function validateOwnedExecutionRef(value: unknown): Readonly<OwnedExecutionRef> { return validateShape(value, parseExecution); }
export function validateProviderGenerationProofRef(value: unknown): Readonly<ProviderGenerationProofRef> { return validateShape(value, parseProviderProof); }
export function validateLiveOwnedGenerationRef(value: unknown): Readonly<LiveOwnedGenerationRef> { return validateShape(value, parseLive); }
export function validateOwnedProcessRef(value: unknown): Readonly<OwnedProcessRef> { return validateShape(value, parseProcess); }
export function validateOwnedToolInvocationRef(value: unknown): Readonly<OwnedToolInvocationRef> { return validateShape(value, parseTool); }
export function validateAdmissionReservationRef(value: unknown): Readonly<AdmissionReservationRef> { return validateShape(value, parseReservation); }
export function validateAdmittedOperationRef(value: unknown): Readonly<AdmittedOperationRef> { return validateShape(value, parseAdmitted); }
export function validateAuthorityConsumptionRef(value: unknown): Readonly<AuthorityConsumptionRef> { return validateShape(value, parseAuthorityReceipt); }
export function validateAuthorityConsumptionWatch(value: unknown): Readonly<AuthorityConsumptionWatch> { return validateShape(value, parseWatch); }
export function validateRetirementFenceRef(value: unknown): Readonly<RetirementFenceRef> { return validateShape(value, parseFence); }

export async function hasOwnedExecutionIntegrity(value: unknown): Promise<boolean> {
  try {
    scanInert(value);
    const parsed = parseExecution(value);
    if (parsed.provenanceDigest !== await digestArtifact('owned-execution-ref', parsed as unknown as Plain, 'provenanceDigest')) return false;
    return parsed.parentOwnershipRef === undefined || await validateParentIntegrity(parsed.parentOwnershipRef);
  } catch (error) {
    if (error instanceof HarnessOwnershipError) return false;
    throw error;
  }
}
export const hasProviderGenerationProofIntegrity = (value: unknown): Promise<boolean> => validateIntegrity(value, parseProviderProof, 'provider-generation-proof', 'proofDigest');
async function validateParentIntegrity(value: ParentOwnershipRef): Promise<boolean> {
  return value.provenanceDigest === await digestArtifact('parent-ownership-ref', value as unknown as Plain, 'provenanceDigest');
}
export async function hasLiveGenerationIntegrity(value: unknown): Promise<boolean> {
  try {
    scanInert(value);
    const parsed = parseLive(value);
    if (parsed.liveGenerationDigest !== await digestArtifact('live-owned-generation-ref', parsed as unknown as Plain, 'liveGenerationDigest')) return false;
    const proof = parsed.providerGenerationProofRef;
    if (proof.ownershipId !== parsed.originOwnershipId || proof.requestId !== parsed.originRequestId || proof.transactionId !== parsed.originTransactionId) return false;
    return await hasProviderGenerationProofIntegrity(proof);
  } catch (error) {
    if (error instanceof HarnessOwnershipError) return false;
    throw error;
  }
}
export async function hasOwnedProcessIntegrity(value: unknown): Promise<boolean> {
  try {
    scanInert(value);
    const parsed = parseProcess(value);
    if (parsed.bindingDigest !== await digestArtifact('owned-process-ref', parsed as unknown as Plain, 'bindingDigest')) return false;
    return parsed.providerGenerationProofRef.proofDigest === parsed.liveGenerationRef.providerGenerationProofRef.proofDigest && await hasOwnedExecutionIntegrity(parsed.executionRef) && await hasLiveGenerationIntegrity(parsed.liveGenerationRef) && await hasProviderGenerationProofIntegrity(parsed.providerGenerationProofRef);
  } catch (error) {
    if (error instanceof HarnessOwnershipError) return false;
    throw error;
  }
}
export async function hasOwnedToolIntegrity(value: unknown): Promise<boolean> {
  try {
    scanInert(value);
    const parsed = parseTool(value);
    if (parsed.bindingDigest !== await digestArtifact('owned-tool-invocation-ref', parsed as unknown as Plain, 'bindingDigest')) return false;
    return await hasOwnedExecutionIntegrity(parsed.executionRef);
  } catch (error) {
    if (error instanceof HarnessOwnershipError) return false;
    throw error;
  }
}
export const hasReservationIntegrity = (value: unknown): Promise<boolean> => validateIntegrity(value, parseReservation, 'admission-reservation-ref', 'reservationDigest');
export const hasAdmittedOperationIntegrity = (value: unknown): Promise<boolean> => validateIntegrity(value, parseAdmitted, 'admitted-operation-ref', 'admissionDigest');
export const hasAuthorityReceiptIntegrity = (value: unknown): Promise<boolean> => validateIntegrity(value, parseAuthorityReceipt, 'authority-consumption-ref', 'receiptDigest');
export const hasWatchIntegrity = (value: unknown): Promise<boolean> => validateIntegrity(value, parseWatch, 'authority-consumption-watch', 'watchDigest');
export const hasRetirementFenceIntegrity = (value: unknown): Promise<boolean> => validateIntegrity(value, parseFence, 'retirement-fence-ref', 'fenceDigest');

export interface OwnedExecutionInput {
  readonly ownershipId: string;
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
}

export async function createOwnedExecutionRef(input: OwnedExecutionInput): Promise<Readonly<OwnedExecutionRef>> {
  scanInert(input);
  const parsed = parseExecution({ kind: 'owned-execution-ref', ...input, provenanceDigest: '0'.repeat(64) });
  const provenanceDigest = await digestArtifact('owned-execution-ref', parsed as unknown as Plain, 'provenanceDigest');
  return detached({ ...parsed, provenanceDigest });
}

export interface ProviderGenerationProofInput {
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
  readonly providerGenerationEvidenceDigest: Digest;
  readonly creationObservationDigest: Digest;
  readonly handoffObservationDigest?: Digest;
}

export async function createProviderGenerationProofRef(input: ProviderGenerationProofInput): Promise<Readonly<ProviderGenerationProofRef>> {
  scanInert(input);
  const parsed = parseProviderProof({ kind: 'provider-generation-proof', ...input, proofDigest: '0'.repeat(64) });
  return makeDigestArtifact('provider-generation-proof', parsed as unknown as Plain, 'proofDigest') as Promise<Readonly<ProviderGenerationProofRef>>;
}

export interface LiveOwnedGenerationInput {
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
}

export async function createLiveOwnedGenerationRef(input: LiveOwnedGenerationInput): Promise<Readonly<LiveOwnedGenerationRef>> {
  scanInert(input);
  const parsed = parseLive({ kind: 'live-owned-generation-ref', ...input, liveGenerationDigest: '0'.repeat(64) });
  return makeDigestArtifact('live-owned-generation-ref', parsed as unknown as Plain, 'liveGenerationDigest') as Promise<Readonly<LiveOwnedGenerationRef>>;
}

export interface OwnedProcessInput {
  readonly executionRef: OwnedExecutionRef;
  readonly liveGenerationRef: LiveOwnedGenerationRef;
  readonly providerGenerationProofRef: ProviderGenerationProofRef;
  readonly diagnosticObservation?: ProcessDiagnosticObservation;
}

export async function createOwnedProcessRef(input: OwnedProcessInput): Promise<Readonly<OwnedProcessRef>> {
  scanInert(input);
  const parsed = parseProcess({ kind: 'owned-process-ref', ...input, bindingDigest: '0'.repeat(64) });
  return makeDigestArtifact('owned-process-ref', parsed as unknown as Plain, 'bindingDigest') as Promise<Readonly<OwnedProcessRef>>;
}

export interface OwnedToolInput {
  readonly executionRef: OwnedExecutionRef;
  readonly liveGenerationId: string;
  readonly invocationId: string;
  readonly normalizedInputDigest: Digest;
  readonly toolKind: H2ToolKind;
  readonly toolInvocationProvenanceDigest: Digest;
}

export async function createOwnedToolInvocationRef(input: OwnedToolInput): Promise<Readonly<OwnedToolInvocationRef>> {
  scanInert(input);
  const parsed = parseTool({ kind: 'owned-tool-invocation-ref', ...input, bindingDigest: '0'.repeat(64) });
  return makeDigestArtifact('owned-tool-invocation-ref', parsed as unknown as Plain, 'bindingDigest') as Promise<Readonly<OwnedToolInvocationRef>>;
}

export interface AdmissionReservationInput {
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
}

export async function createAdmissionReservationRef(input: AdmissionReservationInput): Promise<Readonly<AdmissionReservationRef>> {
  scanInert(input);
  const parsed = parseReservation({ kind: 'admission-reservation-ref', ...input, reservationDigest: '0'.repeat(64) });
  return makeDigestArtifact('admission-reservation-ref', parsed as unknown as Plain, 'reservationDigest') as Promise<Readonly<AdmissionReservationRef>>;
}

async function createAdmittedOperation(reservation: AdmissionReservationRef, sequence: SafeInteger): Promise<Readonly<AdmittedOperationRef>> {
  const parsed = parseAdmitted({ kind: 'admitted-operation-ref', admissionId: reservation.admissionId, reservationId: reservation.admissionId, bindingGenerationId: reservation.bindingGenerationId, liveGenerationId: reservation.liveGenerationId, workspaceId: reservation.workspaceId, taskId: reservation.taskId, taskRevision: reservation.taskRevision, requestId: reservation.requestId, attemptId: reservation.attemptId, transactionId: reservation.transactionId, operationId: reservation.operationId, operationDigest: reservation.operationDigest, targetId: reservation.targetId, targetDigest: reservation.targetDigest, effectScopeDigest: reservation.effectScopeDigest, providerId: reservation.providerId, providerVersion: reservation.providerVersion, admissionSequence: sequence, admissionDigest: '0'.repeat(64) });
  return makeDigestArtifact('admitted-operation-ref', parsed as unknown as Plain, 'admissionDigest') as Promise<Readonly<AdmittedOperationRef>>;
}

async function createAuthorityReceipt(event: AuthorityAuditEvent, watch: AuthorityConsumptionWatch): Promise<Readonly<AuthorityConsumptionRef>> {
  const parsed = parseAuthorityReceipt({ kind: 'authority-consumption-ref', authorityOperationId: event.operation_id, authorityRevision: event.policy_revision, workspaceId: event.workspace, taskId: event.task_id, operationKind: event.kind, descriptorDigest: event.digest, actorId: event.actor_id, ownerId: event.owner_id, decision: 'consumed', consumedTimestamp: event.ts, bridgeEpochId: watch.bridgeEpochId, bridgeReceiptId: uniqueId('receipt'), reservationId: watch.reservationId, bindingGenerationId: watch.bindingGenerationId, requestId: watch.requestId, attemptId: watch.attemptId, transactionId: watch.transactionId, receiptDigest: '0'.repeat(64) });
  return makeDigestArtifact('authority-consumption-ref', parsed as unknown as Plain, 'receiptDigest') as Promise<Readonly<AuthorityConsumptionRef>>;
}

async function createWatch(input: Omit<AuthorityConsumptionWatch, 'kind' | 'watchDigest'>): Promise<Readonly<AuthorityConsumptionWatch>> {
  scanInert(input);
  const parsed = parseWatch({ kind: 'authority-consumption-watch', ...input, watchDigest: '0'.repeat(64) });
  return makeDigestArtifact('authority-consumption-watch', parsed as unknown as Plain, 'watchDigest') as Promise<Readonly<AuthorityConsumptionWatch>>;
}

function uniqueId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.();
  if (random) return prefix + '-' + random;
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
}

export interface TrustedProviderGenerationCapability {
  /** Adapter-local identity; never serialized into an H2 artifact. */
  readonly capabilityId: string;
  readonly verifyExactGeneration: () => boolean | Promise<boolean>;
  readonly terminateExact?: () => Promise<'exact_generation_exited' | 'already_exited' | 'survived' | 'unconfirmed'>;
  readonly observeExactExit?: () => boolean | Promise<boolean>;
}

function capabilityMember(value: object, key: string): PropertyDescriptor | undefined {
  let cursor: object | null = value;
  while (cursor !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(cursor, key);
    if (descriptor) return descriptor;
    cursor = Object.getPrototypeOf(cursor) as object | null;
  }
  return undefined;
}

/**
 * Provider capabilities are adapter-local executable objects, not serialized
 * H2 artifacts.  Snapshot their callable members without invoking accessors
 * or retaining a caller-mutable method table.
 */
function snapshotCapability(value: unknown): TrustedProviderGenerationCapability {
  if (value === null || typeof value !== 'object') return fail('PROCESS_GENERATION_UNAVAILABLE');
  const objectValue = value as object;
  for (const key of Reflect.ownKeys(objectValue)) {
    if (typeof key !== 'string' || !['capabilityId', 'verifyExactGeneration', 'terminateExact', 'observeExactExit'].includes(key)) return fail('PROCESS_GENERATION_UNAVAILABLE');
    const descriptor = Object.getOwnPropertyDescriptor(objectValue, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return fail('PROCESS_GENERATION_UNAVAILABLE');
  }
  const idDescriptor = capabilityMember(objectValue, 'capabilityId');
  const verifyDescriptor = capabilityMember(objectValue, 'verifyExactGeneration');
  const terminateDescriptor = capabilityMember(objectValue, 'terminateExact');
  const observeDescriptor = capabilityMember(objectValue, 'observeExactExit');
  if (!idDescriptor || !('value' in idDescriptor) || typeof idDescriptor.value !== 'string' ||
      !verifyDescriptor || !('value' in verifyDescriptor) || typeof verifyDescriptor.value !== 'function') return fail('PROCESS_GENERATION_UNAVAILABLE');
  if (terminateDescriptor && (!('value' in terminateDescriptor) || typeof terminateDescriptor.value !== 'function')) return fail('PROCESS_GENERATION_UNAVAILABLE');
  if (observeDescriptor && (!('value' in observeDescriptor) || typeof observeDescriptor.value !== 'function')) return fail('PROCESS_GENERATION_UNAVAILABLE');
  const verify = verifyDescriptor.value as (...args: never[]) => boolean | Promise<boolean>;
  const terminate = terminateDescriptor && 'value' in terminateDescriptor ? terminateDescriptor.value as (...args: never[]) => Promise<'exact_generation_exited' | 'already_exited' | 'survived' | 'unconfirmed'> : undefined;
  const observe = observeDescriptor && 'value' in observeDescriptor ? observeDescriptor.value as (...args: never[]) => boolean | Promise<boolean> : undefined;
  return Object.freeze({
    capabilityId: idDescriptor.value,
    verifyExactGeneration: () => verify.call(value),
    ...(terminate === undefined ? {} : { terminateExact: () => terminate.call(value) }),
    ...(observe === undefined ? {} : { observeExactExit: () => observe.call(value) })
  });
}

interface AdmissionInternal {
  readonly reservation: Readonly<AdmissionReservationRef>;
  readonly facts: AdmissionFact[];
  state: AdmissionState;
  authorityConsumption?: Readonly<AuthorityConsumptionRef>;
  admittedOperation?: Readonly<AdmittedOperationRef>;
  terminal: boolean;
  dispatchStarted: boolean;
  terminalObservation?: string;
}

function sameReservation(a: AdmissionReservationRef, b: AdmissionReservationRef): boolean {
  return a.admissionId === b.admissionId && a.reservationDigest === b.reservationDigest && a.liveGenerationId === b.liveGenerationId && a.bindingGenerationId === b.bindingGenerationId && a.transactionId === b.transactionId;
}

function sameH1Scope(a: { readonly workspaceId: WorkspaceId; readonly taskId: TaskId; readonly taskRevision: TaskRevision; readonly requestId: HarnessExecutionRequestId; readonly attemptId: WorkerAttemptId; readonly transactionId: HarnessTransactionId }, b: { readonly workspaceId: WorkspaceId; readonly taskId: TaskId; readonly taskRevision: TaskRevision; readonly requestId: HarnessExecutionRequestId; readonly attemptId: WorkerAttemptId; readonly transactionId: HarnessTransactionId }): boolean {
  return a.workspaceId === b.workspaceId && a.taskId === b.taskId && a.taskRevision === b.taskRevision && a.requestId === b.requestId && a.attemptId === b.attemptId && a.transactionId === b.transactionId;
}

function receiptMatchesReservation(receipt: AuthorityConsumptionRef, reservation: AdmissionReservationRef): boolean {
  return receipt.reservationId === reservation.admissionId && receipt.bindingGenerationId === reservation.bindingGenerationId && receipt.requestId === reservation.requestId && receipt.attemptId === reservation.attemptId && receipt.transactionId === reservation.transactionId && receipt.workspaceId === reservation.workspaceId && receipt.taskId === reservation.taskId && receipt.authorityOperationId === reservation.operationId && receipt.descriptorDigest === reservation.operationDigest;
}

function assertCurrentDigest(expected: Promise<boolean>, code: string): Promise<void> {
  return expected.then(ok => { if (!ok) fail(code); });
}

/**
 * The sole canonical H2 admission source.  Indexes in the live-generation
 * and transaction registries are projections and can always be rebuilt from
 * this ledger.
 */
export class AdmissionLedger {
  private readonly entries = new Map<string, AdmissionInternal>();
  private readonly authorityToAdmission = new Map<string, string>();
  private readonly receiptToAdmission = new Map<string, string>();
  private readonly transactionHistory = new Set<string>();
  private sequence = 0;
  private revision = 0;
  private readonly faultModes = new Set<'commit' | 'fact'>();

  /** Test/adapter hook for proving fail-closed partial-commit behavior. */
  setFault(mode: 'commit' | 'fact', enabled = true): void {
    if (enabled) this.faultModes.add(mode); else this.faultModes.delete(mode);
  }

  get ledgerRevision(): number { return this.revision; }

  async reserve(value: AdmissionReservationRef): Promise<Readonly<AdmissionFact>> {
    await assertCurrentDigest(hasReservationIntegrity(value), 'INVALID_RESERVATION_INTEGRITY');
    const existing = this.entries.get(value.admissionId);
    if (existing) {
      if (!sameReservation(existing.reservation, value)) return fail('ADMISSION_CONFLICT');
      return existing.facts[0]!;
    }
    const fact = await this.makeFact(value, 'RESERVED', undefined, undefined);
    const entry: AdmissionInternal = { reservation: detached(value), facts: [fact as AdmissionFact], state: 'RESERVED', terminal: false, dispatchStarted: false };
    this.entries.set(value.admissionId, entry);
    this.transactionHistory.add(value.transactionId);
    this.revision++;
    return fact;
  }

  private async makeFact(reservation: AdmissionReservationRef, state: AdmissionState, reason?: string, authorityConsumption?: AuthorityConsumptionRef, admittedOperation?: AdmittedOperationRef): Promise<Readonly<AdmissionFact>> {
    if (this.faultModes.has('fact')) return fail('INTERNAL_HARNESS_FAILURE');
    const base: Plain = { kind: 'admission-fact', admissionId: reservation.admissionId, state, observedAt: new Date().toISOString(), ...(reason === undefined ? {} : { reason }), ...(authorityConsumption === undefined ? {} : { authorityConsumption }), ...(admittedOperation === undefined ? {} : { admittedOperation }), factDigest: '0'.repeat(64) };
    return makeDigestArtifact('admission-fact', base, 'factDigest') as Promise<Readonly<AdmissionFact>>;
  }

  private entry(value: AdmissionReservationRef | string): AdmissionInternal {
    const id = typeof value === 'string' ? value : value.admissionId;
    const entry = this.entries.get(id);
    if (!entry) return fail('TOOL_INVOCATION_NOT_FOUND');
    if (typeof value !== 'string' && !sameReservation(entry.reservation, value)) return fail('ADMISSION_CONFLICT');
    return entry;
  }

  get(value: AdmissionReservationRef | string): Readonly<AdmissionInternal> {
    const entry = this.entry(value);
    return detached({ ...entry, facts: [...entry.facts] }) as Readonly<AdmissionInternal>;
  }

  listForTransaction(transactionId: HarnessTransactionId): readonly Readonly<AdmissionInternal>[] {
    return [...this.entries.values()].filter(entry => entry.reservation.transactionId === transactionId).map(entry => detached({ ...entry, facts: [...entry.facts] }) as Readonly<AdmissionInternal>);
  }

  listForGeneration(liveGenerationId: string): readonly Readonly<AdmissionInternal>[] {
    return [...this.entries.values()].filter(entry => entry.reservation.liveGenerationId === liveGenerationId).map(entry => detached({ ...entry, facts: [...entry.facts] }) as Readonly<AdmissionInternal>);
  }

  hasTransactionHistory(transactionId: string): boolean { return this.transactionHistory.has(transactionId); }

  async noteAuthorityConsumption(reservation: AdmissionReservationRef, receipt: AuthorityConsumptionRef): Promise<void> {
    const entry = this.entry(reservation);
    await assertCurrentDigest(hasAuthorityReceiptIntegrity(receipt), 'INVALID_AUTHORITY_RECEIPT_INTEGRITY');
    if (!receiptMatchesReservation(receipt, reservation)) return fail('AUTHORITY_MISMATCH');
    const authorityOwner = this.authorityToAdmission.get(receipt.authorityOperationId);
    if (authorityOwner !== undefined && authorityOwner !== reservation.admissionId) return fail('ADMISSION_CONFLICT');
    const receiptOwner = this.receiptToAdmission.get(receipt.receiptDigest);
    if (receiptOwner !== undefined && receiptOwner !== reservation.admissionId) return fail('ADMISSION_CONFLICT');
    if (entry.authorityConsumption) {
      if (entry.authorityConsumption.receiptDigest !== receipt.receiptDigest) return fail('ADMISSION_CONFLICT');
      return;
    }
    if (entry.state !== 'RESERVED') return fail('ADMISSION_CONFLICT');
    const fact = await this.makeFact(entry.reservation, 'RESERVED', 'authority_consumed', receipt);
    entry.authorityConsumption = detached(receipt);
    this.authorityToAdmission.set(receipt.authorityOperationId, reservation.admissionId);
    this.receiptToAdmission.set(receipt.receiptDigest, reservation.admissionId);
    entry.facts.push(fact as AdmissionFact);
    this.revision++;
  }

  async abortPreconsumption(reservation: AdmissionReservationRef, reason = 'authority_not_consumed'): Promise<void> {
    const entry = this.entry(reservation);
    if (entry.state === 'ABORTED_PRECONSUMPTION') return;
    if (entry.state !== 'RESERVED' || entry.authorityConsumption) return fail('ADMISSION_CONFLICT');
    const fact = await this.makeFact(entry.reservation, 'ABORTED_PRECONSUMPTION', reason);
    entry.state = 'ABORTED_PRECONSUMPTION'; entry.facts.push(fact as AdmissionFact); this.revision++;
  }

  async consumedNoDispatch(reservation: AdmissionReservationRef, reason: string): Promise<void> {
    const entry = this.entry(reservation);
    if (entry.state === 'CONSUMED_NO_DISPATCH') return;
    if (entry.state !== 'RESERVED' || !entry.authorityConsumption || entry.dispatchStarted) return fail('ADMISSION_CONFLICT');
    const fact = await this.makeFact(entry.reservation, 'CONSUMED_NO_DISPATCH', reason, entry.authorityConsumption);
    entry.state = 'CONSUMED_NO_DISPATCH'; entry.facts.push(fact as AdmissionFact); this.revision++;
  }

  async consumedUnresolved(reservation: AdmissionReservationRef, reason: string): Promise<void> {
    const entry = this.entry(reservation);
    if (entry.state === 'CONSUMED_UNRESOLVED') return;
    if (!entry.authorityConsumption && entry.state !== 'RESERVED') return fail('ADMISSION_CONFLICT');
    if (entry.state === 'COMMITTED') return fail('ADMISSION_CONFLICT');
    const fact = await this.makeFact(entry.reservation, 'CONSUMED_UNRESOLVED', reason, entry.authorityConsumption);
    entry.state = 'CONSUMED_UNRESOLVED'; entry.facts.push(fact as AdmissionFact); this.revision++;
  }

  async commit(reservation: AdmissionReservationRef): Promise<Readonly<AdmittedOperationRef>> {
    const entry = this.entry(reservation);
    if (entry.state === 'COMMITTED' && entry.admittedOperation) return entry.admittedOperation;
    if (entry.state !== 'RESERVED' || !entry.authorityConsumption) return fail('ADMISSION_CONFLICT');
    if (this.faultModes.has('commit')) return fail('INTERNAL_HARNESS_FAILURE');
    const sequence = (++this.sequence) as SafeInteger;
    const admitted = await createAdmittedOperation(entry.reservation, sequence);
    const fact = await this.makeFact(entry.reservation, 'COMMITTED', undefined, entry.authorityConsumption, admitted);
    entry.admittedOperation = admitted;
    entry.state = 'COMMITTED'; entry.facts.push(fact as AdmissionFact); this.revision++;
    return admitted;
  }

  async markDispatchStarted(admissionId: string): Promise<void> {
    const entry = this.entry(admissionId);
    if (entry.state !== 'COMMITTED' || !entry.admittedOperation || entry.terminal) return fail('ADMISSION_CONFLICT');
    if (entry.dispatchStarted) return fail('ADMISSION_REPLAY');
    entry.dispatchStarted = true; this.revision++;
  }

  async markTerminal(admissionId: string, observationId: string): Promise<void> {
    const entry = this.entry(admissionId);
    if (entry.state !== 'COMMITTED' || !entry.admittedOperation) return fail('ADMISSION_CONFLICT');
    const terminalObservation = text(observationId, 'INVALID_TERMINAL_OBSERVATION');
    if (entry.terminal) {
      if (entry.terminalObservation !== terminalObservation) return fail('ADMISSION_CONFLICT');
      return;
    }
    entry.terminal = true; entry.terminalObservation = terminalObservation; this.revision++;
  }

  /** Persistent-service start work closes by a trusted live-generation handoff, not process exit. */
  async closeByHandoff(admissionId: string, observationId: string): Promise<void> {
    const entry = this.entry(admissionId);
    if (entry.state !== 'COMMITTED' || !entry.admittedOperation) return fail('ADMISSION_CONFLICT');
    const terminalObservation = text(observationId, 'INVALID_HANDOFF_OBSERVATION');
    if (entry.terminal) {
      if (entry.terminalObservation !== terminalObservation) return fail('ADMISSION_CONFLICT');
      return;
    }
    entry.terminal = true; entry.terminalObservation = terminalObservation; this.revision++;
  }

  /** Exact generation exit/termination closes every committed operation affected by it. */
  async markGenerationTerminal(liveGenerationId: string, observationPrefix: string): Promise<void> {
    const prefix = text(observationPrefix, 'INVALID_TERMINAL_OBSERVATION');
    for (const entry of this.listForGeneration(liveGenerationId)) {
      if (entry.state === 'COMMITTED' && entry.admittedOperation && !entry.terminal) {
        await this.markTerminal(entry.reservation.admissionId, `${prefix}:${entry.reservation.admissionId}`);
      }
    }
  }

  activeForGeneration(liveGenerationId: string): readonly Readonly<AdmittedOperationRef>[] {
    return this.listForGeneration(liveGenerationId).filter(entry => entry.state === 'COMMITTED' && !entry.terminal && entry.admittedOperation).map(entry => entry.admittedOperation!) as readonly Readonly<AdmittedOperationRef>[];
  }

  unresolvedForTransaction(transactionId: HarnessTransactionId): readonly string[] {
    return this.listForTransaction(transactionId).filter(entry => entry.state === 'RESERVED' || entry.state === 'CONSUMED_UNRESOLVED' || (entry.state === 'COMMITTED' && !entry.terminal)).map(entry => entry.reservation.admissionId);
  }

  async createQuiescence(scope: { workspaceId: WorkspaceId; taskId: TaskId; taskRevision: TaskRevision; requestId: HarnessExecutionRequestId; attemptId: WorkerAttemptId; transactionId: HarnessTransactionId }, options: { admissionCutoff: boolean; registryCompleteness: boolean; registryEpochId?: string; unresolvedDescendantIds?: readonly string[] }): Promise<Readonly<QuiescenceObservation>> {
    if (!options.admissionCutoff) return fail('ADMISSION_NOT_STOPPED');
    const entries = this.listForTransaction(scope.transactionId);
    const unresolvedDescendantIds = [...(options.unresolvedDescendantIds ?? [])].map(id => text(id, 'INVALID_DESCENDANT_ID')).sort();
    if (!options.registryCompleteness) return fail('QUIESCENCE_NOT_PROVEN');
    if (new Set(unresolvedDescendantIds).size !== unresolvedDescendantIds.length) return fail('QUIESCENCE_NOT_PROVEN');
    if (entries.some(entry => !sameH1Scope(entry.reservation, scope))) return fail('OWNERSHIP_SCOPE_MISMATCH');
    const registeredAdmissionIds = entries.map(entry => entry.reservation.admissionId).sort();
    const closedAdmissionIds = entries.filter(entry => (entry.state === 'ABORTED_PRECONSUMPTION' || entry.state === 'CONSUMED_NO_DISPATCH' || (entry.state === 'COMMITTED' && entry.terminal))).map(entry => entry.reservation.admissionId).sort();
    const activeAdmissionIds = entries.filter(entry => entry.state === 'COMMITTED' && !entry.terminal).map(entry => entry.reservation.admissionId).sort();
    const unresolvedAdmissionIds = entries.filter(entry => entry.state === 'RESERVED' || entry.state === 'CONSUMED_UNRESOLVED').map(entry => entry.reservation.admissionId).sort();
    const quiescent = activeAdmissionIds.length === 0 && unresolvedAdmissionIds.length === 0 && unresolvedDescendantIds.length === 0;
    const base: Plain = { kind: 'quiescence-observation', observationId: uniqueId('quiescence'), registryEpochId: options.registryEpochId ?? 'ledger-' + this.revision.toString(36), ...scope, admissionCutoff: true, registryCompleteness: true, registeredAdmissionIds, closedAdmissionIds, activeAdmissionIds, unresolvedAdmissionIds, unresolvedDescendantIds, quiescent, observationDigest: '0'.repeat(64) };
    return makeDigestArtifact('quiescence-observation', base, 'observationDigest') as Promise<Readonly<QuiescenceObservation>>;
  }
}

export class TransactionExecutionRegistry {
  private readonly projections = new Map<string, ReadonlySet<string>>();
  private revision = 0;

  get projectionRevision(): number { return this.revision; }

  rebuild(ledger: AdmissionLedger, transactionId: HarnessTransactionId): void {
    const ids = new Set(ledger.listForTransaction(transactionId).map(entry => entry.reservation.admissionId));
    this.projections.set(transactionId, ids); this.revision++;
  }

  setProjection(transactionId: HarnessTransactionId, admissionIds: readonly string[]): void {
    if (new Set(admissionIds).size !== admissionIds.length) return fail('INTERNAL_HARNESS_FAILURE', 'duplicate transaction admission projection');
    this.projections.set(transactionId, new Set(admissionIds)); this.revision++;
  }

  get(transactionId: HarnessTransactionId): readonly string[] { return [...(this.projections.get(transactionId) ?? new Set())].sort(); }

  assertMatches(ledger: AdmissionLedger, transactionId: HarnessTransactionId): void {
    const expected = ledger.listForTransaction(transactionId).map(entry => entry.reservation.admissionId).sort();
    const actual = this.get(transactionId);
    if (canonicalContextJson(expected) !== canonicalContextJson(actual)) return fail('INTERNAL_HARNESS_FAILURE', 'transaction admission projection is stale');
  }
}

class AsyncMutex {
  private tail: Promise<void> = Promise.resolve();

  async run<T>(fn: () => Promise<T> | T): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

interface LiveEntry {
  readonly ref: Readonly<LiveOwnedGenerationRef>;
  readonly capability: TrustedProviderGenerationCapability;
  disposition: LiveGenerationDisposition;
  version: SafeInteger;
  fence?: Readonly<RetirementFenceRef>;
  handoff?: Readonly<LiveGenerationHandoffObservation>;
}

export interface RegisterProvisionalInput {
  readonly executionRef: OwnedExecutionRef;
  readonly providerGenerationEvidenceDigest: Digest;
  readonly creationObservationDigest: Digest;
  readonly capability: TrustedProviderGenerationCapability;
  readonly targetId: string;
  readonly targetDigest: Digest;
  readonly serviceScope: ServiceScope;
  readonly processKind?: H2ProcessKind;
  readonly toolKind?: H2ToolKind;
  readonly targetPolicy?: 'exclusive' | 'multi';
}

export interface HandoffInput {
  readonly noUnresolvedLaunchWork: true;
  readonly noUnresolvedDescendants: true;
  readonly responsibilityTransferred: true;
}

function parseHandoff(value: unknown): HandoffInput {
  const input = record(value, ['noUnresolvedLaunchWork', 'noUnresolvedDescendants', 'responsibilityTransferred'], 'HANDOFF');
  if (input.noUnresolvedLaunchWork !== true || input.noUnresolvedDescendants !== true || input.responsibilityTransferred !== true) return fail('PUBLICATION_NOT_READY');
  return { noUnresolvedLaunchWork: true, noUnresolvedDescendants: true, responsibilityTransferred: true };
}

export interface ProcessBindingInput {
  readonly executionRef: OwnedExecutionRef;
  readonly liveGenerationId: string;
  readonly diagnosticObservation?: ProcessDiagnosticObservation;
}

export interface ToolBindingInput {
  readonly executionRef: OwnedExecutionRef;
  readonly liveGenerationId: string;
  readonly invocationId: string;
  readonly normalizedInputDigest: Digest;
  readonly toolKind: H2ToolKind;
  readonly toolInvocationProvenanceDigest: Digest;
}

function serviceScopeAllows(scope: ServiceScope, executionRef: OwnedExecutionRef): boolean {
  switch (scope.kind) {
    case 'workspace': return scope.scopeId === executionRef.workspaceId;
    // Project, Harness-runtime, and explicitly shared identities are resolved
    // by the trusted registry policy below.  H2 has no caller-provided project
    // map from which it could safely infer those relationships.
    case 'project':
    case 'harness-runtime':
    case 'explicit-shared': return scope.scopeId.length > 0;
  }
}

function serviceScopeKey(scope: ServiceScope): string {
  return canonicalContextJson({ kind: scope.kind, scopeId: scope.scopeId, policyDigest: scope.policyDigest });
}

function targetKey(targetId: string, targetDigest: Digest, serviceScope: ServiceScope): string {
  return canonicalContextJson({ targetId, targetDigest, serviceScope: { kind: serviceScope.kind, scopeId: serviceScope.scopeId, policyDigest: serviceScope.policyDigest } });
}

function bindingKey(executionRef: OwnedExecutionRef, liveGenerationId: string): string {
  return canonicalContextJson({ liveGenerationId, ownershipId: executionRef.ownershipId, bindingGenerationId: executionRef.bindingGenerationId,
    workspaceId: executionRef.workspaceId, taskId: executionRef.taskId, taskRevision: executionRef.taskRevision,
    requestId: executionRef.requestId, attemptId: executionRef.attemptId, transactionId: executionRef.transactionId });
}

function sanitizeRegisterInput(value: RegisterProvisionalInput): RegisterProvisionalInput {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return fail('INVALID_REGISTER_INPUT');
  const objectValue = value as object;
  const prototype = Object.getPrototypeOf(objectValue);
  if (prototype !== Object.prototype && prototype !== null) return fail('INVALID_REGISTER_INPUT');
  const allowed = new Set(['executionRef', 'providerGenerationEvidenceDigest', 'creationObservationDigest', 'capability', 'targetId', 'targetDigest', 'serviceScope', 'processKind', 'toolKind', 'targetPolicy']);
  const descriptors = Object.getOwnPropertyDescriptors(objectValue);
  const output = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(objectValue)) {
    if (typeof key !== 'string' || !allowed.has(key)) return fail('INVALID_REGISTER_INPUT');
    const descriptor = descriptors[key];
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return fail('INVALID_REGISTER_INPUT');
    if (key === 'capability') output[key] = snapshotCapability(descriptor.value);
    else output[key] = descriptor.value;
  }
  if (!Object.prototype.hasOwnProperty.call(output, 'executionRef') || !Object.prototype.hasOwnProperty.call(output, 'capability')) return fail('INVALID_REGISTER_INPUT');
  // Every serializable field is scanned without ever traversing the
  // adapter-local capability's executable members.
  const inert = Object.create(null) as Record<string, unknown>;
  for (const [key, item] of Object.entries(output)) if (key !== 'capability') inert[key] = item;
  scanInert(inert);
  return output as RegisterProvisionalInput;
}

/**
 * Trusted in-memory live-generation registry.  The registry's native
 * capability is the actionable root; serialized references are descriptive
 * and cannot recreate an entry after an epoch loss.
 *
 * All mutations use one serialized critical section.  Its semantic lock
 * order is registry epoch -> stable target -> live generation -> admission
 * ledger/projections.  A path may skip domains, but never acquires them in
 * reverse order; authority.execute() and the recorder bridge run outside it.
 */
export class LiveGenerationRegistry {
  readonly registryEpochId: string;
  readonly ledger: AdmissionLedger;
  readonly transactionRegistry: TransactionExecutionRegistry;
  private readonly mutex = new AsyncMutex();
  private readonly entries = new Map<string, LiveEntry>();
  private readonly targetIndex = new Map<string, { liveGenerationId: string; version: SafeInteger }>();
  private readonly targetPolicies = new Map<string, 'exclusive' | 'multi'>();
  private readonly bindings = new Map<string, ReadonlyArray<OwnedProcessRef | OwnedToolInvocationRef>>();
  private readonly closedBindingKeys = new Set<string>();
  private readonly invocationBindings = new Map<string, { readonly bindingDigest: string; readonly scopeKey: string }>();
  private readonly projectionFailures = new Set<string>();
  private readonly liveProjection = new Map<string, { revision: number; admissionIds: readonly string[] }>();
  private readonly trustedServiceScopeKeys: ReadonlySet<string>;
  private receiptBridge: AuthorityConsumptionReceiptBridge | undefined;

  constructor(options: { registryEpochId?: string; ledger?: AdmissionLedger; transactionRegistry?: TransactionExecutionRegistry; receiptBridge?: AuthorityConsumptionReceiptBridge; trustedServiceScopes?: readonly ServiceScope[] } = {}) {
    this.registryEpochId = options.registryEpochId ?? uniqueId('registry-epoch');
    this.ledger = options.ledger ?? new AdmissionLedger();
    this.transactionRegistry = options.transactionRegistry ?? new TransactionExecutionRegistry();
    const trustedScopes = (options.trustedServiceScopes ?? []).map(scope => validateShape(scope, parseServiceScope));
    this.trustedServiceScopeKeys = new Set(trustedScopes.map(serviceScopeKey));
    this.receiptBridge = options.receiptBridge;
  }

  setReceiptBridge(bridge: AuthorityConsumptionReceiptBridge): void { this.receiptBridge = bridge; }

  setProjectionFailure(kind: 'live' | 'transaction', enabled = true): void {
    if (enabled) this.projectionFailures.add(kind); else this.projectionFailures.delete(kind);
  }

  private current(liveGenerationId: string): LiveEntry {
    const entry = this.entries.get(liveGenerationId);
    if (!entry) return fail('OWNERSHIP_NOT_PROVEN');
    if (entry.ref.registryEpochId !== this.registryEpochId) return fail('RESTART_RECONCILIATION_REQUIRED');
    return entry;
  }

  private async verifyCapability(entry: LiveEntry): Promise<void> {
    await this.verifyCapabilityValue(entry.capability);
  }

  private async verifyCapabilityValue(capability: TrustedProviderGenerationCapability): Promise<void> {
    let exact = false;
    try { exact = (await capability.verifyExactGeneration()) === true; } catch { exact = false; }
    if (!exact) return fail('OWNERSHIP_GENERATION_MISMATCH');
  }

  private assertScopeCompatibility(scope: ServiceScope, executionRef: OwnedExecutionRef): void {
    if (!serviceScopeAllows(scope, executionRef)) return fail('OWNERSHIP_SCOPE_MISMATCH');
    // Workspace scope is intrinsically tied to the H1 workspace.  Broader
    // project/runtime/shared scopes require a trusted policy registration;
    // a caller cannot manufacture cross-workspace sharing by declaring one.
    if (scope.kind !== 'workspace' && !this.trustedServiceScopeKeys.has(serviceScopeKey(scope))) return fail('OWNERSHIP_SCOPE_MISMATCH');
  }

  private bindingFor(executionRef: OwnedExecutionRef, liveGenerationId: string, supplied?: OwnedProcessRef | OwnedToolInvocationRef): Readonly<OwnedProcessRef | OwnedToolInvocationRef> {
    const key = bindingKey(executionRef, liveGenerationId);
    if (this.closedBindingKeys.has(key)) return fail('OWNERSHIP_STALE', 'transaction control binding has expired');
    const candidates = this.bindings.get(key) ?? [];
    const binding = candidates.find(candidate => candidate.executionRef.operationId === executionRef.operationId && candidate.executionRef.operationDigest === executionRef.operationDigest && (supplied === undefined || candidate.bindingDigest === supplied.bindingDigest));
    if (!binding) return fail('OWNERSHIP_NOT_PROVEN', 'transaction binding was not minted by this registry');
    if (binding.executionRef.bindingGenerationId !== executionRef.bindingGenerationId ||
        binding.executionRef.ownershipId !== executionRef.ownershipId ||
        !sameH1Scope(binding.executionRef, executionRef)) return fail('OWNERSHIP_SCOPE_MISMATCH');
    return binding;
  }

  private assertReservationBinding(reservation: AdmissionReservationRef, binding?: OwnedProcessRef | OwnedToolInvocationRef): Readonly<OwnedProcessRef | OwnedToolInvocationRef> {
    if (binding !== undefined) {
      const executionRef = binding.executionRef;
      const liveGenerationId = 'liveGenerationRef' in binding ? binding.liveGenerationRef.liveGenerationId : binding.liveGenerationId;
      if (liveGenerationId !== reservation.liveGenerationId) return fail('OWNERSHIP_SCOPE_MISMATCH');
      this.bindingFor(executionRef, liveGenerationId, binding);
      if (!sameH1Scope(executionRef, reservation) || executionRef.bindingGenerationId !== reservation.bindingGenerationId) return fail('OWNERSHIP_SCOPE_MISMATCH');
      if (executionRef.targetId !== reservation.targetId || executionRef.targetDigest !== reservation.targetDigest || executionRef.effectScopeDigest !== reservation.effectScopeDigest || executionRef.providerId !== reservation.providerId || executionRef.providerVersion !== reservation.providerVersion) return fail('OWNERSHIP_SCOPE_MISMATCH');
      return binding;
    }
    const candidates = [...this.bindings.values()].flat().filter(candidate => {
      const ref = candidate.executionRef;
      const liveGenerationId = 'liveGenerationRef' in candidate ? candidate.liveGenerationRef.liveGenerationId : candidate.liveGenerationId;
      return !this.closedBindingKeys.has(bindingKey(ref, liveGenerationId)) && liveGenerationId === reservation.liveGenerationId && ref.ownershipId.length > 0 && sameH1Scope(ref, reservation) && ref.bindingGenerationId === reservation.bindingGenerationId && ref.targetId === reservation.targetId && ref.targetDigest === reservation.targetDigest && ref.effectScopeDigest === reservation.effectScopeDigest && ref.providerId === reservation.providerId && ref.providerVersion === reservation.providerVersion;
    });
    if (candidates.length === 0) return fail('OWNERSHIP_NOT_PROVEN', 'reservation has no registry-issued control binding');
    return candidates[0]!;
  }

  async registerProvisional(input: RegisterProvisionalInput): Promise<Readonly<LiveOwnedGenerationRef>> {
    input = sanitizeRegisterInput(input);
    input = { ...input, executionRef: validateOwnedExecutionRef(input.executionRef) };
    if (input.executionRef.executionKind === 'process' && !input.processKind) return fail('PROCESS_KIND_REQUIRED');
    if (input.executionRef.executionKind === 'tool' && !input.toolKind) return fail('TOOL_KIND_REQUIRED');
    if (input.processKind && input.toolKind) return fail('LIVE_KIND_CONFLICT');
    if (input.targetId !== input.executionRef.targetId || input.targetDigest !== input.executionRef.targetDigest) return fail('OWNERSHIP_SCOPE_MISMATCH');
    await assertCurrentDigest(hasOwnedExecutionIntegrity(input.executionRef), 'OWNERSHIP_NOT_PROVEN');
    const serviceScope = validateShape(input.serviceScope, parseServiceScope);
    this.assertScopeCompatibility(serviceScope, input.executionRef);
    const liveGenerationId = uniqueId('live-generation');
    const entry = await this.mutex.run(async () => {
      const capabilityId = text(input.capability.capabilityId, 'PROCESS_GENERATION_UNAVAILABLE');
      if (!capabilityId || typeof input.capability.verifyExactGeneration !== 'function') return fail('PROCESS_GENERATION_UNAVAILABLE');
      await this.verifyCapabilityValue(input.capability);
      const target = targetKey(input.targetId, input.targetDigest, serviceScope);
      const policy = input.targetPolicy ?? 'exclusive';
      if (policy !== 'exclusive' && policy !== 'multi') return fail('TARGET_CONFLICT');
      const previousPolicy = this.targetPolicies.get(target);
      if (previousPolicy !== undefined && previousPolicy !== policy) return fail('TARGET_CONFLICT');
      const proof = await createProviderGenerationProofRef({
        proofId: uniqueId('provider-proof'), providerId: input.executionRef.providerId, providerVersion: input.executionRef.providerVersion,
        executionKind: input.executionRef.executionKind, liveGenerationId, ownershipId: input.executionRef.ownershipId,
        registryEpochId: this.registryEpochId, workspaceId: input.executionRef.workspaceId, taskId: input.executionRef.taskId,
        taskRevision: input.executionRef.taskRevision, requestId: input.executionRef.requestId, attemptId: input.executionRef.attemptId, transactionId: input.executionRef.transactionId,
        providerGenerationEvidenceDigest: input.providerGenerationEvidenceDigest, creationObservationDigest: input.creationObservationDigest
      });
      const ref = await createLiveOwnedGenerationRef({
        liveGenerationId, registryEpochId: this.registryEpochId, providerId: input.executionRef.providerId,
        providerVersion: input.executionRef.providerVersion, executionKind: input.executionRef.executionKind,
        ...(input.processKind === undefined ? {} : { processKind: input.processKind }),
        ...(input.toolKind === undefined ? {} : { toolKind: input.toolKind }), targetId: input.targetId, targetDigest: input.targetDigest,
        serviceScope, providerGenerationProofRef: proof, originOwnershipId: input.executionRef.ownershipId,
        originBindingGenerationId: input.executionRef.bindingGenerationId, originRequestId: input.executionRef.requestId,
        originTransactionId: input.executionRef.transactionId, creationProvenanceDigest: input.executionRef.provenanceDigest
      });
      const liveEntry: LiveEntry = { ref, capability: input.capability, disposition: 'provisional', version: 1 as SafeInteger };
      this.entries.set(liveGenerationId, liveEntry);
      this.targetPolicies.set(target, policy);
      return liveEntry;
    });
    return entry.ref;
  }

  /**
   * Publication is intentionally coupled to origin-transaction closure.  A
   * caller cannot make a provisional generation cross-transaction bindable by
   * presenting only a boolean handoff claim.
   */
  async publish(liveGenerationId: string, handoff: HandoffInput, originReservation?: AdmissionReservationRef): Promise<Readonly<LiveGenerationHandoffObservation>> {
    if (originReservation === undefined) return fail('PUBLICATION_NOT_READY', 'persistent handoff requires the committed origin admission');
    return this.completePersistentHandoff(liveGenerationId, originReservation, handoff);
  }

  async completePersistentHandoff(liveGenerationId: string, originReservation: AdmissionReservationRef, handoff: HandoffInput): Promise<Readonly<LiveGenerationHandoffObservation>> {
    originReservation = validateAdmissionReservationRef(originReservation);
    await assertCurrentDigest(hasReservationIntegrity(originReservation), 'INVALID_RESERVATION_INTEGRITY');
    const parsedHandoff = parseHandoff(handoff);
    return this.mutex.run(async () => {
      const entry = this.current(liveGenerationId);
      if (entry.disposition !== 'provisional') return fail(entry.disposition === 'retirement_fenced' ? 'FENCE_CONFLICT' : 'PUBLICATION_NOT_READY');
      if (entry.ref.executionKind === 'process' && entry.ref.processKind !== 'persistent_service') return fail('PUBLICATION_NOT_READY', 'short-lived process cannot be handed off as a live service');
      const reservation = this.ledger.get(originReservation);
      if (reservation.state !== 'COMMITTED' || !reservation.admittedOperation ||
          reservation.reservation.liveGenerationId !== liveGenerationId ||
          reservation.reservation.transactionId !== entry.ref.originTransactionId ||
          reservation.reservation.bindingGenerationId !== entry.ref.originBindingGenerationId ||
          reservation.reservation.requestId !== entry.ref.originRequestId ||
          reservation.reservation.targetId !== entry.ref.targetId ||
          reservation.reservation.targetDigest !== entry.ref.targetDigest ||
          reservation.reservation.providerId !== entry.ref.providerId ||
          reservation.reservation.providerVersion !== entry.ref.providerVersion) return fail('OWNERSHIP_SCOPE_MISMATCH');
      this.assertReservationBinding(originReservation);
      await this.verifyCapability(entry);
      const target = targetKey(entry.ref.targetId, entry.ref.targetDigest, entry.ref.serviceScope);
      const existing = this.targetIndex.get(target);
      const policy = this.targetPolicies.get(target) ?? 'exclusive';
      if (policy === 'exclusive' && existing && existing.liveGenerationId !== liveGenerationId) return fail('TARGET_CONFLICT');
      if (policy === 'exclusive') {
        const unresolvedCompeting = [...this.entries.values()].find(other => other.ref.liveGenerationId !== liveGenerationId && other.disposition !== 'terminal' && other.disposition !== 'provisional' && targetKey(other.ref.targetId, other.ref.targetDigest, other.ref.serviceScope) === target);
        if (unresolvedCompeting) return fail('TARGET_CONFLICT');
      }
      const base: Plain = { kind: 'live-generation-handoff-observation', observationId: uniqueId('handoff'), originOwnershipId: entry.ref.originOwnershipId, originBindingGenerationId: entry.ref.originBindingGenerationId, liveGenerationId, registryEpochId: this.registryEpochId, workspaceId: entry.ref.providerGenerationProofRef.workspaceId, taskId: entry.ref.providerGenerationProofRef.taskId, taskRevision: entry.ref.providerGenerationProofRef.taskRevision, requestId: entry.ref.providerGenerationProofRef.requestId, attemptId: entry.ref.providerGenerationProofRef.attemptId, originTransactionId: entry.ref.originTransactionId, targetId: entry.ref.targetId, providerGenerationEvidenceDigest: entry.ref.providerGenerationProofRef.providerGenerationEvidenceDigest, ...parsedHandoff, published: true, observedAt: new Date().toISOString(), observationDigest: '0'.repeat(64) };
      const observation = await makeDigestArtifact('live-generation-handoff-observation', base, 'observationDigest') as Readonly<LiveGenerationHandoffObservation>;
      // Close origin work before publication.  If this canonical operation
      // fails, no cross-transaction publication is allowed.
      try { await this.ledger.closeByHandoff(originReservation.admissionId, observation.observationId); }
      catch (error) { entry.disposition = 'ownership_unresolved'; entry.version = (entry.version + 1) as SafeInteger; throw error; }
      entry.handoff = observation; entry.disposition = 'published_open'; entry.version = (entry.version + 1) as SafeInteger;
      this.targetIndex.set(target, { liveGenerationId, version: entry.version });
      try { this.refreshProjectionsUnlocked(liveGenerationId, originReservation.transactionId); }
      catch (error) { throw error; }
      return observation;
    });
  }

  async resolve(liveRef: LiveOwnedGenerationRef): Promise<Readonly<LiveOwnedGenerationRef>> {
    liveRef = validateLiveOwnedGenerationRef(liveRef);
    await assertCurrentDigest(hasLiveGenerationIntegrity(liveRef), 'OWNERSHIP_NOT_PROVEN');
    return this.mutex.run(() => {
      if (liveRef.registryEpochId !== this.registryEpochId) return fail('RESTART_RECONCILIATION_REQUIRED');
      const entry = this.current(liveRef.liveGenerationId);
      if (entry.ref.liveGenerationDigest !== liveRef.liveGenerationDigest || entry.disposition === 'terminal' || entry.disposition === 'ownership_unresolved') return fail('OWNERSHIP_STALE');
      return this.verifyCapability(entry).then(() => entry.ref);
    });
  }

  async mintProcessBinding(input: ProcessBindingInput): Promise<Readonly<OwnedProcessRef>> {
    scanInert(input);
    input = {
      ...input,
      executionRef: validateOwnedExecutionRef(input.executionRef),
      liveGenerationId: text(input.liveGenerationId, 'INVALID_LIVE_GENERATION_ID'),
      ...(input.diagnosticObservation === undefined ? {} : { diagnosticObservation: validateShape(input.diagnosticObservation, parseDiagnostic) })
    };
    await assertCurrentDigest(hasOwnedExecutionIntegrity(input.executionRef), 'OWNERSHIP_NOT_PROVEN');
    return this.mutex.run(async () => {
      const entry = this.current(input.liveGenerationId);
      if (this.closedBindingKeys.has(bindingKey(input.executionRef, input.liveGenerationId))) return fail('OWNERSHIP_STALE', 'transaction control binding has expired');
      const originBinding = entry.disposition === 'provisional' && input.executionRef.ownershipId === entry.ref.originOwnershipId && input.executionRef.bindingGenerationId === entry.ref.originBindingGenerationId && sameH1Scope(input.executionRef, entry.ref.providerGenerationProofRef);
      if (entry.disposition !== 'published_open' && !originBinding) return fail(entry.disposition === 'retirement_fenced' ? 'ADMISSION_NOT_STOPPED' : entry.disposition === 'provisional' ? 'PUBLICATION_NOT_READY' : 'OWNERSHIP_STALE');
      if (entry.ref.executionKind !== 'process') return fail('OWNERSHIP_SCOPE_MISMATCH');
      if (entry.ref.registryEpochId !== this.registryEpochId || entry.ref.targetId !== input.executionRef.targetId || entry.ref.targetDigest !== input.executionRef.targetDigest) return fail('OWNERSHIP_SCOPE_MISMATCH');
      this.assertScopeCompatibility(entry.ref.serviceScope, input.executionRef);
      if (entry.ref.providerId !== input.executionRef.providerId || entry.ref.providerVersion !== input.executionRef.providerVersion) return fail('OWNERSHIP_SCOPE_MISMATCH');
      await this.verifyCapability(entry);
      const proof = entry.ref.providerGenerationProofRef;
      const binding = await createOwnedProcessRef({ executionRef: input.executionRef, liveGenerationRef: entry.ref, providerGenerationProofRef: proof, ...(input.diagnosticObservation === undefined ? {} : { diagnosticObservation: input.diagnosticObservation }) });
      const key = bindingKey(input.executionRef, entry.ref.liveGenerationId);
      const existing = this.bindings.get(key) ?? [];
      if (!existing.some(candidate => candidate.bindingDigest === binding.bindingDigest)) this.bindings.set(key, [...existing, binding]);
      return binding;
    });
  }

  async mintToolBinding(input: ToolBindingInput): Promise<Readonly<OwnedToolInvocationRef>> {
    scanInert(input);
    input = {
      ...input,
      executionRef: validateOwnedExecutionRef(input.executionRef),
      liveGenerationId: text(input.liveGenerationId, 'INVALID_LIVE_GENERATION_ID'),
      invocationId: text(input.invocationId, 'INVALID_INVOCATION_ID'),
      normalizedInputDigest: digest(input.normalizedInputDigest, 'INVALID_TOOL_INPUT_DIGEST'),
      toolKind: oneOf(input.toolKind, TOOL_KINDS, 'INVALID_TOOL_KIND'),
      toolInvocationProvenanceDigest: digest(input.toolInvocationProvenanceDigest, 'INVALID_TOOL_PROVENANCE')
    };
    await assertCurrentDigest(hasOwnedExecutionIntegrity(input.executionRef), 'OWNERSHIP_NOT_PROVEN');
    return this.mutex.run(async () => {
      const entry = this.current(input.liveGenerationId);
      if (this.closedBindingKeys.has(bindingKey(input.executionRef, input.liveGenerationId))) return fail('OWNERSHIP_STALE', 'transaction control binding has expired');
      const originBinding = entry.disposition === 'provisional' && input.executionRef.ownershipId === entry.ref.originOwnershipId && input.executionRef.bindingGenerationId === entry.ref.originBindingGenerationId && sameH1Scope(input.executionRef, entry.ref.providerGenerationProofRef);
      if (entry.disposition !== 'published_open' && !originBinding) return fail(entry.disposition === 'retirement_fenced' ? 'ADMISSION_NOT_STOPPED' : entry.disposition === 'provisional' ? 'PUBLICATION_NOT_READY' : 'OWNERSHIP_STALE');
      if (entry.ref.executionKind !== 'tool' || entry.ref.toolKind !== input.toolKind) return fail('OWNERSHIP_SCOPE_MISMATCH');
      if (entry.ref.targetId !== input.executionRef.targetId || entry.ref.targetDigest !== input.executionRef.targetDigest || entry.ref.providerId !== input.executionRef.providerId || entry.ref.providerVersion !== input.executionRef.providerVersion) return fail('OWNERSHIP_SCOPE_MISMATCH');
      this.assertScopeCompatibility(entry.ref.serviceScope, input.executionRef);
      await this.verifyCapability(entry);
      const binding = await createOwnedToolInvocationRef({ executionRef: input.executionRef, liveGenerationId: entry.ref.liveGenerationId, invocationId: input.invocationId, normalizedInputDigest: input.normalizedInputDigest, toolKind: input.toolKind, toolInvocationProvenanceDigest: input.toolInvocationProvenanceDigest });
      const invocationKey = `${entry.ref.liveGenerationId}\u0000${input.invocationId}`;
      const invocationBinding = this.invocationBindings.get(invocationKey);
      const key = bindingKey(input.executionRef, entry.ref.liveGenerationId);
      if (invocationBinding !== undefined) return fail('ADMISSION_REPLAY', 'invocation identity was already issued');
      this.invocationBindings.set(invocationKey, { bindingDigest: binding.bindingDigest, scopeKey: key });
      const existing = this.bindings.get(key) ?? [];
      if (!existing.some(candidate => candidate.bindingDigest === binding.bindingDigest)) this.bindings.set(key, [...existing, binding]);
      return binding;
    });
  }

  async refreshProjections(liveGenerationId: string, transactionId: HarnessTransactionId): Promise<void> {
    await this.mutex.run(() => this.refreshProjectionsUnlocked(liveGenerationId, transactionId));
  }

  private refreshProjectionsUnlocked(liveGenerationId: string, transactionId: HarnessTransactionId): void {
    if (this.projectionFailures.has('live')) return fail('INTERNAL_HARNESS_FAILURE', 'live admission projection failed');
    const activeAdmissionIds = this.ledger.activeForGeneration(liveGenerationId).map(item => item.admissionId).sort();
    this.liveProjection.set(liveGenerationId, { revision: this.ledger.ledgerRevision, admissionIds: Object.freeze(activeAdmissionIds) });
    if (this.projectionFailures.has('transaction')) return fail('INTERNAL_HARNESS_FAILURE', 'transaction admission projection failed');
    this.transactionRegistry.rebuild(this.ledger, transactionId);
  }

  liveProjectionFor(liveGenerationId: string): readonly string[] { return this.liveProjection.get(liveGenerationId)?.admissionIds ?? []; }

  async admitOrdinary(binding: OwnedProcessRef | OwnedToolInvocationRef, reservation: AdmissionReservationRef, receipt: AuthorityConsumptionRef): Promise<Readonly<AdmittedOperationRef>> {
    scanInert(binding); scanInert(reservation); scanInert(receipt);
    binding = 'liveGenerationRef' in binding ? validateOwnedProcessRef(binding) : validateOwnedToolInvocationRef(binding);
    reservation = validateAdmissionReservationRef(reservation);
    receipt = validateAuthorityConsumptionRef(receipt);
    await assertCurrentDigest(('liveGenerationRef' in binding ? hasOwnedProcessIntegrity(binding) : hasOwnedToolIntegrity(binding)), 'OWNERSHIP_NOT_PROVEN');
    await assertCurrentDigest(hasReservationIntegrity(reservation), 'INVALID_RESERVATION_INTEGRITY');
    await assertCurrentDigest(hasAuthorityReceiptIntegrity(receipt), 'INVALID_AUTHORITY_RECEIPT_INTEGRITY');
    return this.mutex.run(async () => {
      const execution = binding.executionRef;
      const liveGenerationId = 'liveGenerationRef' in binding ? binding.liveGenerationRef.liveGenerationId : binding.liveGenerationId;
      const entry = this.current(liveGenerationId);
      if (entry.disposition !== 'published_open') return fail(entry.disposition === 'retirement_fenced' ? 'ADMISSION_NOT_STOPPED' : 'OWNERSHIP_STALE');
      if (reservation.bindingGenerationId !== execution.bindingGenerationId || reservation.liveGenerationId !== liveGenerationId || reservation.transactionId !== execution.transactionId) return fail('OWNERSHIP_SCOPE_MISMATCH');
      if (entry.ref.targetId !== execution.targetId || entry.ref.targetDigest !== execution.targetDigest || entry.ref.providerId !== execution.providerId || entry.ref.providerVersion !== execution.providerVersion) return fail('OWNERSHIP_SCOPE_MISMATCH');
      this.assertReservationBinding(reservation, binding);
      if (!this.receiptBridge || !this.receiptBridge.isTrustedReceipt(receipt)) return fail('AUTHORITY_OBSERVATION_UNRESOLVED');
      await this.verifyCapability(entry);
      await this.ledger.noteAuthorityConsumption(reservation, receipt);
      let admitted: Readonly<AdmittedOperationRef>;
      try {
        admitted = await this.ledger.commit(reservation);
      } catch (error) {
        try { await this.ledger.consumedUnresolved(reservation, 'ordinary_admission_commit_failed'); } catch { /* retain RESERVED + receipt if the ledger itself is faulted */ }
        throw error;
      }
      this.refreshProjectionsUnlocked(liveGenerationId, reservation.transactionId);
      return admitted;
    });
  }

  /** Create the exact retirement fence and commit its stop admission. */
  async fenceAndCommitStop(reservation: AdmissionReservationRef, receipt: AuthorityConsumptionRef, callbackPermit?: object): Promise<{ fence: Readonly<RetirementFenceRef>; admitted: Readonly<AdmittedOperationRef> }> {
    reservation = validateAdmissionReservationRef(reservation);
    receipt = validateAuthorityConsumptionRef(receipt);
    await assertCurrentDigest(hasReservationIntegrity(reservation), 'INVALID_RESERVATION_INTEGRITY');
    await assertCurrentDigest(hasAuthorityReceiptIntegrity(receipt), 'INVALID_AUTHORITY_RECEIPT_INTEGRITY');
    if (!this.receiptBridge) return fail('AUTHORITY_OBSERVATION_UNRESOLVED');
    this.receiptBridge.assertExecutorCallbackPermit(callbackPermit, receipt);
    return this.mutex.run(async () => {
      const entry = this.current(reservation.liveGenerationId);
      if (entry.disposition !== 'published_open') return fail(entry.disposition === 'retirement_fenced' ? 'FENCE_CONFLICT' : 'OWNERSHIP_STALE');
      if (entry.ref.registryEpochId !== this.registryEpochId || entry.ref.targetId !== reservation.targetId || entry.ref.targetDigest !== reservation.targetDigest || entry.ref.providerId !== reservation.providerId || entry.ref.providerVersion !== reservation.providerVersion || !receiptMatchesReservation(receipt, reservation)) return fail('OWNERSHIP_SCOPE_MISMATCH');
      this.assertReservationBinding(reservation);
      if (!this.receiptBridge || !this.receiptBridge.isTrustedReceipt(receipt)) return fail('AUTHORITY_OBSERVATION_UNRESOLVED');
      await this.verifyCapability(entry);
      this.receiptBridge.assertExecutorCallbackPermit(callbackPermit, receipt);
      const base: Plain = { kind: 'retirement-fence-ref', liveGenerationId: reservation.liveGenerationId, registryEpochId: this.registryEpochId, stopTransactionId: reservation.transactionId, bindingGenerationId: reservation.bindingGenerationId, admissionReservationId: reservation.admissionId, operationDigest: reservation.operationDigest, targetDigest: reservation.targetDigest, fenceGeneration: entry.version, fenceDigest: '0'.repeat(64) };
      const fence = await makeDigestArtifact('retirement-fence-ref', base, 'fenceDigest') as Readonly<RetirementFenceRef>;
      entry.fence = fence; entry.disposition = 'retirement_fenced'; entry.version = (entry.version + 1) as SafeInteger;
      this.receiptBridge.consumeExecutorCallbackPermit(callbackPermit);
      try {
        await this.ledger.noteAuthorityConsumption(reservation, receipt);
      } catch (error) {
        try { await this.ledger.consumedUnresolved(reservation, 'stop_consumption_recording_failed'); } catch { /* preserve fence when the canonical ledger itself is faulted */ }
        throw error;
      }
      let admitted: Readonly<AdmittedOperationRef>;
      try {
        admitted = await this.ledger.commit(reservation);
      } catch (error) {
        try { await this.ledger.consumedUnresolved(reservation, 'stop_admission_commit_failed'); } catch { /* canonical unresolved fact is best effort after a ledger fault */ }
        throw error;
      }
      this.refreshProjectionsUnlocked(reservation.liveGenerationId, reservation.transactionId);
      return { fence, admitted };
    });
  }

  async dispatchTermination(reservation: AdmissionReservationRef, fence: RetirementFenceRef): Promise<Readonly<TerminationObservation>> {
    reservation = validateAdmissionReservationRef(reservation);
    fence = validateRetirementFenceRef(fence);
    await assertCurrentDigest(hasReservationIntegrity(reservation), 'INVALID_RESERVATION_INTEGRITY');
    await assertCurrentDigest(hasRetirementFenceIntegrity(fence), 'FENCE_CONFLICT');
    let capability: TrustedProviderGenerationCapability;
    let controlBinding: Readonly<OwnedProcessRef | OwnedToolInvocationRef>;
    await this.mutex.run(async () => {
      const entry = this.current(reservation.liveGenerationId);
      if (entry.disposition !== 'retirement_fenced' || !entry.fence ||
          entry.fence.fenceDigest !== fence.fenceDigest ||
          entry.fence.liveGenerationId !== reservation.liveGenerationId ||
          entry.fence.registryEpochId !== this.registryEpochId ||
          entry.fence.stopTransactionId !== reservation.transactionId ||
          entry.fence.bindingGenerationId !== reservation.bindingGenerationId ||
          entry.fence.admissionReservationId !== reservation.admissionId ||
          entry.fence.operationDigest !== reservation.operationDigest ||
          entry.fence.targetDigest !== reservation.targetDigest) return fail('FENCE_CONFLICT');
      const record = this.ledger.get(reservation);
      if (record.state !== 'COMMITTED' || !record.admittedOperation || !record.authorityConsumption) return fail('ADMISSION_NOT_STOPPED');
      controlBinding = this.assertReservationBinding(reservation);
      if (!this.receiptBridge || !this.receiptBridge.isTrustedReceipt(record.authorityConsumption)) return fail('AUTHORITY_OBSERVATION_UNRESOLVED');
      if (this.projectionFailures.size > 0) return fail('INTERNAL_HARNESS_FAILURE', 'required projection repair pending');
      await this.verifyCapability(entry);
      if (!entry.capability.terminateExact) return fail('PROCESS_GENERATION_UNAVAILABLE', 'exact-generation termination capability unavailable');
      await this.ledger.markDispatchStarted(reservation.admissionId);
      capability = entry.capability;
    });
    let outcome: TerminationObservation['outcome'] = 'unconfirmed';
    let dispatchStarted = false;
    try {
      if (capability!.terminateExact) {
        dispatchStarted = true;
        const providerOutcome = await capability!.terminateExact();
        if (!TERMINATION_OUTCOMES.includes(providerOutcome)) throw new Error('provider returned an invalid termination outcome');
        outcome = providerOutcome;
      }
    } catch { outcome = 'unconfirmed'; }
    const observationBase: Plain = { kind: 'termination-observation', observationId: uniqueId('termination'), ownershipId: controlBinding!.executionRef.ownershipId, liveGenerationId: reservation.liveGenerationId, registryEpochId: this.registryEpochId, admissionId: reservation.admissionId, workspaceId: reservation.workspaceId, taskId: reservation.taskId, taskRevision: reservation.taskRevision, requestId: reservation.requestId, attemptId: reservation.attemptId, transactionId: reservation.transactionId, outcome, dispatchStarted, exactGenerationProven: true, observedAt: new Date().toISOString(), observationDigest: '0'.repeat(64) };
    const observation = await makeDigestArtifact('termination-observation', observationBase, 'observationDigest') as Readonly<TerminationObservation>;
    await this.mutex.run(async () => {
      const entry = this.current(reservation.liveGenerationId);
      if (outcome === 'exact_generation_exited' || outcome === 'already_exited') {
        await this.ledger.markGenerationTerminal(reservation.liveGenerationId, observation.observationId);
        this.retireEntry(entry);
      }
    });
    return observation;
  }

  private retireEntry(entry: LiveEntry): void {
    entry.disposition = 'terminal'; entry.version = (entry.version + 1) as SafeInteger;
    const key = targetKey(entry.ref.targetId, entry.ref.targetDigest, entry.ref.serviceScope);
    const mapped = this.targetIndex.get(key);
    if (mapped && mapped.liveGenerationId === entry.ref.liveGenerationId && mapped.version <= entry.version) this.targetIndex.delete(key);
  }

  async observeNaturalExit(liveGenerationId: string): Promise<void> {
    const capability = await this.mutex.run(() => {
      const entry = this.current(liveGenerationId);
      return entry.capability.observeExactExit;
    });
    if (!capability) return;
    let exited = false;
    try { exited = (await capability()) === true; } catch { exited = false; }
    if (!exited) return;
    await this.mutex.run(() => {
      const entry = this.current(liveGenerationId);
      if (entry.disposition === 'provisional' || entry.disposition === 'published_open' || entry.disposition === 'retirement_fenced') {
        // Exact native exit closes every committed H2 operation affected by
        // this generation; it does not imply any effect-certainty outcome.
        return this.ledger.markGenerationTerminal(liveGenerationId, uniqueId('natural-exit')).then(() => this.retireEntry(entry));
      }
    });
  }

  async markOwnershipLost(liveGenerationId: string): Promise<void> {
    await this.mutex.run(() => {
      const entry = this.current(liveGenerationId);
      if (entry.disposition === 'terminal') return fail('OWNERSHIP_LOST');
      entry.disposition = 'ownership_unresolved'; entry.version = (entry.version + 1) as SafeInteger;
    });
  }

  async disposition(liveGenerationId: string): Promise<LiveGenerationDisposition> {
    return this.mutex.run(() => this.current(liveGenerationId).disposition);
  }

  async activeAdmissions(liveGenerationId: string): Promise<readonly Readonly<AdmittedOperationRef>[]> {
    return this.mutex.run(() => this.ledger.activeForGeneration(liveGenerationId));
  }

  /** H1 calls this when the bound epoch closes; the binding remains historical but cannot admit work. */
  async closeControlBinding(binding: OwnedProcessRef | OwnedToolInvocationRef): Promise<void> {
    binding = 'liveGenerationRef' in binding ? validateOwnedProcessRef(binding) : validateOwnedToolInvocationRef(binding);
    await assertCurrentDigest(('liveGenerationRef' in binding ? hasOwnedProcessIntegrity(binding) : hasOwnedToolIntegrity(binding)), 'OWNERSHIP_NOT_PROVEN');
    await this.mutex.run(() => {
      const liveGenerationId = 'liveGenerationRef' in binding ? binding.liveGenerationRef.liveGenerationId : binding.liveGenerationId;
      const key = bindingKey(binding.executionRef, liveGenerationId);
      if (this.closedBindingKeys.has(key)) return;
      this.bindingFor(binding.executionRef, liveGenerationId, binding);
      this.closedBindingKeys.add(key);
    });
  }

  /** Quiescence is always evaluated against canonical ledger truth in this registry epoch. */
  async createQuiescence(scope: { workspaceId: WorkspaceId; taskId: TaskId; taskRevision: TaskRevision; requestId: HarnessExecutionRequestId; attemptId: WorkerAttemptId; transactionId: HarnessTransactionId }, options: { admissionCutoff: boolean; registryCompleteness: boolean; unresolvedDescendantIds?: readonly string[] }): Promise<Readonly<QuiescenceObservation>> {
    return this.mutex.run(() => this.ledger.createQuiescence(scope, { ...options, registryEpochId: this.registryEpochId }));
  }
}

interface WatchInternal {
  readonly ref: Readonly<AuthorityConsumptionWatch>;
  state: 'installed' | 'executing' | 'settled' | 'ambiguous';
  recorderFault: boolean;
  consumedEventSeen: boolean;
  receipt?: Readonly<AuthorityConsumptionRef>;
  fingerprint?: string;
  executeSettled: boolean;
  callbackEntered: boolean;
  dispatchStarted: boolean;
}

interface CallbackPermitInternal {
  readonly watchId: string;
  readonly receiptDigest: string;
  readonly reservationId: string;
  used: boolean;
}

export interface AuthorityConsumptionWatchInput extends Omit<AuthorityConsumptionWatch, 'kind' | 'watchId' | 'watchDigest' | 'bridgeEpochId'> {
  readonly watchId?: string;
}

export interface BridgeExecuteClassification {
  readonly outcome: 'ABORTED_PRECONSUMPTION' | 'CONSUMED_NO_DISPATCH' | 'CONSUMED_UNRESOLVED';
  readonly receipt?: Readonly<AuthorityConsumptionRef>;
  readonly reason: string;
}

/**
 * Composition-root observation bridge for the existing Execution Authority
 * recorder. It observes the same persisted consumed event and never grants,
 * revokes or executes authority.
 */
export class AuthorityConsumptionReceiptBridge {
  readonly bridgeEpochId: string;
  private readonly maxWatches: number;
  private readonly maxReceipts: number;
  private readonly maxTombstones: number;
  private readonly watches = new Map<string, WatchInternal>();
  private readonly pendingWatchIds = new Set<string>();
  private readonly pendingOperationIds = new Set<string>();
  private readonly operationWatches = new Map<string, string>();
  private readonly receipts = new Map<string, Readonly<AuthorityConsumptionRef>>();
  private readonly tombstones = new Set<string>();
  private readonly consumedOperationsWithoutWatch = new Set<string>();
  private readonly callbackPermits = new WeakMap<object, CallbackPermitInternal>();
  private pendingReceiptCount = 0;
  private recorderWrapped = false;
  private epochFaulted = false;

  constructor(options: { bridgeEpochId?: string; maxWatches?: number; maxReceipts?: number; maxTombstones?: number } = {}) {
    this.bridgeEpochId = options.bridgeEpochId ?? uniqueId('bridge-epoch');
    this.maxWatches = options.maxWatches ?? MAX_WATCHES;
    this.maxReceipts = options.maxReceipts ?? MAX_RECEIPTS;
    this.maxTombstones = options.maxTombstones ?? MAX_TOMBSTONES;
    if (!Number.isSafeInteger(this.maxWatches) || this.maxWatches < 1 || !Number.isSafeInteger(this.maxReceipts) || this.maxReceipts < 1 || !Number.isSafeInteger(this.maxTombstones) || this.maxTombstones < 1) return fail('BRIDGE_CAPACITY_EXHAUSTED');
  }

  get healthy(): boolean { return !this.epochFaulted; }
  get activeWatchCount(): number { return this.watches.size; }
  get receiptCount(): number { return this.receipts.size; }

  async installWatch(input: AuthorityConsumptionWatchInput): Promise<Readonly<AuthorityConsumptionWatch>> {
    scanInert(input);
    if (this.epochFaulted) return fail('BRIDGE_HEALTH_UNCERTAIN');
    const watchId = input.watchId ?? uniqueId('watch');
    if (this.watches.has(watchId) || this.pendingWatchIds.has(watchId) || this.operationWatches.has(input.authorityOperationId) || this.pendingOperationIds.has(input.authorityOperationId) || this.receipts.has(input.authorityOperationId) || this.tombstones.has(input.authorityOperationId) || this.consumedOperationsWithoutWatch.has(input.authorityOperationId)) return fail('BRIDGE_WATCH_CONFLICT');
    if (this.watches.size + this.pendingWatchIds.size >= this.maxWatches) return fail('BRIDGE_CAPACITY_EXHAUSTED');
    if (this.receipts.size >= this.maxReceipts) return fail('BRIDGE_CAPACITY_EXHAUSTED');
    this.pendingWatchIds.add(watchId); this.pendingOperationIds.add(input.authorityOperationId);
    try {
      const ref = await createWatch({ ...input, watchId, bridgeEpochId: this.bridgeEpochId });
      const internal: WatchInternal = { ref, state: 'installed', recorderFault: false, consumedEventSeen: false, executeSettled: false, callbackEntered: false, dispatchStarted: false };
      this.watches.set(watchId, internal);
      this.operationWatches.set(ref.authorityOperationId, watchId);
      return ref;
    } finally {
      this.pendingWatchIds.delete(watchId); this.pendingOperationIds.delete(input.authorityOperationId);
    }
  }

  beginExecute(watchId: string): void {
    const watch = this.watches.get(watchId);
    if (!watch || watch.state !== 'installed' || this.epochFaulted || !this.recorderWrapped) return fail('BRIDGE_HEALTH_UNCERTAIN');
    watch.state = 'executing';
  }

  /**
   * Trusted composition-root seam: call only from the actual Execution
   * Authority executor callback.  The returned identity is deliberately
   * ephemeral and cannot be reconstructed from serialized data.
   */
  enterExecutorCallback(watchId: string): object {
    const watch = this.watches.get(watchId);
    if (!watch || watch.state !== 'executing' || watch.callbackEntered || !watch.receipt || this.epochFaulted || !this.recorderWrapped) return fail('FENCE_CONFLICT', 'executor callback receipt is not available');
    watch.callbackEntered = true;
    const permit = Object.freeze({});
    this.callbackPermits.set(permit, { watchId, receiptDigest: watch.receipt.receiptDigest, reservationId: watch.ref.reservationId, used: false });
    return permit;
  }

  /** Validate callback provenance without acquiring any H2 ownership lock. */
  assertExecutorCallbackPermit(permit: unknown, receipt: AuthorityConsumptionRef): void {
    if (permit === null || typeof permit !== 'object') return fail('FENCE_CONFLICT', 'executor callback provenance required');
    const internal = this.callbackPermits.get(permit);
    const watch = internal === undefined ? undefined : this.watches.get(internal.watchId);
    if (!internal || internal.used || !watch || !watch.receipt || internal.receiptDigest !== receipt.receiptDigest || internal.reservationId !== receipt.reservationId || !sameReceiptIdentity(watch.receipt, receipt) || !this.isTrustedReceipt(receipt)) return fail('FENCE_CONFLICT', 'executor callback provenance mismatch');
  }

  consumeExecutorCallbackPermit(permit: unknown): void {
    if (permit === null || typeof permit !== 'object') return fail('FENCE_CONFLICT', 'executor callback provenance required');
    const internal = this.callbackPermits.get(permit);
    if (!internal || internal.used) return fail('FENCE_CONFLICT', 'executor callback provenance already consumed');
    internal.used = true;
  }

  settleExecute(watchId: string, input: { callbackEntered: boolean; dispatchStarted: boolean }): void {
    const watch = this.watches.get(watchId);
    if (!watch || (watch.state !== 'executing' && watch.state !== 'ambiguous')) return fail('BRIDGE_HEALTH_UNCERTAIN');
    watch.executeSettled = true; watch.callbackEntered = input.callbackEntered; watch.dispatchStarted = input.dispatchStarted;
    if (!watch.recorderFault && watch.state !== 'ambiguous') watch.state = 'settled';
    if (watch.state === 'settled' && !watch.receipt) this.addTombstone(watch.ref.authorityOperationId);
  }

  private addTombstone(operationId: string): void {
    if (this.tombstones.size >= this.maxTombstones) {
      const oldest = this.tombstones.values().next().value;
      if (typeof oldest === 'string') this.tombstones.delete(oldest);
    }
    this.tombstones.add(operationId);
  }

  private rememberConsumedWithoutWatch(operationId: string): void {
    if (this.consumedOperationsWithoutWatch.size >= this.maxTombstones) {
      const oldest = this.consumedOperationsWithoutWatch.values().next().value;
      if (typeof oldest === 'string') this.consumedOperationsWithoutWatch.delete(oldest);
    }
    this.consumedOperationsWithoutWatch.add(operationId);
  }

  /** Wrap exactly the canonical recorder injected into Execution Authority. */
  wrapRecorder(recorder: (event: AuthorityAuditEvent) => Promise<AuthorityRecorderResult>): (event: unknown) => Promise<AuthorityRecorderResult> {
    if (this.recorderWrapped) return fail('BRIDGE_WATCH_CONFLICT', 'recorder already wrapped');
    if (typeof recorder !== 'function') return fail('BRIDGE_HEALTH_UNCERTAIN');
    this.recorderWrapped = true;
    return async (rawEvent: unknown): Promise<AuthorityRecorderResult> => {
      const operationId = peekStringField(rawEvent, 'operation_id');
      const decision = peekStringField(rawEvent, 'decision');
      const watchId = decision === 'consumed' && operationId !== undefined ? this.operationWatches.get(operationId) : undefined;
      // Non-H2 authority events (paired, proposed, approve/reject, etc.) and
      // unwatched consumed events retain the recorder's exact semantics.
      if (watchId === undefined) {
        if (decision === 'consumed' && operationId !== undefined) this.rememberConsumedWithoutWatch(operationId);
        return recorder(rawEvent as AuthorityAuditEvent);
      }
      let event: AuthorityAuditEvent;
      try { event = validateAuthorityEvent(rawEvent); } catch (error) { this.epochFaulted = true; throw error; }
      const watch = this.watches.get(watchId);
      if (!watch || watch.ref.bridgeEpochId !== this.bridgeEpochId) { this.epochFaulted = true; return fail('BRIDGE_HEALTH_UNCERTAIN'); }
      if (!this.matchesWatch(event, watch.ref)) { watch.recorderFault = true; watch.state = 'ambiguous'; return fail('AUTHORITY_OBSERVATION_UNRESOLVED'); }
      watch.consumedEventSeen = true;
      let result: AuthorityRecorderResult;
      try { result = await recorder(event); } catch (error) { watch.recorderFault = true; watch.state = 'ambiguous'; throw error; }
      if (!result || typeof result.persisted !== 'boolean') { watch.recorderFault = true; watch.state = 'ambiguous'; return fail('AUTHORITY_OBSERVATION_UNRESOLVED'); }
      if (!result.persisted) { watch.state = 'ambiguous'; return result; }
      try {
        const fingerprint = eventFingerprint(event);
        if (watch.fingerprint !== undefined && watch.fingerprint !== fingerprint) return fail('AUTHORITY_OBSERVATION_UNRESOLVED');
        if (this.receipts.size + this.pendingReceiptCount >= this.maxReceipts && !this.receipts.has(event.operation_id)) return fail('BRIDGE_CAPACITY_EXHAUSTED');
        if (watch.receipt) {
          if (watch.fingerprint !== fingerprint) return fail('AUTHORITY_OBSERVATION_UNRESOLVED');
          return result;
        }
        this.pendingReceiptCount++;
        try {
          const receipt = await createAuthorityReceipt(event, watch.ref);
          watch.receipt = receipt; watch.fingerprint = fingerprint;
          this.receipts.set(event.operation_id, receipt);
        } finally { this.pendingReceiptCount--; }
      } catch (error) {
        watch.recorderFault = true; watch.state = 'ambiguous';
        // Capacity and per-watch identity conflicts are local accounting
        // failures.  They must not disable unrelated H2 watches or the
        // non-H2 authority path; only a bridge/provenance integrity failure
        // faults the whole observation epoch.
        if (!(error instanceof HarnessOwnershipError && (error.code === 'BRIDGE_CAPACITY_EXHAUSTED' || error.code === 'AUTHORITY_OBSERVATION_UNRESOLVED' || error.code === 'BRIDGE_WATCH_CONFLICT'))) this.epochFaulted = true;
        throw error;
      }
      return result;
    };
  }

  private matchesWatch(event: AuthorityAuditEvent, watch: AuthorityConsumptionWatch): boolean {
    return event.operation_id === watch.authorityOperationId && event.policy_revision === watch.authorityRevision && event.workspace === watch.workspaceId && event.task_id === watch.taskId && event.kind === watch.operationKind && event.digest === watch.descriptorDigest && event.actor_id === watch.actorId && event.owner_id === watch.ownerId && event.decision === 'consumed';
  }

  receiptFor(watchId: string): Readonly<AuthorityConsumptionRef> | undefined {
    return this.watches.get(watchId)?.receipt;
  }

  /** A receipt is trusted only while the current bridge/watch is alive. */
  resolveReceipt(watchId: string, receipt: AuthorityConsumptionRef): Readonly<AuthorityConsumptionRef> {
    const watch = this.watches.get(watchId);
    if (!watch || !watch.receipt || !sameReceiptIdentity(watch.receipt, receipt) || receipt.bridgeEpochId !== this.bridgeEpochId || !this.isTrustedReceipt(receipt)) return fail('AUTHORITY_OBSERVATION_UNRESOLVED');
    return watch.receipt;
  }

  isTrustedReceipt(receipt: AuthorityConsumptionRef): boolean {
    try {
      scanInert(receipt);
      if (this.epochFaulted || receipt.bridgeEpochId !== this.bridgeEpochId) return false;
      const current = this.receipts.get(receipt.authorityOperationId);
      return current !== undefined && current.receiptDigest === receipt.receiptDigest && sameReceiptIdentity(current, receipt);
    } catch { return false; }
  }

  classify(watchId: string): BridgeExecuteClassification {
    const watch = this.watches.get(watchId);
    if (!watch || !watch.executeSettled || watch.state === 'installed' || watch.state === 'executing' || !this.recorderWrapped) return fail('BRIDGE_HEALTH_UNCERTAIN');
    if (watch.state === 'ambiguous' || watch.recorderFault || this.epochFaulted) return { outcome: 'CONSUMED_UNRESOLVED', ...(watch.receipt === undefined ? {} : { receipt: watch.receipt }), reason: 'consumption_or_recorder_truth_ambiguous' };
    if (watch.receipt) {
      if (!watch.callbackEntered && !watch.dispatchStarted) return { outcome: 'CONSUMED_NO_DISPATCH', receipt: watch.receipt, reason: 'canonical_consumed_persisted_callback_not_entered' };
      if (!watch.dispatchStarted) return { outcome: 'CONSUMED_NO_DISPATCH', receipt: watch.receipt, reason: 'canonical_consumed_persisted_no_provider_dispatch' };
      return { outcome: 'CONSUMED_UNRESOLVED', receipt: watch.receipt, reason: 'provider_dispatch_truth_requires_runtime_observation' };
    }
    if (!watch.recorderFault && !this.epochFaulted && watch.state === 'settled' && !watch.consumedEventSeen) return { outcome: 'ABORTED_PRECONSUMPTION', reason: 'healthy_watch_proves_no_consumed_event' };
    return { outcome: 'CONSUMED_UNRESOLVED', reason: 'consumption_or_recorder_truth_ambiguous' };
  }

  markEpochLost(): void {
    this.epochFaulted = true;
    for (const watch of this.watches.values()) { watch.recorderFault = true; watch.state = 'ambiguous'; }
  }

  closeWatch(watchId: string): void {
    const watch = this.watches.get(watchId);
    if (!watch || !watch.executeSettled || watch.state !== 'settled' || watch.recorderFault || this.epochFaulted) return fail('BRIDGE_HEALTH_UNCERTAIN');
    this.addTombstone(watch.ref.authorityOperationId);
    this.receipts.delete(watch.ref.authorityOperationId);
    this.watches.delete(watchId); this.operationWatches.delete(watch.ref.authorityOperationId);
  }
}

export async function createProcessRuntimeObservation(input: Omit<ProcessRuntimeObservation, 'kind' | 'observationDigest'>): Promise<Readonly<ProcessRuntimeObservation>> {
  scanInert(input);
  const base: Plain = { kind: 'process-runtime-observation', ...parseProcessRuntimeObservation(input), observationDigest: '0'.repeat(64) };
  return makeDigestArtifact('process-runtime-observation', base, 'observationDigest') as Promise<Readonly<ProcessRuntimeObservation>>;
}

export async function createToolCompletionObservation(input: Omit<ToolCompletionObservation, 'kind' | 'observationDigest'>): Promise<Readonly<ToolCompletionObservation>> {
  scanInert(input);
  const base: Plain = { kind: 'tool-completion-observation', ...parseToolCompletionObservation(input), observationDigest: '0'.repeat(64) };
  return makeDigestArtifact('tool-completion-observation', base, 'observationDigest') as Promise<Readonly<ToolCompletionObservation>>;
}

export async function createTerminationObservation(input: Omit<TerminationObservation, 'kind' | 'observationDigest'>): Promise<Readonly<TerminationObservation>> {
  scanInert(input);
  const base: Plain = { kind: 'termination-observation', ...parseTerminationObservation(input), observationDigest: '0'.repeat(64) };
  return makeDigestArtifact('termination-observation', base, 'observationDigest') as Promise<Readonly<TerminationObservation>>;
}

export async function createOwnershipLossObservation(input: Omit<OwnershipLossObservation, 'kind' | 'observationDigest'>): Promise<Readonly<OwnershipLossObservation>> {
  scanInert(input);
  const base: Plain = { kind: 'ownership-loss-observation', ...parseOwnershipLossObservation(input), observationDigest: '0'.repeat(64) };
  return makeDigestArtifact('ownership-loss-observation', base, 'observationDigest') as Promise<Readonly<OwnershipLossObservation>>;
}

export async function createLiveGenerationHandoffObservation(input: Omit<LiveGenerationHandoffObservation, 'kind' | 'observationDigest'>): Promise<Readonly<LiveGenerationHandoffObservation>> {
  scanInert(input);
  const base: Plain = { kind: 'live-generation-handoff-observation', ...parseHandoffObservation(input), observationDigest: '0'.repeat(64) };
  return makeDigestArtifact('live-generation-handoff-observation', base, 'observationDigest') as Promise<Readonly<LiveGenerationHandoffObservation>>;
}

export async function createH2OwnershipFailure(input: { readonly code: H2FailureCode; readonly message: string; readonly registryEpochId?: string; readonly liveGenerationId?: string; readonly transactionId?: HarnessTransactionId; readonly admissionId?: string }): Promise<Readonly<H2OwnershipFailure>> {
  scanInert(input);
  const parsed = record(input, ['code', 'message', 'registryEpochId', 'liveGenerationId', 'transactionId', 'admissionId'], 'H2_FAILURE');
  const registryEpochId = optionalText(parsed, 'registryEpochId', 'INVALID_REGISTRY_EPOCH');
  const liveGenerationId = optionalText(parsed, 'liveGenerationId', 'INVALID_LIVE_GENERATION_ID');
  const transactionId = optionalText(parsed, 'transactionId', 'INVALID_TRANSACTION') as HarnessTransactionId | undefined;
  const admissionId = optionalText(parsed, 'admissionId', 'INVALID_ADMISSION_ID');
  const base: Plain = { kind: 'h2-ownership-failure', code: oneOf(parsed.code, FAILURE_CODES, 'INVALID_H2_FAILURE_CODE'), message: text(parsed.message, 'INVALID_FAILURE_MESSAGE'), ...(registryEpochId === undefined ? {} : { registryEpochId }), ...(liveGenerationId === undefined ? {} : { liveGenerationId }), ...(transactionId === undefined ? {} : { transactionId }), ...(admissionId === undefined ? {} : { admissionId }), failureDigest: '0'.repeat(64) };
  return makeDigestArtifact('h2-ownership-failure', base, 'failureDigest') as Promise<Readonly<H2OwnershipFailure>>;
}

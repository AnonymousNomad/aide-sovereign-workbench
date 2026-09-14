import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createExecutionAuthority } from '../../node/src/services/execution-authority.mjs';
import {
  AdmissionLedger,
  AuthorityConsumptionReceiptBridge,
  HarnessOwnershipError,
  LiveGenerationRegistry,
  TransactionExecutionRegistry,
  createAdmissionReservationRef,
  createOwnedProcessRef,
  createOwnedExecutionRef,
  createProcessRuntimeObservation,
  createProviderGenerationProofRef,
  hasOwnedExecutionIntegrity,
  h2Digest,
  validateOwnedExecutionRef
} from '../../common/execution/harness-ownership.ts';
import type {
  AuthorityAuditEvent,
  AuthorityConsumptionWatchInput,
  Digest,
  HarnessExecutionRequestId,
  HarnessTransactionId,
  OwnedExecutionRef,
  SafeInteger,
  ServiceScope,
  WorkspaceId,
  TaskId,
  WorkerAttemptId
} from '../../common/execution/harness-ownership.ts';

const D = 'a'.repeat(64) as Digest;
const E = 'b'.repeat(64) as Digest;
const F = 'c'.repeat(64) as Digest;
const scope = {
  workspaceId: 'workspace-1' as WorkspaceId,
  taskId: 'task-1' as TaskId,
  taskRevision: 0 as SafeInteger,
  attemptId: 'attempt-1' as WorkerAttemptId,
  transactionId: 'transaction-1' as HarnessTransactionId,
  requestId: 'request-1' as HarnessExecutionRequestId
};
const serviceScope: ServiceScope = { kind: 'workspace', scopeId: scope.workspaceId, policyDigest: D };
const bridgeRecorders = new WeakMap<AuthorityConsumptionReceiptBridge, (event: unknown) => Promise<{ persisted: boolean; error?: string | null }>>();

function expectCode(action: () => unknown, code: string): void {
  assert.throws(action, (error: unknown) => error instanceof HarnessOwnershipError && error.code === code);
}

async function redigest<T extends Record<string, unknown>>(kind: string, value: T, field: keyof T, changes: Partial<T>): Promise<T> {
  const unsigned = { ...value, ...changes } as Record<string, unknown>;
  delete unsigned[field as string];
  return { ...unsigned, [field]: await h2Digest(kind, unsigned) } as T;
}

async function execution(overrides: Partial<OwnedExecutionRef> = {}): Promise<Readonly<OwnedExecutionRef>> {
  return createOwnedExecutionRef({
    ownershipId: 'ownership-1',
    bindingGenerationId: 'binding-1',
    ...scope,
    operationId: 'operation-1' as OwnedExecutionRef['operationId'],
    operationDigest: D,
    targetId: 'model-service',
    targetDigest: E,
    effectScopeDigest: F,
    executionKind: 'process',
    providerId: 'provider-1',
    providerVersion: '1',
    ...overrides
  });
}

function capability(state: { alive: boolean } = { alive: true }) {
  return {
    capabilityId: 'capability-1',
    verifyExactGeneration: () => state.alive,
    observeExactExit: () => !state.alive,
    terminateExact: async () => {
      if (!state.alive) return 'already_exited' as const;
      state.alive = false;
      return 'exact_generation_exited' as const;
    }
  };
}

async function publishedRegistry(exec: OwnedExecutionRef | undefined = undefined, options: { targetPolicy?: 'exclusive' | 'multi'; state?: { alive: boolean }; receiptBridge?: AuthorityConsumptionReceiptBridge } = {}) {
  exec ??= await execution();
  const state = options.state ?? { alive: true };
  const receiptBridge = options.receiptBridge ?? new AuthorityConsumptionReceiptBridge({ bridgeEpochId: `bridge-${exec.transactionId}` });
  const registry = new LiveGenerationRegistry({ registryEpochId: 'epoch-1', receiptBridge });
  const live = await registry.registerProvisional({
    executionRef: exec,
    providerGenerationEvidenceDigest: D,
    creationObservationDigest: E,
    capability: capability(state),
    targetId: exec.targetId,
    targetDigest: exec.targetDigest,
    serviceScope,
    processKind: 'persistent_service',
    targetPolicy: options.targetPolicy ?? 'exclusive'
  });
  const originBinding = await registry.mintProcessBinding({ executionRef: exec, liveGenerationId: live.liveGenerationId });
  const originReservation = await reservation(exec, live.liveGenerationId, `${exec.transactionId}-handoff`, `handoff-operation-${exec.transactionId}` as OwnedExecutionRef['operationId']);
  await registry.ledger.reserve(originReservation);
  const { receipt: originReceipt } = await watchAndReceipt({
    authorityOperationId: originReservation.operationId,
    descriptorDigest: originReservation.operationDigest,
    reservationId: originReservation.admissionId,
    bindingGenerationId: exec.bindingGenerationId,
    requestId: exec.requestId,
    attemptId: exec.attemptId,
    transactionId: exec.transactionId
  }, receiptBridge);
  await registry.ledger.noteAuthorityConsumption(originReservation, originReceipt);
  await registry.ledger.commit(originReservation);
  const handoff = await registry.completePersistentHandoff(live.liveGenerationId, originReservation, {
    noUnresolvedLaunchWork: true,
    noUnresolvedDescendants: true,
    responsibilityTransferred: true
  });
  assert.equal(handoff.published, true);
  return { registry, live, state, receiptBridge, originBinding, originReservation };
}

async function watchAndReceipt(overrides: Partial<AuthorityConsumptionWatchInput> = {}, bridge = new AuthorityConsumptionReceiptBridge({ bridgeEpochId: 'bridge-1' }), callbackEntered = false) {
  const watch = await bridge.installWatch({
    authorityOperationId: 'operation-1',
    authorityRevision: 1 as SafeInteger,
    workspaceId: scope.workspaceId,
    taskId: scope.taskId,
    operationKind: 'tasks.stop',
    descriptorDigest: D,
    actorId: 'actor-1',
    ownerId: 'owner-1',
    reservationId: 'admission-1',
    bindingGenerationId: 'binding-1',
    requestId: scope.requestId,
    attemptId: scope.attemptId,
    transactionId: scope.transactionId,
    ...overrides
  });
  const recorder = bridgeRecorders.get(bridge) ?? bridge.wrapRecorder(async () => ({ persisted: true }));
  bridgeRecorders.set(bridge, recorder);
  bridge.beginExecute(watch.watchId);
  const event: AuthorityAuditEvent = {
    type: 'authority',
    ts: '2026-09-14T12:00:00.000Z',
    workspace: scope.workspaceId,
    operation_id: watch.authorityOperationId,
    actor_id: watch.actorId,
    owner_id: watch.ownerId,
    task_id: watch.taskId,
    kind: watch.operationKind,
    digest: watch.descriptorDigest,
    policy_revision: watch.authorityRevision,
    decision: 'consumed'
  };
  await recorder(event);
  const callbackPermit = callbackEntered ? bridge.enterExecutorCallback(watch.watchId) : undefined;
  bridge.settleExecute(watch.watchId, { callbackEntered, dispatchStarted: false });
  const classification = bridge.classify(watch.watchId);
  assert.equal(classification.outcome, 'CONSUMED_NO_DISPATCH');
  assert.ok(classification.receipt);
  return { bridge, watch, receipt: classification.receipt!, callbackPermit };
}

async function reservation(exec: OwnedExecutionRef, liveGenerationId: string, admissionId = 'admission-1', operationId: OwnedExecutionRef['operationId'] = exec.operationId) {
  return createAdmissionReservationRef({
    admissionId,
    bindingGenerationId: exec.bindingGenerationId,
    liveGenerationId,
    workspaceId: exec.workspaceId,
    taskId: exec.taskId,
    taskRevision: exec.taskRevision,
    requestId: exec.requestId,
    attemptId: exec.attemptId,
    transactionId: exec.transactionId,
    operationId,
    operationDigest: exec.operationDigest,
    targetId: exec.targetId,
    targetDigest: exec.targetDigest,
    effectScopeDigest: exec.effectScopeDigest,
    providerId: exec.providerId,
    providerVersion: exec.providerVersion
  });
}

test('H2 identity factories detach and freeze input without invoking getters', async () => {
  let getterCount = 0;
  const input = {
    ownershipId: 'ownership-getter',
    bindingGenerationId: 'binding-getter',
    ...scope,
    operationId: 'operation-getter' as OwnedExecutionRef['operationId'],
    operationDigest: D,
    targetId: 'target',
    targetDigest: E,
    effectScopeDigest: F,
    executionKind: 'process' as const,
    providerId: 'provider',
    providerVersion: '1'
  };
  Object.defineProperty(input, 'targetId', { enumerable: true, configurable: true, get() { getterCount++; return 'target'; } });
  Object.defineProperty(input, 'kind', { enumerable: true, configurable: true, value: 'owned-execution-ref' });
  Object.defineProperty(input, 'provenanceDigest', { enumerable: true, configurable: true, value: D });
  expectCode(() => validateOwnedExecutionRef(input), 'ACCESSOR_OR_HIDDEN_PROPERTY');
  assert.equal(getterCount, 0);
  const created = await execution();
  assert.equal(Object.isFrozen(created), true);
  assert.equal(Object.isFrozen(created), true);
  assert.equal(await hasOwnedExecutionIntegrity(created), true);
  const copy = { ...created };
  assert.equal(await hasOwnedExecutionIntegrity(copy), true);
  (copy as { targetId: string }).targetId = 'foreign-target';
  assert.equal(await hasOwnedExecutionIntegrity(copy), false);
});

test('H2 rejects hidden, symbol, prototype, BigInt, cycle, and unsafe object values', async () => {
  const ref = await execution();
  const hidden = { ...ref };
  Object.defineProperty(hidden, 'hidden', { value: 1, enumerable: false });
  expectCode(() => validateOwnedExecutionRef(hidden), 'ACCESSOR_OR_HIDDEN_PROPERTY');
  const symbolValue = { ...ref, [Symbol('foreign')]: 'x' };
  expectCode(() => validateOwnedExecutionRef(symbolValue), 'SYMBOL_KEY');
  const custom = Object.assign(Object.create({ foreign: true }), ref);
  expectCode(() => validateOwnedExecutionRef(custom), 'UNSUPPORTED_OBJECT');
  const bigint = { ...ref, targetId: 1n };
  expectCode(() => validateOwnedExecutionRef(bigint), 'NON_JSON_VALUE');
  const cycle: Record<string, unknown> = { ...ref };
  cycle.targetId = cycle;
  expectCode(() => validateOwnedExecutionRef(cycle), 'JSON_CYCLE');
  const unsafe = { ...ref, taskRevision: Number.MAX_SAFE_INTEGER + 1 };
  expectCode(() => validateOwnedExecutionRef(unsafe), 'INVALID_OWNED_EXECUTION_REVISION');
});

test('parent provenance cannot substitute H1 scope', async () => {
  const parentUnsigned = {
    kind: 'parent-ownership-ref' as const,
    ownershipId: 'parent-owner', bindingGenerationId: 'parent-binding', liveGenerationId: 'parent-live',
    workspaceId: scope.workspaceId, taskId: scope.taskId, taskRevision: scope.taskRevision,
    requestId: scope.requestId, attemptId: scope.attemptId, transactionId: scope.transactionId,
    provenanceDigest: '0'.repeat(64) as Digest
  };
  const parent = { ...parentUnsigned, provenanceDigest: await h2Digest('parent-ownership-ref', parentUnsigned) };
  await assert.rejects(createOwnedExecutionRef({ ...(await execution()), parentOwnershipRef: { ...parent, workspaceId: 'foreign-workspace' as WorkspaceId } }), (error: unknown) => error instanceof HarnessOwnershipError && error.code === 'OWNERSHIP_SCOPE_MISMATCH');
});

test('provisional generations are not bindable until trusted handoff publication', async () => {
  const exec = await execution();
  const receiptBridge = new AuthorityConsumptionReceiptBridge({ bridgeEpochId: 'bridge-provisional' });
  const registry = new LiveGenerationRegistry({ registryEpochId: 'epoch-provisional', receiptBridge });
  const live = await registry.registerProvisional({
    executionRef: exec,
    providerGenerationEvidenceDigest: D,
    creationObservationDigest: E,
    capability: capability(),
    targetId: exec.targetId,
    targetDigest: exec.targetDigest,
    serviceScope,
    processKind: 'persistent_service'
  });
  const originBinding = await registry.mintProcessBinding({ executionRef: exec, liveGenerationId: live.liveGenerationId });
  assert.equal(originBinding.executionRef.transactionId, exec.transactionId);
  const foreign = await execution({ ownershipId: 'foreign', bindingGenerationId: 'foreign-binding', requestId: 'foreign-request' as HarnessExecutionRequestId, attemptId: 'foreign-attempt' as WorkerAttemptId, transactionId: 'foreign-transaction' as HarnessTransactionId });
  await assert.rejects(registry.mintProcessBinding({ executionRef: foreign, liveGenerationId: live.liveGenerationId }), (error: unknown) => error instanceof HarnessOwnershipError && error.code === 'PUBLICATION_NOT_READY');
  const originReservation = await reservation(exec, live.liveGenerationId, 'provisional-handoff');
  await registry.ledger.reserve(originReservation);
  const { receipt } = await watchAndReceipt({ authorityOperationId: exec.operationId, descriptorDigest: exec.operationDigest, reservationId: originReservation.admissionId }, receiptBridge);
  await registry.ledger.noteAuthorityConsumption(originReservation, receipt);
  await registry.ledger.commit(originReservation);
  await registry.completePersistentHandoff(live.liveGenerationId, originReservation, { noUnresolvedLaunchWork: true, noUnresolvedDescendants: true, responsibilityTransferred: true });
  const binding = await registry.mintProcessBinding({ executionRef: exec, liveGenerationId: live.liveGenerationId });
  assert.notEqual(binding.executionRef.bindingGenerationId, binding.liveGenerationRef.liveGenerationId);
});

test('provider capability methods are snapshotted at the trusted registration boundary', async () => {
  const exec = await execution({ ownershipId: 'cap-snapshot-owner', bindingGenerationId: 'cap-snapshot-binding', requestId: 'cap-snapshot-request' as HarnessExecutionRequestId, attemptId: 'cap-snapshot-attempt' as WorkerAttemptId, transactionId: 'cap-snapshot-transaction' as HarnessTransactionId });
  const provider = capability();
  const registry = new LiveGenerationRegistry({ registryEpochId: 'epoch-cap-snapshot' });
  const live = await registry.registerProvisional({ executionRef: exec, providerGenerationEvidenceDigest: D, creationObservationDigest: E, capability: provider, targetId: exec.targetId, targetDigest: exec.targetDigest, serviceScope, processKind: 'persistent_service' });
  provider.verifyExactGeneration = () => false;
  const binding = await registry.mintProcessBinding({ executionRef: exec, liveGenerationId: live.liveGenerationId });
  assert.equal(binding.liveGenerationRef.liveGenerationId, live.liveGenerationId);
});

test('broader service scopes require trusted registry policy and cannot be caller-manufactured', async () => {
  const exec = await execution({ ownershipId: 'scope-owner', bindingGenerationId: 'scope-binding', requestId: 'scope-request' as HarnessExecutionRequestId, attemptId: 'scope-attempt' as WorkerAttemptId, transactionId: 'scope-transaction' as HarnessTransactionId });
  const shared: ServiceScope = { kind: 'explicit-shared', scopeId: 'approved-shared-service', policyDigest: D };
  const project: ServiceScope = { kind: 'project', scopeId: 'project-1', policyDigest: E };
  const untrusted = new LiveGenerationRegistry({ registryEpochId: 'epoch-untrusted-scope' });
  await assert.rejects(untrusted.registerProvisional({ executionRef: exec, providerGenerationEvidenceDigest: D, creationObservationDigest: E, capability: capability(), targetId: exec.targetId, targetDigest: exec.targetDigest, serviceScope: shared, processKind: 'persistent_service' }), (error: unknown) => error instanceof HarnessOwnershipError && error.code === 'OWNERSHIP_SCOPE_MISMATCH');
  await assert.rejects(untrusted.registerProvisional({ executionRef: exec, providerGenerationEvidenceDigest: D, creationObservationDigest: E, capability: capability(), targetId: exec.targetId, targetDigest: exec.targetDigest, serviceScope: project, processKind: 'persistent_service' }), (error: unknown) => error instanceof HarnessOwnershipError && error.code === 'OWNERSHIP_SCOPE_MISMATCH');
  const trusted = new LiveGenerationRegistry({ registryEpochId: 'epoch-trusted-scope', trustedServiceScopes: [shared, project] });
  const live = await trusted.registerProvisional({ executionRef: exec, providerGenerationEvidenceDigest: D, creationObservationDigest: E, capability: capability(), targetId: exec.targetId, targetDigest: exec.targetDigest, serviceScope: shared, processKind: 'persistent_service' });
  assert.equal(live.serviceScope.kind, 'explicit-shared');
  const projectLive = await trusted.registerProvisional({ executionRef: exec, providerGenerationEvidenceDigest: D, creationObservationDigest: E, capability: capability(), targetId: exec.targetId, targetDigest: exec.targetDigest, serviceScope: project, processKind: 'persistent_service', targetPolicy: 'multi' });
  assert.equal(projectLive.serviceScope.scopeId, 'project-1');
});

test('cross-transaction control requires a fresh H1 binding while preserving the same live generation', async () => {
  const first = await execution();
  const { registry, live } = await publishedRegistry(first);
  const firstBinding = await registry.mintProcessBinding({ executionRef: first, liveGenerationId: live.liveGenerationId });
  const second = await execution({ ownershipId: 'ownership-2', bindingGenerationId: 'binding-2', requestId: 'request-2' as HarnessExecutionRequestId, attemptId: 'attempt-2' as WorkerAttemptId, transactionId: 'transaction-2' as HarnessTransactionId });
  const secondBinding = await registry.mintProcessBinding({ executionRef: second, liveGenerationId: live.liveGenerationId });
  assert.equal(secondBinding.liveGenerationRef.liveGenerationId, firstBinding.liveGenerationRef.liveGenerationId);
  assert.notEqual(secondBinding.executionRef.transactionId, firstBinding.executionRef.transactionId);
  assert.notEqual(secondBinding.executionRef.bindingGenerationId, firstBinding.executionRef.bindingGenerationId);
});

test('canonical AdmissionLedger preserves reservations, consumed-no-dispatch, and committed truth', async () => {
  const exec = await execution();
  const { registry, live } = await publishedRegistry(exec);
  const binding = await registry.mintProcessBinding({ executionRef: exec, liveGenerationId: live.liveGenerationId });
  const reserved = await reservation(exec, live.liveGenerationId);
  const ledger = registry.ledger;
  await ledger.reserve(reserved);
  const { receipt } = await watchAndReceipt();
  await ledger.noteAuthorityConsumption(reserved, receipt);
  await ledger.consumedNoDispatch(reserved, 'callback_not_entered');
  assert.equal(ledger.get(reserved).state, 'CONSUMED_NO_DISPATCH');
  assert.equal(ledger.activeForGeneration(live.liveGenerationId).length, 0);
  const secondExec = await execution({ ownershipId: 'ownership-2', bindingGenerationId: 'binding-2', requestId: 'request-2' as HarnessExecutionRequestId, attemptId: 'attempt-2' as WorkerAttemptId, transactionId: 'transaction-2' as HarnessTransactionId });
  const secondLive = (await publishedRegistry(secondExec)).live;
  const secondBinding = await registry.mintProcessBinding({ executionRef: secondExec, liveGenerationId: secondLive.liveGenerationId }).catch(() => undefined);
  assert.equal(secondBinding, undefined);
  void binding;
});

test('retirement fence is owned by one exact stop reservation and blocks ordinary work', async () => {
  const exec = await execution();
  const receiptBridge = new AuthorityConsumptionReceiptBridge({ bridgeEpochId: 'bridge-stop' });
  const { registry, live, state } = await publishedRegistry(exec, { receiptBridge });
  const binding = await registry.mintProcessBinding({ executionRef: exec, liveGenerationId: live.liveGenerationId });
  const stop = await reservation(exec, live.liveGenerationId);
  await registry.ledger.reserve(stop);
  const { receipt, callbackPermit } = await watchAndReceipt({}, receiptBridge, true);
  const result = await registry.fenceAndCommitStop(stop, receipt, callbackPermit);
  assert.equal((await registry.disposition(live.liveGenerationId)), 'retirement_fenced');
  const ordinaryExec = await execution({ ownershipId: 'ordinary', bindingGenerationId: 'ordinary-binding', requestId: 'ordinary-request' as HarnessExecutionRequestId, attemptId: 'ordinary-attempt' as WorkerAttemptId, transactionId: 'ordinary-transaction' as HarnessTransactionId });
  await assert.rejects(registry.mintProcessBinding({ executionRef: ordinaryExec, liveGenerationId: live.liveGenerationId }), (error: unknown) => error instanceof HarnessOwnershipError && error.code === 'ADMISSION_NOT_STOPPED');
  await assert.rejects(registry.dispatchTermination(stop, { ...result.fence, fenceDigest: D }), (error: unknown) => error instanceof HarnessOwnershipError && error.code === 'FENCE_CONFLICT');
  const observation = await registry.dispatchTermination(stop, result.fence);
  assert.equal(observation.outcome, 'exact_generation_exited');
  assert.equal(state.alive, false);
  assert.equal(await registry.disposition(live.liveGenerationId), 'terminal');
  void binding;
});

test('receipt consumption alone cannot create a pre-callback retirement fence', async () => {
  const exec = await execution({ ownershipId: 'pre-callback-owner', bindingGenerationId: 'pre-callback-binding', requestId: 'pre-callback-request' as HarnessExecutionRequestId, attemptId: 'pre-callback-attempt' as WorkerAttemptId, transactionId: 'pre-callback-transaction' as HarnessTransactionId });
  const receiptBridge = new AuthorityConsumptionReceiptBridge({ bridgeEpochId: 'bridge-pre-callback' });
  const { registry, live } = await publishedRegistry(exec, { receiptBridge });
  const stop = await reservation(exec, live.liveGenerationId, 'pre-callback-stop', 'pre-callback-stop-op' as OwnedExecutionRef['operationId']);
  await registry.ledger.reserve(stop);
  const { receipt } = await watchAndReceipt({ authorityOperationId: stop.operationId, descriptorDigest: stop.operationDigest, reservationId: stop.admissionId }, receiptBridge);
  await assert.rejects(registry.fenceAndCommitStop(stop, receipt), (error: unknown) => error instanceof HarnessOwnershipError && error.code === 'FENCE_CONFLICT');
  assert.equal(await registry.disposition(live.liveGenerationId), 'published_open');
});

test('registry-issued binding provenance rejects a structurally valid recomputed binding', async () => {
  const exec = await execution();
  const receiptBridge = new AuthorityConsumptionReceiptBridge({ bridgeEpochId: 'bridge-binding-forge' });
  const { registry, live, originBinding } = await publishedRegistry(exec, { receiptBridge });
  const forgedBinding = await createOwnedProcessRef({
    executionRef: exec,
    liveGenerationRef: originBinding.liveGenerationRef,
    providerGenerationProofRef: originBinding.providerGenerationProofRef,
    diagnosticObservation: { pid: 900 as SafeInteger }
  });
  const operation = await reservation(exec, live.liveGenerationId, 'binding-forge', 'binding-forge-op' as OwnedExecutionRef['operationId']);
  await registry.ledger.reserve(operation);
  const { receipt } = await watchAndReceipt({ authorityOperationId: operation.operationId, descriptorDigest: operation.operationDigest, reservationId: operation.admissionId }, receiptBridge);
  await assert.rejects(registry.admitOrdinary(forgedBinding, operation, receipt), (error: unknown) => error instanceof HarnessOwnershipError && error.code === 'OWNERSHIP_NOT_PROVEN');
});

test('a closed H1 control binding remains historical and cannot be minted or reused', async () => {
  const exec = await execution();
  const { registry, live, originBinding } = await publishedRegistry(exec);
  await registry.closeControlBinding(originBinding);
  await assert.rejects(registry.mintProcessBinding({ executionRef: exec, liveGenerationId: live.liveGenerationId }), (error: unknown) => error instanceof HarnessOwnershipError && error.code === 'OWNERSHIP_STALE');
});

test('one H1 binding can admit distinct operations only with distinct admission and authority identities', async () => {
  const exec = await execution();
  const receiptBridge = new AuthorityConsumptionReceiptBridge({ bridgeEpochId: 'bridge-multi-op' });
  const { registry, live, originBinding } = await publishedRegistry(exec, { receiptBridge });
  const first = await reservation(exec, live.liveGenerationId, 'multi-1', 'multi-op-1' as OwnedExecutionRef['operationId']);
  await registry.ledger.reserve(first);
  const firstReceipt = (await watchAndReceipt({ authorityOperationId: first.operationId, descriptorDigest: first.operationDigest, reservationId: first.admissionId }, receiptBridge)).receipt;
  const firstAdmitted = await registry.admitOrdinary(originBinding, first, firstReceipt);
  const second = await reservation(exec, live.liveGenerationId, 'multi-2', 'multi-op-2' as OwnedExecutionRef['operationId']);
  await registry.ledger.reserve(second);
  const secondReceipt = (await watchAndReceipt({ authorityOperationId: second.operationId, descriptorDigest: second.operationDigest, reservationId: second.admissionId }, receiptBridge)).receipt;
  const secondAdmitted = await registry.admitOrdinary(originBinding, second, secondReceipt);
  assert.notEqual(firstAdmitted.admissionId, secondAdmitted.admissionId);
  assert.notEqual(firstAdmitted.admissionSequence, secondAdmitted.admissionSequence);
  assert.equal((await registry.activeAdmissions(live.liveGenerationId)).length, 2);
});

test('projection failure cannot erase canonical committed admission or permit dispatch', async () => {
  const exec = await execution();
  const receiptBridge = new AuthorityConsumptionReceiptBridge({ bridgeEpochId: 'bridge-projection' });
  const { registry, live } = await publishedRegistry(exec, { receiptBridge });
  const binding = await registry.mintProcessBinding({ executionRef: exec, liveGenerationId: live.liveGenerationId });
  const stop = await reservation(exec, live.liveGenerationId);
  await registry.ledger.reserve(stop);
  const { receipt, callbackPermit } = await watchAndReceipt({}, receiptBridge, true);
  registry.setProjectionFailure('live');
  await assert.rejects(registry.fenceAndCommitStop(stop, receipt, callbackPermit), (error: unknown) => error instanceof HarnessOwnershipError && error.code === 'INTERNAL_HARNESS_FAILURE');
  assert.equal(registry.ledger.get(stop).state, 'COMMITTED');
  await assert.rejects(registry.dispatchTermination(stop, registry.ledger.get(stop).facts.at(-1)?.admittedOperation ? { kind: 'retirement-fence-ref', liveGenerationId: live.liveGenerationId, registryEpochId: registry.registryEpochId, stopTransactionId: stop.transactionId, bindingGenerationId: stop.bindingGenerationId, admissionReservationId: stop.admissionId, operationDigest: stop.operationDigest, targetDigest: stop.targetDigest, fenceGeneration: 1 as SafeInteger, fenceDigest: D } : {} as never), (error: unknown) => error instanceof HarnessOwnershipError);
  void binding;
});

test('recomputed receipt integrity cannot substitute for trusted bridge provenance', async () => {
  const exec = await execution();
  const receiptBridge = new AuthorityConsumptionReceiptBridge({ bridgeEpochId: 'bridge-receipt-forge' });
  const { registry, live } = await publishedRegistry(exec, { receiptBridge });
  const stop = await reservation(exec, live.liveGenerationId, 'receipt-forge', 'receipt-forge-op' as OwnedExecutionRef['operationId']);
  await registry.ledger.reserve(stop);
  const { receipt, callbackPermit } = await watchAndReceipt({ authorityOperationId: stop.operationId, descriptorDigest: stop.operationDigest, reservationId: stop.admissionId }, receiptBridge, true);
  const forged = await redigest('authority-consumption-ref', receipt, 'receiptDigest', { bridgeReceiptId: 'caller-created-receipt' });
  await assert.rejects(registry.fenceAndCommitStop(stop, forged, callbackPermit), (error: unknown) => error instanceof HarnessOwnershipError && error.code === 'FENCE_CONFLICT');
});

test('authority receipt bridge installs watches before execute and closes the D-06 callback gap', async () => {
  let recorderCalls = 0;
  const bridge = new AuthorityConsumptionReceiptBridge({ bridgeEpochId: 'bridge-d06' });
  const watch = await bridge.installWatch({
    authorityOperationId: 'op-d06', authorityRevision: 2 as SafeInteger, workspaceId: 'workspace-1', taskId: 'task-1', operationKind: 'tasks.stop', descriptorDigest: D,
    actorId: 'actor-d06', ownerId: 'owner-d06', reservationId: 'reservation-d06', bindingGenerationId: 'binding-d06', requestId: 'request-d06' as HarnessExecutionRequestId,
    attemptId: 'attempt-d06' as WorkerAttemptId, transactionId: 'transaction-d06' as HarnessTransactionId
  });
  const recorder = bridge.wrapRecorder(async event => { recorderCalls++; assert.equal(event.decision, 'consumed'); return { persisted: true }; });
  bridge.beginExecute(watch.watchId);
  await recorder({ type: 'authority', ts: '2026-09-14T12:00:00.000Z', workspace: 'workspace-1', operation_id: 'op-d06', actor_id: 'actor-d06', owner_id: 'owner-d06', task_id: 'task-1', kind: 'tasks.stop', digest: D, policy_revision: 2 as SafeInteger, decision: 'consumed' });
  bridge.settleExecute(watch.watchId, { callbackEntered: false, dispatchStarted: false });
  const outcome = bridge.classify(watch.watchId);
  assert.equal(recorderCalls, 1);
  assert.equal(outcome.outcome, 'CONSUMED_NO_DISPATCH');
  assert.ok(outcome.receipt);
  assert.equal(bridge.healthy, true);
});

test('real Execution Authority consumed persistence is receipted even when revocation prevents callback entry', async () => {
  const bridge = new AuthorityConsumptionReceiptBridge({ bridgeEpochId: 'bridge-real-d06' });
  let authority!: ReturnType<typeof createExecutionAuthority>;
  let callbackCount = 0;
  const recorder = bridge.wrapRecorder(async event => {
    if (event.decision === 'consumed') authority.control.revokePending();
    return { persisted: true };
  });
  authority = createExecutionAuthority({ workspace: scope.workspaceId, record: recorder });
  const origin = 'h2-test';
  const paired = await authority.pair(authority.control.createPairing(origin), origin);
  const owner = authority.authenticate(paired.token, origin);
  const input = { workspace: scope.workspaceId, taskId: scope.taskId, kind: 'tasks.stop', args: { taskId: 'managed-service' } };
  const proposed = await authority.prepare(owner, input);
  await authority.decide(owner, proposed.operation_id, 'approve');
  const watch = await bridge.installWatch({
    authorityOperationId: proposed.operation_id,
    authorityRevision: 1 as SafeInteger,
    workspaceId: scope.workspaceId,
    taskId: scope.taskId,
    operationKind: 'tasks.stop',
    descriptorDigest: proposed.digest as Digest,
    actorId: owner.id,
    ownerId: owner.id,
    reservationId: 'real-d06-reservation',
    bindingGenerationId: 'real-d06-binding',
    requestId: 'real-d06-request' as HarnessExecutionRequestId,
    attemptId: 'real-d06-attempt' as WorkerAttemptId,
    transactionId: 'real-d06-transaction' as HarnessTransactionId
  });
  bridge.beginExecute(watch.watchId);
  await assert.rejects(authority.execute(owner, proposed.operation_id, input, () => { callbackCount++; }), { code: 'CONFLICT' });
  bridge.settleExecute(watch.watchId, { callbackEntered: callbackCount > 0, dispatchStarted: false });
  const classification = bridge.classify(watch.watchId);
  assert.equal(callbackCount, 0);
  assert.equal(classification.outcome, 'CONSUMED_NO_DISPATCH');
  assert.ok(classification.receipt);
});

test('receipt absence is abort only under healthy settled-watch proof; recorder ambiguity is unresolved', async () => {
  const bridge = new AuthorityConsumptionReceiptBridge({ bridgeEpochId: 'bridge-abort' });
  const watch = await bridge.installWatch({
    authorityOperationId: 'op-abort', authorityRevision: 1 as SafeInteger, workspaceId: 'workspace-1', taskId: 'task-1', operationKind: 'tasks.stop', descriptorDigest: D,
    actorId: 'actor', ownerId: 'owner', reservationId: 'res', bindingGenerationId: 'bind', requestId: 'req' as HarnessExecutionRequestId, attemptId: 'att' as WorkerAttemptId, transactionId: 'tx' as HarnessTransactionId
  });
  const recorder = bridge.wrapRecorder(async () => ({ persisted: false }));
  bridge.beginExecute(watch.watchId);
  bridge.settleExecute(watch.watchId, { callbackEntered: false, dispatchStarted: false });
  assert.equal(bridge.classify(watch.watchId).outcome, 'ABORTED_PRECONSUMPTION');
  const bridgeAmbiguous = new AuthorityConsumptionReceiptBridge({ bridgeEpochId: 'bridge-ambiguous' });
  const ambiguous = await bridgeAmbiguous.installWatch({
    authorityOperationId: 'op-ambiguous', authorityRevision: 1 as SafeInteger, workspaceId: 'workspace-1', taskId: 'task-1', operationKind: 'tasks.stop', descriptorDigest: D,
    actorId: 'actor', ownerId: 'owner', reservationId: 'res-2', bindingGenerationId: 'bind-2', requestId: 'req-2' as HarnessExecutionRequestId, attemptId: 'att-2' as WorkerAttemptId, transactionId: 'tx-2' as HarnessTransactionId
  });
  const ambiguousRecorder = bridgeAmbiguous.wrapRecorder(async () => ({ persisted: false }));
  bridgeAmbiguous.beginExecute(ambiguous.watchId);
  await ambiguousRecorder({ type: 'authority', ts: '2026-09-14T12:00:00.000Z', workspace: 'workspace-1', operation_id: 'op-ambiguous', actor_id: 'actor', owner_id: 'owner', task_id: 'task-1', kind: 'tasks.stop', digest: D, policy_revision: 1 as SafeInteger, decision: 'consumed' });
  bridgeAmbiguous.settleExecute(ambiguous.watchId, { callbackEntered: false, dispatchStarted: false });
  assert.equal(bridgeAmbiguous.classify(ambiguous.watchId).outcome, 'CONSUMED_UNRESOLVED');
  void recorder;
});

test('bridge does not correlate unwatched authority events and rejects duplicate/conflicting watches', async () => {
  const bridge = new AuthorityConsumptionReceiptBridge({ bridgeEpochId: 'bridge-watch' });
  const watch = await bridge.installWatch({
    authorityOperationId: 'op-watch', authorityRevision: 1 as SafeInteger, workspaceId: 'workspace-1', taskId: 'task-1', operationKind: 'tasks.stop', descriptorDigest: D,
    actorId: 'actor', ownerId: 'owner', reservationId: 'res', bindingGenerationId: 'bind', requestId: 'req' as HarnessExecutionRequestId, attemptId: 'att' as WorkerAttemptId, transactionId: 'tx' as HarnessTransactionId
  });
  await assert.rejects(bridge.installWatch({
    authorityOperationId: 'op-watch', authorityRevision: 1 as SafeInteger, workspaceId: 'workspace-1', taskId: 'task-1', operationKind: 'tasks.stop', descriptorDigest: D,
    actorId: 'actor', ownerId: 'owner', reservationId: 'res-2', bindingGenerationId: 'bind-2', requestId: 'req-2' as HarnessExecutionRequestId, attemptId: 'att-2' as WorkerAttemptId, transactionId: 'tx-2' as HarnessTransactionId
  }), (error: unknown) => error instanceof HarnessOwnershipError && error.code === 'BRIDGE_WATCH_CONFLICT');
  const recorder = bridge.wrapRecorder(async () => ({ persisted: true }));
  const result = await recorder({ type: 'authority', ts: '2026-09-14T12:00:00.000Z', workspace: 'workspace-1', operation_id: 'unwatched', actor_id: 'actor', owner_id: 'owner', task_id: 'task-1', kind: 'tasks.stop', digest: D, policy_revision: 1 as SafeInteger, decision: 'consumed' });
  assert.equal(result.persisted, true);
  void watch;
});

test('bridge bounds receipt retention and rejects watch reuse before execution', async () => {
  const bridge = new AuthorityConsumptionReceiptBridge({ bridgeEpochId: 'bridge-bounds', maxReceipts: 1, maxTombstones: 4 });
  const event = (operationId: string) => ({ type: 'authority' as const, ts: '2026-09-14T12:00:00.000Z', workspace: 'workspace-1', operation_id: operationId, actor_id: 'actor', owner_id: 'owner', task_id: 'task-1', kind: 'tasks.stop', digest: D, policy_revision: 1 as SafeInteger, decision: 'consumed' });
  const first = await bridge.installWatch({ authorityOperationId: 'bounds-1', authorityRevision: 1 as SafeInteger, workspaceId: 'workspace-1', taskId: 'task-1', operationKind: 'tasks.stop', descriptorDigest: D, actorId: 'actor', ownerId: 'owner', reservationId: 'bounds-res-1', bindingGenerationId: 'bounds-bind-1', requestId: 'bounds-req-1' as HarnessExecutionRequestId, attemptId: 'bounds-att-1' as WorkerAttemptId, transactionId: 'bounds-tx-1' as HarnessTransactionId });
  const recorder = bridge.wrapRecorder(async () => ({ persisted: true }));
  bridge.beginExecute(first.watchId);
  await recorder(event('bounds-1'));
  bridge.settleExecute(first.watchId, { callbackEntered: false, dispatchStarted: false });
  await assert.rejects(bridge.installWatch({ authorityOperationId: 'bounds-2', authorityRevision: 1 as SafeInteger, workspaceId: 'workspace-1', taskId: 'task-1', operationKind: 'tasks.stop', descriptorDigest: D, actorId: 'actor', ownerId: 'owner', reservationId: 'bounds-res-2', bindingGenerationId: 'bounds-bind-2', requestId: 'bounds-req-2' as HarnessExecutionRequestId, attemptId: 'bounds-att-2' as WorkerAttemptId, transactionId: 'bounds-tx-2' as HarnessTransactionId }), (error: unknown) => error instanceof HarnessOwnershipError && error.code === 'BRIDGE_CAPACITY_EXHAUSTED');
  bridge.closeWatch(first.watchId);
  await assert.rejects(bridge.installWatch({ authorityOperationId: 'bounds-1', authorityRevision: 1 as SafeInteger, workspaceId: 'workspace-1', taskId: 'task-1', operationKind: 'tasks.stop', descriptorDigest: D, actorId: 'actor', ownerId: 'owner', reservationId: 'bounds-res-3', bindingGenerationId: 'bounds-bind-3', requestId: 'bounds-req-3' as HarnessExecutionRequestId, attemptId: 'bounds-att-3' as WorkerAttemptId, transactionId: 'bounds-tx-3' as HarnessTransactionId }), (error: unknown) => error instanceof HarnessOwnershipError && error.code === 'BRIDGE_WATCH_CONFLICT');
  const recycled = await bridge.installWatch({ authorityOperationId: 'bounds-2', authorityRevision: 1 as SafeInteger, workspaceId: 'workspace-1', taskId: 'task-1', operationKind: 'tasks.stop', descriptorDigest: D, actorId: 'actor', ownerId: 'owner', reservationId: 'bounds-res-4', bindingGenerationId: 'bounds-bind-4', requestId: 'bounds-req-4' as HarnessExecutionRequestId, attemptId: 'bounds-att-4' as WorkerAttemptId, transactionId: 'bounds-tx-4' as HarnessTransactionId });
  assert.equal(recycled.authorityOperationId, 'bounds-2');
});

test('bridge registration capacity failure after durable persistence is unresolved, never an abort', async () => {
  const bridge = new AuthorityConsumptionReceiptBridge({ bridgeEpochId: 'bridge-registration-fault', maxReceipts: 1 });
  const makeWatch = (id: string) => bridge.installWatch({ authorityOperationId: id, authorityRevision: 1 as SafeInteger, workspaceId: 'workspace-1', taskId: 'task-1', operationKind: 'tasks.stop', descriptorDigest: D, actorId: 'actor', ownerId: 'owner', reservationId: `${id}-res`, bindingGenerationId: `${id}-bind`, requestId: `${id}-req` as HarnessExecutionRequestId, attemptId: `${id}-att` as WorkerAttemptId, transactionId: `${id}-tx` as HarnessTransactionId });
  const first = await makeWatch('registration-1');
  const second = await makeWatch('registration-2');
  const recorder = bridge.wrapRecorder(async () => ({ persisted: true }));
  const event = (operationId: string) => ({ type: 'authority' as const, ts: '2026-09-14T12:00:00.000Z', workspace: 'workspace-1', operation_id: operationId, actor_id: 'actor', owner_id: 'owner', task_id: 'task-1', kind: 'tasks.stop', digest: D, policy_revision: 1 as SafeInteger, decision: 'consumed' });
  bridge.beginExecute(first.watchId);
  await recorder(event('registration-1'));
  bridge.beginExecute(second.watchId);
  await assert.rejects(recorder(event('registration-2')), (error: unknown) => error instanceof HarnessOwnershipError && error.code === 'BRIDGE_CAPACITY_EXHAUSTED');
  bridge.settleExecute(second.watchId, { callbackEntered: false, dispatchStarted: false });
  assert.equal(bridge.classify(second.watchId).outcome, 'CONSUMED_UNRESOLVED');
});

test('conflicting duplicate consumed events never downgrade a receipt to no-dispatch', async () => {
  const bridge = new AuthorityConsumptionReceiptBridge({ bridgeEpochId: 'bridge-duplicate-conflict' });
  const watch = await bridge.installWatch({ authorityOperationId: 'duplicate-op', authorityRevision: 1 as SafeInteger, workspaceId: 'workspace-1', taskId: 'task-1', operationKind: 'tasks.stop', descriptorDigest: D, actorId: 'actor', ownerId: 'owner', reservationId: 'duplicate-res', bindingGenerationId: 'duplicate-bind', requestId: 'duplicate-req' as HarnessExecutionRequestId, attemptId: 'duplicate-att' as WorkerAttemptId, transactionId: 'duplicate-tx' as HarnessTransactionId });
  const recorder = bridge.wrapRecorder(async () => ({ persisted: true }));
  bridge.beginExecute(watch.watchId);
  const event = { type: 'authority' as const, ts: '2026-09-14T12:00:00.000Z', workspace: 'workspace-1', operation_id: 'duplicate-op', actor_id: 'actor', owner_id: 'owner', task_id: 'task-1', kind: 'tasks.stop', digest: D, policy_revision: 1 as SafeInteger, decision: 'consumed' };
  await recorder(event);
  await assert.rejects(recorder({ ...event, ts: '2026-09-14T12:00:01.000Z' }), (error: unknown) => error instanceof HarnessOwnershipError && error.code === 'AUTHORITY_OBSERVATION_UNRESOLVED');
  bridge.settleExecute(watch.watchId, { callbackEntered: false, dispatchStarted: false });
  assert.equal(bridge.classify(watch.watchId).outcome, 'CONSUMED_UNRESOLVED');
});

test('bridge marks an unwatched consumed operation and recorder partial failure unresolved', async () => {
  const bridge = new AuthorityConsumptionReceiptBridge({ bridgeEpochId: 'bridge-health' });
  const recorder = bridge.wrapRecorder(async () => { throw new Error('write closed after partial persistence'); });
  const event = { type: 'authority' as const, ts: '2026-09-14T12:00:00.000Z', workspace: 'workspace-1', operation_id: 'missed-consumed', actor_id: 'actor', owner_id: 'owner', task_id: 'task-1', kind: 'tasks.stop', digest: D, policy_revision: 1 as SafeInteger, decision: 'consumed' };
  await assert.rejects(recorder(event));
  await assert.rejects(bridge.installWatch({ authorityOperationId: 'missed-consumed', authorityRevision: 1 as SafeInteger, workspaceId: 'workspace-1', taskId: 'task-1', operationKind: 'tasks.stop', descriptorDigest: D, actorId: 'actor', ownerId: 'owner', reservationId: 'missed-res', bindingGenerationId: 'missed-bind', requestId: 'missed-req' as HarnessExecutionRequestId, attemptId: 'missed-att', transactionId: 'missed-tx' as HarnessTransactionId }), (error: unknown) => error instanceof HarnessOwnershipError && error.code === 'BRIDGE_WATCH_CONFLICT');
  const watched = await bridge.installWatch({ authorityOperationId: 'partial-consumed', authorityRevision: 1 as SafeInteger, workspaceId: 'workspace-1', taskId: 'task-1', operationKind: 'tasks.stop', descriptorDigest: D, actorId: 'actor', ownerId: 'owner', reservationId: 'partial-res', bindingGenerationId: 'partial-bind', requestId: 'partial-req' as HarnessExecutionRequestId, attemptId: 'partial-att', transactionId: 'partial-tx' as HarnessTransactionId });
  bridge.beginExecute(watched.watchId);
  await assert.rejects(recorder({ ...event, operation_id: 'partial-consumed' }));
  bridge.settleExecute(watched.watchId, { callbackEntered: false, dispatchStarted: false });
  assert.equal(bridge.classify(watched.watchId).outcome, 'CONSUMED_UNRESOLVED');
});

test('receipt absence after bridge epoch loss is never definitive pre-consumption abort', async () => {
  const bridge = new AuthorityConsumptionReceiptBridge({ bridgeEpochId: 'bridge-epoch-loss' });
  const watch = await bridge.installWatch({ authorityOperationId: 'epoch-loss-op', authorityRevision: 1 as SafeInteger, workspaceId: 'workspace-1', taskId: 'task-1', operationKind: 'tasks.stop', descriptorDigest: D, actorId: 'actor', ownerId: 'owner', reservationId: 'epoch-loss-res', bindingGenerationId: 'epoch-loss-bind', requestId: 'epoch-loss-req' as HarnessExecutionRequestId, attemptId: 'epoch-loss-att', transactionId: 'epoch-loss-tx' as HarnessTransactionId });
  bridge.wrapRecorder(async () => ({ persisted: false }));
  bridge.beginExecute(watch.watchId);
  bridge.markEpochLost();
  bridge.settleExecute(watch.watchId, { callbackEntered: false, dispatchStarted: false });
  assert.equal(bridge.classify(watch.watchId).outcome, 'CONSUMED_UNRESOLVED');
});

test('non-H2 authority events pass through without H2 schema requirements', async () => {
  const bridge = new AuthorityConsumptionReceiptBridge({ bridgeEpochId: 'bridge-non-h2' });
  const seen: unknown[] = [];
  const recorder = bridge.wrapRecorder(async event => { seen.push(event); return { persisted: true }; });
  const event = { type: 'authority', ts: '2026-09-14T12:00:00.000Z', workspace: 'workspace-1', decision: 'paired', origin: 'local-composition-root' };
  const result = await recorder(event);
  assert.equal(result.persisted, true);
  assert.deepEqual(seen[0], event);
  assert.equal(bridge.healthy, true);
});

test('fence and admission identities cannot be substituted across generations or transactions', async () => {
  const exec = await execution();
  const receiptBridge = new AuthorityConsumptionReceiptBridge({ bridgeEpochId: 'bridge-fence' });
  const { registry, live } = await publishedRegistry(exec, { receiptBridge });
  const reservationOne = await reservation(exec, live.liveGenerationId);
  await registry.ledger.reserve(reservationOne);
  const { receipt, callbackPermit } = await watchAndReceipt({}, receiptBridge, true);
  const { fence } = await registry.fenceAndCommitStop(reservationOne, receipt, callbackPermit);
  const other = await execution({ ownershipId: 'other', bindingGenerationId: 'other-binding', operationId: 'other-op' as OwnedExecutionRef['operationId'], requestId: 'other-request' as HarnessExecutionRequestId, attemptId: 'other-attempt' as WorkerAttemptId, transactionId: 'other-transaction' as HarnessTransactionId });
  const forged = { ...fence, stopTransactionId: other.transactionId };
  await assert.rejects(registry.dispatchTermination(reservationOne, forged), (error: unknown) => error instanceof HarnessOwnershipError && error.code === 'FENCE_CONFLICT');
});

test('canonical ledger drives quiescence even when projections are stale, and empty history is safe', async () => {
  const exec = await execution();
  const ledger = new AdmissionLedger();
  const txProjection = new TransactionExecutionRegistry();
  const empty = await ledger.createQuiescence(scope, { admissionCutoff: true, registryCompleteness: true });
  assert.equal(empty.quiescent, true);
  const reserved = await reservation(exec, 'live-empty');
  await ledger.reserve(reserved);
  const blocked = await ledger.createQuiescence(scope, { admissionCutoff: true, registryCompleteness: true });
  assert.equal(blocked.quiescent, false);
  assert.deepEqual(blocked.unresolvedAdmissionIds, ['admission-1']);
  txProjection.setProjection(scope.transactionId, []);
  assert.throws(() => txProjection.assertMatches(ledger, scope.transactionId), (error: unknown) => error instanceof HarnessOwnershipError && error.code === 'INTERNAL_HARNESS_FAILURE');
});

test('exact generation exit closes all committed operations before transaction quiescence', async () => {
  const state = { alive: true };
  const exec = await execution();
  const receiptBridge = new AuthorityConsumptionReceiptBridge({ bridgeEpochId: 'bridge-exit-accounting' });
  const { registry, live, originBinding } = await publishedRegistry(exec, { state, receiptBridge });
  const active = await reservation(exec, live.liveGenerationId, 'active-exit', 'active-exit-op' as OwnedExecutionRef['operationId']);
  await registry.ledger.reserve(active);
  const receipt = (await watchAndReceipt({ authorityOperationId: active.operationId, descriptorDigest: active.operationDigest, reservationId: active.admissionId }, receiptBridge)).receipt;
  await registry.admitOrdinary(originBinding, active, receipt);
  const before = await registry.createQuiescence(scope, { admissionCutoff: true, registryCompleteness: true });
  assert.equal(before.quiescent, false);
  state.alive = false;
  await registry.observeNaturalExit(live.liveGenerationId);
  const after = await registry.createQuiescence(scope, { admissionCutoff: true, registryCompleteness: true });
  assert.equal(after.quiescent, true);
  assert.deepEqual(after.activeAdmissionIds, []);
});

test('exclusive target publication linearizes so one concurrent generation remains provisional', async () => {
  const bridge = new AuthorityConsumptionReceiptBridge({ bridgeEpochId: 'bridge-target-race' });
  const registry = new LiveGenerationRegistry({ registryEpochId: 'epoch-target-race', receiptBridge: bridge });
  const firstExec = await execution({ transactionId: 'target-tx-1' as HarnessTransactionId, requestId: 'target-req-1' as HarnessExecutionRequestId });
  const secondExec = await execution({ ownershipId: 'target-owner-2', bindingGenerationId: 'target-bind-2', transactionId: 'target-tx-2' as HarnessTransactionId, requestId: 'target-req-2' as HarnessExecutionRequestId, attemptId: 'target-att-2' as WorkerAttemptId });
  const firstLive = await registry.registerProvisional({ executionRef: firstExec, providerGenerationEvidenceDigest: D, creationObservationDigest: E, capability: capability(), targetId: firstExec.targetId, targetDigest: firstExec.targetDigest, serviceScope, processKind: 'persistent_service' });
  const secondLive = await registry.registerProvisional({ executionRef: secondExec, providerGenerationEvidenceDigest: D, creationObservationDigest: E, capability: capability(), targetId: secondExec.targetId, targetDigest: secondExec.targetDigest, serviceScope, processKind: 'persistent_service' });
  const firstBinding = await registry.mintProcessBinding({ executionRef: firstExec, liveGenerationId: firstLive.liveGenerationId });
  const secondBinding = await registry.mintProcessBinding({ executionRef: secondExec, liveGenerationId: secondLive.liveGenerationId });
  const firstReservation = await reservation(firstExec, firstLive.liveGenerationId, 'target-res-1', 'target-op-1' as OwnedExecutionRef['operationId']);
  const secondReservation = await reservation(secondExec, secondLive.liveGenerationId, 'target-res-2', 'target-op-2' as OwnedExecutionRef['operationId']);
  await registry.ledger.reserve(firstReservation); await registry.ledger.reserve(secondReservation);
  const firstReceipt = (await watchAndReceipt({ authorityOperationId: firstReservation.operationId, descriptorDigest: firstReservation.operationDigest, reservationId: firstReservation.admissionId, requestId: firstReservation.requestId, attemptId: firstReservation.attemptId, transactionId: firstReservation.transactionId }, bridge)).receipt;
  const secondReceipt = (await watchAndReceipt({ authorityOperationId: secondReservation.operationId, descriptorDigest: secondReservation.operationDigest, reservationId: secondReservation.admissionId, bindingGenerationId: secondReservation.bindingGenerationId, requestId: secondReservation.requestId, attemptId: secondReservation.attemptId, transactionId: secondReservation.transactionId }, bridge)).receipt;
  await registry.ledger.noteAuthorityConsumption(firstReservation, firstReceipt); await registry.ledger.commit(firstReservation);
  await registry.ledger.noteAuthorityConsumption(secondReservation, secondReceipt); await registry.ledger.commit(secondReservation);
  const outcomes = await Promise.allSettled([
    registry.completePersistentHandoff(firstLive.liveGenerationId, firstReservation, { noUnresolvedLaunchWork: true, noUnresolvedDescendants: true, responsibilityTransferred: true }),
    registry.completePersistentHandoff(secondLive.liveGenerationId, secondReservation, { noUnresolvedLaunchWork: true, noUnresolvedDescendants: true, responsibilityTransferred: true })
  ]);
  assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
  const rejected = outcomes.find(item => item.status === 'rejected');
  assert.ok(rejected && rejected.status === 'rejected' && rejected.reason instanceof HarnessOwnershipError && rejected.reason.code === 'TARGET_CONFLICT');
  assert.equal((await registry.disposition(firstLive.liveGenerationId)) === 'published_open' || (await registry.disposition(secondLive.liveGenerationId)) === 'published_open', true);
  void firstBinding; void secondBinding;
});

test('natural exit retires only the exact live generation; PID diagnostics never select a replacement', async () => {
  const state = { alive: true };
  const exec = await execution();
  const { registry, live } = await publishedRegistry(exec, { state });
  await registry.observeNaturalExit(live.liveGenerationId);
  assert.equal(await registry.disposition(live.liveGenerationId), 'published_open');
  state.alive = false;
  await registry.observeNaturalExit(live.liveGenerationId);
  assert.equal(await registry.disposition(live.liveGenerationId), 'terminal');
  await assert.rejects(registry.mintProcessBinding({ executionRef: exec, liveGenerationId: live.liveGenerationId }), (error: unknown) => error instanceof HarnessOwnershipError && error.code === 'OWNERSHIP_STALE');
});

test('tool ownership uses invocation identity without pretending a PID exists', async () => {
  const toolExec = await execution({ ownershipId: 'tool-owner', bindingGenerationId: 'tool-binding', executionKind: 'tool', targetId: 'model-rpc' });
  const receiptBridge = new AuthorityConsumptionReceiptBridge({ bridgeEpochId: 'bridge-tool' });
  const registry = new LiveGenerationRegistry({ registryEpochId: 'tool-epoch', receiptBridge });
  const live = await registry.registerProvisional({
    executionRef: toolExec, providerGenerationEvidenceDigest: D, creationObservationDigest: E, capability: capability(),
    targetId: toolExec.targetId, targetDigest: toolExec.targetDigest, serviceScope, toolKind: 'rpc'
  });
  const originBinding = await registry.mintToolBinding({ executionRef: toolExec, liveGenerationId: live.liveGenerationId, invocationId: 'origin-invocation', normalizedInputDigest: D, toolKind: 'rpc', toolInvocationProvenanceDigest: E });
  const originReservation = await reservation(toolExec, live.liveGenerationId, 'tool-handoff', 'handoff-operation-tool' as OwnedExecutionRef['operationId']);
  await registry.ledger.reserve(originReservation);
  const { receipt } = await watchAndReceipt({ authorityOperationId: originReservation.operationId, descriptorDigest: originReservation.operationDigest, reservationId: originReservation.admissionId, bindingGenerationId: toolExec.bindingGenerationId, requestId: toolExec.requestId, attemptId: toolExec.attemptId, transactionId: toolExec.transactionId }, receiptBridge);
  await registry.ledger.noteAuthorityConsumption(originReservation, receipt);
  await registry.ledger.commit(originReservation);
  await registry.completePersistentHandoff(live.liveGenerationId, originReservation, { noUnresolvedLaunchWork: true, noUnresolvedDescendants: true, responsibilityTransferred: true });
  const invocation = await registry.mintToolBinding({ executionRef: toolExec, liveGenerationId: live.liveGenerationId, invocationId: 'invoke-1', normalizedInputDigest: D, toolKind: 'rpc', toolInvocationProvenanceDigest: E });
  assert.equal(invocation.liveGenerationId, live.liveGenerationId);
  assert.equal('pid' in invocation, false);
  await assert.rejects(registry.mintToolBinding({ executionRef: toolExec, liveGenerationId: live.liveGenerationId, invocationId: 'invoke-1', normalizedInputDigest: D, toolKind: 'rpc', toolInvocationProvenanceDigest: E }), (error: unknown) => error instanceof HarnessOwnershipError && error.code === 'ADMISSION_REPLAY');
  void originBinding;
});

test('runtime observations are separate immutable facts and do not carry effect certainty', async () => {
  const observation = await createProcessRuntimeObservation({
    observationId: 'observation-1', observation: 'exit_observed', ownershipId: 'owner-1', liveGenerationId: 'live-1', registryEpochId: 'epoch-1',
    admissionId: 'admission-1', ...scope, observedAt: '2026-09-14T12:00:00.000Z', providerGenerationEvidenceDigest: D
  });
  assert.equal(Object.isFrozen(observation), true);
  assert.equal('effectCertainty' in observation, false);
  assert.equal('quiescent' in observation, false);
});

test('provider proof factory is integrity-bound and provider proof substitution fails', async () => {
  const proof = await createProviderGenerationProofRef({
    proofId: 'proof-1', providerId: 'provider', providerVersion: '1', executionKind: 'process', liveGenerationId: 'live-1', ownershipId: 'owner',
    registryEpochId: 'epoch', ...scope, providerGenerationEvidenceDigest: D, creationObservationDigest: E
  });
  assert.equal(Object.isFrozen(proof), true);
  const forged = { ...proof, liveGenerationId: 'live-2' };
  assert.equal(await (await import('../../common/execution/harness-ownership.ts')).hasProviderGenerationProofIntegrity(forged), false);
});

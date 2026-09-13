import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { build } from 'vite';
import {
  canonicalResidentOrchestratorJson,
  createResidentRequestDraft,
  finalizeResidentRequest,
  hasResidentRequestIntegrity,
  isResidentRequestFinalized,
  reviseResidentRequest,
  toOrchestratorProjection,
  ResidentOrchestratorRequestError
} from '../../common/orchestration/resident-orchestrator-request.ts';

type Data = Record<string, unknown>;

const HEX = 'a'.repeat(64);

function clone<T>(value: T): T {
  return structuredClone(value);
}

function ref(id: string, requestId = 'request-1', workspaceId = 'workspace-1'): Data {
  return { id, version: 'v1', requestId, workspaceId };
}

function draft(): Data {
  return {
    schemaVersion: '1', serialization: 'covert-resident-orchestrator-json-v1', status: 'draft',
    requestId: 'request-1', workspaceId: 'workspace-1', correlationId: 'correlation-1',
    causationId: null, operatorIntentId: 'intent-1', parentRequestId: null, requestRevision: 0,
    goal: {
      statement: 'Repair authentication tests without changing public API behavior.', taskClass: 'modify',
      deliverables: ['code_change', 'test_evidence']
    },
    context: {
      id: 'context-1', digest: HEX, requestId: 'request-1', workspaceId: 'workspace-1',
      taskId: 'task-1', snapshotRef: 'snapshot-1'
    },
    operatorPolicy: {
      reference: { id: 'policy-1', revision: 1, requestId: 'request-1', workspaceId: 'workspace-1' },
      autonomy: 'bounded', detail: 'standard', confirmation: 'on_risk',
      interactionDuringExecution: 'allowed', taskShape: 'bounded'
    },
    sovereignty: 'local_only',
    constraints: {
      hard: {
        excludedPaths: ['public-api.ts'], preserveApiCompatibility: true, maxRiskClass: 'workspace_mutation',
        destructiveEffects: 'forbidden', requiredValidation: ['tests', 'typecheck', 'no_regression'], noUnrelatedChanges: true
      },
      hints: {
        preferExistingTests: true, preferLocalModel: true, preferMinimalDiff: true,
        workflowFamilies: ['safe-refactor'], skillFamilies: ['typescript-debugging']
      }
    },
    methodology: {
      requiredWorkflows: [ref('workflow-1')], preferredWorkflows: [],
      requiredSkills: [ref('skill-1')], preferredSkills: []
    },
    roles: {
      requiredRoles: ['planner', 'coder', 'reviewer'], independentReviewer: true,
      localOnlyModel: true, maxModelCount: 3, preferredModelFamilies: ['local-code']
    },
    resources: {
      maxParallelWorkers: 2, maxWallClockMs: 600_000, maxModelInputTokens: 8_000,
      maxModelOutputTokens: 2_000, resourcePressure: 'normal', mutationConcurrency: 'serial'
    },
    requestedEffects: {
      riskClass: 'workspace_mutation', fileMutation: 'expected', processExecution: 'forbidden',
      externalEgress: 'forbidden', destructiveEffects: 'forbidden'
    },
    acceptance: {
      id: 'acceptance-1', revision: 1, requestId: 'request-1', workspaceId: 'workspace-1',
      validationPlanRequired: true, requiredChecks: ['tests', 'typecheck', 'independent_review', 'evidence', 'no_regression'],
      independentReview: 'required', evidenceRequired: true, noRegressionRequired: true,
      operatorConfirmation: 'required', deliverables: ['code_change', 'test_evidence']
    },
    completion: {
      stopAfterPlanning: false, stopBeforeMutation: true, stopOnFirstBlocker: true,
      boundedRepairAllowed: true, maxRepairAttempts: 2, onAmbiguity: 'ask_operator'
    }
  };
}

async function rejects(value: unknown, code?: string): Promise<void> {
  await assert.rejects(
    Promise.resolve().then(() => createResidentRequestDraft(value)),
    error => error instanceof ResidentOrchestratorRequestError && (!code || error.code === code)
  );
}

function alter<T extends Data>(value: T, path: readonly string[], replacement: unknown): T {
  const output = clone(value) as Data;
  let cursor: Data = output;
  for (const key of path.slice(0, -1)) cursor = cursor[key] as Data;
  cursor[path[path.length - 1]!] = replacement;
  return output as T;
}

test('minimal and fully populated Resident requests are normalized as drafts', () => {
  const value = createResidentRequestDraft(draft());
  assert.equal(value.status, 'draft');
  assert.equal(value.goal.taskClass, 'modify');
  assert.equal(value.constraints.hard.noUnrelatedChanges, true);
  assert.equal(value.requestedEffects.riskClass, 'workspace_mutation');
  assert.equal(Object.isFrozen(value), true);
  assert.equal(Object.isFrozen(value.context), true);
});

test('finalization produces an immutable Orchestrator projection with integrity only', async () => {
  const request = await finalizeResidentRequest(draft());
  assert.equal(request.status, 'finalized');
  assert.equal(request.digest.length, 64);
  assert.equal(isResidentRequestFinalized(request), true);
  assert.equal(await hasResidentRequestIntegrity(request), true);
  const projection = await toOrchestratorProjection(request);
  assert.deepEqual(projection, request);
  assert.equal(Object.isFrozen(projection), true);
  assert.equal(Object.isFrozen(projection.acceptance), true);
});

test('canonical projection is not a plan, verdict, or authority object', async () => {
  const request = await finalizeResidentRequest(draft());
  assert.equal('executionPlan' in request, false);
  assert.equal('workerAssignments' in request, false);
  assert.equal('verified' in request, false);
  assert.equal('approved' in request, false);
  assert.equal('permission' in request, false);
  assert.equal(await hasResidentRequestIntegrity(request), true);
});

test('canonical digest is stable across insertion order and changes for meaningful intent', async () => {
  const first = await finalizeResidentRequest(draft());
  const reordered: Data = {};
  for (const key of Object.keys(draft()).reverse()) reordered[key] = draft()[key];
  const second = await finalizeResidentRequest(reordered);
  assert.equal(first.digest, second.digest);

  const changes: Array<[string, (value: Data) => void]> = [
    ['goal', value => { (value.goal as Data).statement = 'A different goal.'; }],
    ['sovereignty', value => { value.sovereignty = 'remote_allowed'; }],
    ['role', value => { (value.roles as Data).requiredRoles = ['planner', 'reviewer']; }],
    ['policy', value => { (value.operatorPolicy as Data).detail = 'detailed'; }],
    ['context digest', value => { (value.context as Data).digest = 'b'.repeat(64); }]
  ];
  for (const [name, change] of changes) {
    const changed = draft(); change(changed);
    assert.notEqual((await finalizeResidentRequest(changed)).digest, first.digest, name);
  }
});

test('revision updates are monotonic, identity-bound, and drafts remain refinable', async () => {
  const current = createResidentRequestDraft(draft());
  const next = alter(draft(), ['requestRevision'], 1);
  const revised = reviseResidentRequest(current, next, 0);
  assert.equal(revised.requestRevision, 1);
  assert.equal(revised.status, 'draft');
  assert.throws(() => reviseResidentRequest(current, alter(draft(), ['requestRevision'], 2), 0), { code: 'REQUEST_REVISION_SEQUENCE' });
  assert.throws(() => reviseResidentRequest(current, next, 1), { code: 'STALE_REQUEST_REVISION' });
  assert.throws(() => reviseResidentRequest(current, alter(next, ['requestRevision'], 0), 0), { code: 'REQUEST_REVISION_SEQUENCE' });
  assert.throws(() => reviseResidentRequest(current, alter(next, ['requestId'], 'other'), 0));
  assert.throws(() => reviseResidentRequest(current, alter(next, ['workspaceId'], 'other'), 0));
  const finalized = await finalizeResidentRequest(draft());
  assert.throws(() => reviseResidentRequest(finalized, next, 0), { code: 'FINALIZED_REQUEST_IMMUTABLE' });
});

test('context and every scoped methodology/policy/acceptance reference must match request scope', async () => {
  const attacks: Array<[string, string[]]> = [
    ['context workspace', ['context', 'workspaceId']], ['context request', ['context', 'requestId']],
    ['policy workspace', ['operatorPolicy', 'reference', 'workspaceId']], ['policy request', ['operatorPolicy', 'reference', 'requestId']],
    ['workflow workspace', ['methodology', 'requiredWorkflows', '0', 'workspaceId']],
    ['workflow request', ['methodology', 'requiredWorkflows', '0', 'requestId']],
    ['skill workspace', ['methodology', 'requiredSkills', '0', 'workspaceId']],
    ['acceptance workspace', ['acceptance', 'workspaceId']], ['acceptance request', ['acceptance', 'requestId']]
  ];
  for (const [name, path] of attacks) {
    const value = draft();
    let cursor: Data = value;
    for (const key of path.slice(0, -1)) cursor = cursor[key] as Data;
    cursor[path[path.length - 1]!] = 'other';
    await rejects(value);
    assert.notEqual(name, '');
  }
  assert.throws(() => reviseResidentRequest(
    createResidentRequestDraft(draft()),
    alter(draft(), ['context', 'workspaceId'], 'other'),
    0
  ), { code: 'CONTEXT_SCOPE_MISMATCH' });
});

test('hard constraints, hints, privacy declarations and effect intent have separate semantics', () => {
  const value = createResidentRequestDraft(draft());
  assert.equal(value.constraints.hard.noUnrelatedChanges, true);
  assert.equal(value.constraints.hints.preferMinimalDiff, true);
  assert.equal(value.sovereignty, 'local_only');
  assert.equal(value.requestedEffects.fileMutation, 'expected');
  assert.equal(value.requestedEffects.processExecution, 'forbidden');
  const remote = createResidentRequestDraft(alter(draft(), ['sovereignty'], 'remote_allowed'));
  assert.equal(remote.sovereignty, 'remote_allowed');
});

const forbiddenFields = [
  'subtasks', 'taskGraph', 'dependencyGraph', 'workerAssignments', 'selectedWorkers', 'executionPlan', 'schedule',
  'transactionId', 'checkpointId', 'executionHandle', 'processId', 'toolHandle', 'capabilityToken', 'approvalToken',
  'approved', 'permission', 'veritasVerdict', 'verified', 'accepted', 'committed', 'authority', 'credential'
];
for (const field of forbiddenFields) {
  test(`rejects authority/plan/verdict field ${field} at every contract boundary`, async () => {
    await rejects({ ...draft(), [field]: true });
    await rejects(alter(draft(), ['goal', field], true));
    await rejects(alter(draft(), ['context', field], true));
    await rejects(alter(draft(), ['constraints', 'hard', field], true));
    await rejects(alter(draft(), ['acceptance', field], true));
  });
}

test('raw context, memory and prompt blobs are not accepted', async () => {
  for (const field of ['rawContext', 'memoryDump', 'prompt', 'chatHistory', 'secretStore']) {
    await rejects({ ...draft(), [field]: 'forged context' });
  }
});

test('invalid values, prototypes, symbols, hidden fields and accessors fail without getter execution', async () => {
  const invalid: unknown[] = [undefined, NaN, Infinity, -Infinity, 1n, () => 'x', Symbol('x'), new Date(), new Map()];
  for (const value of invalid) await rejects(alter(draft(), ['goal', 'statement'], value));

  const inherited = Object.create({ statement: 'evil' }) as Data;
  await rejects(alter(draft(), ['goal'], inherited));
  const symbolValue = draft(); symbolValue.goal = { ...(symbolValue.goal as Data), [Symbol('hidden')]: true };
  await rejects(symbolValue);
  const hidden = draft();
  Object.defineProperty(hidden.goal, 'hidden', { value: true, enumerable: false });
  await rejects(hidden);

  let getterReads = 0;
  const accessor = draft();
  Object.defineProperty(accessor.context, 'digest', {
    enumerable: true,
    get() { getterReads++; return HEX; }
  });
  await rejects(accessor);
  assert.equal(getterReads, 0);
  const nestedAccessor = draft();
  Object.defineProperty((nestedAccessor.acceptance as Data).requiredChecks, '0', {
    enumerable: true,
    get() { getterReads++; return 'tests'; }
  });
  await rejects(nestedAccessor);
  assert.equal(getterReads, 0);
});

test('caller aliases cannot mutate a draft, finalized request, projection, or digest', async () => {
  const source = draft();
  const normalized = createResidentRequestDraft(source);
  const digestBefore = await finalizeResidentRequest(source);
  (source.goal as Data).statement = 'mutated';
  ((source.constraints as Data).hints as Data).workflowFamilies = ['mutated'];
  (source.methodology as Data).requiredSkills = [];
  assert.equal(normalized.goal.statement, 'Repair authentication tests without changing public API behavior.');
  assert.deepEqual(normalized.constraints.hints.workflowFamilies, ['safe-refactor']);
  assert.equal((normalized.methodology.requiredSkills as readonly unknown[]).length, 1);
  assert.equal(await hasResidentRequestIntegrity(digestBefore), true);
  assert.throws(() => { (digestBefore.goal as unknown as Data).statement = 'evil'; }, TypeError);
  assert.equal((await toOrchestratorProjection(digestBefore)).goal.statement, 'Repair authentication tests without changing public API behavior.');
});

test('integrity rejects tampered digest and stale request scope, while digest is not authentication', async () => {
  const request = await finalizeResidentRequest(draft());
  const tampered = { ...request, sovereignty: 'remote_allowed' };
  assert.equal(await hasResidentRequestIntegrity(tampered), false);
  assert.equal(await hasResidentRequestIntegrity({ ...request, digest: 'b'.repeat(64) }), false);
  assert.equal(await hasResidentRequestIntegrity({ ...request, requestId: 'other' }), false);
  assert.equal(await hasResidentRequestIntegrity({ ...request, authority: 'forged' }), false);
  assert.equal(canonicalResidentOrchestratorJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
});

test('browser bundle contains no server execution dependencies and runs in a browser realm', async () => {
  let code = '';
  await build({
    configFile: false, envFile: false, publicDir: false, logLevel: 'silent',
    build: { write: false, minify: false, lib: {
      entry: fileURLToPath(new URL('../../common/orchestration/resident-orchestrator-request.ts', import.meta.url)),
      name: 'CovertResidentRequest', formats: ['iife']
    } },
    plugins: [{ name: 'resident-request-browser-assertion', generateBundle(_options, bundle) {
      for (const id of this.getModuleIds()) assert.doesNotMatch(id, /node:|browser-external|execution-authority|child_process|fs/);
      for (const chunk of Object.values(bundle)) if (chunk.type === 'chunk') code += chunk.code;
    } }]
  });
  assert.ok(code.length > 0);
  const realm = { crypto: globalThis.crypto, TextEncoder, text: JSON.stringify(draft()) };
  const result = await runInNewContext(code + '\nCovertResidentRequest.createResidentRequestDraft(JSON.parse(text));', realm) as Data;
  assert.equal(result.status, 'draft');
});

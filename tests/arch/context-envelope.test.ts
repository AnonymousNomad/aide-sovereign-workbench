import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { build } from 'vite';
import {
  ContextBuildInput, ContextEnvelope, ContextItem,
  type ContextBuildInputT, type ContextItemT
} from '../../common/contracts/context.ts';
import { buildContextEnvelope, canonicalContextJson, hasContextIntegrity } from '../../common/context/context-envelope.ts';
import { createExecutionAuthority } from '../../node/src/services/execution-authority.mjs';

function item(id = 'a', required = true): ContextItemT {
  return {
    id, revision: 'r1', type: 'source', source: { id: 'source-' + id, revision: 'r1', locator: '/private/project/' + id },
    provenance: { producer: 'collector', observedAt: '2026-09-12T00:00:00.000Z', evidenceRefs: ['evidence-1'],
      derivedFrom: [], transform: null, basis: 'observed', confidence: null },
    scope: { workspaceId: 'workspace', taskId: 'task', roles: ['planner', 'coder', 'reviewer', 'security', 'research'] },
    privacy: 'LOCAL_ONLY', freshness: { snapshotRef: 'snapshot', validUntil: null, revoked: false },
    selection: { required, pinned: false, relevance: 0.5, dependencies: [], conflicts: [], redundancyGroup: null },
    content: 'const answer = 42;'
  };
}
function fixture(items = [item()]): ContextBuildInputT {
  return {
    request: { taskId: 'task', attemptId: 'attempt', workspaceId: 'workspace', snapshotRef: 'snapshot', role: 'coder',
      destination: { modelId: 'local-a', modelRevision: 'q4-r1', providerId: 'local', locality: 'local', servedContextLimit: 4096 },
      evaluatedAt: '2026-09-12T01:00:00.000Z' },
    policy: { id: 'policy', revision: '1', destinations: 'local_only', maxInputTokens: 3000,
      reservedOutputTokens: 512, safetyMarginTokens: 64, framingReserveTokens: 32 }, items
  };
}
async function denied(input: unknown, code: string) {
  await assert.rejects(buildContextEnvelope(input), { code });
}

test('canonical serialization sorts keys, preserves array order and explicit null', () => {
  assert.equal(canonicalContextJson({ z: [2, 1], a: { y: null, x: true } }), '{"a":{"x":true,"y":null},"z":[2,1]}');
  assert.equal(canonicalContextJson({ a: 1, b: 2 }), canonicalContextJson({ b: 2, a: 1 }));
  assert.notEqual(canonicalContextJson([1, 2]), canonicalContextJson([2, 1]));
  assert.equal(canonicalContextJson(-0), '0');
  assert.notEqual(canonicalContextJson({}), canonicalContextJson({ a: null }));
});

test('semantically identical inputs have stable SHA-256 including UTF-8 payload', async () => {
  const input = fixture(); input.items[0]!.content = 'café 日本語 🛠';
  const a = await buildContextEnvelope(input);
  const b = await buildContextEnvelope({ items: input.items, policy: input.policy, request: input.request });
  assert.equal(a.digest, b.digest);
  assert.equal(await hasContextIntegrity(a), true);
  const { digest, ...unsigned } = a;
  assert.equal(digest, createHash('sha256').update(canonicalContextJson(unsigned), 'utf8').digest('hex'));
  assert.equal(a.manifest.included[0]!.contentDigest, createHash('sha256').update(input.items[0]!.content).digest('hex'));
  assert.equal(a.manifest.budget.measurement, 'conservative_estimate');
  assert.equal(a.manifest.budget.inputTokens,
    new TextEncoder().encode(canonicalContextJson(a.worker.messages)).length + input.policy.framingReserveTokens);
});

const changes: Array<[string, (value: ContextBuildInputT) => void]> = [
  ['content', v => { v.items[0]!.content += ' changed'; }],
  ['item revision', v => { v.items[0]!.revision = 'r2'; }],
  ['model', v => { v.request.destination.modelId = 'local-b'; }],
  ['model revision', v => { v.request.destination.modelRevision = 'r2'; }],
  ['provider', v => { v.request.destination.providerId = 'another'; }],
  ['role', v => { v.request.role = 'reviewer'; }],
  ['policy revision', v => { v.policy.revision = '2'; }],
  ['policy content', v => { v.policy.safetyMarginTokens += 1; }],
  ['served context', v => { v.request.destination.servedContextLimit += 1; }],
  ['snapshot', v => { v.request.snapshotRef = 'snapshot2'; v.items[0]!.freshness.snapshotRef = 'snapshot2'; }]
];
for (const [name, change] of changes) test(`digest binds ${name}`, async () => {
  const input = fixture(); const before = await buildContextEnvelope(input); change(input);
  assert.notEqual((await buildContextEnvelope(input)).digest, before.digest);
});

test('fallback locality requires a newly eligible envelope; old payload tampering fails integrity', async () => {
  const input = fixture(); input.policy.destinations = 'local_and_remote'; input.items[0]!.privacy = 'REMOTE_ALLOWED';
  const before = await buildContextEnvelope(input);
  input.request.destination.locality = 'remote';
  const after = await buildContextEnvelope(input);
  assert.notEqual(before.digest, after.digest);
  const tampered = JSON.parse(JSON.stringify(before)); tampered.worker.destination.locality = 'remote';
  assert.equal(await hasContextIntegrity(tampered), false);
});

for (const [name, change] of [
  ['workspace', (i: ContextItemT) => { i.scope.workspaceId = 'other'; }],
  ['task', (i: ContextItemT) => { i.scope.taskId = 'other'; }],
  ['role', (i: ContextItemT) => { i.scope.roles = ['reviewer']; }]
] as const) test(`${name} scope mismatch rejects even optional context`, async () => {
  const i = item('a', false); change(i); await denied(fixture([i]), 'SCOPE_MISMATCH');
});

for (const [name, code, change] of [
  ['expired', 'EXPIRED', (i: ContextItemT) => { i.freshness.validUntil = '2026-09-12T01:00:00.000Z'; }],
  ['revoked', 'REVOKED', (i: ContextItemT) => { i.freshness.revoked = true; }],
  ['stale', 'STALE', (i: ContextItemT) => { i.freshness.snapshotRef = 'old'; }],
  ['future observation', 'STALE', (i: ContextItemT) => { i.provenance.observedAt = '2027-01-01T00:00:00.000Z'; }]
] as const) test(`required ${name} blocks; optional is explicitly excluded`, async () => {
  const i = item(); change(i); await denied(fixture([i]), 'REQUIRED_' + code);
  i.selection.required = false;
  const result = await buildContextEnvelope(fixture([i]));
  assert.equal(result.worker.messages.length, 0);
  assert.equal(result.manifest.excluded[0]!.reason, code.toLowerCase());
});

test('NEVER_EXPOSE and local manifest metadata do not reach worker projection', async () => {
  const secret = item('SECRET_NAME', false); secret.privacy = 'NEVER_EXPOSE'; secret.content = 'SECRET_VALUE';
  const a = await buildContextEnvelope(fixture([item(), secret]));
  const b = await buildContextEnvelope(fixture());
  assert.deepEqual(a.worker, b.worker);
  assert.equal(a.manifest.excluded[0]!.reason, 'privacy');
  assert.doesNotMatch(JSON.stringify(a.worker), /SECRET|private|locator|excluded|source-|evidence-/);
  secret.selection.required = true; await denied(fixture([secret]), 'REQUIRED_PRIVACY');
});

test('local policy blocks remote and LOCAL_ONLY cannot be released by remote eligibility', async () => {
  const input = fixture(); input.request.destination.locality = 'remote';
  await denied(input, 'DESTINATION_POLICY'); input.policy.destinations = 'local_and_remote';
  await denied(input, 'REQUIRED_PRIVACY'); input.items[0]!.selection.required = false;
  assert.equal((await buildContextEnvelope(input)).manifest.excluded[0]!.reason, 'privacy');
});

test('ASK blocks without a trusted release seam; caller release boolean is rejected', async () => {
  const input = fixture(); input.items[0]!.privacy = 'ASK';
  await denied(input, 'REQUIRED_RELEASE_REQUIRED');
  await denied({ ...input, releaseSatisfied: true }, 'INVALID_CONTRACT');
  input.items[0]!.selection.required = false;
  assert.equal((await buildContextEnvelope(input)).manifest.excluded[0]!.reason, 'release_required');
});

test('required budget includes output, margin and framing; oversized required content fails', async () => {
  const input = fixture(); const built = await buildContextEnvelope(input);
  input.request.destination.servedContextLimit = built.manifest.budget.inputTokens + input.policy.reservedOutputTokens + input.policy.safetyMarginTokens;
  await buildContextEnvelope(input);
  input.request.destination.servedContextLimit -= 1; await denied(input, 'REQUIRED_BUDGET');
  const large = fixture(); large.items[0]!.content = 'x'.repeat(4000); await denied(large, 'REQUIRED_BUDGET');
});

test('optional drop order is deterministic across inventory order with no required eviction', async () => {
  const required = item(); const b = item('b', false); const c = item('c', false);
  const input = fixture([required, b]);
  input.policy.maxInputTokens = (await buildContextEnvelope(input)).manifest.budget.inputTokens;
  input.items.push(c);
  const a = await buildContextEnvelope(input); input.items.reverse(); const other = await buildContextEnvelope(input);
  assert.equal(a.digest, other.digest);
  assert.deepEqual(a.manifest.included.map(entry => entry.item.id), ['a', 'b']);
  assert.deepEqual(a.manifest.excluded.map(entry => [entry.itemId, entry.reason]), [['c', 'budget']]);
});

test('dependency closure cannot drop required dependencies for budget or privacy', async () => {
  const a = item(); const b = item('b', false); a.selection.dependencies = ['b'];
  const input = fixture([a, b]);
  assert.deepEqual((await buildContextEnvelope(input)).manifest.included.map(e => e.reason), ['required', 'dependency']);
  b.privacy = 'NEVER_EXPOSE'; await denied(input, 'REQUIRED_PRIVACY');
  a.selection.required = false;
  assert.equal((await buildContextEnvelope(input)).manifest.excluded.find(e => e.itemId === 'a')!.reason, 'dependency_unavailable');
});

test('dependency cycle is rejected even in optional inventory', async () => {
  const a = item('a', false); const b = item('b', false); a.selection.dependencies = ['b']; b.selection.dependencies = ['a'];
  await denied(fixture([a, b]), 'DEPENDENCY_CYCLE');
});

test('required dependency closure must fit and hidden dependencies cannot be injected', async () => {
  const a = item(); const b = item('b', false); a.selection.dependencies = ['b']; b.content = 'x'.repeat(4000);
  await denied(fixture([a, b]), 'REQUIRED_BUDGET');
  a.selection.required = false;
  const result = await buildContextEnvelope(fixture([a, b]));
  assert.deepEqual(result.worker.messages, []);
  assert.deepEqual(result.manifest.excluded.map(e => e.reason), ['budget', 'budget']);
});

test('serialization bounds nesting and rejects altered schema versions', async () => {
  let nested: unknown = null;
  for (let i = 0; i < 66; i++) nested = { child: nested };
  assert.throws(() => canonicalContextJson(nested), { code: 'JSON_LIMIT' });
  const envelope = JSON.parse(JSON.stringify(await buildContextEnvelope(fixture())));
  envelope.schemaVersion = '2';
  assert.equal(await hasContextIntegrity(envelope), false);
});

for (const field of ['dependencies', 'conflicts'] as const) test(`missing ${field} reference is rejected`, async () => {
  const a = item(); a.selection[field] = ['missing']; await denied(fixture([a]), 'INVALID_REFERENCE');
});

test('duplicate identifiers and duplicate/self references are rejected', async () => {
  await denied(fixture([item(), item()]), 'DUPLICATE_ITEM');
  const a = item(); a.selection.dependencies = ['a']; await denied(fixture([a]), 'INVALID_REFERENCE');
  a.selection.dependencies = ['b', 'b']; await denied(fixture([a, item('b')]), 'INVALID_REFERENCE');
});

test('required conflict rejects and asymmetric optional conflict excludes deterministically', async () => {
  const a = item(); const b = item('b'); b.selection.conflicts = ['a'];
  await denied(fixture([a, b]), 'REQUIRED_CONFLICT'); b.selection.required = false;
  const output = await buildContextEnvelope(fixture([a, b]));
  assert.deepEqual(output.manifest.included.map(e => e.item.id), ['a']);
  assert.equal(output.manifest.excluded[0]!.reason, 'conflict');
});

test('redundancy preserves required items and pinned cannot override privacy', async () => {
  const a = item(); const b = item('b', false); a.selection.redundancyGroup = b.selection.redundancyGroup = 'same';
  b.selection.pinned = true;
  const output = await buildContextEnvelope(fixture([b, a]));
  assert.deepEqual(output.manifest.included.map(e => e.item.id), ['a']);
  assert.equal(output.manifest.excluded[0]!.reason, 'redundant');
  b.selection.required = true; await denied(fixture([a, b]), 'REQUIRED_REDUNDANT');
  b.selection.required = false; b.privacy = 'NEVER_EXPOSE';
  assert.equal((await buildContextEnvelope(fixture([a, b]))).manifest.excluded[0]!.reason, 'privacy');
});

test('output is deeply immutable and detached before asynchronous hashing', async () => {
  const input = fixture(); const pending = buildContextEnvelope(input);
  input.items[0]!.content = 'altered'; input.request.destination.modelId = 'altered';
  const output = await pending;
  assert.equal(output.worker.messages[0]!.text, 'const answer = 42;');
  assert.equal(output.worker.destination.modelId, 'local-a');
  function frozen(value: unknown): void {
    if (value !== null && typeof value === 'object') {
      assert.equal(Object.isFrozen(value), true);
      for (const child of Object.values(value)) frozen(child);
    }
  }
  frozen(output);
  assert.throws(() => { Object.assign(output.worker.destination, { modelId: 'evil' }); }, TypeError);
  assert.equal(await hasContextIntegrity(output), true);
});

for (const field of ['approved', 'executionHandle', 'capability', 'actorToken', 'permission', 'authority']) {
  test(`authority smuggling field ${field} is rejected at top-level and nested boundaries`, async () => {
    const input = fixture();
    for (const value of [true, 'false', { operation_id: 'forged' }]) {
      await denied({ ...input, [field]: value }, 'INVALID_CONTRACT');
      await denied({ ...input, items: [{ ...input.items[0], [field]: value }] }, 'INVALID_CONTRACT');
      await denied({ ...input, request: { ...input.request, destination: { ...input.request.destination, [field]: value } } }, 'INVALID_CONTRACT');
      assert.equal(ContextBuildInput.safeParse({ ...input, policy: { ...input.policy, [field]: value } }).success, false);
    }
  });
}

test('a serialized context envelope cannot be used as a canonical execution handle', async () => {
  const envelope = JSON.parse(JSON.stringify(await buildContextEnvelope(fixture())));
  const authority = createExecutionAuthority({ workspace: fileURLToPath(new URL('../../', import.meta.url)), record: async () => ({ persisted: true }) });
  try {
    assert.throws(() => authority.assertExecution(envelope, 'agent.tool', {}), { code: 'FORBIDDEN' });
    assert.equal(ContextEnvelope.safeParse({ ...envelope, executionHandle: { operation_id: 'x' } }).success, false);
  } finally { authority.control.close(); }
});

test('unsupported JSON values, properties and non-finite numbers are rejected without running getters', async () => {
  const cycle: Record<string, unknown> = {}; cycle['self'] = cycle;
  const accessor = Object.defineProperty({}, 'x', { enumerable: true, get() { throw new Error('GETTER_EXECUTED'); } });
  const hidden = Object.defineProperty({}, 'x', { enumerable: false, value: 1 });
  const extraArray = Object.assign([1], { extra: 2 });
  for (const value of [undefined, NaN, Infinity, -Infinity, () => 1, Symbol('x'), 1n, new Date(), new Map(), new Set(),
    cycle, accessor, hidden, extraArray, [undefined], new Array(1), { [Symbol('x')]: 1 }, { x: undefined }]) {
    assert.throws(() => canonicalContextJson(value), error => error instanceof Error && error.name === 'ContextEnvelopeError');
    await assert.rejects(buildContextEnvelope({ ...fixture(), extra: value }));
  }
  assert.equal(ContextItem.safeParse({ ...item(), content: undefined }).success, false);
});

test('compressed context preserves origins, transform/version and omissions without trust upgrade', async () => {
  const a = item(); a.provenance.basis = 'derived';
  a.provenance.derivedFrom = [{ id: 'original', revision: 'old-r1', locator: '/private/original' }];
  a.provenance.transform = { id: 'summarizer', version: '1', omissions: ['examples'] };
  const output = await buildContextEnvelope(fixture([a]));
  assert.deepEqual(output.manifest.included[0]!.item.provenance, a.provenance);
  assert.doesNotMatch(JSON.stringify(output.worker), /original|summarizer|omissions/);
  a.provenance.basis = 'observed'; await denied(fixture([a]), 'INVALID_CONTRACT');
  a.provenance.basis = 'derived'; a.provenance.derivedFrom = []; await denied(fixture([a]), 'INVALID_CONTRACT');
});

test('browser bundle imports no Node execution modules and runs with browser globals only', async () => {
  let code = '';
  await build({
    configFile: false, envFile: false, publicDir: false, logLevel: 'silent',
    build: { write: false, minify: false, lib: {
      entry: fileURLToPath(new URL('../../common/context/context-envelope.ts', import.meta.url)), name: 'CovertContext', formats: ['iife']
    } },
    plugins: [{ name: 'context-browser-assertion', generateBundle(_options, bundle) {
      for (const id of this.getModuleIds()) assert.doesNotMatch(id, /node:|browser-external|execution-authority|agent-tools/);
      for (const chunk of Object.values(bundle)) if (chunk.type === 'chunk') code += chunk.code;
    } }]
  });
  assert.ok(code.length > 0);
  // Build input and library must share a realm, just as a browser application does.
  const realm = { crypto: globalThis.crypto, TextEncoder, text: JSON.stringify(fixture()) };
  const result = await runInNewContext(code + '\nCovertContext.buildContextEnvelope(JSON.parse(text));', realm) as Awaited<ReturnType<typeof buildContextEnvelope>>;
  assert.equal(result.digest, (await buildContextEnvelope(fixture())).digest);
});

// tests/arch/onboarding-runtime.test.ts (cline/T4, 2026-09-02)
// PR A of aide-onboarding-walkthrough. End-to-end test: bring up a real
// server with the 4 onboarding routes, exercise the state machine, verify
// the state file is persisted atomically. Onboarding mutations are authority-
// bound state transitions (capability.write descriptors).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type http from 'node:http';
import * as fsModule from 'node:fs';
const fsp = fsModule.promises;
import os from 'node:os';
import path from 'node:path';
import { ArchServer } from '../../node/src/server.ts';
import { routesForOnboarding } from '../../node/src/routes/onboarding.ts';
import { routesForAuthority } from '../../node/src/routes/authority.ts';
import { pairFixture } from './authority-fixture.ts';
import { OnboardingState } from '../../common/contracts/onboarding.ts';
import { createOnboardingService, OnboardingConflictError } from '../../node/src/services/onboarding.mjs';

type Envelope<T> = { ok: boolean; data?: T; error?: { code: string; message: string } };
type Owner = Awaited<ReturnType<typeof pairFixture>>;

async function read(owner: Owner, pathName: string): Promise<{ status: number; body: Envelope<unknown> }> {
  const response = await owner.request(pathName);
  return { status: response.status, body: (await response.json()) as Envelope<unknown> };
}

async function mutate(owner: Owner, method: string, pathName: string, payload: unknown, taskId: string): Promise<{ status: number; body: Envelope<unknown> }> {
  const headers = await owner.approve(method, pathName, payload, taskId);
  const response = await owner.request(pathName, { method, headers, body: JSON.stringify(payload) });
  return { status: response.status, body: (await response.json()) as Envelope<unknown> };
}

async function unapproved(owner: Owner, method: string, pathName: string, payload: unknown): Promise<{ status: number; body: Envelope<unknown> }> {
  const response = await owner.request(pathName, { method, body: JSON.stringify(payload) });
  return { status: response.status, body: (await response.json()) as Envelope<unknown> };
}

async function setup(): Promise<{ workspace: string; server: ArchServer; httpServer: http.Server; owner: Owner; base: string }> {
  const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), 'aide-onboarding-'));
  const server = new ArchServer(workspace, path.join(workspace, 'arch-onboarding.log'));
  for (const route of routesForAuthority()) server.route(route);
  for (const route of routesForOnboarding(workspace)) server.route(route);
  const httpServer = await server.listen(0);
  const address = httpServer.address();
  assert.ok(address && typeof address === 'object');
  const base = 'http://127.0.0.1:' + (address as { port: number }).port;
  const owner = await pairFixture(server, base);
  return { workspace, server, httpServer, owner, base };
}

async function teardown(workspace: string, server: ArchServer, httpServer: http.Server): Promise<void> {
  server.authority.control.close();
  httpServer.closeAllConnections();
  await new Promise<void>(resolve => { httpServer.close(() => resolve()); });
  for (let attempt = 0; attempt < 10; attempt++) {
    try { await fsp.rm(workspace, { recursive: true, force: true }); break; }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? '';
      if (!['EBUSY', 'ENOTEMPTY', 'EPERM'].includes(code)) throw error;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
}

test('onboarding walkthrough: state machine + atomic persistence (PR A)', async () => {
  const { workspace, server, httpServer, owner } = await setup();
  try {
    // 1. GET state returns the default state.
    const initial = await read(owner, '/api/onboarding/state');
    assert.equal(initial.status, 200);
    assert.equal(initial.body.ok, true);
    const initialState = OnboardingState.parse((initial.body.data as { state: unknown }).state);
    assert.equal(initialState.current_step, 'welcome');
    assert.equal(initialState.walkthrough_complete, false);

    // 2. POST next with no body advances to privacy.
    const next1 = await mutate(owner, 'POST', '/api/onboarding/next', {}, 'task:onboarding-next-1');
    assert.equal(next1.status, 200);
    assert.equal((next1.body.data as { advanced_to: string }).advanced_to, 'privacy');

    // 3. POST next with user choices (welcome step) advances to byok_optin.
    const next2 = await mutate(owner, 'POST', '/api/onboarding/next', {
      name: 'Operator',
      role: 'developer',
      workbench: 'sovereign-coder'
    }, 'task:onboarding-next-2');
    assert.equal(next2.status, 200);
    assert.equal((next2.body.data as { advanced_to: string }).advanced_to, 'byok_optin');
    const state2 = OnboardingState.parse((next2.body.data as { state: unknown }).state);
    assert.equal(state2.user_choices.name, 'Operator');
    assert.equal(state2.user_choices.workbench, 'sovereign-coder');

    // 4. PUT state replaces the full state (operator override path).
    const override = { ...state2, current_step: 'desktop_optin' as const, walkthrough_complete: false };
    const put1 = await mutate(owner, 'PUT', '/api/onboarding/state', override, 'task:onboarding-put');
    assert.equal(put1.status, 200);
    const state3 = OnboardingState.parse((put1.body.data as { state: unknown }).state);
    assert.equal(state3.current_step, 'desktop_optin');

    // 5. POST next advances to system_map.
    const next3 = await mutate(owner, 'POST', '/api/onboarding/next', {}, 'task:onboarding-next-3');
    assert.equal(next3.status, 200);
    assert.equal((next3.body.data as { advanced_to: string }).advanced_to, 'system_map');

    // 6. POST complete sets walkthrough_complete = true.
    const complete = await mutate(owner, 'POST', '/api/onboarding/complete', {}, 'task:onboarding-complete');
    assert.equal(complete.status, 200);
    assert.equal((complete.body.data as { complete: boolean }).complete, true);
    const finalState = OnboardingState.parse((complete.body.data as { state: unknown }).state);
    assert.equal(finalState.walkthrough_complete, true);
    assert.equal(finalState.current_step, 'system_map');

    // 7. Atomic persistence: state file exists, parses, matches the final state.
    const stateFile = path.join(workspace, '.aide', 'onboarding-state.json');
    const raw = await fsp.readFile(stateFile, 'utf8');
    const persisted = OnboardingState.parse(JSON.parse(raw));
    assert.equal(persisted.walkthrough_complete, true);

    // 8. No .partial file left over (atomic rename worked).
    await assert.rejects(() => fsp.access(stateFile + '.partial'), /ENOENT/);

    // 9. Reject: empty state PUT returns 400 (zod strict) before authority.
    const badPut = await unapproved(owner, 'PUT', '/api/onboarding/state', {});
    assert.equal(badPut.status, 400);
  } finally {
    await teardown(workspace, server, httpServer);
  }
});

test('onboarding authority: transitions bind origin state and fail closed on drift', async () => {
  const { workspace, server, httpServer, owner, base } = await setup();
  try {
    const stateFile = path.join(workspace, '.aide', 'onboarding-state.json');
    const stateRaw = async (): Promise<string> => fsp.readFile(stateFile, 'utf8').catch(() => '');

    const anonymous = await fetch(base + '/api/onboarding/next', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(anonymous.status, 403, 'anonymous actor rejected');

    const before = await stateRaw();
    const blocked = await unapproved(owner, 'POST', '/api/onboarding/next', {});
    assert.equal(blocked.status, 409, 'paired actor without approval fails');
    assert.equal(await stateRaw(), before, 'no mutation without approval');

    // Approval for `next` at welcome cannot execute after the state moved on.
    const initialRead = await read(owner, '/api/onboarding/state');
    const initialState = OnboardingState.parse((initialRead.body.data as { state: unknown }).state);
    const staleNext = await owner.approve('POST', '/api/onboarding/next', { name: 'Drifted' }, 'task:onboarding-stale');
    const moved = await mutate(owner, 'PUT', '/api/onboarding/state', {
      ...initialState,
      current_step: 'privacy'
    }, 'task:onboarding-move');
    assert.equal(moved.status, 200);
    const staleRun = await owner.request('/api/onboarding/next', { method: 'POST', headers: staleNext, body: JSON.stringify({ name: 'Drifted' }) });
    assert.equal(staleRun.status, 409, 'next approval cannot authorize a different transition after drift');
    const afterDrift = OnboardingState.parse(JSON.parse(await stateRaw()));
    assert.equal(afterDrift.current_step, 'privacy', 'drifted state is untouched by the stale approval instance');

    // A next approval cannot be used for complete, and vice versa.
    const nextApproval = await owner.approve('POST', '/api/onboarding/next', {}, 'task:onboarding-cross');
    const crossRoute = await owner.request('/api/onboarding/complete', { method: 'POST', headers: nextApproval, body: '{}' });
    assert.equal(crossRoute.status, 409, 'next approval cannot become complete');

    // PUT approval binds the exact normalized state written.
    const currentState = OnboardingState.parse(JSON.parse(await stateRaw()));
    const original = { ...currentState, user_choices: { ...currentState.user_choices, role: 'developer' as const } };
    const changed = { ...currentState, user_choices: { ...currentState.user_choices, role: 'researcher' as const } };
    const putHeaders = await owner.approve('PUT', '/api/onboarding/state', original, 'task:onboarding-put-bound');
    const changedPut = await owner.request('/api/onboarding/state', { method: 'PUT', headers: putHeaders, body: JSON.stringify(changed) });
    assert.equal(changedPut.status, 409, 'changed state cannot reuse approval');
    const appliedPut = await owner.request('/api/onboarding/state', { method: 'PUT', headers: putHeaders, body: JSON.stringify(original) });
    assert.equal(appliedPut.status, 200, 'exact approved state executes');

    // Complete: approval binds walkthrough_complete; replay fails; a second
    // complete approval after the state changed cannot replay the old one.
    const completeHeaders = await owner.approve('POST', '/api/onboarding/complete', undefined, 'task:onboarding-complete-bound');
    const completed = await owner.request('/api/onboarding/complete', { method: 'POST', headers: completeHeaders });
    assert.equal(completed.status, 200);
    const completeReplay = await owner.request('/api/onboarding/complete', { method: 'POST', headers: completeHeaders });
    assert.equal(completeReplay.status, 409, 'complete cannot be reused after state changed');

    const serialized = await stateRaw();
    const token = owner.headers.Authorization.slice(7);
    assert.ok(!serialized.includes(token), 'onboarding artifacts must not serialize bearer material');
    assert.ok(!serialized.includes(owner.actorId), 'onboarding artifacts must not serialize actor identity');
    assert.ok(!serialized.includes(completeHeaders['X-AIDE-Operation']), 'onboarding artifacts must not serialize operation ids');
  } finally {
    await teardown(workspace, server, httpServer);
  }
});

test('onboarding TOCTOU repair: serialization prevents approval for N executing against M', async () => {
  const { workspace, server, httpServer, owner } = await setup();
  const originalReadFile = fsModule.promises.readFile as unknown as (file: unknown, ...rest: unknown[]) => Promise<unknown>;
  const mutableFsp = fsModule.promises as unknown as { readFile: (file: unknown, ...rest: unknown[]) => Promise<unknown> };
  try {
    // Materialize the default state at N = welcome and capture it for B.
    const initialRead = await read(owner, '/api/onboarding/state');
    const initialState = OnboardingState.parse((initialRead.body.data as { state: unknown }).state);

    // Approve A: `next` bound to from_step = welcome.
    const aHeaders = await owner.approve('POST', '/api/onboarding/next', { name: 'A' }, 'task:toctou-a');

    // Interpose on state reads. A's execute-time descriptor read is read #1;
    // the handler's read inside the serialized critical section is read #2.
    // Hold read #2 so A keeps the critical section while B attempts a PUT.
    let stateReads = 0;
    let reachedCriticalRead!: () => void;
    const criticalReadReached = new Promise<void>(resolve => { reachedCriticalRead = resolve; });
    let releaseCriticalRead!: () => void;
    const criticalReadGate = new Promise<void>(resolve => { releaseCriticalRead = resolve; });
    mutableFsp.readFile = async (file: unknown, ...rest: unknown[]) => {
      if (String(file).endsWith('onboarding-state.json')) {
        stateReads += 1;
        if (stateReads === 2) { reachedCriticalRead(); await criticalReadGate; }
      }
      return originalReadFile(file, ...rest);
    };

    const aPromise = owner.request('/api/onboarding/next', { method: 'POST', headers: aHeaders, body: JSON.stringify({ name: 'A' }) });
    await criticalReadReached;

    // B tries to replace state N while A holds the transition critical section.
    const bPromise = mutate(owner, 'PUT', '/api/onboarding/state', { ...initialState, current_step: 'privacy' }, 'task:toctou-b');
    const bOutcome = await Promise.race([
      bPromise.then(() => 'settled', () => 'settled'),
      new Promise<string>(resolve => setTimeout(() => resolve('pending'), 250))
    ]);
    assert.equal(bOutcome, 'pending', 'PUT must not complete while a transition holds the critical section');

    // Release A: it must commit exactly its approved welcome -> privacy step.
    releaseCriticalRead();
    const aResponse = await aPromise;
    const aBody = (await aResponse.json()) as Envelope<{ advanced_to?: string }>;
    assert.equal(aResponse.status, 200);
    assert.equal(aBody.data?.advanced_to, 'privacy', 'A executed exactly its approved transition');

    // B's replacement applies afterwards (last-write-wins for PUT).
    const bResponse = await bPromise;
    assert.equal(bResponse.status, 200);
    mutableFsp.readFile = originalReadFile;
    const finalRead = await read(owner, '/api/onboarding/state');
    const finalState = OnboardingState.parse((finalRead.body.data as { state: unknown }).state);
    console.log(JSON.stringify({ approved: 'welcome->privacy', aAdvancedTo: aBody.data?.advanced_to ?? null, finalStep: finalState.current_step }));
    assert.equal(finalState.current_step, 'privacy');
    assert.notEqual(finalState.current_step, 'byok_optin', 'no transition may derive from the unexpected state');
  } finally {
    mutableFsp.readFile = originalReadFile;
    await teardown(workspace, server, httpServer);
  }
});

test('onboarding concurrency: stale approvals fail CONFLICT with zero mutation and the queue recovers', async () => {
  const { workspace, server, httpServer, owner } = await setup();
  try {
    const stateRaw = async (): Promise<string> => fsp.readFile(path.join(workspace, '.aide', 'onboarding-state.json'), 'utf8').catch(() => '');

    // Two independent approvals from the same N=welcome. A commits N->privacy.
    const aHeaders = await owner.approve('POST', '/api/onboarding/next', {}, 'task:same-n-a');
    const bHeaders = await owner.approve('POST', '/api/onboarding/next', {}, 'task:same-n-b');
    const aRun = await owner.request('/api/onboarding/next', { method: 'POST', headers: aHeaders, body: '{}' });
    assert.equal(aRun.status, 200);
    assert.equal(((await aRun.json()) as Envelope<{ advanced_to?: string }>).data?.advanced_to, 'privacy');

    const beforeStale = await stateRaw();
    const bRun = await owner.request('/api/onboarding/next', { method: 'POST', headers: bHeaders, body: '{}' });
    assert.equal(bRun.status, 409, 'same-N stale approval must fail');
    assert.equal(((await bRun.json()) as Envelope<unknown>).error?.code, 'CONFLICT');
    assert.equal(await stateRaw(), beforeStale, 'stale approval must not mutate state');

    // Failed transition must not poison the queue: a fresh approval still works.
    const fresh = await mutate(owner, 'POST', '/api/onboarding/next', {}, 'task:fresh-next');
    assert.equal(fresh.status, 200);
    assert.equal((fresh.body.data as { advanced_to: string }).advanced_to, 'byok_optin');

    // Stale complete: approved at (byok_optin,false); state advances first.
    const completeHeaders = await owner.approve('POST', '/api/onboarding/complete', undefined, 'task:stale-complete');
    const advance = await mutate(owner, 'POST', '/api/onboarding/next', {}, 'task:advance');
    assert.equal(advance.status, 200);
    assert.equal((advance.body.data as { advanced_to: string }).advanced_to, 'desktop_optin');
    const beforeComplete = await stateRaw();
    const staleComplete = await owner.request('/api/onboarding/complete', { method: 'POST', headers: completeHeaders });
    assert.equal(staleComplete.status, 409, 'stale complete must fail');
    assert.equal(await stateRaw(), beforeComplete, 'stale complete must not mutate state');
  } finally {
    await teardown(workspace, server, httpServer);
  }
});

test('onboarding service serialization: CAS, write-failure recovery, cross-service independence', async () => {
  const dirA = await fsp.mkdtemp(path.join(os.tmpdir(), 'aide-onboarding-svc-a-'));
  const dirB = await fsp.mkdtemp(path.join(os.tmpdir(), 'aide-onboarding-svc-b-'));
  const originalReadFile = fsModule.promises.readFile as unknown as (file: unknown, ...rest: unknown[]) => Promise<unknown>;
  const originalWriteFile = fsModule.promises.writeFile as unknown as (file: unknown, ...rest: unknown[]) => Promise<unknown>;
  const mutableFsp = fsModule.promises as unknown as {
    readFile: (file: unknown, ...rest: unknown[]) => Promise<unknown>;
    writeFile: (file: unknown, ...rest: unknown[]) => Promise<unknown>;
  };
  try {
    const serviceA = createOnboardingService({ workspace: dirA });
    const serviceB = createOnboardingService({ workspace: dirB });

    // Compare-and-commit is enforced by the service itself.
    const first = await serviceA.nextStep(undefined, { from_step: 'welcome' });
    assert.equal(first.advanced_to, 'privacy');
    await assert.rejects(() => serviceA.nextStep(undefined, { from_step: 'welcome' }), OnboardingConflictError);
    await assert.rejects(() => serviceA.complete({ from_step: 'welcome', walkthrough_complete: false }), OnboardingConflictError);
    const afterCas = await serviceA.getState();
    assert.equal(afterCas.current_step, 'privacy', 'conflicts leave durable state unchanged');

    // A write failure releases the queue and propagates.
    let failed = false;
    mutableFsp.writeFile = async (file: unknown, ...rest: unknown[]) => {
      if (!failed && String(file).endsWith('onboarding-state.json.partial')) { failed = true; throw new Error('simulated disk failure'); }
      return originalWriteFile(file, ...rest);
    };
    await assert.rejects(() => serviceA.nextStep(undefined, { from_step: 'privacy' }), /simulated disk failure/);
    mutableFsp.writeFile = originalWriteFile;
    const recovered = await serviceA.nextStep(undefined, { from_step: 'privacy' });
    assert.equal(recovered.advanced_to, 'byok_optin', 'queue recovers after a failed write');

    // Cross-service independence: B resolves while A is held inside its read.
    let reachedRead!: () => void;
    const readReached = new Promise<void>(resolve => { reachedRead = resolve; });
    let releaseRead!: () => void;
    const readGate = new Promise<void>(resolve => { releaseRead = resolve; });
    mutableFsp.readFile = async (file: unknown, ...rest: unknown[]) => {
      if (String(file).startsWith(dirA) && String(file).endsWith('onboarding-state.json')) { reachedRead(); await readGate; }
      return originalReadFile(file, ...rest);
    };
    const heldA = serviceA.nextStep(undefined, { from_step: 'byok_optin' });
    await readReached;
    const bResult = await serviceB.nextStep(undefined, { from_step: 'welcome' });
    assert.equal(bResult.advanced_to, 'privacy', 'a separate service instance is not blocked');
    releaseRead();
    const releasedA = await heldA;
    assert.equal(releasedA.advanced_to, 'desktop_optin');
    mutableFsp.readFile = originalReadFile;
  } finally {
    mutableFsp.readFile = originalReadFile;
    mutableFsp.writeFile = originalWriteFile;
    await fsp.rm(dirA, { recursive: true, force: true });
    await fsp.rm(dirB, { recursive: true, force: true });
  }
});

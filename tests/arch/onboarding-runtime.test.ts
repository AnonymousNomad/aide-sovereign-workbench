// tests/arch/onboarding-runtime.test.ts (cline/T4, 2026-09-02)
// PR A of aide-onboarding-walkthrough. End-to-end test: bring up a real
// server with the 4 onboarding routes, exercise the state machine, verify
// the state file is persisted atomically. ONE aggregated test() matching
// the runner-proven shape from worktree-isolation.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type http from 'node:http';
import * as fsModule from 'node:fs';
const fsp = fsModule.promises;
import os from 'node:os';
import path from 'node:path';
import { ArchServer } from '../../node/src/server.ts';
import { routesForOnboarding } from '../../node/src/routes/onboarding.ts';
import { OnboardingState } from '../../common/contracts/onboarding.ts';

type Envelope<T> = { ok: boolean; data?: T; error?: { code: string; message: string } };

async function get<T>(base: string, pathName: string): Promise<{ status: number; body: Envelope<T> }> {
  const response = await fetch(base + pathName);
  return { status: response.status, body: (await response.json()) as Envelope<T> };
}

async function post<T>(base: string, pathName: string, payload: unknown): Promise<{ status: number; body: Envelope<T> }> {
  const response = await fetch(base + pathName, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  return { status: response.status, body: (await response.json()) as Envelope<T> };
}

async function put<T>(base: string, pathName: string, payload: unknown): Promise<{ status: number; body: Envelope<T> }> {
  const response = await fetch(base + pathName, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  return { status: response.status, body: (await response.json()) as Envelope<T> };
}

test('onboarding walkthrough: state machine + atomic persistence (PR A)', async () => {
  const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), 'aide-onboarding-'));
  let httpServer: http.Server | undefined;
  let base = '';
  try {
    // 1. Spin up a real server with the 4 onboarding routes.
    const server = new ArchServer(workspace, path.join(workspace, 'arch-onboarding.log'));
    for (const route of routesForOnboarding(workspace)) server.route(route);
    httpServer = await server.listen(0);
    const address = httpServer.address();
    assert.ok(address && typeof address === 'object');
    base = 'http://127.0.0.1:' + (address as { port: number }).port;

    // 2. GET state returns the default state.
    const initial = await get<{ state: unknown }>(base, '/api/onboarding/state');
    assert.equal(initial.status, 200);
    assert.equal(initial.body.ok, true);
    const initialState = OnboardingState.parse((initial.body.data as { state: unknown }).state);
    assert.equal(initialState.current_step, 'welcome');
    assert.equal(initialState.walkthrough_complete, false);

    // 3. POST next with no body advances to privacy.
    const next1 = await post<{ state: unknown; advanced_to: string }>(base, '/api/onboarding/next', {});
    assert.equal(next1.status, 200);
    assert.equal((next1.body.data as { advanced_to: string }).advanced_to, 'privacy');

    // 4. POST next with user choices (welcome step) advances to byok_optin.
    const next2 = await post<{ state: unknown; advanced_to: string }>(base, '/api/onboarding/next', {
      name: 'Operator',
      role: 'developer',
      workbench: 'sovereign-coder'
    });
    assert.equal(next2.status, 200);
    assert.equal((next2.body.data as { advanced_to: string }).advanced_to, 'byok_optin');
    const state2 = OnboardingState.parse((next2.body.data as { state: unknown }).state);
    assert.equal(state2.user_choices.name, 'Operator');
    assert.equal(state2.user_choices.workbench, 'sovereign-coder');

    // 5. PUT state replaces the full state (operator override path).
    const override = { ...state2, current_step: 'desktop_optin' as const, walkthrough_complete: false };
    const put1 = await put<{ state: unknown }>(base, '/api/onboarding/state', override);
    assert.equal(put1.status, 200);
    const state3 = OnboardingState.parse((put1.body.data as { state: unknown }).state);
    assert.equal(state3.current_step, 'desktop_optin');

    // 6. POST next advances to system_map.
    const next3 = await post(base, '/api/onboarding/next', {});
    assert.equal(next3.status, 200);
    assert.equal((next3.body.data as { advanced_to: string }).advanced_to, 'system_map');

    // 7. POST complete sets walkthrough_complete = true.
    const complete = await post<{ state: unknown; complete: boolean }>(base, '/api/onboarding/complete', {});
    assert.equal(complete.status, 200);
    assert.equal((complete.body.data as { complete: boolean }).complete, true);
    const finalState = OnboardingState.parse((complete.body.data as { state: unknown }).state);
    assert.equal(finalState.walkthrough_complete, true);
    assert.equal(finalState.current_step, 'system_map');

    // 8. Atomic persistence: state file exists, parses, matches the final state.
    const stateFile = path.join(workspace, '.aide', 'onboarding-state.json');
    const raw = await fsp.readFile(stateFile, 'utf8');
    const persisted = OnboardingState.parse(JSON.parse(raw));
    assert.equal(persisted.walkthrough_complete, true);

    // 9. No .partial file left over (atomic rename worked).
    await assert.rejects(() => fsp.access(stateFile + '.partial'), /ENOENT/);

    // 10. Reject: empty state PUT returns 400 (zod strict).
    const badPut = await put(base, '/api/onboarding/state', {});
    assert.equal(badPut.status, 400);
  } finally {
    if (httpServer) {
      await new Promise<void>((resolve) => {
        (httpServer as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
        httpServer!.close(() => resolve());
      });
    }
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        await fsp.rm(workspace, { recursive: true, force: true });
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code ?? '';
        if (!['EBUSY', 'ENOTEMPTY', 'EPERM'].includes(code)) throw error;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }
});


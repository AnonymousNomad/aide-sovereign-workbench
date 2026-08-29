import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ModelRouter, RouterError } from '../../node/src/services/model-router.ts';
import type { ModelRuntime } from '../../node/src/services/model-runtime.ts';
import type { ProviderService } from '../../node/src/services/providers.ts';

interface FakeEntry {
  id: string;
  name: string;
  status: string;
  roles: string[];
  endpoint: string;
  model: string;
  context_tokens: number;
}

class FakeRuntime {
  entries: FakeEntry[] = [];
  ready = new Set<string>();

  status(): { runtime: boolean; models: Array<Record<string, unknown>> } {
    return {
      runtime: true,
      models: this.entries.map(entry => ({
        id: entry.id,
        name: entry.name,
        status: this.ready.has(entry.id) ? 'running' : entry.status,
        endpoint: entry.endpoint
      }))
    };
  }

  list(): FakeEntry[] {
    return this.entries;
  }

  async verifyEndpointModel(id: string): Promise<{ ready: boolean }> {
    return { ready: this.ready.has(id) };
  }

  servedWindow: number | null = null;

  // Mirrors ModelRuntime.getEffectiveBudget: null until a served window has
  // been probed, otherwise effective window minus the completion reserve.
  getEffectiveBudget(id: string, reserveTokens: number): number | null {
    const entry = this.entries.find(candidate => candidate.id === id);
    if (entry === undefined || !this.ready.has(id)) return null;
    const window = this.servedWindow ?? entry.context_tokens;
    const budget = Math.floor(window - reserveTokens);
    return budget > 0 ? budget : null;
  }

  async chat(id: string, messages: Array<{ role: string; content: string }>): Promise<{ text: string; modelId: string; timingMs: number }> {
    return { text: `local:${id}:${messages.length}`, modelId: id, timingMs: 1 };
  }

  async chatStream(id: string, messages: Array<{ role: string; content: string }>, onDelta: (delta: string) => void): Promise<void> {
    onDelta(`stream:${id}:${messages.length}`);
  }
}

class FakeProviders {
  connected = new Set<string>();

  async list(): Promise<Array<{ id: string; status: string }>> {
    return [...this.connected].map(id => ({ id, status: 'connected' }));
  }

  async chat(providerId: string, model: string, messages: Array<{ role: string; content: string }>): Promise<{ text: string; modelId: string; timingMs: number }> {
    return { text: `cloud:${providerId}:${model}:${messages.length}`, modelId: `${providerId}:${model}`, timingMs: 2 };
  }
}

function makeRouter(runtime: FakeRuntime, providers: FakeProviders): ModelRouter {
  return new ModelRouter(runtime as unknown as ModelRuntime, providers as unknown as ProviderService);
}

function entry(id: string, status: string, roles: string[], contextTokens = 2048): FakeEntry {
  return { id, name: `Model ${id}`, status, roles, endpoint: `http://127.0.0.1:8080/v1`, model: `${id}.gguf`, context_tokens: contextTokens };
}

test('routes() lists local entries and only connected cloud providers', async () => {
  const runtime = new FakeRuntime();
  runtime.entries = [entry('a', 'ready', ['chat']), entry('b', 'pending', ['chat'])];
  const providers = new FakeProviders();
  providers.connected.add('openai');
  const router = makeRouter(runtime, providers);
  const routes = await router.routes();
  const local = routes.filter(route => route.providerType === 'local');
  assert.equal(local.length, 2);
  assert.equal(local[0]!.id, 'local:a');
  assert.equal(local[0]!.chatTemplate, 'gguf-metadata');
  assert.equal(local[0]!.contextLength, 2048);
  const cloud = routes.filter(route => route.providerType === 'cloud');
  assert.ok(cloud.some(route => route.id === 'cloud:openai:gpt-4o-mini'), 'connected provider exposes its model routes');
  assert.ok(cloud.some(route => route.id.startsWith('cloud:anthropic:')), 'full catalog is listed for the picker');
  assert.ok(cloud.filter(route => route.id.startsWith('cloud:anthropic:')).every(route => route.status === 'down'), 'disconnected providers are marked down, not ready');
});

test('unstarted local models are unverified, not down', async () => {
  const runtime = new FakeRuntime();
  runtime.entries = [entry('a', 'ready', ['chat'])];
  const router = makeRouter(runtime, new FakeProviders());
  const routes = await router.routes();
  const local = routes.find(route => route.id === 'local:a')!;
  assert.equal(local.status, 'unverified', 'declared ready but not running');
});

test('routeForRole returns the first ready model and reports a fallback when the first is down', async () => {
  const runtime = new FakeRuntime();
  runtime.entries = [entry('a', 'ready', ['chat']), entry('b', 'ready', ['chat'])];
  runtime.ready.add('b');
  const router = makeRouter(runtime, new FakeProviders());
  const selection = await router.routeForRole('chat');
  assert.equal(selection.modelId, 'local:b', 'a is down so b answers');
  assert.equal(selection.fellBack?.from, 'local:a');
  assert.equal(selection.fellBack?.to, 'local:b');
  assert.equal(selection.fellBack?.reason, 'down');
});

test('routeForRole throws with guidance when nothing is ready', async () => {
  const runtime = new FakeRuntime();
  runtime.entries = [entry('a', 'ready', ['chat'])];
  const router = makeRouter(runtime, new FakeProviders());
  await assert.rejects(
    () => router.routeForRole('chat'),
    (error: unknown) => error instanceof RouterError && error.reason === 'down' && error.message.includes('start this model')
  );
});

test('routeForId falls back to the role chain with an explicit from/to', async () => {
  const runtime = new FakeRuntime();
  runtime.entries = [entry('a', 'ready', ['chat']), entry('b', 'ready', ['chat'])];
  runtime.ready.add('b');
  const router = makeRouter(runtime, new FakeProviders());
  const selection = await router.routeForId('local:a');
  assert.equal(selection.modelId, 'local:b');
  assert.equal(selection.fellBack?.from, 'local:a');
  assert.equal(selection.fellBack?.reason, 'down');
});

test('routeForId resolves a ready explicit binding without fallback', async () => {
  const runtime = new FakeRuntime();
  runtime.entries = [entry('a', 'ready', ['chat'])];
  runtime.ready.add('a');
  const router = makeRouter(runtime, new FakeProviders());
  const selection = await router.routeForId('local:a');
  assert.equal(selection.modelId, 'local:a');
  assert.equal(selection.fellBack, undefined);
});

test('chat fits history to the route context and reports the estimate', async () => {
  const runtime = new FakeRuntime();
  runtime.entries = [entry('a', 'ready', ['chat'], 1024)];
  runtime.ready.add('a');
  const router = makeRouter(runtime, new FakeProviders());
  const long = 'x'.repeat(200);
  const result = await router.chat('local:a', [
    { role: 'user', content: 'q1' },
    { role: 'assistant', content: 'a1' },
    { role: 'user', content: long }
  ]);
  assert.ok(result.text.startsWith('local:a:'), 'executed against the local runtime');
  assert.equal(result.modelId, 'local:a');
  assert.ok(result.usedApprox > 0, 'context estimate is reported');
});

test('chat routes cloud requests to the provider executor', async () => {
  const runtime = new FakeRuntime();
  runtime.entries = [entry('a', 'ready', ['chat'])];
  const providers = new FakeProviders();
  providers.connected.add('openai');
  const router = makeRouter(runtime, providers);
  const result = await router.chat('cloud:openai:gpt-4o-mini', [{ role: 'user', content: 'hi' }]);
  assert.ok(result.text.startsWith('cloud:openai:gpt-4o-mini:'));
  assert.equal(result.modelId, 'cloud:openai:gpt-4o-mini');
});

test('chatStream emits deltas and reports the answering model on fallback', async () => {
  const runtime = new FakeRuntime();
  runtime.entries = [entry('a', 'ready', ['chat']), entry('b', 'ready', ['chat'])];
  runtime.ready.add('b');
  const router = makeRouter(runtime, new FakeProviders());
  const deltas: string[] = [];
  const result = await router.chatStream('local:a', [{ role: 'user', content: 'hi' }], delta => deltas.push(delta), new AbortController().signal);
  assert.deepEqual(deltas, ['stream:b:1'], 'streamed from the fallback model');
  assert.equal(result.modelId, 'local:b');
test('chat fits history against the effective served window, not the declared context', async () => {
  // Declared 8192, engine serves 1024 (clamped n_ctx). Without effective
  // fitting the router would send the full history and the engine would
  // reject it with HTTP 400 (audit failures C1/D1, 2026-08-28).
  const runtime = new FakeRuntime();
  runtime.entries = [entry('a', 'ready', ['chat'], 8192)];
  runtime.ready.add('a');
  runtime.servedWindow = 1024;
  const router = makeRouter(runtime, new FakeProviders());
  const result = await router.chat('local:a', [
    { role: 'user', content: 'q1' },
    { role: 'assistant', content: 'y'.repeat(30000) },
    { role: 'user', content: 'keep this question' }
  ]);
  assert.equal(result.modelId, 'local:a');
  assert.ok(result.usedApprox <= (1024 - 512) + 8, 'history fit inside the effective window budget');
});

test('overflowTrimmed is set when the newest turn alone exceeds the budget', async () => {
  const runtime = new FakeRuntime();
  runtime.entries = [entry('a', 'ready', ['chat'], 8192)];
  runtime.ready.add('a');
  runtime.servedWindow = 1024;
  const router = makeRouter(runtime, new FakeProviders());
  const result = await router.chat('local:a', [
    { role: 'user', content: 'z'.repeat(12000) }
  ]);
  assert.equal(result.overflowTrimmed, true, 'oversized newest turn is head-trimmed, not hard-failed');
  assert.ok(result.usedApprox <= 512 + 8);
});

test('declared context is used when no served window has been probed', async () => {
  const runtime = new FakeRuntime();
  runtime.entries = [entry('a', 'ready', ['chat'], 2048)];
  runtime.ready.add('a');
  const router = makeRouter(runtime, new FakeProviders());
  const result = await router.chat('local:a', [{ role: 'user', content: 'hi' }]);
  assert.equal(result.overflowTrimmed, undefined);
  assert.ok(result.text.startsWith('local:a:'));
});
});

test('chat throws RouterError down when the route is unknown', async () => {
  const runtime = new FakeRuntime();
  const router = makeRouter(runtime, new FakeProviders());
  await assert.rejects(
    () => router.chat('local:nope', [{ role: 'user', content: 'hi' }]),
    (error: unknown) => error instanceof RouterError && error.reason === 'down'
  );
});
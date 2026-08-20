import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { BUILTIN_PROVIDERS, ProviderService, ProviderError, type ProviderServiceOptions } from '../../node/src/services/providers.ts';
import { CredentialStore, type CryptService } from '../../node/src/services/credentials.ts';

class FakeCrypt implements CryptService {
  readonly kind = 'fake';
  async available(): Promise<boolean> {
    return true;
  }
  async protect(plaintext: string): Promise<string> {
    return `enc:${Buffer.from(plaintext, 'utf8').toString('base64')}`;
  }
  async unprotect(blobB64: string): Promise<string> {
    if (!blobB64.startsWith('enc:')) throw new Error('bad blob');
    return Buffer.from(blobB64.slice(4), 'base64').toString('utf8');
  }
}

function makeService(dir: string, fetchFn: typeof fetch): { service: ProviderService; logs: string[] } {
  const logs: string[] = [];
  const options: ProviderServiceOptions = {
    credentials: new CredentialStore(dir, new FakeCrypt()),
    fetchFn,
    logger: { info: (message: string) => logs.push(message) }
  };
  return { service: new ProviderService(dir, options), logs };
}

test('built-in provider registry is well-formed', () => {
  assert.equal(BUILTIN_PROVIDERS.length, 6);
  const ids = new Set<string>();
  for (const provider of BUILTIN_PROVIDERS) {
    assert.ok(!ids.has(provider.id), `duplicate provider id ${provider.id}`);
    ids.add(provider.id);
    assert.ok(provider.egressHost.length > 0, `${provider.id} needs an egress host`);
    assert.ok(provider.models.length > 0, `${provider.id} needs model ids`);
    try {
      const host = new URL(provider.baseUrl).hostname;
      assert.equal(host, provider.egressHost, `${provider.id} baseUrl host must match egressHost`);
    } catch {
      assert.fail(`${provider.id} baseUrl must be a valid URL`);
    }
  }
});

test('list reports not_connected before any credential exists', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-prov-'));
  try {
    const { service } = makeService(dir, (() => Promise.resolve(new Response(null, { status: 200 }))) as typeof fetch);
    const providers = await service.list();
    assert.equal(providers.length, 6);
    assert.ok(providers.every(provider => provider.status === 'not_connected'));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('connect probes with a successful response -> connected and persists the key', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-prov-'));
  try {
    const calls: string[] = [];
    const fetchFn = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push(String(url));
      const headers = new Headers(init?.headers);
      assert.equal(headers.get('authorization'), 'Bearer sk-test');
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    const { service } = makeService(dir, fetchFn);
    const result = await service.connect({ providerId: 'openai', key: 'sk-test' });
    assert.equal(result.status, 'connected');
    assert.ok(calls[0]!.includes('/chat/completions'), `probe must hit the chat completions endpoint: ${calls[0]}`);
    const providers = await service.list();
    assert.equal(providers.find(provider => provider.id === 'openai')?.status, 'connected');
    assert.ok(await new CredentialStore(dir, new FakeCrypt()).has('openai'));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('connect maps 401 to invalid_key and 403 to invalid_key', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-prov-'));
  try {
    const service = makeService(dir, (() => Promise.resolve(new Response(null, { status: 401 }))) as typeof fetch).service;
    const result = await service.connect({ providerId: 'groq', key: 'bad' });
    assert.equal(result.status, 'invalid_key');
    const provider = (await service.list()).find(entry => entry.id === 'groq');
    assert.equal(provider?.status, 'invalid_key', 'list must show the cached probe result');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('connect maps timeouts and network errors to unreachable', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-prov-'));
  try {
    const service = makeService(dir, (() => Promise.reject(new DOMException('aborted', 'AbortError'))) as typeof fetch).service;
    const result = await service.connect({ providerId: 'anthropic', key: 'key' });
    assert.equal(result.status, 'unreachable');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('anthropic probes the /v1/messages shape with x-api-key', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-prov-'));
  try {
    let url = '';
    let headers: Headers | undefined;
    let body = '';
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      url = String(input);
      headers = new Headers(init?.headers);
      body = String(init?.body);
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    const { service } = makeService(dir, fetchFn);
    await service.connect({ providerId: 'anthropic', key: 'x-ant-1' });
    assert.ok(url.endsWith('/messages'), `anthropic probe must hit /messages: ${url}`);
    assert.equal(headers?.get('x-api-key'), 'x-ant-1');
    assert.equal(headers?.get('anthropic-version'), '2023-06-01');
    assert.ok(body.includes('"max_tokens":1'));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('a user-added baseUrl requires explicit host approval', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-prov-'));
  try {
    const { service } = makeService(dir, (() => Promise.resolve(new Response(null, { status: 200 }))) as typeof fetch);
    await assert.rejects(
      () => service.connect({ providerId: 'openai', key: 'k', baseUrl: 'https://my-relay.example/v1' }),
      error => error instanceof ProviderError && error.code === 'FORBIDDEN' && error.message.includes('approve')
    );
    const result = await service.connect({ providerId: 'openai', key: 'k', baseUrl: 'https://my-relay.example/v1', approveHost: true });
    assert.equal(result.status, 'connected');
    const allowlist = JSON.parse(await fs.readFile(path.join(dir, '.aide', 'provider-hosts.json'), 'utf8')) as { hosts: string[] };
    assert.ok(allowlist.hosts.includes('my-relay.example'), 'approved host must persist');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('disconnect removes the credential and resets status', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-prov-'));
  try {
    const { service } = makeService(dir, (() => Promise.resolve(new Response(null, { status: 200 }))) as typeof fetch);
    await service.connect({ providerId: 'mistral', key: 'k' });
    await service.disconnect('mistral');
    const provider = (await service.list()).find(entry => entry.id === 'mistral');
    assert.equal(provider?.status, 'not_connected');
    assert.equal(await new CredentialStore(dir, new FakeCrypt()).has('mistral'), false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('unknown provider id is rejected', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-prov-'));
  try {
    const { service } = makeService(dir, (() => Promise.resolve(new Response(null, { status: 200 }))) as typeof fetch);
    await assert.rejects(() => service.connect({ providerId: 'nope', key: 'k' }), error => error instanceof ProviderError && error.code === 'NOT_READY');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
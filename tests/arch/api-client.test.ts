import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { ApiError, api } from '../../browser/src/services/api.ts';
import { egressFetch } from '../../browser/src/services/egress.ts';
import { ok, fail } from '../../common/errors.ts';
import { healthFixtures, fileReadFixtures, fileWriteFixtures, searchFixtures, searchReplaceFixtures, sessionFixtures, lspFixtures } from '../fixtures/index.ts';

function mockFetch(payload: unknown, status = 200): { seen: { url: string; method: string }[] } {
  const seen: { url: string; method: string }[] = [];
  mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), method: init?.method ?? 'GET' });
    return new Response(JSON.stringify(payload), { status });
  });
  return { seen };
}

test('offline guard refuses non-local urls', async () => {
  await assert.rejects(egressFetch('https://evil.example/x'), /offline guard/);
  await assert.rejects(egressFetch('file:///C:/Windows/win.ini'), /offline guard/);
});

test('api.health returns parsed data from an ok envelope', async () => {
  const payload = healthFixtures.healthy;
  mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(ok(payload)), { status: 200 }));
  const health = await api.health();
  assert.equal(health.version, 'test');
  assert.equal(health.freeMemoryMB, 5120);
  mock.restoreAll();
});

test('api throws ApiError with code and message on an error envelope', async () => {
  mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(fail('NOT_READY', 'still warming up')), { status: 409 }));
  await assert.rejects(api.health(), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, 'NOT_READY');
    assert.equal(error.message, 'still warming up');
    return true;
  });
  mock.restoreAll();
});

test('api throws ApiError BAD_RESPONSE when the envelope does not match the contract', async () => {
  mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(ok({ garbage: true })), { status: 200 }));
  await assert.rejects(api.health(), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, 'BAD_RESPONSE');
    return true;
  });
  mock.restoreAll();
});

test('api throws ApiError BAD_RESPONSE on a non-JSON daemon response', async () => {
  mock.method(globalThis, 'fetch', async () => new Response('internal server error', { status: 500 }));
  await assert.rejects(api.health(), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, 'BAD_RESPONSE');
    return true;
  });
  mock.restoreAll();
});

test('api.fileRead serializes the query and validates the response', async () => {
  const { seen } = mockFetch(ok(fileReadFixtures.readNormal));
  const file = await api.fileRead('src/a.ts');
  assert.equal(file.content, 'export const a = 1;\n');
  assert.equal(seen[0]?.url, '/api/file?path=src%2Fa.ts');
  mock.restoreAll();
});

test('api.fileRead surfaces the too_large flag from the fixture', async () => {
  mockFetch(ok(fileReadFixtures.readTooLarge));
  const file = await api.fileRead('big.bin');
  assert.equal(file.too_large, true);
  assert.equal(file.content, null);
  mock.restoreAll();
});

test('api.fileWrite POSTs to /api/file/write (route path, not /api/file)', async () => {
  const { seen } = mockFetch(ok(fileWriteFixtures.writeNormal));
  await api.fileWrite('a.ts', 'export const a = 1;\n');
  assert.equal(seen[0]?.method, 'POST');
  assert.equal(seen[0]?.url, '/api/file/write');
  mock.restoreAll();
});

test('api.search serializes flags as 0/1 and validates the response', async () => {
  const { seen } = mockFetch(ok(searchFixtures.withMatches));
  const result = await api.search('monaco', { icase: true, regex: false });
  assert.equal(result.total, 3);
  assert.equal(result.results.length, 2);
  assert.equal(seen[0]?.url, '/api/search?q=monaco&regex=0&icase=1');
  mock.restoreAll();
});

test('api.search accepts an empty result set from the fixture', async () => {
  mockFetch(ok(searchFixtures.noMatches));
  const result = await api.search('nothing-here');
  assert.equal(result.total, 0);
  assert.deepEqual(result.results, []);
  mock.restoreAll();
});

test('api.searchReplace POSTs with approved and validates the response', async () => {
  const { seen } = mockFetch(ok(searchReplaceFixtures.replaced));
  const result = await api.searchReplace({ query: 'monaco', replacement: 'monaco-editor' });
  assert.equal(result.files_changed, 2);
  assert.equal(result.occurrences, 3);
  assert.equal(seen[0]?.method, 'POST');
  assert.equal(seen[0]?.url, '/api/search/replace');
  mock.restoreAll();
});

test('api.sessionPut uses PUT (route is registered as PUT, not POST)', async () => {
  const { seen } = mockFetch(ok(sessionFixtures.withSplits));
  const result = await api.sessionPut(sessionFixtures.withSplits);
  assert.equal(result.splits?.join(','), 'g1,g2');
  assert.equal(seen[0]?.method, 'PUT');
  assert.equal(seen[0]?.url, '/api/session');
  mock.restoreAll();
});

test('api.sessionGet validates the empty session fixture', async () => {
  mockFetch(ok(sessionFixtures.empty));
  const result = await api.sessionGet();
  assert.deepEqual(result.tabs, []);
  assert.deepEqual(result.splits, ['g1']);
  mock.restoreAll();
});

test('api.lspStatus GETs /api/lsp/status and validates the fixture', async () => {
  const { seen } = mockFetch(ok(lspFixtures.statusAvailable));
  const result = await api.lspStatus();
  assert.equal(result.servers.length, 2);
  assert.equal(seen[0]?.method, 'GET');
  assert.equal(seen[0]?.url, '/api/lsp/status');
  mock.restoreAll();
});

test('api.lspStart POSTs the language id and validates the fixture', async () => {
  const { seen } = mockFetch(ok(lspFixtures.startRunning));
  const result = await api.lspStart('typescript');
  assert.equal(result.status, 'running');
  assert.equal(seen[0]?.method, 'POST');
  assert.equal(seen[0]?.url, '/api/lsp/start');
  mock.restoreAll();
});

test('api.lspOpen POSTs uri, languageId and text and validates the fixture', async () => {
  const { seen } = mockFetch(ok(lspFixtures.openOpened));
  const result = await api.lspOpen('file:///broken.ts', 'typescript', 'export const x = 1;');
  assert.equal(result.opened, true);
  assert.equal(seen[0]?.method, 'POST');
  assert.equal(seen[0]?.url, '/api/lsp/open');
  mock.restoreAll();
});

test('api.lspClose POSTs the uri and validates the fixture', async () => {
  const { seen } = mockFetch(ok(lspFixtures.closeClosed));
  const result = await api.lspClose('file:///broken.ts');
  assert.equal(result.closed, true);
  assert.equal(seen[0]?.method, 'POST');
  assert.equal(seen[0]?.url, '/api/lsp/close');
  mock.restoreAll();
});

test('api.lspChange POSTs uri, text and version and validates the fixture', async () => {
  const { seen } = mockFetch(ok(lspFixtures.changeChanged));
  const result = await api.lspChange('file:///broken.ts', 'export const x = 1;', 2);
  assert.equal(result.changed, true);
  assert.equal(seen[0]?.method, 'POST');
  assert.equal(seen[0]?.url, '/api/lsp/change');
  mock.restoreAll();
});
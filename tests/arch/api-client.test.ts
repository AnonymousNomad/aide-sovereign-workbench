import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { ApiError, api } from '../../browser/src/services/api.ts';
import { egressFetch } from '../../browser/src/services/egress.ts';
import { ok, fail } from '../../common/errors.ts';

test('offline guard refuses non-local urls', async () => {
  await assert.rejects(egressFetch('https://evil.example/x'), /offline guard/);
  await assert.rejects(egressFetch('file:///C:/Windows/win.ini'), /offline guard/);
});

test('api.health returns parsed data from an ok envelope', async () => {
  const payload = { version: 'test', uptimeMs: 10, workspace: 'E:\\ws', freeMemoryMB: 1000 };
  mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(ok(payload)), { status: 200 }));
  const health = await api.health();
  assert.equal(health.version, 'test');
  assert.equal(health.freeMemoryMB, 1000);
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
  const seen: string[] = [];
  mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
    seen.push(String(url));
    return new Response(JSON.stringify(ok({ path: 'hello.txt', content: 'hi\n', too_large: false, size: 3 })), { status: 200 });
  });
  const file = await api.fileRead('hello.txt');
  assert.equal(file.content, 'hi\n');
  assert.equal(seen[0], '/api/file?path=hello.txt');
  mock.restoreAll();
});
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeJsonRpc, JsonRpcDecoder } from '../../node/src/services/jsonrpc.ts';

test('encode + decode round trip preserves the message', () => {
  const message = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} };
  const decoder = new JsonRpcDecoder();
  const decoded = decoder.push(encodeJsonRpc(message));
  assert.equal(decoded.length, 1);
  assert.deepEqual(decoded[0], message);
});

test('utf-8 bodies are byte-length framed and round trip exactly', () => {
  const message = { jsonrpc: '2.0', method: 'textDocument/didOpen', params: { text: 'const café = "中文" — ✓' } };
  const decoder = new JsonRpcDecoder();
  const decoded = decoder.push(encodeJsonRpc(message));
  assert.equal(decoded.length, 1);
  assert.equal((decoded[0] as { params: { text: string } }).params.text, 'const café = "中文" — ✓');
});

test('one-byte chunked delivery yields exactly one message', () => {
  const message = { jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri: 'file:///a.ts', diagnostics: [] } };
  const framed = encodeJsonRpc(message);
  const decoder = new JsonRpcDecoder();
  const decoded: unknown[] = [];
  for (let i = 0; i < framed.length; i += 1) {
    decoded.push(...decoder.push(framed.subarray(i, i + 1)));
  }
  assert.equal(decoded.length, 1);
  assert.deepEqual(decoded[0], message);
});

test('splits in the middle of the header and the middle of a multi-byte char both survive', () => {
  const first = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} };
  const second = { jsonrpc: '2.0', id: 2, method: 'shutdown', params: null };
  const a = encodeJsonRpc(first);
  const b = encodeJsonRpc(second);
  const stream = Buffer.concat([a, b]);
  const decoder = new JsonRpcDecoder();
  const decoded: unknown[] = [];
  for (let i = 0; i < stream.length; i += 7) {
    decoded.push(...decoder.push(stream.subarray(i, Math.min(i + 7, stream.length))));
  }
  assert.deepEqual(decoded, [first, second]);
});

test('two frames in a single push decode as two messages', () => {
  const decoder = new JsonRpcDecoder();
  const messages = decoder.push(Buffer.concat([encodeJsonRpc({ jsonrpc: '2.0', id: 1, method: 'a', params: {} }), encodeJsonRpc({ jsonrpc: '2.0', id: 2, method: 'b', params: {} })]));
  assert.equal(messages.length, 2);
});

test('partial frame at the end waits for more data', () => {
  const framed = encodeJsonRpc({ jsonrpc: '2.0', method: 'initialized', params: {} });
  const decoder = new JsonRpcDecoder();
  const partial = framed.subarray(0, framed.length - 3);
  assert.equal(decoder.push(partial).length, 0);
  const messages = decoder.push(framed.subarray(framed.length - 3));
  assert.equal(messages.length, 1);
});

test('garbage frame without Content-Length is skipped, the next valid frame still parses', () => {
  const garbage = Buffer.from('NOT-A-FRAME\r\n\r\n{broken', 'utf8');
  const good = encodeJsonRpc({ jsonrpc: '2.0', id: 9, method: 'ping', params: {} });
  const decoder = new JsonRpcDecoder();
  const messages = decoder.push(Buffer.concat([garbage, good]));
  assert.equal(messages.length, 1);
  assert.equal((messages[0] as { id: number }).id, 9);
});

test('frame declaring an absurd length is skipped, framing continues', () => {
  const absurd = Buffer.from('Content-Length: 99999999999\r\n\r\nx', 'utf8');
  const good = encodeJsonRpc({ jsonrpc: '2.0', id: 3, method: 'ping', params: {} });
  const decoder = new JsonRpcDecoder();
  const messages = decoder.push(Buffer.concat([absurd, good]));
  assert.equal(messages.length, 1);
  assert.equal((messages[0] as { id: number }).id, 3);
});

test('malformed json body is dropped without killing the stream', () => {
  const malformed = Buffer.from('Content-Length: 9\r\n\r\n{"broken"', 'utf8');
  const good = encodeJsonRpc({ jsonrpc: '2.0', id: 4, method: 'ping', params: {} });
  const decoder = new JsonRpcDecoder();
  const messages = decoder.push(Buffer.concat([malformed, good]));
  assert.equal(messages.length, 1);
  assert.equal((messages[0] as { id: number }).id, 4);
});

test('header longer than the guard without a terminator throws', () => {
  const decoder = new JsonRpcDecoder();
  assert.throws(() => decoder.push(Buffer.from('Content-Length: 1'.padEnd(70000, 'x'))), /header exceeds limit/);
});
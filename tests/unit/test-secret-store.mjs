import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSecretStore } from '../../node/src/services/secret-store.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aide-secret-'));
const secretsPath = path.join(tmp, 'secrets.json');

test('secret store: plaintext fallback is opt-in only (protect failure without env throws)', () => {
  process.env.AIDE_ALLOW_PLAINTEXT_SECRETS = '0';
  const store = createSecretStore({
    secretsPath,
    protect: () => { throw new Error('no dpapi'); },
    unprotect: () => { throw new Error('no dpapi'); },
  });
  assert.throws(() => store.setKey('p1', 'sk-x'), /plaintext forbidden|unavailable/);
});

test('secret store: injected protect/unprotect round-trips and never stores plaintext', () => {
  const store = createSecretStore({
    secretsPath,
    protect: plain => `cipher:${Buffer.from(plain, 'utf8').reverse().toString('hex')}`,
    unprotect: cipher => Buffer.from(String(cipher).replace(/^cipher:/, ''), 'hex').reverse().toString('utf8'),
  });
  store.setKey('p1', 'sk-roundtrip-abc');
  assert.equal(store.getKey('p1'), 'sk-roundtrip-abc');
  assert.deepEqual(store.listProviderIds(), ['p1']);
  const file = fs.readFileSync(secretsPath, 'utf8');
  assert.doesNotMatch(file, /sk-roundtrip-abc/, 'plaintext never written to disk');
  assert.match(file, /cipher:/, 'protected form written to disk');
  assert.equal(store.deleteKey('p1'), true, 'delete reports success');
  assert.equal(store.getKey('p1'), null, 'key gone after delete');
});

test('secret store: REAL DPAPI round-trip on Windows', { skip: process.platform !== 'win32' ? 'DPAPI requires Windows' : false }, () => {
  const store = createSecretStore({ secretsPath: path.join(tmp, 'dpapi.json') });
  store.setKey('win', 'sk-dpapi-real-512');
  assert.equal(store.getKey('win'), 'sk-dpapi-real-512', 'DPAPI protect+unprotect round-trips across separate powershell invocations');
  const file = fs.readFileSync(path.join(tmp, 'dpapi.json'), 'utf8');
  assert.doesNotMatch(file, /sk-dpapi-real-512/, 'DPAPI ciphertext never exposes the key');
  assert.match(file, /AQAAANCMnd8/, 'stored value is a DPAPI blob (header present)');
  assert.equal(store.deleteKey('win'), true);
  assert.equal(store.getKey('win'), null);
});

test('secret store: missing file reads as empty; delete of unknown id reports false', () => {
  const store = createSecretStore({ secretsPath: path.join(tmp, 'empty.json') });
  assert.equal(store.getKey('ghost'), null);
  assert.equal(store.deleteKey('ghost'), false);
});
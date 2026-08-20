import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import { CredentialStore, type CryptService } from '../../node/src/services/credentials.ts';
import { scrubKey } from '../../node/src/services/credentials.ts';

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

function hasPowershell(): Promise<boolean> {
  return new Promise(resolve => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'exit 0'], { windowsHide: true });
    child.on('error', () => resolve(false));
    child.on('close', code => resolve(code === 0));
  });
}

test('scrubKey hides the key from text', () => {
  assert.equal(scrubKey('authorization: Bearer sk-abc123 boom', 'sk-abc123'), 'authorization: Bearer [redacted] boom');
  assert.equal(scrubKey('no key here', 'sk-abc123'), 'no key here');
  assert.equal(scrubKey('plain', undefined), 'plain');
});

test('CredentialStore round-trips keys through the crypt service and persists', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-cred-'));
  try {
    const store = new CredentialStore(dir, new FakeCrypt());
    assert.equal(await store.has('openai'), false);
    await store.set('openai', 'sk-secret');
    await store.set('anthropic', 'x-key-2');
    assert.equal(await store.has('openai'), true);
    assert.equal(await store.get('openai'), 'sk-secret');
    assert.deepEqual((await store.ids()).sort(), ['anthropic', 'openai']);

    const reloaded = new CredentialStore(dir, new FakeCrypt());
    assert.equal(await reloaded.get('openai'), 'sk-secret');
    assert.equal(await reloaded.get('anthropic'), 'x-key-2');

    await reloaded.delete('openai');
    assert.equal(await reloaded.get('openai'), undefined);
    assert.deepEqual(await reloaded.ids(), ['anthropic']);
    const file = JSON.parse(await fs.readFile(path.join(dir, '.aide', 'credentials.dpapi'), 'utf8')) as { providers: Record<string, string> };
    assert.ok(!JSON.stringify(file).includes('sk-secret'), 'plaintext must never be written to disk');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('PowerShellCrypt protects/unprotects with real DPAPI (CurrentUser)', { skip: process.platform !== 'win32' }, async () => {
  if (!(await hasPowershell())) return;
  const { PowerShellCrypt } = await import('../../node/src/services/credentials.ts');
  const crypt = new PowerShellCrypt();
  assert.equal(await crypt.available(), true);
  const blob = await crypt.protect('aide-credential-test');
  assert.ok(blob.length > 0);
  assert.ok(!blob.includes('aide-credential-test'), 'encrypted blob must not contain the plaintext');
  assert.equal(await crypt.unprotect(blob), 'aide-credential-test');
});
// tests/unit/test-handoff-containment.mjs
// Pre-Wave-3J security repair: Handoff bundle storage must fail closed when
// effective filesystem containment or safe bundle-object identity cannot be
// proven. Lexical containment alone is insufficient.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createHandoffService } from '../../node/src/services/handoff-service.mjs';

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-contain-'));
  const ws = path.join(root, 'ws');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(ws, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  return { root, ws, outside };
}

function loopWith(transcript = [{ role: 'user', content: 'refactor the parser', ts: null }]) {
  return {
    list: () => [{ session_id: 's-1' }],
    transcriptOf: id => {
      if (id === 's-1') return transcript;
      throw new Error('no such session');
    }
  };
}

const handoffDir = ws => path.join(ws, '.aide', 'handoff');
const importedDir = ws => path.join(handoffDir(ws), 'imported');
const isValidation = error => error?.code === 'VALIDATION';

function validBundle() {
  return {
    version: 1, id: 'probe-bundle', created_at: new Date().toISOString(), generator: 'probe',
    tier: 'brief',
    brief: { task: 'probe task', decisions: [], open_questions: [], constraints: [] },
    distillation: 'auto'
  };
}

function sentinelJson() {
  return JSON.stringify({
    version: 1, id: 'outside-sentinel', created_at: 'sentinel', generator: 'outside',
    tier: 'brief',
    brief: { task: 'OUTSIDE-SENTINEL-TASK', decisions: [], open_questions: [], constraints: [] },
    distillation: 'auto'
  }, null, 1);
}

function tempLeftovers(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(name => name.startsWith('.handoff-'));
}

function cleanup(root) {
  for (let attempt = 0; attempt < 10; attempt++) {
    try { fs.rmSync(root, { recursive: true, force: true }); return; }
    catch (error) {
      if (!['EBUSY', 'ENOTEMPTY', 'EPERM'].includes(error?.code ?? '')) throw error;
    }
  }
}

test('normal export and import stay inside their roots with no temp leftovers', async () => {
  const { root, ws, outside } = makeRoot();
  try {
    const svc = createHandoffService({ workspace: ws, agentLoop: loopWith() });
    const exported = await svc.exportBundle({ tier: 'brief', session_id: 's-1' });
    const bundleFile = path.join(handoffDir(ws), `${exported.bundle_id}.json`);
    assert.equal(fs.existsSync(bundleFile), true);
    assert.deepEqual(tempLeftovers(handoffDir(ws)), []);
    assert.equal(svc.getBundle(exported.bundle_id).tier, 'brief');
    assert.equal(svc.listBundles().bundles.some(bundle => bundle.id === exported.bundle_id), true);

    const imported = svc.importBundle(validBundle());
    const importedFile = path.join(importedDir(ws), `${imported.context_id}.json`);
    assert.equal(fs.existsSync(importedFile), true);
    assert.deepEqual(tempLeftovers(importedDir(ws)), []);
    assert.equal(svc.listBundles().bundles.some(bundle => bundle.imported === true), true);
    assert.deepEqual(fs.readdirSync(outside), []);
  } finally {
    cleanup(root);
  }
});

test('missing handoff roots are created beneath the validated hierarchy', async () => {
  const { root, ws, outside } = makeRoot();
  try {
    const svc = createHandoffService({ workspace: ws, agentLoop: loopWith() });
    await svc.exportBundle({ tier: 'brief', session_id: 's-1' });
    assert.equal(fs.existsSync(handoffDir(ws)), true);
    svc.importBundle(validBundle());
    assert.equal(fs.existsSync(importedDir(ws)), true);
    assert.deepEqual(fs.readdirSync(outside), []);
  } finally {
    cleanup(root);
  }
});

test('handoff root junction outside the workspace fails closed for export, import, list, and get', async () => {
  const { root, ws, outside } = makeRoot();
  try {
    fs.mkdirSync(path.join(ws, '.aide'), { recursive: true });
    fs.symlinkSync(outside, handoffDir(ws), 'junction');
    const svc = createHandoffService({ workspace: ws, agentLoop: loopWith() });
    await assert.rejects(() => svc.exportBundle({ tier: 'brief', session_id: 's-1' }), isValidation);
    assert.throws(() => svc.importBundle(validBundle()), isValidation);
    assert.throws(() => svc.listBundles(), isValidation);
    assert.throws(() => svc.getBundle(crypto.randomUUID()), isValidation);
    assert.deepEqual(fs.readdirSync(outside), []);
  } finally {
    cleanup(root);
  }
});

test('imported subroot junction outside the handoff root fails closed', async () => {
  const { root, ws, outside } = makeRoot();
  try {
    fs.mkdirSync(handoffDir(ws), { recursive: true });
    fs.symlinkSync(outside, importedDir(ws), 'junction');
    const svc = createHandoffService({ workspace: ws, agentLoop: loopWith() });
    // Export (handoff root) is still safe and usable.
    const exported = await svc.exportBundle({ tier: 'brief', session_id: 's-1' });
    assert.equal(fs.existsSync(path.join(handoffDir(ws), `${exported.bundle_id}.json`)), true);
    assert.throws(() => svc.importBundle(validBundle()), isValidation);
    assert.deepEqual(fs.readdirSync(outside), []);
  } finally {
    cleanup(root);
  }
});

test('bundle symlink to an outside sentinel is rejected for read; sentinel never surfaced', async () => {
  const { root, ws, outside } = makeRoot();
  try {
    fs.mkdirSync(handoffDir(ws), { recursive: true });
    const sentinel = path.join(outside, 'sentinel.json');
    fs.writeFileSync(sentinel, sentinelJson());
    const id = crypto.randomUUID();
    fs.symlinkSync(sentinel, path.join(handoffDir(ws), `${id}.json`), 'file');
    const svc = createHandoffService({ workspace: ws, agentLoop: loopWith() });
    assert.throws(() => svc.getBundle(id), isValidation);
    assert.equal(svc.listBundles().bundles.some(bundle => bundle.id === id), false, 'unsafe entries are never surfaced');
    assert.equal(fs.readFileSync(sentinel, 'utf8'), sentinelJson(), 'sentinel byte-identical');
  } finally {
    cleanup(root);
  }
});

test('bundle hardlink to an outside sentinel is rejected for read; sentinel byte-identical', async () => {
  const { root, ws, outside } = makeRoot();
  try {
    fs.mkdirSync(handoffDir(ws), { recursive: true });
    const sentinel = path.join(outside, 'sentinel.json');
    fs.writeFileSync(sentinel, sentinelJson());
    const id = crypto.randomUUID();
    fs.linkSync(sentinel, path.join(handoffDir(ws), `${id}.json`));
    const svc = createHandoffService({ workspace: ws, agentLoop: loopWith() });
    assert.throws(() => svc.getBundle(id), isValidation);
    assert.equal(svc.listBundles().bundles.some(bundle => bundle.id === id), false);
    assert.equal(fs.readFileSync(sentinel, 'utf8'), sentinelJson(), 'sentinel byte-identical');
  } finally {
    cleanup(root);
  }
});

test('non-regular bundle object is rejected', async () => {
  const { root, ws, outside } = makeRoot();
  try {
    fs.mkdirSync(handoffDir(ws), { recursive: true });
    const id = crypto.randomUUID();
    fs.mkdirSync(path.join(handoffDir(ws), `${id}.json`));
    const svc = createHandoffService({ workspace: ws, agentLoop: loopWith() });
    assert.throws(() => svc.getBundle(id), isValidation);
    assert.deepEqual(fs.readdirSync(outside), []);
  } finally {
    cleanup(root);
  }
});

test('sibling-prefix root boundary is not confused with the workspace', async () => {
  const { root, ws, outside } = makeRoot();
  const wsEvil = path.join(root, 'ws-evil');
  try {
    fs.mkdirSync(wsEvil, { recursive: true });
    fs.mkdirSync(path.join(ws, '.aide'), { recursive: true });
    fs.symlinkSync(wsEvil, handoffDir(ws), 'junction');
    const svc = createHandoffService({ workspace: ws, agentLoop: loopWith() });
    await assert.rejects(() => svc.exportBundle({ tier: 'brief', session_id: 's-1' }), isValidation);
    assert.deepEqual(fs.readdirSync(wsEvil), []);
    assert.deepEqual(fs.readdirSync(outside), []);
  } finally {
    cleanup(root);
  }
});

test('export failure before temp creation leaves no temp or final artifacts', async () => {
  const { root, ws, outside } = makeRoot();
  try {
    fs.mkdirSync(path.join(ws, '.aide'), { recursive: true });
    fs.writeFileSync(handoffDir(ws), 'not a directory', 'utf8');
    const svc = createHandoffService({ workspace: ws, agentLoop: loopWith() });
    await assert.rejects(() => svc.exportBundle({ tier: 'brief', session_id: 's-1' }), isValidation);
    assert.deepEqual(fs.readdirSync(path.join(ws, '.aide')).filter(name => name.startsWith('.handoff-')), []);
    assert.deepEqual(fs.readdirSync(outside), []);
  } finally {
    cleanup(root);
  }
});

test('import failure before temp creation leaves no temp or final artifacts', async () => {
  const { root, ws, outside } = makeRoot();
  try {
    fs.mkdirSync(handoffDir(ws), { recursive: true });
    fs.writeFileSync(importedDir(ws), 'not a directory', 'utf8');
    const svc = createHandoffService({ workspace: ws, agentLoop: loopWith() });
    assert.throws(() => svc.importBundle(validBundle()), isValidation);
    assert.deepEqual(tempLeftovers(handoffDir(ws)), []);
    assert.deepEqual(fs.readdirSync(outside), []);
  } finally {
    cleanup(root);
  }
});

test('unknown and malformed bundle ids preserve their contracts', async () => {
  const { root, ws } = makeRoot();
  try {
    const svc = createHandoffService({ workspace: ws, agentLoop: loopWith() });
    assert.throws(
      () => svc.getBundle(crypto.randomUUID()),
      error => error?.code === 'NOT_FOUND',
      'unknown server-generated id remains NOT_FOUND'
    );
    assert.throws(
      () => svc.getBundle('../escape'),
      error => error?.code === 'VALIDATION',
      'malformed id rejected before any filesystem use'
    );
    assert.deepEqual(fs.readdirSync(ws).filter(name => name !== '.aide'), [], 'no stray artifacts from read-only lookups');
  } finally {
    cleanup(root);
  }
});

// tests/unit/test-experts-registry-containment.mjs
// Pre-Wave-3I security repair: the ExpertRegistry name -> path primitive must
// fail closed for invalid or filesystem-unsafe expert identities, and must
// prove effective containment for reads, writes, and renames.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createExpertRegistry, ExpertError } from '../../harness/micro-experts.mjs';

const VALIDATION = (error) => error instanceof ExpertError && error.code === 'VALIDATION';

async function makeWorkspace() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'experts-contain-'));
  await fs.mkdir(path.join(dir, '.aide', 'experts'), { recursive: true });
  return dir;
}

function makeManifest(name, domain = 'test.dom') {
  return {
    name,
    role: 'classify',
    domain,
    input_features: ['a', 'b'],
    classes: ['x', 'y'],
    architecture: { type: 'mlp', hidden: [2], activation: 'tanh' },
    weights: { W1: [[0.1, 0.2], [0.3, 0.4]], b1: [0, 0], W2: [[0.5, -0.5], [-0.5, 0.5]], b2: [0, 0] },
    meta: { train_rows: 4 }
  };
}

async function cleanup(dir) {
  for (let attempt = 0; attempt < 10; attempt++) {
    try { await fs.rm(dir, { recursive: true, force: true }); return; }
    catch (error) {
      if (!['EBUSY', 'ENOTEMPTY', 'EPERM'].includes(error?.code ?? '')) throw error;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}

const BAD_NAMES = [
  '', ' ', '.', '..', '../x', 'a/b', 'a\\b', '/abs', 'C:\\x', 'file:///x',
  'UPPERCASE', 'has.dot', 'signals', 'x y', 'x_underscore', 'x\u0000y', 'x'.repeat(65)
];

test('valid lifecycle stays inside the registry root: save/load/infer/freeze/thaw/prune', async () => {
  const dir = await makeWorkspace();
  try {
    const reg = createExpertRegistry({ workspace: dir });
    const saved = await reg.save(makeManifest('tier-one'));
    assert.equal(saved.name, 'tier-one');
    await fs.access(path.join(dir, '.aide', 'experts', 'tier-one.json'));

    const loaded = await reg.load('tier-one');
    assert.equal(loaded.name, 'tier-one');
    const inferred = await reg.infer('tier-one', { a: 1, b: 0 });
    assert.ok(['x', 'y'].includes(inferred.class));

    const frozen = await reg.freeze('tier-one');
    assert.equal(frozen.state, 'dormant');
    await assert.rejects(() => fs.access(path.join(dir, '.aide', 'experts', 'tier-one.json')));
    await fs.access(path.join(dir, '.aide', 'experts', 'dormant', 'tier-one.json'));

    const thawed = await reg.thaw('tier-one');
    assert.equal(thawed.state, 'hot');
    // Current (preserved) thaw semantics: the dormant file stays on disk; the
    // canonical identity is what matters for the cache and later loads.
    await fs.access(path.join(dir, '.aide', 'experts', 'dormant', 'tier-one.json'));
    assert.equal((await reg.load('tier-one')).name, 'tier-one');

    await reg.save(makeManifest('tier-two'));
    const pruned = await reg.prune('tier-two', 'test');
    assert.equal(pruned.state, 'archived');
    const archived = await fs.readdir(path.join(dir, '.aide', 'experts', 'archive'));
    assert.ok(archived.some(name => name.startsWith('tier-two.')), JSON.stringify(archived));
    await assert.rejects(() => reg.load('tier-two'), error => error instanceof ExpertError && error.code === 'EXPERT_NOT_FOUND');
  } finally {
    await cleanup(dir);
  }
});

test('name grammar rejects traversal, separators, absolute, reserved and malformed identities', async () => {
  const dir = await makeWorkspace();
  try {
    const reg = createExpertRegistry({ workspace: dir });
    for (const name of BAD_NAMES) {
      await assert.rejects(() => reg.load(name), VALIDATION, `load ${JSON.stringify(name)}`);
      await assert.rejects(() => reg.infer(name, { a: 1 }), VALIDATION, `infer ${JSON.stringify(name)}`);
      await assert.rejects(() => reg.freeze(name), VALIDATION, `freeze ${JSON.stringify(name)}`);
      await assert.rejects(() => reg.thaw(name), VALIDATION, `thaw ${JSON.stringify(name)}`);
      await assert.rejects(() => reg.prune(name, 'test'), VALIDATION, `prune ${JSON.stringify(name)}`);
      await assert.rejects(() => reg.save(makeManifest(name)), VALIDATION, `save ${JSON.stringify(name)}`);
    }
    assert.deepEqual(await fs.readdir(path.join(dir, '.aide', 'experts')), []);
    assert.equal(reg._test.hot.size, 0, 'cache must stay clean');
  } finally {
    await cleanup(dir);
  }
});

test('outside sentinel JSON stays unread and unmodified when traversal names are attempted', async () => {
  const dir = await makeWorkspace();
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'experts-outside-'));
  try {
    const sentinelPath = path.join(outside, 'secret.json');
    const sentinel = JSON.stringify(makeManifest('secret'));
    await fs.writeFile(sentinelPath, sentinel);
    const reg = createExpertRegistry({ workspace: dir });
    const attempts = ['../secret', '../../secret', '..\\secret', path.join(outside, 'secret'), 'secret/../secret'];
    for (const name of attempts) {
      await assert.rejects(() => reg.load(name), VALIDATION, `load ${JSON.stringify(name)}`);
      await assert.rejects(() => reg.infer(name, { a: 1 }), VALIDATION, `infer ${JSON.stringify(name)}`);
    }
    assert.equal(await fs.readFile(sentinelPath, 'utf8'), sentinel, 'sentinel untouched');
    assert.deepEqual(await fs.readdir(outside), ['secret.json']);
    assert.equal(reg._test.hot.size, 0);
  } finally {
    await cleanup(dir);
    await cleanup(outside);
  }
});

test('symlink expert file pointing outside is rejected; sentinel untouched', async () => {
  const dir = await makeWorkspace();
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'experts-outside-'));
  try {
    const sentinelPath = path.join(outside, 'sentinel.json');
    const sentinel = JSON.stringify(makeManifest('sentinel'));
    await fs.writeFile(sentinelPath, sentinel);
    await fs.symlink(sentinelPath, path.join(dir, '.aide', 'experts', 'linked.json'), 'file');
    const reg = createExpertRegistry({ workspace: dir });
    await assert.rejects(() => reg.load('linked'), VALIDATION);
    await assert.rejects(() => reg.infer('linked', { a: 1 }), VALIDATION);
    assert.equal(await fs.readFile(sentinelPath, 'utf8'), sentinel);
    assert.equal(reg._test.hot.has('linked'), false, 'invalid identity never enters the hot cache');
  } finally {
    await cleanup(dir);
    await cleanup(outside);
  }
});

test('freeze rejects a link-like source and a link-like destination without outside effects', async () => {
  const dir = await makeWorkspace();
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'experts-outside-'));
  try {
    const sourceSentinel = path.join(outside, 'source.json');
    const destinationSentinel = path.join(outside, 'destination.json');
    const sentinelOne = JSON.stringify(makeManifest('source-sentinel'));
    const sentinelTwo = JSON.stringify(makeManifest('destination-sentinel'));
    await fs.writeFile(sourceSentinel, sentinelOne);
    await fs.writeFile(destinationSentinel, sentinelTwo);
    await fs.symlink(sourceSentinel, path.join(dir, '.aide', 'experts', 'linked-source.json'), 'file');

    const reg = createExpertRegistry({ workspace: dir });
    await assert.rejects(() => reg.freeze('linked-source'), VALIDATION, 'link-like source rejected');
    assert.equal(await fs.readFile(sourceSentinel, 'utf8'), sentinelOne);

    await reg.save(makeManifest('victim'));
    await fs.mkdir(path.join(dir, '.aide', 'experts', 'dormant'), { recursive: true });
    await fs.symlink(destinationSentinel, path.join(dir, '.aide', 'experts', 'dormant', 'victim.json'), 'file');
    await assert.rejects(() => reg.freeze('victim'), VALIDATION, 'link-like destination rejected');
    assert.equal(await fs.readFile(destinationSentinel, 'utf8'), sentinelTwo);
    await fs.access(path.join(dir, '.aide', 'experts', 'victim.json'));
  } finally {
    await cleanup(dir);
    await cleanup(outside);
  }
});

test('junctioned dormant parent cannot receive a rename target', async () => {
  const dir = await makeWorkspace();
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'experts-outside-'));
  try {
    const reg = createExpertRegistry({ workspace: dir });
    await reg.save(makeManifest('ghost'));
    await fs.symlink(outside, path.join(dir, '.aide', 'experts', 'dormant'), 'junction');
    await assert.rejects(() => reg.freeze('ghost'), VALIDATION, 'junctioned destination parent rejected');
    assert.deepEqual(await fs.readdir(outside), [], 'nothing may be written outside the registry root');
    await fs.access(path.join(dir, '.aide', 'experts', 'ghost.json'));
  } finally {
    await cleanup(dir);
    await cleanup(outside);
  }
});

test('junction at the experts root fails closed for save and load', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'experts-rootjun-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'experts-outside-'));
  const ws = path.join(root, 'ws');
  try {
    await fs.mkdir(path.join(ws, '.aide'), { recursive: true });
    await fs.symlink(outside, path.join(ws, '.aide', 'experts'), 'junction');
    const reg = createExpertRegistry({ workspace: ws });
    await assert.rejects(() => reg.save(makeManifest('rooted')), VALIDATION, 'junctioned root rejected on save');
    await assert.rejects(() => reg.load('rooted'), VALIDATION, 'junctioned root rejected on load');
    assert.deepEqual(await fs.readdir(outside), []);
  } finally {
    await cleanup(root);
    await cleanup(outside);
  }
});

test('cache identity is the canonical validated name only', async () => {
  const dir = await makeWorkspace();
  try {
    const reg = createExpertRegistry({ workspace: dir });
    await reg.save(makeManifest('canon'));
    await reg.load('canon');
    assert.equal(reg._test.hot.has('canon'), true);
    assert.equal(reg._test.hot.size, 1);
    for (const alias of ['./canon', 'dir/../canon', 'Canon', 'canon ']) {
      await assert.rejects(() => reg.load(alias), VALIDATION, `alias ${JSON.stringify(alias)}`);
    }
    assert.deepEqual([...reg._test.hot.keys()], ['canon']);
  } finally {
    await cleanup(dir);
  }
});

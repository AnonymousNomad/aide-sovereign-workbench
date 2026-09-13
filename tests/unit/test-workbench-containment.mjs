// tests/unit/test-workbench-containment.mjs
// Pre-Wave-3I security repair: Workbench state operations must fail closed
// when effective filesystem containment or safe state-object identity cannot
// be proven. Lexical containment alone is insufficient.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkbenchManager, WorkbenchValidationError } from '../../workbenches/manager.mjs';

const BUNDLE = 'sovereign-coder';
const SECOND_BUNDLE = 'sovereign-architect';
const stateDir = (ws) => path.join(ws, '.aide', 'workbenches');
const stateFile = (ws, id = BUNDLE) => path.join(stateDir(ws), `${id}.json`);
const isValidation = (error) => error instanceof WorkbenchValidationError;

function sentinelJson(id = 'sentinel') {
  return JSON.stringify({
    id,
    version: '9.9.9',
    installed_at: 'sentinel',
    enabled: true,
    plugins_enabled: {},
    skills_enabled: {},
    mcp_trusted: { filesystem: true }
  }, null, 2);
}

async function makeRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wb-contain-'));
  const ws = path.join(root, 'ws');
  const outside = path.join(root, 'outside');
  await fs.mkdir(ws, { recursive: true });
  await fs.mkdir(outside, { recursive: true });
  return { root, ws, outside };
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

async function listStateFiles(ws) {
  return fs.readdir(stateDir(ws)).catch(() => []);
}

test('normal install/uninstall keeps state under the canonical root with no temp leftovers', async () => {
  const { root, ws, outside } = await makeRoot();
  try {
    const manager = new WorkbenchManager({ workspace: ws });
    const installed = await manager.install(BUNDLE);
    assert.equal(installed.workbench.id, BUNDLE);
    const raw = await fs.readFile(stateFile(ws), 'utf8');
    const state = JSON.parse(raw);
    assert.equal(state.enabled, false, 'install writes disabled state');
    assert.deepEqual(state.mcp_trusted, {}, 'install grants no trust');
    assert.deepEqual(await listStateFiles(ws), [`${BUNDLE}.json`]);
    assert.equal((await manager.get(BUNDLE)).workbench.installed, true);

    await manager.install(BUNDLE); // duplicate install preserves overwrite semantics
    assert.deepEqual(await listStateFiles(ws), [`${BUNDLE}.json`]);
    assert.equal((await listStateFiles(ws)).some(name => name.includes('.tmp')), false, 'no temp leftovers');

    const removed = await manager.uninstall(BUNDLE);
    assert.deepEqual(removed, { removed: BUNDLE });
    assert.equal((await manager.get(BUNDLE)).workbench.installed, false);
    assert.deepEqual(await fs.readdir(outside), []);
  } finally {
    await cleanup(root);
  }
});

test('missing state root is created beneath the validated workspace', async () => {
  const { root, ws, outside } = await makeRoot();
  try {
    const manager = new WorkbenchManager({ workspace: ws });
    await manager.install(BUNDLE);
    await fs.access(stateDir(ws));
    assert.deepEqual(await fs.readdir(outside), []);
  } finally {
    await cleanup(root);
  }
});

test('root junction outside the workspace fails closed for install, load, trust, and uninstall', async () => {
  const { root, ws, outside } = await makeRoot();
  try {
    await fs.mkdir(path.dirname(stateDir(ws)), { recursive: true });
    await fs.symlink(outside, stateDir(ws), 'junction');
    const manager = new WorkbenchManager({ workspace: ws });
    await assert.rejects(() => manager.install(BUNDLE), isValidation, 'install rejected');
    await assert.rejects(() => manager.get(BUNDLE), isValidation, 'load rejected');
    await assert.rejects(() => manager.setTrust(BUNDLE, 'filesystem', true), isValidation, 'trust save rejected');
    await assert.rejects(() => manager.uninstall(BUNDLE), isValidation, 'remove rejected');
    assert.deepEqual(await fs.readdir(outside), [], 'nothing written outside the root');
  } finally {
    await cleanup(root);
  }
});

test('state-file symlink to an outside sentinel is rejected for read, write, trust, and remove', async () => {
  const { root, ws, outside } = await makeRoot();
  try {
    const sentinel = path.join(outside, 'sentinel.json');
    await fs.writeFile(sentinel, sentinelJson());
    await fs.mkdir(stateDir(ws), { recursive: true });
    await fs.symlink(sentinel, stateFile(ws), 'file');
    const manager = new WorkbenchManager({ workspace: ws });
    await assert.rejects(() => manager.get(BUNDLE), isValidation, 'read rejected');
    await assert.rejects(() => manager.install(BUNDLE), isValidation, 'write rejected');
    await assert.rejects(() => manager.setTrust(BUNDLE, 'filesystem', true), isValidation, 'trust rejected');
    await assert.rejects(() => manager.uninstall(BUNDLE), isValidation, 'remove rejected');
    assert.equal(await fs.readFile(sentinel, 'utf8'), sentinelJson(), 'sentinel byte-identical');
    assert.equal((await fs.lstat(stateFile(ws))).isSymbolicLink(), true, 'link untouched by rejected removal');
  } finally {
    await cleanup(root);
  }
});

test('state-file hardlink to an outside sentinel is rejected; sentinel byte-identical', async () => {
  const { root, ws, outside } = await makeRoot();
  try {
    const sentinel = path.join(outside, 'sentinel.json');
    await fs.writeFile(sentinel, sentinelJson());
    await fs.mkdir(stateDir(ws), { recursive: true });
    await fs.link(sentinel, stateFile(ws));
    const manager = new WorkbenchManager({ workspace: ws });
    await assert.rejects(() => manager.get(BUNDLE), isValidation, 'read rejected');
    await assert.rejects(() => manager.install(BUNDLE), isValidation, 'hardlink destination write rejected');
    await assert.rejects(() => manager.setTrust(BUNDLE, 'filesystem', true), isValidation, 'trust write rejected');
    await assert.rejects(() => manager.uninstall(BUNDLE), isValidation, 'hardlink removal rejected');
    assert.equal(await fs.readFile(sentinel, 'utf8'), sentinelJson(), 'sentinel byte-identical');
    await fs.access(stateFile(ws));
  } finally {
    await cleanup(root);
  }
});

test('non-regular state object (directory) is rejected', async () => {
  const { root, ws, outside } = await makeRoot();
  try {
    await fs.mkdir(stateFile(ws), { recursive: true });
    const manager = new WorkbenchManager({ workspace: ws });
    await assert.rejects(() => manager.get(BUNDLE), isValidation);
    await assert.rejects(() => manager.install(BUNDLE), isValidation);
    await assert.rejects(() => manager.uninstall(BUNDLE), isValidation);
    assert.deepEqual(await fs.readdir(outside), []);
  } finally {
    await cleanup(root);
  }
});

test('safe removal removes only the exact state entry; siblings and outside stay intact', async () => {
  const { root, ws, outside } = await makeRoot();
  try {
    const sentinel = path.join(outside, 'sentinel.json');
    await fs.writeFile(sentinel, sentinelJson());
    const manager = new WorkbenchManager({ workspace: ws });
    await manager.install(BUNDLE);
    await manager.install(SECOND_BUNDLE);
    await manager.uninstall(BUNDLE);
    assert.deepEqual(await listStateFiles(ws), [`${SECOND_BUNDLE}.json`]);
    assert.equal(await fs.readFile(sentinel, 'utf8'), sentinelJson());
  } finally {
    await cleanup(root);
  }
});

test('sibling-prefix root boundary is not confused with the canonical root', async () => {
  const { root, ws, outside } = await makeRoot();
  const wsEvil = path.join(root, 'ws-evil');
  try {
    await fs.mkdir(wsEvil, { recursive: true });
    await fs.mkdir(path.dirname(stateDir(ws)), { recursive: true });
    // Root junction to a sibling directory whose path shares the workspace
    // prefix: component-aware containment must still fail closed.
    await fs.symlink(wsEvil, stateDir(ws), 'junction');
    const manager = new WorkbenchManager({ workspace: ws });
    await assert.rejects(() => manager.install(BUNDLE), isValidation, 'sibling-prefix root rejected');
    assert.deepEqual(await fs.readdir(wsEvil), []);

    // A real sibling directory inside the workspace is never targeted.
    await fs.rm(stateDir(ws), { force: true });
    await fs.mkdir(path.join(ws, '.aide', 'workbenches-evil'), { recursive: true });
    await manager.install(BUNDLE);
    assert.deepEqual(await fs.readdir(path.join(ws, '.aide', 'workbenches-evil')), []);
    assert.deepEqual(await listStateFiles(ws), [`${BUNDLE}.json`]);
    assert.deepEqual(await fs.readdir(outside), []);
  } finally {
    await cleanup(root);
  }
});

test('unknown catalog identities stay zero-effect', async () => {
  const { root, ws, outside } = await makeRoot();
  try {
    const manager = new WorkbenchManager({ workspace: ws });
    await assert.rejects(() => manager.install('does-not-exist'), isValidation);
    await assert.rejects(() => manager.uninstall('does-not-exist'), isValidation);
    assert.equal(await manager.get('does-not-exist'), null);
    assert.deepEqual(await listStateFiles(ws), []);
    assert.deepEqual(await fs.readdir(outside), []);
  } finally {
    await cleanup(root);
  }
});

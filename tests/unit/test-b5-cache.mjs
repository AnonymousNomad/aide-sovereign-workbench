import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { TaskService, hashGlobs, globToMatcher } from '../../node/src/services/task-service.mjs';
import { BuildCache } from '../../node/src/services/build-cache.mjs';

const NODE = process.execPath;

async function makeWorkspace(tasks) {
  const ws = await mkdtemp(path.join(tmpdir(), 'aide-b5-cache-'));
  await mkdir(path.join(ws, '.vscode'), { recursive: true });
  await mkdir(path.join(ws, 'src'), { recursive: true });
  await writeFile(path.join(ws, 'src', 'main.txt'), 'v1', 'utf8');
  await writeFile(path.join(ws, '.vscode', 'tasks.json'), JSON.stringify({ version: '2.0.0', tasks }), 'utf8');
  return ws;
}

async function waitForTerminal(svc, jobId, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = svc.status().jobs.find(j => j.job_id === jobId);
    if (job && job.status !== 'running') return job;
    await new Promise(r => setTimeout(r, 40));
  }
  throw new Error(`job ${jobId} not terminal in ${timeoutMs}ms`);
}

function appendTask(label, extra = {}) {
  return {
    label,
    type: 'process',
    command: NODE,
    args: ['-e', 'require("node:fs").appendFileSync(process.env.B5_MARKER, "run\\n")'],
    cache: { inputs: ['src/**'], env: ['B5_MODE'] },
    ...extra
  };
}

async function markerCount(ws) {
  try {
    const raw = await readFile(path.join(ws, 'markers.txt'), 'utf8');
    return raw.split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
}

test('b5: miss then hit restores without executing (marker written once)', async () => {
  process.env.B5_MARKER = '';
  const ws = await makeWorkspace([appendTask('cached build')]);
  process.env.B5_MARKER = path.join(ws, 'markers.txt');
  const svc = new TaskService({ workspace: ws, onEvent: () => {} });
  try {
    const first = await svc.run('cached build');
    const f = await waitForTerminal(svc, first.job_id);
    assert.equal(f.status, 'exited');
    assert.equal(f.restored, false);
    assert.equal(await markerCount(ws), 1);

    const second = await svc.run('cached build');
    const s = await waitForTerminal(svc, second.job_id);
    assert.equal(s.status, 'exited');
    assert.equal(s.exitCode, 0);
    assert.equal(s.restored, true, 'second run must restore');
    assert.equal(await markerCount(ws), 1, 'restore must NOT execute the command');

    const outputs = [];
    const svc3 = new TaskService({ workspace: ws, onEvent: e => { if (e.event === 'output') outputs.push(e.line); } });
    const third = await svc3.run('cached build');
    await waitForTerminal(svc3, third.job_id);
    assert.ok(outputs.some(line => line.includes('[aide] restored from cache')), 'honesty banner required');
  } finally {
    delete process.env.B5_MARKER;
    await rm(ws, { recursive: true, force: true });
  }
});

test('b5: changing declared input forces real run; undeclared change still hits', async () => {
  const ws = await makeWorkspace([
    appendTask('b'),
    { label: 'writer', type: 'process', command: NODE, args: ['-e', 'require("node:fs").writeFileSync(process.argv[1], "v" + Date.now())'], cache: undefined }
  ]);
  process.env.B5_MARKER = path.join(ws, 'markers.txt');
  const svc = new TaskService({ workspace: ws, onEvent: () => {} });
  try {
    await waitForTerminal(svc, (await svc.run('b')).job_id);
    await waitForTerminal(svc, (await svc.run('b')).job_id);
    assert.equal(await markerCount(ws), 1);

    await mkdir(path.join(ws, 'docs'), { recursive: true });
    await writeFile(path.join(ws, 'docs', 'notes.md'), 'untracked', 'utf8'); // outside cache.inputs
    await waitForTerminal(svc, (await svc.run('b')).job_id);
    assert.equal(await markerCount(ws), 1, 'undeclared file change must NOT invalidate');

    await writeFile(path.join(ws, 'src', 'main.txt'), 'v2-changed', 'utf8'); // declared
    await waitForTerminal(svc, (await svc.run('b')).job_id);
    assert.equal(await markerCount(ws), 2, 'declared input content change must invalidate');
  } finally {
    delete process.env.B5_MARKER;
    await rm(ws, { recursive: true, force: true });
  }
});

test('b5: declared env var participates in key; undeclared does not', async () => {
  const ws = await makeWorkspace([appendTask('envy')]);
  process.env.B5_MARKER = path.join(ws, 'markers.txt');
  const svc = new TaskService({ workspace: ws, onEvent: () => {} });
  try {
    process.env.B5_MODE = 'prod';
    process.env.B5_IGNORED = 'a';
    await waitForTerminal(svc, (await svc.run('envy')).job_id);
    await waitForTerminal(svc, (await svc.run('envy')).job_id);
    assert.equal(await markerCount(ws), 1);

    process.env.B5_IGNORED = 'changed-but-undeclared';
    await waitForTerminal(svc, (await svc.run('envy')).job_id);
    assert.equal(await markerCount(ws), 1, 'undeclared env must not invalidate');

    process.env.B5_MODE = 'dev';
    await waitForTerminal(svc, (await svc.run('envy')).job_id);
    assert.equal(await markerCount(ws), 2, 'declared env change must invalidate');
  } finally {
    delete process.env.B5_MARKER;
    delete process.env.B5_MODE;
    delete process.env.B5_IGNORED;
    await rm(ws, { recursive: true, force: true });
  }
});

test('b5: failing runs are never cached or restored', async () => {
  const ws = await makeWorkspace([
    { label: 'flaky fail', type: 'process', command: NODE, args: ['-e', 'process.exit(9)'], cache: { inputs: ['src/**'] } }
  ]);
  const svc = new TaskService({ workspace: ws, onEvent: () => {} });
  try {
    const a = await waitForTerminal(svc, (await svc.run('flaky fail')).job_id);
    assert.equal(a.restored, false);
    const b = await waitForTerminal(svc, (await svc.run('flaky fail')).job_id);
    assert.equal(b.restored, false, 'failure must not be restorable');
    assert.equal(b.exitCode, 9);
    const stats = svc.cache.stats();
    assert.equal(stats.entries.filter(e => e.exitCode === 9).length, 0);
  } finally {
    await rm(ws, { recursive: true, force: true });
  }
});

test('b5: LRU eviction enforces entry cap', async () => {
  const ws = await mkdtemp(path.join(tmpdir(), 'aide-b5-evict-'));
  try {
    const cache = new BuildCache({ workspace: ws, maxEntries: 2 });
    for (const key of ['k1', 'k2']) {
      await cache.record({ key, label: key, createdAt: Date.now(), exitCode: 0, sizeBytes: 10 }, 'log', []);
    }
    await cache.get('k1'); // k1 now most-recent
    await cache.record({ key: 'k3', label: 'k3', createdAt: Date.now(), exitCode: 0, sizeBytes: 10 }, 'log', []);
    let stats = cache.stats();
    assert.deepEqual(stats.entries.map(e => e.key).sort(), ['k1', 'k3'], 'oldest (k2) evicted');
    await cache.record({ key: 'k4', label: 'k4', createdAt: Date.now(), exitCode: 0, sizeBytes: 10 }, 'log', []);
    await cache.record({ key: 'k5', label: 'k5', createdAt: Date.now(), exitCode: 0, sizeBytes: 10 }, 'log', []);
    stats = cache.stats();
    assert.ok(stats.entries.length <= 2, `cap respected: ${stats.entries.length}`);
  } finally {
    await rm(ws, { recursive: true, force: true });
  }
});

test('b5: hashGlobs hashes contents deterministically and normalizes separators', async () => {
  const ws = await mkdtemp(path.join(tmpdir(), 'aide-b5-hash-'));
  try {
    await mkdir(path.join(ws, 'src', 'nested'), { recursive: true });
    await writeFile(path.join(ws, 'src', 'a.txt'), 'alpha');
    await writeFile(path.join(ws, 'src', 'nested', 'b.txt'), 'beta');
    const h1 = await hashGlobs(ws, ['src/**']);
    const h2 = await hashGlobs(ws, ['src/**']);
    assert.equal(Object.keys(h1).length > 0, true);
    assert.equal(h1['src/a.txt'], h2['src/a.txt'], 'deterministic for same contents');
    await writeFile(path.join(ws, 'src', 'a.txt'), 'ALPHA');
    const h3 = await hashGlobs(ws, ['src/**']);
    assert.notEqual(h3['src/a.txt'], h1['src/a.txt'], 'content change changes hash');
    const keys = Object.keys(h1).sort();
    assert.ok(keys.includes('src/a.txt'));
    assert.ok(keys.includes('src/nested/b.txt'));
    assert.ok(!keys.some(k => k.includes('\\')), 'separators normalized to /');
  } finally {
    await rm(ws, { recursive: true, force: true });
  }
});

test('b5: globToMatcher supports **, *, ? semantics', () => {
  const m = globToMatcher('src/**/*.ts');
  assert.equal(m.test(normalize('src/a.ts')), true);
  assert.equal(m.test(normalize('src/x/y/z.ts')), true);
  assert.equal(m.test(normalize('lib/a.ts')), false);
  const star = globToMatcher('docs/*.md');
  assert.equal(star.test(normalize('docs/readme.md')), true);
  assert.equal(star.test(normalize('docs/sub/readme.md')), false);
  const q = globToMatcher('file?.txt');
  assert.equal(q.test(normalize('file1.txt')), true);
  assert.equal(q.test(normalize('file10.txt')), false);
});

function normalize(p) {
  return p.split('\\').join('/');
}

test('b5: background-matcher tasks are never cached', async () => {
  const ws = await makeWorkspace([
    {
      label: 'watcher nocache',
      type: 'process',
      isBackground: true,
      command: NODE,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      cache: { inputs: ['src/**'] },
      problemMatcher: {
        name: 'w', owner: 'w',
        pattern: { regexp: '^(?!.*)$', file: 1, line: 2 },
        background: { activeOnStart: true, beginsPattern: 'begin', endsPattern: 'end' }
      }
    }
  ]);
  const svc = new TaskService({ workspace: ws, onEvent: () => {} });
  try {
    const { job_id } = await svc.run('watcher nocache');
    await new Promise(r => setTimeout(r, 400));
    await svc.stop(job_id);
    const stats = svc.cache.stats();
    assert.equal(stats.entries.length, 0, 'watcher output must never be recorded');
  } finally {
    await rm(ws, { recursive: true, force: true });
  }
});

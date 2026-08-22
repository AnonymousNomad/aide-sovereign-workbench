import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TaskService, resolveDepPlan } from '../../node/src/services/task-service.mjs';

async function makeWorkspace(tasksJson) {
  const dir = await mkdtemp(path.join(tmpdir(), 'aide-b3-compound-'));
  await mkdirp(path.join(dir, '.vscode'));
  await writeFile(path.join(dir, '.vscode', 'tasks.json'), JSON.stringify({ version: '2.0.0', tasks: tasksJson }), 'utf8');
  return dir;
}

async function mkdirp(dir) {
  await (await import('node:fs/promises')).mkdir(dir, { recursive: true });
}

const NODE = process.execPath;
function echoTask(label, text, extra = {}) {
  return {
    label,
    type: 'process',
    command: NODE,
    args: ['-e', `require("node:fs").appendFileSync(process.env.B3_MARKER, ${JSON.stringify(text)} + "\\n")`],
    ...extra
  };
}

test('b3: resolveDepPlan detects cycles before launch', () => {
  const tasks = [
    { label: 'a', type: 'process', command: 'x', dependsOn: 'b' },
    { label: 'b', type: 'process', command: 'x', dependsOn: ['a'] }
  ];
  assert.throws(() => resolveDepPlan(tasks, tasks[0]), /circular dependency.*a -> b -> a|a -> b -> a/i);
});

test('b3: resolveDepPlan orders sequential deps depth-first', () => {
  const tasks = [
    echoTask('root', 'r', { dependsOn: ['one', 'two'] }),
    echoTask('one', '1', { dependsOn: 'deep' }),
    echoTask('deep', 'd'),
    echoTask('two', '2')
  ];
  const plan = resolveDepPlan(tasks, tasks[0]);
  assert.deepEqual(plan.executionOrder.map(node => node.task.label), ['deep', 'one', 'two', 'root']);
});

test('b3: sequential compound enforces order and attributes output', async () => {
  const ws = await makeWorkspace([
    {
      ...echoTask('build', 'BUILD-RAN'),
      env: undefined,
      args: ['-e', 'require("node:fs").appendFileSync(process.env.B3_MARKER, "BUILD-RAN\\n"); console.log("built ok")']
    },
    { ...echoTask('root', 'ROOT-RAN', { dependsOn: 'build' }) }
  ]);
  process.env.B3_MARKER = path.join(ws, 'markers.txt');
  try {
    const svc = new TaskService({ workspace: ws, onEvent: () => {} });
    const { job_id } = await svc.run('root');
    await waitForTerminal(svc, job_id);
    const jobs = svc.status().jobs;
    const root = jobs.find(j => j.job_id === job_id);
    assert.equal(root.status, 'exited');
    assert.equal(root.exitCode, 0);
    const children = jobs.filter(j => j.parent_job_id === job_id);
    assert.equal(children.length, 2, 'dep leaf + compound-root own leaf both carry parent linkage');
    const buildChild = children.find(j => j.label === 'build');
    assert.ok(buildChild, 'build child present');
    assert.equal(buildChild.name_path, 'root > build');
    const markers = await readFile(process.env.B3_MARKER, 'utf8');
    assert.deepEqual(markers.trim().split('\n'), ['BUILD-RAN', 'ROOT-RAN']);
    const childJob = jobs.find(j => j.parent_job_id === job_id);
    assert.ok(childJob.name_path.startsWith('root'), `name_path groups under root: ${childJob.name_path}`);
  } finally {
    delete process.env.B3_MARKER;
    await rm(ws, { recursive: true, force: true });
  }
});

test('b3: failing dependency stops chain and marks parent failed_dependency', async () => {
  const neverPath = path.join(await mkdtemp(path.join(tmpdir(), 'aide-b3-never-')), 'never.txt');
  const ws = await makeWorkspace([
    { label: 'boom', type: 'process', command: NODE, args: ['-e', 'process.exit(3)'] },
    { label: 'never', type: 'process', command: NODE, args: ['-e', `require("node:fs").appendFileSync(${JSON.stringify(neverPath)}, "x")`] },
    { label: 'root', type: 'process', command: NODE, args: ['-e', ''], dependsOn: ['boom', 'never'] }
  ]);
  const events = [];
  const svc = new TaskService({ workspace: ws, onEvent: e => events.push(e) });
  try {
    const { job_id } = await svc.run('root');
    await waitForTerminal(svc, job_id);
    const root = svc.status().jobs.find(j => j.job_id === job_id);
    assert.equal(root.status, 'failed');
    assert.equal(root.failed_dependency, 'boom');
    await new Promise(r => setTimeout(r, 300));
    await assert.rejects(readFile(neverPath), /ENOENT/, 'third task never started');
    const exitEvents = events.filter(e => e.event === 'exit' && e.job_id === job_id);
    assert.equal(exitEvents.length, 1);
  } finally {
    await rm(ws, { recursive: true, force: true });
    await rm(path.dirname(neverPath), { recursive: true, force: true });
  }
});

test('b3: parallel starts both; failing sibling kills the other', async () => {
  const slowScript = 'setInterval(() => {}, 1000)';
  const ws = await makeWorkspace([
    { label: 'slowwin', type: 'process', command: NODE, args: ['-e', slowScript] },
    { label: 'fastfail', type: 'process', command: NODE, args: ['-e', 'setTimeout(() => process.exit(2), 400)'] },
    { label: 'par', type: 'process', command: NODE, args: ['-e', ''], dependsOn: ['slowwin', 'fastfail'], dependsOrder: 'parallel' }
  ]);
  const svc = new TaskService({ workspace: ws, onEvent: () => {} });
  const { job_id } = await svc.run('par');
  await waitForTerminal(svc, job_id, 15000);
  const jobs = svc.status().jobs;
  const par = jobs.find(j => j.job_id === job_id);
  assert.equal(par.status, 'failed');
  assert.equal(par.failed_dependency, 'fastfail');
  await new Promise(r => setTimeout(r, 500));
  const stillRunning = jobs.filter(j => j.job_id !== job_id && svc.jobs.get(j.job_id)?.status === 'running');
  assert.equal(stillRunning.length, 0, `parallel failure must kill siblings; running: ${stillRunning.map(j => j.label)}`);
  await rm(ws, { recursive: true, force: true });
});

test('b3: background dependency becomes ready on ends-pattern without waiting exit', async () => {
  const watcherScript = [
    'console.log("[watch] compile started");',
    'setTimeout(() => console.log("[watch] compilation finished"), 500);',
    'setInterval(() => {}, 60000);'
  ].join('\n');
  const ws = await makeWorkspace([
    {
      label: 'watcher',
      type: 'process',
      isBackground: true,
      command: NODE,
      args: ['-e', watcherScript],
      problemMatcher: {
        name: 'b3watch',
        owner: 'b3',
        pattern: { regexp: '^(?!.*)$', file: 1, line: 2 },
        background: { activeOnStart: true, beginsPattern: '\\[watch\\] compile started', endsPattern: 'compilation finished' }
      }
    },
    { ...echoTask('after', 'AFTER-RAN', { dependsOn: 'watcher' }) }
  ]);
  process.env.B3_MARKER = path.join(ws, 'markers.txt');
  const t0 = Date.now();
  const svc = new TaskService({ workspace: ws, onEvent: () => {} });
  try {
    const { job_id } = await svc.run('after');
    await waitForTerminal(svc, job_id, 20000);
    const elapsed = Date.now() - t0;
    assert.equal(await readFile(process.env.B3_MARKER, 'utf8').then(t => t.trim()), 'AFTER-RAN');
    assert.ok(elapsed < 15000, `parent must start at readiness (~0.5s), took ${elapsed}ms`);
    const watcherJobs = svc.status().jobs.filter(j => j.label === 'watcher' && j.parent_job_id !== null || j.label === 'watcher');
    assert.ok(watcherJobs.length >= 1, 'watcher job visible');
  } finally {
    await stopAllJobs(svc);
    delete process.env.B3_MARKER;
    await rm(ws, { recursive: true, force: true });
  }
});

test('b3: inline object dependency is accepted and validated strictly', () => {
  const tasks = [
    {
      label: 'root',
      type: 'process',
      command: NODE,
      dependsOn: [{ label: 'inl', type: 'process', command: NODE }]
    }
  ];
  const plan = resolveDepPlan(tasks, tasks[0]);
  assert.equal(plan.executionOrder[0].task.label, 'inl');
  const bad = [
    {
      label: 'root',
      type: 'process',
      command: NODE,
      dependsOn: [{ label: 'inl', type: 'nonsense', command: NODE }]
    }
  ];
  assert.throws(() => resolveDepPlan(bad, bad[0]), /type must be/);
});

test('b3: stopping a compound coordinator kills running children', async () => {
  const ws = await makeWorkspace([
    { label: 'long', type: 'process', command: NODE, args: ['-e', 'setInterval(() => {}, 1000)'] },
    { label: 'rootlong', type: 'process', command: NODE, args: ['-e', 'setInterval(() => {}, 1000)'], dependsOn: 'long' }
  ]);
  const svc = new TaskService({ workspace: ws, onEvent: () => {} });
  const { job_id } = await svc.run('rootlong');
  await new Promise(r => setTimeout(r, 1200));
  await svc.stop(job_id);
  await new Promise(r => setTimeout(r, 700));
  const jobs = svc.status().jobs;
  assert.equal(jobs.find(j => j.job_id === job_id).status, 'stopped');
  const child = jobs.find(j => j.parent_job_id === job_id);
  assert.ok(child, 'child exists');
  assert.notEqual(child.status, 'running', 'child must be killed with parent');
  await rm(ws, { recursive: true, force: true });
});

async function waitForTerminal(svc, jobId, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = svc.status().jobs.find(j => j.job_id === jobId);
    if (job && job.status !== 'running') return job;
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error(`job ${jobId} did not reach terminal state within ${timeoutMs}ms`);
}

async function stopAllJobs(svc) {
  for (const job of [...svc.jobs.values()]) {
    if (job.status === 'running') {
      try { await svc.stop(job.job_id); } catch { /* raced to terminal */ }
    }
  }
  for (let i = 0; i < 20; i++) {
    const anyRunning = [...svc.jobs.values()].some(j => j.status === 'running');
    if (!anyRunning) break;
    await new Promise(r => setTimeout(r, 100));
  }
  await new Promise(r => setTimeout(r, 1200));
}

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { launchSupervisedStack } from '../tests/helpers/supervised-stack.mjs';

const run = promisify(execFile);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function removeTree(target) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try { await rm(target, { recursive: true, force: true }); return; }
    catch (error) {
      if (!['EBUSY', 'ENOTEMPTY', 'EPERM'].includes(error.code)) throw error;
      await sleep(500);
    }
  }
}

// Canonical acceptance: every privileged operation runs through the supervised
// facade, the transport actor is paired, and each mutation is an explicitly
// approved exact operation. Routes whose HTTP surface is intentionally
// unenrolled (LSP document sync) are asserted fail-closed instead.
const workspace = await mkdtemp(path.join(tmpdir(), 'aide-real-acceptance-'));
await mkdir(path.join(workspace, 'tasks'), { recursive: true });
await mkdir(path.join(workspace, 'plugins', 'real-plugin'), { recursive: true });
await mkdir(path.join(workspace, 'academy', 'courses'), { recursive: true });
await mkdir(path.join(workspace, 'providers'), { recursive: true });
await mkdir(path.join(workspace, '.aide'), { recursive: true });
await writeFile(path.join(workspace, 'README.md'), 'base\n');
await writeFile(path.join(workspace, 'sample.ts'), "const message = 'task';\nmessage.\n");
await writeFile(path.join(workspace, 'tasks', 'manifest.json'), JSON.stringify({ tasks: [{ id: 'real-task', label: 'Real task', program: 'node', args: ['-e', "process.stdout.write('task-ok')"] }] }));
await writeFile(path.join(workspace, '.aide', 'tasks.json'), JSON.stringify({ version: '2.0.0', tasks: [{ label: 'Real task', type: 'shell', command: 'node', args: ['-e', "process.stdout.write('task-ok')"] }] }));
await writeFile(path.join(workspace, 'plugins', 'presets.json'), '[]');
await writeFile(path.join(workspace, 'plugins', 'real-plugin', 'aide-plugin.json'), JSON.stringify({ id: 'real-plugin', name: 'Real Plugin', version: '1.0.0', api_version: '1', entry: 'index.mjs', capabilities: ['ui.view'] }));
await writeFile(path.join(workspace, 'plugins', 'real-plugin', 'index.mjs'), "let d='';process.stdin.on('data', c => d += c);process.stdin.on('end', () => process.stdout.write(JSON.stringify({accepted:JSON.parse(d).value})));\n");
await writeFile(path.join(workspace, 'academy', 'courses', 'real.json'), JSON.stringify({ id: 'real-course', title: 'Real Course', level: 'beginner', lessons: [{ id: 'one', title: 'One', kind: 'exercise', objective: 'Test one', check: 'node' }] }));
await writeFile(path.join(workspace, 'providers', 'manifest.json'), JSON.stringify({ providers: [{ id: 'local', name: 'Local', kind: 'openai-compatible', endpoint: 'http://127.0.0.1:1/v1', model: 'local', offline: true }] }));
await run('git', ['init', '-q'], { cwd: workspace });
await run('git', ['config', 'user.name', 'AIDE Acceptance'], { cwd: workspace });
await run('git', ['config', 'user.email', 'acceptance@aide.invalid'], { cwd: workspace });
await run('git', ['add', '.'], { cwd: workspace });
await run('git', ['commit', '-qm', 'base'], { cwd: workspace });

const stack = await launchSupervisedStack({ workspace });
try {
  // PHASE 1: boot and workspace tree
  const tree = await stack.json('facade', 'GET', '/api/workspace/tree');
  assert.equal(tree.status, 200);
  assert.ok(tree.body.data.tree.some(item => item.name === 'README.md'), JSON.stringify(tree.body).slice(0, 200));

  // PHASE 2: file write — unapproved fails closed, non-explicit approval is denied at the route, exact approved write lands
  const unapproved = await stack.json('facade', 'POST', '/api/file/write', { body: { path: 'README.md', content: 'blocked', approved: false } });
  assert.equal(unapproved.status, 409, `unapproved write must be denied (got ${unapproved.status})`);
  assert.equal(unapproved.body.error?.detail?.reason, 'APPROVAL_REQUIRED');
  const notExplicit = await stack.approveJson({ adapter: 'ts', method: 'POST', path: '/api/file/write', body: { path: 'README.md', content: 'blocked', approved: false } });
  assert.equal(notExplicit.status, 403, 'approved operation without explicit approval flag is still forbidden');
  const written = await stack.approveJson({ adapter: 'ts', method: 'POST', path: '/api/file/write', body: { path: 'README.md', content: 'edited\n', approved: true } });
  assert.equal(written.status, 200, JSON.stringify(written.body).slice(0, 200));
  const read = await stack.json('facade', 'GET', '/api/file?path=README.md');
  assert.match(read.body.data.content, /edited/, 'file content round-trips');

  // PHASE 3: patch apply (approved exact operation)
  const patch = 'diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-edited\n+patched\n';
  const patched = await stack.approveJson({ adapter: 'ts', method: 'POST', path: '/api/patch/apply', body: { patch, approved: true } });
  assert.equal(patched.status, 200, JSON.stringify(patched.body).slice(0, 200));

  // PHASE 4: terminal (approved exact operation)
  const terminal = await stack.approveJson({ adapter: 'ts', method: 'POST', path: '/api/terminal/run', body: { program: 'echo', args: ['terminal-ok'], approved: true } });
  assert.equal(terminal.status, 200);
  assert.equal(terminal.body.data.stdout.trim(), 'terminal-ok');

  // PHASE 5: LSP — start/stop are enrolled executes; document sync stays fail-closed
  const lspStart = await stack.approveJson({ adapter: 'ts', method: 'POST', path: '/api/lsp/start', body: { languageId: 'typescript' } });
  assert.equal(lspStart.status, 200, JSON.stringify(lspStart.body).slice(0, 200));
  const syncAttempt = await stack.json('facade', 'POST', '/api/lsp/request', { body: { id: 'typescript', message: { method: 'initialize', params: {} } } });
  assert.equal(syncAttempt.status, 403, 'document sync HTTP surface must remain fail-closed');
  const lspStop = await stack.approveJson({ adapter: 'ts', method: 'POST', path: '/api/lsp/stop', body: { id: 'typescript' } });
  assert.equal(lspStop.status, 200, JSON.stringify(lspStop.body).slice(0, 200));

  // PHASE 6: task run (approved exact operation) with terminal state observed.
  // The task service proposes each command as its own exact operation; the
  // operator approves them through the authenticated event channel.
  const approvals = await (async () => {
    const socket = await stack.openEventSocket(['tasks']);
    const loop = stack.autoApprove(socket);
    return { ...loop, socket };
  })();
  let task;
  try {
    task = await stack.approveJson({ adapter: 'ts', method: 'POST', path: '/api/tasks/run', body: { label: 'Real task' } });
    assert.equal(task.status, 200, JSON.stringify(task.body).slice(0, 200));
    const jobId = task.body.data.job_id;
    let job = null;
    for (let i = 0; i < 100; i += 1) {
      await sleep(200);
      const status = await stack.json('facade', 'GET', '/api/tasks/status');
      job = (status.body.data.jobs ?? []).find(entry => entry.job_id === jobId) ?? null;
      if (job && job.status !== 'running') break;
    }
    assert.ok(job, 'task job visible in status');
    assert.equal(job.status, 'exited', JSON.stringify(job).slice(0, 200));
    assert.equal(job.exitCode, 0, 'task exits cleanly');
  } finally {
    approvals.stop();
    approvals.socket.terminate();
  }

  // PHASE 7: Git — read-only diff, approved stage and commit
  const gitStatus = await stack.json('facade', 'GET', '/api/git/status');
  assert.equal(gitStatus.status, 200);
  assert.ok(gitStatus.body.data.changes.some(change => change.path === 'README.md'), JSON.stringify(gitStatus.body).slice(0, 220));
  const gitDiff = await stack.json('facade', 'POST', '/api/git/diff', { body: { path: 'README.md' } });
  assert.equal(gitDiff.status, 200);
  assert.match(gitDiff.body.data.text, /patched/);
  const staged = await stack.approveJson({ adapter: 'ts', method: 'POST', path: '/api/git/stage', body: { paths: ['README.md'] } });
  assert.equal(staged.status, 200, JSON.stringify(staged.body).slice(0, 200));
  const committed = await stack.approveJson({ adapter: 'ts', method: 'POST', path: '/api/git/commit', body: { message: 'acceptance change' } });
  assert.equal(committed.status, 200, JSON.stringify(committed.body).slice(0, 200));

  // PHASE 8: session (approved exact write, read round-trip)
  const sessionSave = await stack.approveJson({ adapter: 'ts', method: 'PUT', path: '/api/session', body: { active_file: 'README.md', open_files: ['README.md'], panel: 'terminal' } });
  assert.equal(sessionSave.status, 200, JSON.stringify(sessionSave.body).slice(0, 200));
  const sessionRead = await stack.json('facade', 'GET', '/api/session');
  assert.equal(sessionRead.body.data.active_file, 'README.md');

  // PHASE 9: plugins — approved trust and execute
  const trust = await stack.approveJson({ adapter: 'ts', method: 'POST', path: '/api/plugins/trust', body: { id: 'real-plugin', trusted: true } });
  assert.equal(trust.status, 200, JSON.stringify(trust.body).slice(0, 200));
  const plugin = await stack.approveJson({ adapter: 'ts', method: 'POST', path: '/api/plugins/execute', body: { id: 'real-plugin', payload: { value: 'plugin-ok' } } });
  assert.equal(plugin.status, 200);
  assert.equal(plugin.body.data.result.accepted, 'plugin-ok');

  // PHASE 10: academy — catalog read plus approved deterministic check and completion
  const academy = await stack.json('facade', 'GET', '/api/academy');
  assert.equal(academy.body.data.courses.length, 3, JSON.stringify(academy.body).slice(0, 220));
  const lessonCheck = await stack.approveJson({ adapter: 'ts', method: 'POST', path: '/api/academy/check', body: { courseId: 'python-foundations', lessonId: 'variables' } });
  assert.equal(lessonCheck.status, 200, JSON.stringify(lessonCheck.body).slice(0, 200));
  assert.equal(lessonCheck.body.data.passed, true);
  const lessonComplete = await stack.approveJson({ adapter: 'ts', method: 'POST', path: '/api/academy/complete', body: { courseId: 'python-foundations', lessonId: 'variables', reflection: 'acceptance task completed' } });
  assert.equal(lessonComplete.status, 200, JSON.stringify(lessonComplete.body).slice(0, 220));
  assert.ok(lessonComplete.body.data.progress.completed.includes('variables'), JSON.stringify(lessonComplete.body).slice(0, 220));

  // PHASE 11: providers, artifacts, search semantics
  const providers = await stack.json('facade', 'GET', '/api/providers');
  assert.equal(providers.status, 200);
  assert.ok(providers.body.data.providers.length >= 3, 'builtin provider list is non-empty');
  const artifacts = await stack.json('facade', 'GET', '/api/artifacts');
  assert.equal(artifacts.status, 200);
  const search = await stack.json('facade', 'GET', '/api/search?q=patched');
  assert.equal(search.body.data.total, 1);
  assert.equal(search.body.data.results[0].path, 'README.md');
  assert.match(search.body.data.results[0].hits[0].text, /patched/);
  const emptyQuery = await stack.json('facade', 'GET', '/api/search?q=');
  assert.equal(emptyQuery.status, 400, 'empty query rejected at the strict contract edge');
  assert.equal(emptyQuery.body.error.code, 'BAD_REQUEST');
  const longQuery = await stack.json('facade', 'GET', `/api/search?q=${'a%20very%20long%20query%20'.repeat(20)}`);
  assert.equal(longQuery.status, 400, 'oversized query rejected at the strict contract edge');

  console.log('REAL AIDE ACCEPTANCE PASSED: supervised boot, fail-closed + approved writes, patch, terminal, LSP lifecycle (sync fail-closed), task, git, session, plugins, academy, providers, artifacts, search contracts');
} finally {
  await stack.close();
  await removeTree(workspace);
}

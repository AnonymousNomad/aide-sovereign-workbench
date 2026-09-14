import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, stat } from 'node:fs/promises';
import os from 'node:os';
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

function localDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Canonical P0 acceptance on the supervised stack. Privileged operations are
// approved exact operations; surfaces that are intentionally fail-closed today
// (BYOK mutation routes still migration-waived, unapproved agent start) are
// asserted as denials instead of being bypassed.
const workspace = await mkdtemp(path.join(os.tmpdir(), 'aide-p0-ws-'));
const tmpHome = await mkdtemp(path.join(os.tmpdir(), 'aide-p0-home-'));
const modelsDir = path.join(workspace, 'models');
await mkdir(path.join(workspace, 'tasks'), { recursive: true });
await mkdir(path.join(workspace, 'plugins', 'p0-plugin'), { recursive: true });
await mkdir(path.join(workspace, 'academy', 'courses'), { recursive: true });
await mkdir(path.join(workspace, 'providers'), { recursive: true });
await mkdir(modelsDir, { recursive: true });
await mkdir(path.join(workspace, '.aide'), { recursive: true });
await writeFile(path.join(workspace, 'README.md'), 'base\n');
await writeFile(path.join(workspace, 'note.md'), 'alpha\nbeta\ngamma\n');
await writeFile(path.join(workspace, 'sample.ts'), "const message = 'p0';\nmessage.\n");
await writeFile(path.join(workspace, 'tasks', 'manifest.json'), JSON.stringify({ tasks: [{ id: 'p0-task', label: 'P0 task', program: 'node', args: ['-e', "process.stdout.write('p0-task-ok')"] }] }));
await writeFile(path.join(workspace, '.aide', 'tasks.json'), JSON.stringify({ version: '2.0.0', tasks: [{ label: 'P0 task', type: 'shell', command: 'node', args: ['-e', "process.stdout.write('p0-task-ok')"] }] }));
await writeFile(path.join(workspace, 'plugins', 'presets.json'), '[]');
await writeFile(path.join(workspace, 'plugins', 'p0-plugin', 'aide-plugin.json'), JSON.stringify({ id: 'p0-plugin', name: 'P0 Plugin', version: '1.0.0', api_version: '1', entry: 'index.mjs', capabilities: ['ui.view'] }));
await writeFile(path.join(workspace, 'plugins', 'p0-plugin', 'index.mjs'), "let d='';process.stdin.on('data', c => d += c);process.stdin.on('end', () => process.stdout.write(JSON.stringify({accepted:JSON.parse(d).value})));\n");
await writeFile(path.join(workspace, 'providers', 'manifest.json'), JSON.stringify({ providers: [{ id: 'local', name: 'Local', kind: 'openai-compatible', endpoint: 'http://127.0.0.1:1/v1', model: 'local', offline: true }] }));
await run('git', ['init', '-q'], { cwd: workspace });
await run('git', ['config', 'user.name', 'AIDE P0 Acceptance'], { cwd: workspace });
await run('git', ['config', 'user.email', 'p0@aide.invalid'], { cwd: workspace });
await run('git', ['add', '.'], { cwd: workspace });
await run('git', ['commit', '-qm', 'base'], { cwd: workspace });

const env = {
  AIDE_WORKSPACE: workspace,
  USERPROFILE: tmpHome,
  HOMEDRIVE: path.parse(tmpHome).root,
  HOMEPATH: tmpHome.slice(path.parse(tmpHome).root.length),
  AIDE_MODEL_DIR: modelsDir,
  AIDE_CLOSED_LOOP: 'false',
  AIDE_ALLOW_PLAINTEXT_SECRETS: '1'
};

let stack = await launchSupervisedStack({ workspace, env });
try {
  // PHASE 1: boot and workspace tree
  const tree = await stack.json('facade', 'GET', '/api/workspace/tree');
  assert.equal(tree.status, 200);
  assert.ok(tree.body.data.tree.some(item => item.name === 'README.md'), 'tree lists README.md');

  // PHASE 2: file open/write authority matrix
  const unapproved = await stack.json('facade', 'POST', '/api/file/write', { body: { path: 'README.md', content: 'blocked', approved: false } });
  assert.equal(unapproved.status, 409, `unapproved write must be denied (got ${unapproved.status})`);
  assert.equal(unapproved.body.error?.detail?.reason, 'APPROVAL_REQUIRED');
  const notExplicit = await stack.approveJson({ adapter: 'ts', method: 'POST', path: '/api/file/write', body: { path: 'README.md', content: 'blocked', approved: false } });
  assert.equal(notExplicit.status, 403, 'approved operation without the explicit flag is forbidden');
  const written = await stack.approveJson({ adapter: 'ts', method: 'POST', path: '/api/file/write', body: { path: 'README.md', content: 'edited by acceptance\n', approved: true } });
  assert.equal(written.status, 200, JSON.stringify(written.body).slice(0, 200));
  const read = await stack.json('facade', 'GET', '/api/file?path=README.md');
  assert.match(read.body.data.content, /edited by acceptance/, 'file content round-trips');

  // PHASE 3: language server lifecycle — enrolled start/stop, fail-closed document sync
  const lspStart = await stack.approveJson({ adapter: 'ts', method: 'POST', path: '/api/lsp/start', body: { languageId: 'typescript' } });
  assert.equal(lspStart.status, 200, JSON.stringify(lspStart.body).slice(0, 200));
  for (const [pathname, body] of [['/api/lsp/request', { id: 'typescript', message: { method: 'initialize', params: {} } }], ['/api/lsp/notify', { id: 'typescript', message: { method: 'initialized', params: {} } }]]) {
    const denied = await stack.json('facade', 'POST', pathname, { body });
    assert.equal(denied.status, 403, `${pathname} must remain fail-closed`);
  }
  const lspStop = await stack.approveJson({ adapter: 'ts', method: 'POST', path: '/api/lsp/stop', body: { id: 'typescript' } });
  assert.equal(lspStop.status, 200, JSON.stringify(lspStop.body).slice(0, 200));

  // PHASE 4: terminal (approved exact operation)
  const terminal = await stack.approveJson({ adapter: 'ts', method: 'POST', path: '/api/terminal/run', body: { program: 'echo', args: ['p0-terminal-ok'], approved: true } });
  assert.equal(terminal.status, 200);
  assert.match(terminal.body.data.stdout, /p0-terminal-ok/, 'terminal stdout');

  // PHASE 5: task run — the service proposes each command; the operator approves
  // on the authenticated event channel; the job reaches a clean exit.
  const approvals = await (async () => {
    const socket = await stack.openEventSocket(['tasks']);
    const loop = stack.autoApprove(socket);
    return { ...loop, socket };
  })();
  try {
    const task = await stack.approveJson({ adapter: 'ts', method: 'POST', path: '/api/tasks/run', body: { label: 'P0 task' } });
    assert.equal(task.status, 200, JSON.stringify(task.body).slice(0, 200));
    const jobId = task.body.data.job_id;
    let finalJob = null;
    for (let i = 0; i < 100; i += 1) {
      await sleep(200);
      const status = await stack.json('facade', 'GET', '/api/tasks/status');
      finalJob = (status.body.data.jobs ?? []).find(job => job.job_id === jobId) ?? null;
      if (finalJob && finalJob.status !== 'running') break;
    }
    assert.ok(finalJob, 'task job found in status');
    assert.equal(finalJob.status, 'exited', JSON.stringify(finalJob).slice(0, 220));
    assert.equal(finalJob.exitCode, 0, 'task exits cleanly');
  } finally {
    approvals.stop();
    approvals.socket.terminate();
  }

  // PHASE 6: git — approved stage and commit after a read-only status
  const gitStatus = await stack.json('facade', 'GET', '/api/git/status');
  assert.equal(gitStatus.status, 200);
  assert.ok(gitStatus.body.data.changes.some(change => change.path === 'README.md'), 'git status lists README.md');
  const staged = await stack.approveJson({ adapter: 'ts', method: 'POST', path: '/api/git/stage', body: { paths: ['README.md'] } });
  assert.equal(staged.status, 200, JSON.stringify(staged.body).slice(0, 200));
  const committed = await stack.approveJson({ adapter: 'ts', method: 'POST', path: '/api/git/commit', body: { message: 'acceptance edit' } });
  assert.equal(committed.status, 200, JSON.stringify(committed.body).slice(0, 200));

  // PHASE 7: model status surface (read; first call may run the engine probe)
  const models = await stack.json('facade', 'GET', '/api/models/status', { signal: AbortSignal.timeout(120000) });
  assert.equal(models.status, 200);
  assert.ok(Array.isArray(models.body.data.models), 'models status returns models array');

  // PHASE 8: BYOK mutation routes are still migration-waived: they must fail
  // closed for a paired operator until their authority decision lands.
  const byokWrites = [
    ['PUT', '/api/byok/providers/set', { provider: { id: 'hermetic', name: 'Hermetic', base_url: 'http://127.0.0.1:1/v1', api_type: 'chat-completions', model_id: 'hermetic-1', tool_calling: true } }],
    ['PUT', '/api/byok/key', { provider_id: 'hermetic', api_key: 'sk-hermetic-p0-test' }],
    ['PUT', '/api/byok/routing', { routing: { plan: 'local', act: { provider_id: 'hermetic', model_id: 'hermetic-1' }, utility: 'local' } }],
    ['PUT', '/api/byok/consent', { enabled: true }],
    ['POST', '/api/byok/test', { provider_id: 'hermetic' }]
  ];
  for (const [method, pathname, body] of byokWrites) {
    const denied = await stack.json('facade', method, pathname, { body });
    assert.equal(denied.status, 403, `${method} ${pathname} must remain fail-closed`);
    assert.equal(denied.body.error.code, 'FORBIDDEN');
  }
  const byokStatus = await stack.json('facade', 'GET', '/api/byok/status');
  assert.equal(byokStatus.status, 200);
  assert.equal(byokStatus.body.data.consent_enabled, false, 'consent never enabled by denied writes');

  // PHASE 9: unapproved agent start is rejected at the authority edge
  const agentDenied = await stack.json('facade', 'POST', '/api/agent/start', { body: { task: 'Improve note.md', mode: 'act', chat_source: 'provider' } });
  assert.equal(agentDenied.status, 409, 'agent start requires an approved exact operation');
  assert.equal(agentDenied.body.error?.detail?.reason, 'APPROVAL_REQUIRED');

  // PHASE 10: session (approved exact write, read round-trip)
  const sessionSave = await stack.approveJson({ adapter: 'ts', method: 'PUT', path: '/api/session', body: { active_file: 'note.md', open_files: ['note.md', 'README.md'], panel: 'terminal' } });
  assert.equal(sessionSave.status, 200, JSON.stringify(sessionSave.body).slice(0, 200));
  const sessionRead = await stack.json('facade', 'GET', '/api/session');
  assert.equal(sessionRead.body.data.active_file, 'note.md', 'session round-trips');

  // PHASE 11: restart the whole stack and verify state survives on disk
  await stack.close();
  stack = await launchSupervisedStack({ workspace, env });
  const sessionAfter = await stack.json('facade', 'GET', '/api/session');
  assert.equal(sessionAfter.body.data.active_file, 'note.md', 'session recovered after restart');
  const fileAfter = await stack.json('facade', 'GET', '/api/file?path=README.md');
  assert.match(fileAfter.body.data.content, /edited by acceptance/, 'file edit persists after restart');
  const treeAfter = await stack.json('facade', 'GET', '/api/workspace/tree');
  assert.equal(treeAfter.status, 200, 'workspace tree after restart');

  console.log('P0 AIDE ACCEPTANCE PASSED: supervised boot + pairing, file authority matrix, LSP lifecycle with fail-closed document sync, terminal, task with live command approvals, git, model status, BYOK fail-closed posture, unapproved agent start denial, session round-trip, restart persistence');
} finally {
  await stack.close();
  await removeTree(workspace);
  await removeTree(tmpHome);
}

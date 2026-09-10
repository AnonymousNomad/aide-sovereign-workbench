import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = promisify(execFile);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function localDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitExit(child, timeoutMs = 5000) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    sleep(timeoutMs)
  ]);
}

function killTree(children) {
  return Promise.all(children.map(async record => {
    const child = record?.child;
    if (!child) return;
    try { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); } catch {}
    await waitExit(child, 3000);
    try { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); } catch {}
    await waitExit(child, 1000);
    await new Promise(resolve => {
      const taskkill = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      taskkill.once('exit', resolve);
      taskkill.once('error', resolve);
    });
  }));
}

const children = [];

function spawnChild(label, args, env) {
  const child = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let stderr = '';
  let exitInfo = null;
  child.stderr.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-8000); });
  child.once('error', error => { exitInfo = exitInfo || `spawn error: ${error.message}`; });
  child.once('exit', (code, signal) => { exitInfo = exitInfo || `exited early (code=${code}, signal=${signal || 'none'})`; });
  const record = { label, child, get stderr() { return stderr; }, get exitInfo() { return exitInfo; } };
  children.push(record);
  return record;
}

async function removeTree(target) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try { await rm(target, { recursive: true, force: true }); return; }
    catch (error) {
      if (!['EBUSY', 'ENOTEMPTY', 'EPERM'].includes(error.code)) throw error;
      await sleep(500);
    }
  }
}

// --- hermetic fake OpenAI-compatible provider (the "external" BYOK leg) ---
const providerCalls = [];
function startFakeProvider() {
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    const json = body => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    if (request.method === 'GET' && !raw) {
      json({ object: 'list', data: [{ id: 'hermetic-1', object: 'model', owned_by: 'p0-test' }] });
      return;
    }
    let payload = {};
    try { payload = JSON.parse(raw); } catch {}
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    const last = messages.length ? String(messages[messages.length - 1].content ?? '') : '';
    providerCalls.push({ path: request.url, messages: messages.length });
    const content = last.startsWith('<tool_result')
      ? '<attempt_completion>\n<result>note.md improved via hermetic BYOK provider</result>\n</attempt_completion>'
      : '<replace_in_file>\n<path>note.md</path>\n<content><<<<<<< SEARCH\nalpha\n=======\nalpha-ai\nAI-EDIT-VERIFIED\n>>>>>>> REPLACE</content>\n</replace_in_file>';
    json({ id: 'chatcmpl-p0', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content } }] });
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// --- workspace + homedir (hermetic: secret store must NOT touch operator home) ---
const workspace = await mkdtemp(path.join(os.tmpdir(), 'aide-p0-ws-'));
const tmpHome = await mkdtemp(path.join(os.tmpdir(), 'aide-p0-home-'));
const modelsDir = path.join(workspace, 'models');
await mkdir(path.join(workspace, 'tasks'), { recursive: true });
await mkdir(path.join(workspace, 'plugins', 'p0-plugin'), { recursive: true });
await mkdir(path.join(workspace, 'academy', 'courses'), { recursive: true });
await mkdir(path.join(workspace, 'providers'), { recursive: true });
await mkdir(modelsDir, { recursive: true });
await writeFile(path.join(workspace, 'README.md'), 'base\n');
await writeFile(path.join(workspace, 'note.md'), 'alpha\nbeta\ngamma\n');
await writeFile(path.join(workspace, 'sample.ts'), "const message = 'p0';\nmessage.\n");
await writeFile(path.join(workspace, 'tasks', 'manifest.json'), JSON.stringify({ tasks: [{ id: 'p0-task', label: 'P0 task', program: 'node', args: ['-e', "process.stdout.write('p0-task-ok')"] }] }));
await writeFile(path.join(workspace, 'plugins', 'presets.json'), '[]');
await writeFile(path.join(workspace, 'plugins', 'p0-plugin', 'aide-plugin.json'), JSON.stringify({ id: 'p0-plugin', name: 'P0 Plugin', version: '1.0.0', api_version: '1', entry: 'index.mjs', capabilities: ['ui.view'] }));
await writeFile(path.join(workspace, 'plugins', 'p0-plugin', 'index.mjs'), "let d='';process.stdin.on('data', c => d += c);process.stdin.on('end', () => process.stdout.write(JSON.stringify({accepted:JSON.parse(d).value})));\n");
await writeFile(path.join(workspace, 'providers', 'manifest.json'), JSON.stringify({ providers: [{ id: 'local', name: 'Local', kind: 'openai-compatible', endpoint: 'http://127.0.0.1:1/v1', model: 'local', offline: true }] }));
await run('git', ['init', '-q'], { cwd: workspace });
await run('git', ['config', 'user.name', 'AIDE P0 Acceptance'], { cwd: workspace });
await run('git', ['config', 'user.email', 'p0@aide.invalid'], { cwd: workspace });
await run('git', ['add', '.'], { cwd: workspace });
await run('git', ['commit', '-qm', 'base'], { cwd: workspace });

// --- ports + fake provider ---
const provider = await startFakeProvider();
const providerPort = provider.address().port;
const archPort = await freePort();
const legacyPort = await freePort();
const facadePort = await freePort();

const sharedEnv = { AIDE_WORKSPACE: workspace, USERPROFILE: tmpHome, HOMEDRIVE: path.parse(tmpHome).root, HOMEPATH: tmpHome.slice(path.parse(tmpHome).root.length), AIDE_MODEL_DIR: modelsDir, AIDE_CLOSED_LOOP: 'false', AIDE_ALLOW_PLAINTEXT_SECRETS: '1' };

function boot(label, args, env) { return spawnChild(label, args, { ...env, ...sharedEnv }); }

function bootAll() {
  const arch = boot('arch', ['node/src/server.ts'], { AIDE_ARCH_PORT: String(archPort), AIDE_VERSION: 'p0-acceptance' });
  const legacy = boot('legacy', ['daemon/server.mjs'], { AIDE_DAEMON_PORT: String(legacyPort), AIDE_LEGACY_PORT: String(legacyPort) });
  const facade = boot('facade', ['scripts/facade.mjs'], { AIDE_ARCH_PORT: String(archPort), AIDE_LEGACY_PORT: String(legacyPort), AIDE_DAEMON_PORT: String(legacyPort), AIDE_FACADE_PORT: String(facadePort) });
  return { arch, legacy, facade };
}

function requestMethod(method, port, pathPart, payload) {
  const init = { method, headers: { 'Content-Type': 'application/json' } };
  if (payload !== undefined) init.body = JSON.stringify(payload);
  return fetch(`http://127.0.0.1:${port}${pathPart}`, init);
}

async function request(port, pathPart, payload) { return requestMethod('GET', port, pathPart, payload); }

async function post(port, pathPart, payload) { return requestMethod('POST', port, pathPart, payload); }

async function put(port, pathPart, payload) { return requestMethod('PUT', port, pathPart, payload); }

let passed = false;
try {
  const { arch, legacy, facade } = bootAll();

  async function readyPhase() {
    for (let i = 0; i < 200; i += 1) {
      const bad = children.find(c => c.exitInfo);
      if (bad) throw new Error(`${bad.label}: ${bad.exitInfo}${bad.stderr ? ` stderr: ${bad.stderr.trim()}` : ''}`);
      let ok = true;
      try { if (!(await fetch(`http://127.0.0.1:${archPort}/api/health`)).ok) ok = false; } catch { ok = false; }
      try { if (!(await fetch(`http://127.0.0.1:${legacyPort}/health`)).ok) ok = false; } catch { ok = false; }
      if (ok) return;
      await sleep(100);
    }
    const reports = children.map(c => `${c.label}: ${c.exitInfo || 'alive'}${c.stderr ? ` stderr=[${c.stderr.trim().slice(0, 300)}]` : ''}`).join(' | ');
    throw new Error(`backends not ready after 20s (${reports})`);
  }

  async function expectOk(res, what) {
    const parsed = await res.json().catch(() => ({}));
    assert.equal(res.status, 200, `${what}: expected 200, got ${res.status} body=${JSON.stringify(parsed)}`);
    return parsed;
  }

  // PHASE 1: boot and bootstrapped workspace
  await readyPhase();
  let res = await request(facadePort, '/api/workspace/tree');
  let body = await expectOk(res, 'workspace tree');
  assert.ok(body.tree.some(item => item.name === 'README.md'), 'tree lists README.md');

  // PHASE 2: file open/write with explicit approval (TS route via facade)
  res = await post(facadePort, '/api/file/write', { path: 'README.md', content: 'blocked', approved: false });
  assert.equal(res.status, 403, `unapproved write must be FORBIDDEN (got ${res.status})`);
  body = await res.json();
  assert.equal(body.code, 'FORBIDDEN', 'unapproved write returns FORBIDDEN code');
  res = await post(facadePort, '/api/file/write', { path: 'README.md', content: 'edited by acceptance\n', approved: true });
  body = await expectOk(res, 'approved file write');
  res = await request(facadePort, '/api/file?path=README.md');
  body = await res.json();
  assert.match(body.content, /edited by acceptance/, 'file content round-trips');

  // PHASE 3: language server (legacy route via facade default)
  res = await post(facadePort, '/api/lsp/start', { id: 'typescript' });
  await expectOk(res, 'lsp start');
  const lspCapabilities = { textDocument: { publishDiagnostics: { relatedInformation: true }, completion: { completionItem: { snippetSupport: true } }, definition: { linkSupport: true }, hover: { contentFormat: ['markdown', 'plaintext'] } } };
  res = await post(facadePort, '/api/lsp/request', { id: 'typescript', message: { method: 'initialize', params: { processId: null, rootUri: 'file:///workspace', capabilities: lspCapabilities } } });
  body = await expectOk(res, 'lsp initialize');
  assert.ok(body.result, 'lsp initialize result present');
  await post(facadePort, '/api/lsp/notify', { id: 'typescript', message: { method: 'initialized', params: {} } });
  res = await post(facadePort, '/api/lsp/notify', { id: 'typescript', message: { method: 'textDocument/didOpen', params: { textDocument: { uri: 'file:///workspace/sample.ts', languageId: 'typescript', version: 1, text: "const message = 'p0';\nmessage.\n" } } } });
  await expectOk(res, 'lsp didOpen');
  res = await post(facadePort, '/api/lsp/request', { id: 'typescript', message: { method: 'textDocument/completion', params: { textDocument: { uri: 'file:///workspace/sample.ts' }, position: { line: 1, character: 8 } } } });
  const completion = await expectOk(res, 'lsp completion');
  assert.ok((completion.result?.items || completion.result || []).length > 0, `lsp completion returned items (${JSON.stringify(completion).slice(0, 200)})`);
  await post(facadePort, '/api/lsp/stop', { id: 'typescript' });

  // PHASE 4: terminal (legacy route via facade)
  res = await post(facadePort, '/api/terminal/run', { program: 'echo', args: ['p0-terminal-ok'], approved: true });
  body = await expectOk(res, 'terminal run');
  assert.match(body.stdout, /p0-terminal-ok/, 'terminal stdout');

  // PHASE 5: task (legacy route via facade)
  res = await post(facadePort, '/api/tasks/run', { id: 'p0-task' });
  let status = await expectOk(res, 'task run');
  for (let i = 0; i < 20; i += 1) {
    await sleep(100);
    res = await request(facadePort, '/api/tasks/status');
    status = await res.json();
    if (status.status !== 'running') break;
  }
  assert.equal(status.status, 'passed', 'task passes');
  assert.match(status.stdout, /p0-task-ok/, 'task stdout');

  // PHASE 6: git (canonical TS route via facade)
  res = await request(facadePort, '/api/git/status');
  body = await expectOk(res, 'git status');
  assert.ok(body.changes.some(change => change.path === 'README.md'), 'git status lists README.md');
  res = await post(facadePort, '/api/git/stage', { paths: ['README.md'] });
  await expectOk(res, 'git stage');
  res = await post(facadePort, '/api/git/commit', { message: 'acceptance edit' });
  await expectOk(res, 'git commit');

  // PHASE 7: model status surface (legacy route via facade, empty-but-alive)
  res = await request(facadePort, '/api/models/status');
  body = await expectOk(res, 'models status');
  assert.ok(Array.isArray(body.models), 'models status returns models array');

  // PHASE 8: BYOK consent + hermetic provider (TS routes via facade)
  res = await put(facadePort, '/api/byok/providers/set', { provider: { id: 'hermetic', name: 'Hermetic', base_url: `http://127.0.0.1:${providerPort}/v1`, api_type: 'chat-completions', model_id: 'hermetic-1', tool_calling: true } });
  await expectOk(res, 'byok provider set');
  res = await put(facadePort, '/api/byok/key', { provider_id: 'hermetic', api_key: 'sk-hermetic-p0-test' });
  body = await expectOk(res, 'byok key set');
  assert.equal(body.stored, true, 'byok key stored');
  res = await put(facadePort, '/api/byok/routing', { routing: { plan: 'local', act: { provider_id: 'hermetic', model_id: 'hermetic-1' }, utility: 'local' } });
  await expectOk(res, 'byok routing set');
  res = await put(facadePort, '/api/byok/consent', { enabled: true });
  await expectOk(res, 'byok consent');
  res = await request(facadePort, '/api/byok/status');
  body = await res.json();
  assert.equal(body.consent_enabled, true, 'consent enabled');
  assert.equal(body.routing.act.provider_id, 'hermetic', 'act routed to hermetic');
  assert.equal(body.providers[0].key_stored, true, 'key flagged stored without echoing material');
  assert.doesNotMatch(JSON.stringify(body), /sk-hermetic-p0-test/, 'status never echoes key material');
  res = await post(facadePort, '/api/byok/test', { provider_id: 'hermetic' });
  body = await expectOk(res, 'byok test');
  assert.equal(body.ok, true, 'byok provider test reaches provider (fetchImpl wiring works)');

  // PHASE 9: agent loop via hermetic BYOK chat (TS routes via facade)
  res = await post(facadePort, '/api/agent/start', { task: 'Improve note.md', mode: 'act', chat_source: 'provider' });
  body = await expectOk(res, 'agent start');
  const { session_id } = body;
  assert.match(session_id, /^[0-9a-f-]+$/i, 'session id returned');

  let agentStatus = null;
  for (let i = 0; i < 60; i += 1) {
    await sleep(100);
    res = await request(facadePort, `/api/agent/status?id=${session_id}`);
    const pending = await res.json();
    if (pending.state === 'awaiting_approval') { agentStatus = pending; break; }
    if (['done', 'error', 'aborted'].includes(pending.state)) { agentStatus = pending; break; }
  }
  assert.ok(agentStatus, 'agent reached visible state');
  assert.equal(agentStatus.state, 'awaiting_approval', `agent awaits approval (got ${JSON.stringify(agentStatus).slice(0, 300)})`);
  assert.equal(agentStatus.pending_approval.tool, 'replace_in_file', 'pending write tool');
  const approvalId = agentStatus.pending_approval.approval_id;

  res = await post(facadePort, '/api/agent/decision', { session_id, approval_id: approvalId, decision: 'approve' });
  await expectOk(res, 'agent decision approve');

  let finalState = null;
  for (let i = 0; i < 80; i += 1) {
    await sleep(100);
    res = await request(facadePort, `/api/agent/status?id=${session_id}`);
    const current = await res.json();
    if (['done', 'error', 'aborted'].includes(current.state)) { finalState = current; break; }
  }
  assert.equal(finalState?.state, 'done', `agent completes (got ${JSON.stringify(finalState).slice(0, 300)})`);
  const noteContent = await readFile(path.join(workspace, 'note.md'), 'utf8');
  assert.match(noteContent, /AI-EDIT-VERIFIED/, 'approved agent edit landed on disk');
  const journalText = await readFile(path.join(workspace, '.aide', 'egress', 'journal.jsonl'), 'utf8');
  assert.match(journalText, /byok-chat/, 'egress journal records chat egress');
  assert.match(journalText, /hermetic/, 'egress journal records provider id');
  assert.ok(providerCalls.some(call => call.path === '/v1/chat/completions'), 'provider served chat completions');

  // PHASE 9.5: Mission 1 closed-loop wiring — deterministic verification,
  // evidence ledger, memory digest, resident observation (all through the
  // real production chain: facade -> TS arch -> audit trail -> bus -> disk).
  async function pathExists(p) {
    try { await stat(p); return true; } catch { return false; }
  }
  async function waitForFile(dir, predicate, max = 40) {
    for (let i = 0; i < max; i += 1) {
      try {
        const names = await readdir(dir);
        const hit = names.find(predicate);
        if (hit) return hit;
      } catch {}
      await sleep(100);
    }
    return null;
  }
  const verFile = await waitForFile(path.join(workspace, '.aide', 'verifications'), n => n.endsWith('.verification.json'));
  assert.ok(verFile, 'Phase 9.5: agent.verification evidence file written');
  const verRecord = JSON.parse(await readFile(path.join(workspace, '.aide', 'verifications', verFile), 'utf8'));
  assert.equal(verRecord.outcome, 'done', 'Phase 9.5: verification outcome = done');
  assert.equal(verRecord.trajectory_format, 'aide-1', 'Phase 9.5: veritas evidence format');
  const trajFile = await waitForFile(path.join(workspace, '.aide', 'trajectories'), n => n.endsWith('.traj.json'));
  assert.ok(trajFile, 'Phase 9.5: trajectory file written');
  const busText = await readFile(path.join(workspace, '.aide', 'cipher-state.jsonl'), 'utf8');
  const busRows = busText.split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l));
  const busTypes = busRows.map(r => r.type);
  assert.ok(busTypes.includes('agent.start'), 'Phase 9.5: bus has agent.start');
  assert.ok(busTypes.includes('approval'), 'Phase 9.5: bus has legacy approval row (emitApproval piggyback)');
  assert.ok(busTypes.includes('agent.approval'), 'Phase 9.5: bus has agent.approval envelope');
  assert.ok(busTypes.includes('agent.verification'), 'Phase 9.5: bus has agent.verification row');
  // resident observation rows land after onSessionEnd flush (fire-and-forget)
  let residentRow = busRows.find(r => r.type === 'resident');
  if (!residentRow) {
    for (let i = 0; i < 40 && !residentRow; i += 1) {
      await sleep(100);
      const text2 = await readFile(path.join(workspace, '.aide', 'cipher-state.jsonl'), 'utf8');
      residentRow = text2.split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l)).find(r => r.type === 'resident');
    }
  }
  assert.ok(residentRow, 'Phase 9.5: resident observation row on bus');
  res = await request(facadePort, '/api/resident/summary');
  body = await expectOk(res, 'resident summary');
  assert.ok(body.summary && typeof body.summary.status === 'string', 'Phase 9.5: resident summary status');
  res = await request(facadePort, `/api/audit/session?id=${session_id}`);
  await expectOk(res, 'audit session');
  // memory day digest lands after onSessionEnd digest() flush (local date per memory-spine)
  const today = localDate();
  const dayFile = path.join(workspace, '.aide', 'memory', 'days', `${today}.json`);
  let dayExists = await pathExists(dayFile);
  for (let i = 0; i < 40 && !dayExists; i += 1) { await sleep(100); dayExists = await pathExists(dayFile); }
  assert.ok(dayExists, 'Phase 9.5: memory day digest file written (Mission 1 item 4)');
  const dayDigest = JSON.parse(await readFile(dayFile, 'utf8'));
  assert.equal(dayDigest.date, today, 'Phase 9.5: day digest date matches');
  assert.ok(dayDigest.approvals >= 1, 'Phase 9.5: digest counts the approval');
  assert.ok(typeof dayDigest.tools_used.write_file === 'number' || typeof dayDigest.tools_used.replace_in_file === 'number', 'Phase 9.5: digest tracks tool affinity');

  // PHASE 10: session state (legacy route via facade)
  res = await put(facadePort, '/api/session', { active_file: 'note.md', open_files: ['note.md', 'README.md'], panel: 'terminal' });
  await expectOk(res, 'session save');
  res = await request(facadePort, '/api/session');
  assert.equal((await res.json()).active_file, 'note.md', 'session round-trips');

  // PHASE 11: restart the whole stack, verify state survives on disk
  await killTree(children);
  children.length = 0;
  bootAll();
  await readyPhase();
  res = await request(facadePort, '/api/session');
  assert.equal((await res.json()).active_file, 'note.md', 'session recovered after restart');
  res = await request(facadePort, '/api/byok/status');
  body = await res.json();
  assert.equal(body.consent_enabled, true, 'byok consent persists after restart');
  res = await request(facadePort, '/api/file?path=note.md');
  body = await res.json();
  assert.match(body.content, /AI-EDIT-VERIFIED/, 'agent edit persists after restart');

  passed = true;
  console.log('P0 AIDE ACCEPTANCE PASSED: boot, file+approval gate, LSP, terminal, task, git, model status, BYOK consent+routing, provider test (fetchImpl wiring), agent approval loop, on-disk edit, egress journal, session recovery across full restack restart');
} finally {
  await killTree(children);
  await new Promise(resolve => provider.close(() => resolve()));
  await removeTree(workspace);
  await removeTree(tmpHome);
}

if (!passed) process.exitCode = 1;
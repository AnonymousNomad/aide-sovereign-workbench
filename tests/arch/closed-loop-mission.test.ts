// Mission 1 "Close the loop" end-to-end test (aide-closed-loop-wiring skill).
// Proves, through the real production call chain over HTTP:
//   1. An approved agent action writes a deterministic verification stamp
//      + evidence file + trajectory to disk.
//   2. The state bus (cipher-state.jsonl) carries agent.start, tool.call,
//      approval/rejection, agent.approval, and agent.verification rows.
//   3. On session completion the memory digest is refreshed (day file lands
//      under .aide/memory/days/).
//   4. The Resident Assistant receives a state observation row (type resident).
//   5. A rejected action produces a type rejection bus row that the
//      closed-loop selfimprove runner converts into a verifier-stamped
//      signal file (hermetic via AIDE_SELFIMPROVE_ROOT).
//   6. The /api/resident/summary surface works and returns 200.
//   7. The model prompt is injected with [WORKSPACE CONTEXT] / [SKILL CONTEXT]
//      advisory blocks (direct createAgentLoop test).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const runExec = promisify(execFile);
const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-mission-'));

const SCRIPT = path.join(repoRoot, 'scripts', 'selfimprove.mjs');

function runSelfimprove(args: string[], env: Record<string, string> = {}) {
  return runExec(process.execPath, [SCRIPT, ...args], {
    cwd: repoRoot,
    env: { ...process.env, AIDE_SELFIMPROVE_ROOT: workspace, CLOSED_LOOP_TEMP: '1', ...env },
    windowsHide: true
  }).then(out => ({ code: 0, stdout: String(out.stdout), stderr: String(out.stderr) }),
    error => ({ code: typeof error.code === 'number' ? error.code : 1, stdout: String(error.stdout || ''), stderr: String(error.stderr || '') }));
}

function runExecCmd(args: string[], env: Record<string, string> = {}) {
  return runExec('git', args, { cwd: workspace, env: { ...process.env, ...env }, windowsHide: true });
}

const { Server: NetServer } = await import('net');

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = new NetServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      s.close(() => resolve(port));
    });
  });
}

function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

function localDate(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function request(port: number, pathPart: string, payload?: unknown, method = 'GET'): Promise<Response> {
  const init: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if (payload !== undefined) init.body = JSON.stringify(payload);
  return fetch(`http://127.0.0.1:${port}${pathPart}`, init);
}

function unwrap(body: { ok?: boolean; data?: unknown } | null): unknown {
  if (body && body.ok === true && body.data !== undefined) return body.data;
  return body;
}

async function requestOk<T = unknown>(port: number, pathPart: string, payload?: unknown, method = 'GET'): Promise<T> {
  const res = await request(port, pathPart, payload, method);
  assert.equal(res.status, 200, `${method} ${pathPart}`);
  return unwrap(await res.json()) as T;
}

before(async () => {
  // hermetic workspace skeleton
  await fs.mkdir(path.join(workspace, '.aide', 'memory', 'days'), { recursive: true });
  await fs.mkdir(path.join(workspace, '.aide', 'verifications'), { recursive: true });
  await fs.mkdir(path.join(workspace, '.aide', 'trajectories'), { recursive: true });
  await fs.mkdir(path.join(workspace, '.aide', 'training'), { recursive: true });
  await fs.mkdir(path.join(workspace, 'tasks'), { recursive: true });
  await fs.mkdir(path.join(workspace, 'plugins', 'p0-plugin'), { recursive: true });
  await fs.mkdir(path.join(workspace, 'academy', 'courses'), { recursive: true });
  await fs.mkdir(path.join(workspace, 'providers'), { recursive: true });
  await fs.mkdir(path.join(workspace, 'models'), { recursive: true });
  await fs.mkdir(path.join(workspace, 'skills', 'packs', 'p0-note-edit'), { recursive: true });

  await fs.writeFile(path.join(workspace, 'README.md'), 'base\n');
  await fs.writeFile(path.join(workspace, 'note.md'), 'alpha\nbeta\ngamma\n');
  await fs.writeFile(path.join(workspace, 'sample.ts'), "const message = 'p0';\nmessage.\n");
  await fs.writeFile(path.join(workspace, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "console.log(1)"' }, dependencies: { aide: '1.0.0' } }));
  await fs.writeFile(path.join(workspace, 'tasks', 'manifest.json'), JSON.stringify({ tasks: [{ id: 'p0-task', label: 'P0 task', program: 'node', args: ['-e', "process.stdout.write('p0-task-ok')"] }] }));
  await fs.writeFile(path.join(workspace, 'plugins', 'presets.json'), '[]');
  await fs.writeFile(path.join(workspace, 'plugins', 'p0-plugin', 'aide-plugin.json'), JSON.stringify({ id: 'p0-plugin', name: 'P0 Plugin', version: '1.0.0', api_version: '1', entry: 'index.mjs', capabilities: ['ui.view'] }));
  await fs.writeFile(path.join(workspace, 'plugins', 'p0-plugin', 'index.mjs'), "let d='';process.stdin.on('data', c => d += c);process.stdin.on('end', () => process.stdout.write(JSON.stringify({accepted:JSON.parse(d).value})));\n");
  await fs.writeFile(path.join(workspace, 'providers', 'manifest.json'), JSON.stringify({ providers: [{ id: 'local', name: 'Local', kind: 'openai-compatible', endpoint: 'http://127.0.0.1:1/v1', model: 'local', offline: true }] }));
  // synthetic skill pack that matches the task "improve the note file"
  await fs.writeFile(path.join(workspace, 'skills', 'registry.json'), JSON.stringify({ generated_at: new Date().toISOString(), count: 1, categories: ['general'], skills: [{ name: 'p0-note-edit', title: 'P0 Note Editing', description: 'Guidelines for editing note files and improving note content safely.', category: 'general', path: 'skills/packs/p0-note-edit/SKILL.md' }] }));
  await fs.writeFile(path.join(workspace, 'skills', 'packs', 'p0-note-edit', 'SKILL.md'), '# P0 Note Editing\n\nAlways verify the note content after editing.\nPreserve the structure and improve clarity.\n');
  await runExecCmd(['init', '-q']);
  await runExecCmd(['config', 'user.name', 'AIDE Mission']);
  await runExecCmd(['config', 'user.email', 'mission@aide.invalid']);
  await runExecCmd(['add', '.']);
  await runExecCmd(['commit', '-qm', 'base']);
});

after(async () => {
  await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
});

type ChatFn = (messages: Array<{ role: string; content: string }>) => Promise<string>;

async function withServer(chatFn: ChatFn, fn: (ctx: { httpServer: import('node:http').Server; port: number; base: string }) => Promise<void>): Promise<void> {
  const { ArchServer } = await import('../../node/src/server.ts');
  const { buildRoutes } = await import('../../node/src/openapi.ts');
  const port = await freePort();
  const routes = await buildRoutes(workspace, 'test', {
    agentChatFn: chatFn,
    skillsRoot: workspace
  });
  const server = new ArchServer(workspace, path.join(workspace, 'server.log'));
  for (const route of routes) server.route(route);
  const httpServer = await server.listen(port);
  try {
    return await fn({ httpServer, port, base: `http://127.0.0.1:${port}` });
  } finally {
    try { httpServer.close(); } catch {}
    try { httpServer.closeAllConnections(); } catch {}
  }
}

async function startAgent(port: number, task = 'improve the note file', mode = 'act'): Promise<string> {
  const body = await requestOk<{ session_id: string }>(port, '/api/agent/start', { task, mode }, 'POST');
  return body.session_id;
}

type AgentStatus = {
  state: string;
  pending_approval?: { approval_id: string } | null;
};

async function decide(port: number, sessionId: string, decision: 'approve' | 'reject' | 'abort'): Promise<Response> {
  let pending: AgentStatus | null = null;
  for (let i = 0; i < 80; i += 1) {
    const body = await requestOk<AgentStatus>(port, `/api/agent/status?id=${sessionId}`);
    pending = body;
    if (pending.state === 'awaiting_approval') break;
    if (['done', 'error', 'aborted'].includes(pending.state)) break;
    await sleep(100);
  }
  assert.equal(pending?.state, 'awaiting_approval', `should await approval (got ${JSON.stringify(pending)?.slice(0, 200)})`);
  const approvalId = pending?.pending_approval?.approval_id;
  assert.ok(approvalId, 'approval id present');
  const dec = await request(port, '/api/agent/decision', { session_id: sessionId, approval_id: approvalId, decision }, 'POST');
  assert.equal(dec.status, 200, 'agent decision');
  return dec;
}

async function waitForState(port: number, sessionId: string, states: string[], max = 120): Promise<{ state: string } & Record<string, unknown> | null> {
  let finalState: ({ state: string } & Record<string, unknown>) | null = null;
  for (let i = 0; i < max; i += 1) {
    const body = await requestOk<AgentStatus & Record<string, unknown>>(port, `/api/agent/status?id=${sessionId}`);
    if (states.includes(body.state)) { finalState = body; break; }
    await sleep(100);
  }
  return finalState;
}

async function readBus(): Promise<Array<Record<string, any>>> {
  const text = await fs.readFile(path.join(workspace, '.aide', 'cipher-state.jsonl'), 'utf8');
  return text.split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l));
}

test('mission 1: approved agent action writes verification + evidence + bus rows + digest + resident row', async () => {
  let chatCalls = 0;
  await withServer(async (_messages) => {
    chatCalls += 1;
    if (chatCalls === 1) {
      return '<replace_in_file>\n<path>note.md</path>\n<content><<<<<<< SEARCH\nbeta\n=======\nbeta-improved\nimproved by p0 mission\n>>>>>>> REPLACE</content>\n</replace_in_file>';
    }
    return '<attempt_completion>\n<result>note.md improved</result>\n</attempt_completion>';
  }, async ({ port }) => {

  const sessionId = await startAgent(port);
  // approve the pending tool call
  await decide(port, sessionId, 'approve');
  const final = await waitForState(port, sessionId, ['done', 'error', 'aborted'], 120);
  assert.equal(final?.state, 'done', `agent should finish done (got ${JSON.stringify(final)?.slice(0, 200)})`);

  // --- evidence file ---
  const verDir = path.join(workspace, '.aide', 'verifications');
  const verFiles = (await fs.readdir(verDir)).filter(f => f.endsWith('.verification.json'));
  assert.ok(verFiles.length >= 1, 'evidence file exists');
  const firstVerFile = verFiles[0];
  assert.ok(firstVerFile, 'evidence file name present');
  const record = JSON.parse(await fs.readFile(path.join(verDir, firstVerFile), 'utf8'));
  assert.equal(record.outcome, 'done', 'verification outcome is done');
  assert.ok(record.trajectory_file.endsWith('.traj.json'), 'verification references trajectory');

  // --- trajectory file ---
  const trajDir = path.join(workspace, '.aide', 'trajectories');
  const trajFiles = (await fs.readdir(trajDir)).filter(f => f.endsWith('.traj.json'));
  assert.ok(trajFiles.length >= 1, 'trajectory file exists');

  // --- note.md was written by the approved tool ---
  const noteContent = await fs.readFile(path.join(workspace, 'note.md'), 'utf8');
  assert.match(noteContent, /improved/, 'approved replace_in_file landed on disk');

  // --- bus rows: agent.start, tool.call, agent.approval(type approval), agent.approval(type agent.approval), tool.result, agent.verification ---
  const rows = await readBus();
  const types = rows.map(r => r.type);
  assert.ok(types.includes('agent.start'), 'bus has agent.start');
  assert.ok(types.includes('tool.call') || types.includes('tool_result') || types.includes('agent.approval'), 'bus has tool/approval activity');
  assert.ok(types.includes('approval'), 'bus has legacy approval row (emitApproval piggyback)');
  assert.ok(types.includes('agent.approval'), 'bus has agent.approval row');
  assert.ok(types.includes('agent.verification'), 'bus has agent.verification row (Mission 1 item 1)');

  // find the verification row for this session
  const vRow = rows.find(r => r.type === 'agent.verification' && r.session_id === sessionId);
  assert.ok(vRow, 'verification row references this session');
  assert.equal(vRow.passed, true, 'verification records the approved-and-executed action as passed');

  // --- /api/audit/session ---
  const sessRes = await request(port, `/api/audit/session?id=${sessionId}`);
  assert.equal(sessRes.status, 200, 'audit session 200');
  const sessBody = unwrap(await sessRes.json()) as { session_id?: string; by_type?: unknown };
  assert.ok(sessBody.session_id === sessionId && sessBody.by_type, 'audit session returns trajectory for this session');

  // --- memory day digest file (local calendar date, per memory-spine) ---
  const today = localDate();
  const dayFile = path.join(workspace, '.aide', 'memory', 'days', `${today}.json`);
  await sleep(200); // allow onSessionEnd digest to flush
  const dayExists = await fs.readFile(dayFile).then(() => true).catch(() => false);
  assert.ok(dayExists, `day digest file ${dayFile} exists (Mission 1 item 4)`);
  if (dayExists) {
    const digest = JSON.parse(await fs.readFile(dayFile, 'utf8'));
    assert.equal(digest.date, today, 'day digest date matches');
    assert.ok(digest.approvals >= 1, 'day digest counts at least one approval');
  }

  // --- resident observation row in bus ---
  const residentRow = rows.find(r => r.type === 'resident' && r.session_id === sessionId);
  // onSessionEnd is fire-and-forget; give it a tick, then re-check bus
  let residentRow2 = residentRow;
  if (!residentRow2) {
    await sleep(300);
    const rows2 = await readBus();
    residentRow2 = rows2.find(r => r.type === 'resident' && r.extra?.session_id === sessionId);
  }
  assert.ok(residentRow2, 'resident observation row exists (Mission 1 item 7)');

  // --- /api/resident/summary works ---
  const residentRes = await request(port, '/api/resident/summary');
  assert.equal(residentRes.status, 200, 'resident summary 200');
  const residentBody = unwrap(await residentRes.json()) as { summary?: Record<string, unknown> };
  assert.ok(residentBody.summary, 'resident summary has data');
  });
});

test('mission 1: rejected action produces a type rejection bus row and a selfimprove signal', async () => {
  let chatCalls = 0;
  await withServer(async (_messages) => {
    chatCalls += 1;
    if (chatCalls === 1) {
      return '<replace_in_file>\n<path>note.md</path>\n<content>bad\n</content>\n</replace_in_file>';
    }
    return '<attempt_completion>\n<result>skipped</result>\n</attempt_completion>';
  }, async ({ port }) => {

  const sessionId = await startAgent(port);
  // reject the pending tool call
  await decide(port, sessionId, 'reject');
  const final = await waitForState(port, sessionId, ['done', 'error', 'aborted'], 120);
  assert.ok(final, 'agent reached terminal state');

  // --- bus has type rejection row ---
  const rows = await readBus();
  const rejRows = rows.filter(r => r.type === 'rejection');
  assert.ok(rejRows.length >= 1, 'bus has type rejection row (Mission 1 item 5)');

  // --- selfimprove runner converts it into a signal ---
  const beforeSignals = (await fs.readdir(path.join(workspace, '.aide', 'training'))).filter(n => n.startsWith('signal-') && n.endsWith('.jsonl')).length;
  const result = await runSelfimprove(['--since=1h']);
  assert.equal(result.code, 0, `selfimprove exits 0 (stderr: ${String(result.stderr).slice(0, 800)})`);
  const afterSignals = (await fs.readdir(path.join(workspace, '.aide', 'training'))).filter(n => n.startsWith('signal-') && n.endsWith('.jsonl')).length;
  assert.equal(afterSignals, beforeSignals + 1, 'selfimprove emitted one signal file (Mission 1 item 5)');
  });
});

test('mission 1: createAgentLoop injects [WORKSPACE CONTEXT] and [SKILL CONTEXT] into the model prompt', async () => {
  const { createAgentLoop } = await import('../../node/src/services/agent-loop.mjs');
  const messages: Array<{ role: string; content: string }> = [];
  const loop = createAgentLoop({
    workspace,
    chatFn: async (msgs) => { messages.push(...msgs); return '<attempt_completion>\n<result>probe</result>\n</attempt_completion>'; },
    rg: null,
    checkpoints: null,
    residentProvider: async () => 'workspace health: good. nothing pending.',
    skillProvider: async () => '# P0 Note Editing\n\nAlways verify the note content after editing.',
    audit: null
  });
  loop.start('probe the prompt injection', 'act');
  // the loop needs approval for replace_in_file; fast-fail by not deciding
  // instead just inspect the messages captured in the chatFn before
  // the loop times out. The system prompt is pushed on the FIRST
  // chatFn call, so capture that message set.
  await sleep(400);
  const systemMessage = messages.find(m => m.role === 'system' && m.content.includes('[WORKSPACE CONTEXT]'));
  assert.ok(systemMessage, 'advisory workspace-context system message was sent to the model');
  assert.match(systemMessage.content, /\[SKILL CONTEXT\]/, 'system prompt contains [SKILL CONTEXT] (Mission 1 item 9)');
  assert.ok(systemMessage.content.includes('workspace health'), 'resident context is present');
  assert.ok(systemMessage.content.includes('P0 Note Editing'), 'skill SOP excerpt is present');
});

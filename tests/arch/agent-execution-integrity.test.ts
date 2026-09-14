import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { buildRoutes } from '../../node/src/openapi.ts';
import { ArchServer } from '../../node/src/server.ts';
import { ModelRuntime } from '../../node/src/services/model-runtime.ts';
import { createStateBus } from '../../harness/cipher-state.mjs';
import { createAuditTrail } from '../../node/src/services/audit-trail.mjs';
import { createAgentLoop } from '../../node/src/services/agent-loop.mjs';
import { AgentStreamEvent } from '../../common/contracts/agent.ts';
import { pairFixture, pairServiceFixture } from './authority-fixture.ts';

// Test-local boundary for the existing untyped JS facade. No compiler
// relaxation or production facade change is needed for this fixture.
type Target = { host: string; port: number };
type RouteMap = { prefixes: Record<string, string>; exact: Record<string, string>; upgrades?: Record<string, string> };
const { createFacade, loadRouteMap } = await import(new URL('../../scripts/facade.mjs', import.meta.url).href) as {
  loadRouteMap(file: string): Promise<RouteMap>;
  createFacade(options: { routeMap: RouteMap; targets: { ts: Target; legacy: Target }; authenticate?: (token: string, origin: string) => unknown }): Promise<{ server: import('node:http').Server; close(): Promise<void> }>;
};

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-integrity-'));
const marker = 'PHASE1A_REAL_SKILL_INPUT';
const arch = new ArchServer(workspace, path.join(workspace, 'arch.log'));
let httpServer: import('node:http').Server;
let facade: Awaited<ReturnType<typeof createFacade>>;
let base: string;
let owner: Awaited<ReturnType<typeof pairFixture>>;
let taskSequence = 0;
const requests: Array<Array<{ role: string; content: string }>> = [];
let replies = ['<attempt_completion><result>done</result></attempt_completion>'];
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function eventually<T>(probe: () => Promise<T | null> | T | null): Promise<T> {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value !== null) return value;
    await pause(20);
  }
  throw new Error('integrity observation deadline exceeded');
}
// Canonical transport seam: every route needs the paired operator (Bearer);
// mutations additionally carry the approved exact operation for that request.
type Envelope<T> = { ok: boolean; data?: T; error?: { code: string; message: string } };
function unwrap<T>(body: Envelope<T> | null): T {
  if (body && body.ok === true && body.data !== undefined) return body.data;
  return body as unknown as T;
}
type AgentVerification = {
  execution: string;
  state: string;
  passed: boolean;
  audit: string;
  publication: string;
  evidence_file: string | null;
  errors: string[];
  [key: string]: unknown;
};
// Session status read back over the canonical agent status route.
type AgentStatusBody = {
  session_id: string;
  state: string;
  mode: string;
  iterations: number;
  error: string | null;
  pending_approval: { approval_id: string } | null;
  verification: AgentVerification;
};
async function getJson<T = any>(url: string): Promise<{ status: number; body: T }> {
  const res = await owner.request(url, { signal: AbortSignal.timeout(30000) });
  return { status: res.status, body: unwrap<T>(await res.json() as Envelope<T>) };
}
async function postApproved<T = any>(url: string, body: unknown, taskId: string): Promise<{ status: number; body: T }> {
  const headers = await owner.approve('POST', url, body, taskId);
  const res = await owner.request(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  return { status: res.status, body: unwrap<T>(await res.json() as Envelope<T>) };
}
async function start(task = 'alpha beta gamma: create result.js and run its tests') {
  const res = await postApproved<{ session_id: string }>('/api/agent/start', { task, mode: 'act' }, `integrity-start-${++taskSequence}`);
  assert.equal(res.status, 200);
  return res.body.session_id;
}
  async function terminal(id: string): Promise<AgentStatusBody> {
    const deadline = Date.now() + 30000;
  let last: AgentStatusBody | null = null;
  while (Date.now() < deadline) {
    const { body } = await getJson<AgentStatusBody>('/api/agent/status?id=' + id);
    last = body;
    if (['done', 'error', 'aborted'].includes(body.state)) return body;
    await pause(20);
  }
  throw new Error(`terminal state not reached: ${JSON.stringify(last)?.slice(0, 500)}`);
}
// The loop requests every exact operation as its own human approval
// (checkpoint snapshot ahead of a mutating tool). Decide each distinct
// approval until the session is terminal; denials are decided explicitly.
async function approveAllPending(id: string, decision: 'approve' | 'reject' = 'approve'): Promise<void> {
  let lastDecided: string | null = null;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const { body } = await getJson<AgentStatusBody>('/api/agent/status?id=' + id);
    if (['done', 'error', 'aborted'].includes(body.state)) return;
    const approvalId = body.pending_approval?.approval_id;
    if (body.state === 'awaiting_approval' && approvalId && approvalId !== lastDecided) {
      lastDecided = approvalId;
      const res: { status: number; body: unknown } = await postApproved('/api/agent/decision', { session_id: id, approval_id: approvalId, decision }, `integrity-decision-${id.slice(0, 8)}-${lastDecided.slice(0, 8)}`);
      assert.equal(res.status, 200);
      continue;
    }
    await pause(20);
  }
}
before(async () => {
  await fs.mkdir(path.join(workspace, 'skills'), { recursive: true });
  await fs.writeFile(path.join(workspace, 'skills/SKILL.md'), '# ' + marker);
  await fs.writeFile(path.join(workspace, 'skills/registry.json'), JSON.stringify({ skills: [
    { title: 'alpha beta gamma', description: 'alpha beta gamma', category: 'test', path: 'skills/SKILL.md' }
  ] }));
  const manifestPath = path.join(workspace, 'models.json');
  await fs.writeFile(manifestPath, '{"models":[]}');
  const runtime = new ModelRuntime({ workspace, manifestPath, ingestedPath: path.join(workspace, 'ingested.json'), modelDir: workspace });
  await runtime.load();
  // Warm the engine probe once (canonical daemon boot behavior). Without it,
  // the first runtime.status() call spawns each Python candidate and can block
  // the first agent start and resident context for many seconds.
  await runtime.probePython();
  for (const route of await buildRoutes(workspace, 'integrity', {
    authority: arch.authority,
    skillsRoot: workspace, modelRuntime: runtime, events: arch.events,
    agentChatFn: async messages => {
      requests.push(structuredClone(messages));
      return replies.length > 1 ? replies.shift()! : replies[0]!;
    }
  })) arch.route(route);
  httpServer = await arch.listen(0);
  const addr = httpServer.address();
  assert.ok(addr && typeof addr === 'object');
  const target = { host: '127.0.0.1', port: addr.port };
  facade = await createFacade({
    routeMap: await loadRouteMap(path.resolve('common/facade-route-map.json')),
    targets: { ts: target, legacy: target },
    // The production facade authenticates the transport actor over the authority
    // channel; this in-process fixture wires the same production method.
    authenticate: (token, origin) => arch.authority.authenticate(token, origin)
  });
  const front = facade.server.address();
  assert.ok(front && typeof front === 'object');
  base = `http://127.0.0.1:${front.port}`;
  owner = await pairFixture(arch, base);
  console.log(JSON.stringify({ fixture: workspace, pid: process.pid, freeMemoryBytes: os.freemem(), archPort: addr.port, facadePort: front.port }));
});
after(async () => {
  if (facade) await facade.close();
  arch.events.close();
  await arch.logger.flush();
  if (httpServer) {
    httpServer.closeAllConnections();
    await new Promise<void>(resolve => httpServer.close(() => resolve()));
  }
  // Retain only this disposable fixture as evidence; never remove user state.
  console.log(JSON.stringify({ cleanup: 'servers closed', archListening: httpServer?.listening, facadeListening: facade?.server.listening, retained: workspace }));
});

test('direct and sandbox mutations reject missing, false, malformed and model-supplied approval', async t => {
  const approvals: unknown[] = [undefined, false, 'false', null, 1, {}, true];
  for (const sandbox of [undefined, 'denied']) for (const approved of approvals) {
    await t.test(`${sandbox ?? 'workspace'} approval=${JSON.stringify(approved)}`, async () => {
      const file = `denied-${sandbox ?? 'root'}-${approvals.indexOf(approved)}.txt`;
      const payload = {
        name: 'write_file', approved, sandbox,
        arguments: { path: file, content: 'unauthorized', approved: 'false' }
      };
      // Canonical denial path. The exact-operation contract rejects malformed
      // approval values before authority (400); well-formed attempts obtain an
      // approved transport operation yet the route must still refuse the direct
      // mutation because no trusted session decision exists (403).
      let headers: Record<string, string> = { 'content-type': 'application/json' };
      try {
        headers = await owner.approve('POST', '/api/agent/tool', payload, `integrity-tool-denied-${sandbox ?? 'root'}-${approvals.indexOf(approved)}`);
      } catch { /* denied at the contract boundary; request proceeds unapproved */ }
      const res = await owner.request('/api/agent/tool', { method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(30000) });
      const observed = await res.json().catch(() => null);
      assert.ok(res.status >= 400, JSON.stringify(observed));
      const target = sandbox ? path.join(workspace, '.aide/sandboxes', sandbox, file) : path.join(workspace, file);
      assert.equal(await fs.access(target).then(() => true, () => false), false);
    });
  }
});

test('production route injects selected content at the actual model-request boundary', async () => {
  const offset = requests.length;
  await terminal(await start());
  assert.ok(requests.slice(offset).some(messages => messages.some(m => m.role === 'system' && m.content.includes(marker))));
});

test('completion without requested artifacts or tests is never verified', async () => {
  const state = await terminal(await start());
  const record = await eventually(async () => {
    try { return JSON.parse(await fs.readFile(path.join(workspace, '.aide/verifications', state.session_id + '.verification.json'), 'utf8')); }
    catch { return null; }
  });
  assert.equal(record.verdict.passed, false);
  assert.notEqual(record.verdict.status, 'verified');
  assert.equal(await fs.access(path.join(workspace, 'result.js')).then(() => true, () => false), false);
});

test('state bus and audit expose real disk-write failure without rejecting best-effort callers', async () => {
  const broken = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-integrity-disk-'));
  await fs.writeFile(path.join(broken, '.aide'), 'not a directory');
  const result = await createStateBus(broken).append({ type: 'agent.start' });
  assert.equal((result as any)?.persisted, false);
  assert.ok((result as any)?.error);
  const auditResult = await createAuditTrail({ workspace: broken }).emitAgentStart({ sessionId: 's', mode: 'act', task: 'test' });
  assert.equal((auditResult as any)?.persisted, false);
});

test('EventHub explicitly reports contract rejection', () => {
  const result = arch.events.publish('agent', { event: 'verification', session_id: 'invalid' });
  assert.equal((result as any)?.accepted, false);
});

test('real producer verification survives EventHub and facade WebSocket validation', async () => {
  const socket = new WebSocket(base.replace('http:', 'ws:') + '/ws', { headers: { Origin: 'http://fixture.local' } });
  const received: any[] = [];
  socket.on('message', raw => received.push(JSON.parse(String(raw))));
  try {
    await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    socket.send(JSON.stringify({ type: 'authenticate', token: owner.headers.Authorization.slice(7) }));
    await eventually(() => received.some(message => message.type === 'authenticated') ? true : null);
    socket.send(JSON.stringify({ type: 'subscribe', channels: ['agent'] }));
    // Ping/pong crosses the same ordered WebSocket after subscription.
    await new Promise<void>((resolve, reject) => { socket.once('pong', resolve); socket.once('error', reject); socket.ping(); });
    const id = await start();
    await terminal(id);
    const event = await eventually(() => received.find(e => e.channel === 'agent' && e.data.session_id === id && e.data.event === 'verification') ?? null);
    assert.equal(AgentStreamEvent.safeParse(event.data).success, true);
    assert.equal(event.data.passed, false);
  } finally {
    socket.terminate();
  }
});

test('invalid decisions cannot approve a pending session mutation', async () => {
  const fixture = await pairServiceFixture(workspace);
  const loop = createAgentLoop({ workspace, authority: fixture.authority, chatFn: async () => '<write_file><path>session-denied.txt</path><content>denied</content><approved>true</approved></write_file>' });
  const { session_id: id } = await fixture.startAgent(loop, 'write');
  const state = await eventually(() => {
    const s = loop.status(id);
    return s.pending_approval ? s : null;
  });
  try {
    const approvalId = state.pending_approval!.approval_id;
    await assert.rejects(() => fixture.approveAndExecute('agent.decision', { session_id: id, approval_id: approvalId, decision: 'false' }, id, execution => loop.decide(id, approvalId, 'false' as any, execution)));
    await pause(30);
    assert.equal(await fs.access(path.join(workspace, 'session-denied.txt')).then(() => true, () => false), false);
  } finally {
    if (loop.status(id).state === 'awaiting_approval') await fixture.decideAgent(loop, id, state.pending_approval!.approval_id, 'abort');
  }
});

test('legitimate session approval is one-shot and preserves approved writes', async () => {
  let calls = 0;
  const fixture = await pairServiceFixture(workspace);
  const loop = createAgentLoop({ workspace, authority: fixture.authority, audit: createAuditTrail({ workspace }), onEvent: event => arch.events.publish('agent', event),
    chatFn: async () => ++calls === 1 ? '<write_file><path>approved.txt</path><content>trusted session</content></write_file>' : '<attempt_completion><result>done</result></attempt_completion>' });
  const { session_id: id } = await fixture.startAgent(loop, 'write approved.txt');
  const pending = await eventually(() => loop.status(id).pending_approval);
  for (const value of [undefined, null, false, true, 'false', 'true', {}, 1]) {
    await assert.rejects(() => Promise.resolve(loop.decide(id, pending.approval_id, value as any)));
  }
  assert.equal(await fs.access(path.join(workspace, 'approved.txt')).then(() => true, () => false), false);
  await fixture.decideAgent(loop, id, pending.approval_id, 'approve');
  await assert.rejects(() => fixture.decideAgent(loop, id, pending.approval_id, 'approve'));
  const final = await eventually(() => loop.status(id).state === 'done' ? loop.status(id) : null);
  assert.equal(await fs.readFile(path.join(workspace, 'approved.txt'), 'utf8'), 'trusted session');
  assert.equal(final.verification?.execution, 'succeeded');
  assert.equal(final.verification?.state, 'unavailable');
  assert.equal(final.verification?.passed, false);
  assert.equal(final.verification?.audit, 'persisted');
});

test('direct aliases and sandbox read cannot create an unauthorized sandbox', async () => {
  for (const name of ['str_replace_editor', 'execute_bash', 'run_command', 'desktop_action', 'switch_mode']) {
    const res = await postApproved('/api/agent/tool', { name, approved: true, sandbox: 'never-created', arguments: { approved: 'true', path: 'x', content: 'y', command: 'node --version', target: 'act' } }, `integrity-tool-alias-${name}`);
    assert.equal(res.status, 403, name);
  }
  const read = await postApproved('/api/agent/tool', { name: 'read_file', sandbox: 'never-created', arguments: { path: 'missing' } }, 'integrity-tool-read-sandbox');
  assert.ok(read.status >= 400);
  assert.equal(await fs.access(path.join(workspace, '.aide/sandboxes/never-created')).then(() => true, () => false), false);
  const valid = await postApproved<{ output: string }>('/api/agent/tool', { name: 'read_file', arguments: { path: 'skills/SKILL.md' } }, 'integrity-tool-read-valid');
  assert.equal(valid.status, 200);
  assert.match(valid.body.output, new RegExp(marker));
});

test('no-match is observable and not a loader failure', async () => {
  const id = await start('zzzzqqq');
  const final = await terminal(id);
  assert.equal(final.state, 'done');
  const rows = await createAuditTrail({ workspace }).readEvents({ type: 'agent.context', sessionId: id });
  assert.ok(rows.some(row => row.source === 'skills' && row.status === 'no_match' && row.error === null));
});

test('selected skill read failure stops production inference and records context failure', async () => {
  const skill = path.join(workspace, 'skills/SKILL.md');
  await fs.rename(skill, skill + '.saved');
  const offset = requests.length;
  try {
    const id = await start();
    const final = await terminal(id);
    assert.equal(final.state, 'error');
    assert.ok(final.error, 'terminal error message must be observable');
    assert.match(final.error, /skills context failed/);
    assert.equal(requests.length, offset);
    const rows = await createAuditTrail({ workspace }).readEvents({ type: 'agent.context', sessionId: id });
    assert.ok(rows.some(row => row.source === 'skills' && row.status === 'failed' && typeof row.error === 'string'));
  } finally { await fs.rename(skill + '.saved', skill); }
});

test('production audit write failure cannot claim durable evidence', async () => {
  const bus = path.join(workspace, '.aide/cipher-state.jsonl');
  await fs.rename(bus, bus + '.saved');
  await fs.mkdir(bus);
  try {
    // The transport authority here records in memory (fixture-owned), while the
    // session's own audit trail points at the blocked bus: execution can run
    // and its verification must expose the audit failure instead of a pass.
    const fixture = await pairServiceFixture(workspace);
    const loop = createAgentLoop({
      workspace,
      authority: fixture.authority,
      audit: createAuditTrail({ workspace }),
      chatFn: async () => '<attempt_completion><result>done</result></attempt_completion>'
    });
    const { session_id: id } = await fixture.startAgent(loop, 'audit-failure probe');
    const final = await eventually(() => loop.status(id).state === 'done' ? loop.status(id) : null);
    assert.equal(final.state, 'done');
    assert.ok(final.verification, 'verification outcome must be observable');
    assert.equal(final.verification.execution, 'succeeded');
    assert.equal(final.verification.passed, false);
    assert.equal(final.verification.audit, 'failed');
    assert.equal(final.verification.state, 'errored');
    assert.ok(final.verification.errors.some((e: string) => e.includes('emitVerification')));
  } finally { await fs.rmdir(bus); await fs.rename(bus + '.saved', bus); }
});

test('production verification rejection is visible separately from execution and audit', async () => {
  const original = arch.events.publish.bind(arch.events);
  arch.events.publish = (channel, data) => original(channel, channel === 'agent' && (data as any)?.event === 'verification' ? { event: 'verification' } : data);
  try {
    const final = await terminal(await start());
    assert.equal(final.verification.execution, 'succeeded');
    assert.equal(final.verification.publication, 'rejected');
    assert.equal(final.verification.audit, 'persisted');
    assert.equal(final.verification.state, 'errored');
    assert.equal(final.verification.passed, false);
  } finally { arch.events.publish = original; }
});

test('evidence-file persistence failure is exposed without claiming a filename', async () => {
  const directory = path.join(workspace, '.aide/verifications');
  await fs.rename(directory, directory + '.saved');
  await fs.writeFile(directory, 'blocked');
  try {
    const final = await terminal(await start());
    assert.equal(final.verification.evidence_file, null);
    assert.equal(final.verification.passed, false);
    assert.equal(final.verification.state, 'errored');
    assert.ok(final.verification.errors.some((e: string) => e.startsWith('verifications:')));
  } finally { await fs.unlink(directory); await fs.rename(directory + '.saved', directory); }
});

test('nonzero command result is execution failure, not successful tool execution', async () => {
  replies = ['<run_command><command>node --invalid-phase1a-option</command></run_command>', '<attempt_completion><result>tests passed</result></attempt_completion>'];
  const id = await start();
  await eventually(async () => {
    const { body } = await getJson<{ pending_approval: { approval_id: string } | null }>('/api/agent/status?id=' + id);
    return body.pending_approval ?? null;
  });
  await approveAllPending(id);
  const final = await terminal(id);
  assert.equal(final.verification.execution, 'failed');
  assert.equal(final.verification.state, 'failed');
  assert.equal(final.verification.passed, false);
  replies = ['<attempt_completion><result>done</result></attempt_completion>'];
});

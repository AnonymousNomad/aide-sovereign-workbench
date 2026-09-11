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

// Test-local boundary for the existing untyped JS facade. No compiler
// relaxation or production facade change is needed for this fixture.
type Target = { host: string; port: number };
type RouteMap = { prefixes: Record<string, string>; exact: Record<string, string>; upgrades?: Record<string, string> };
const { createFacade, loadRouteMap } = await import(new URL('../../scripts/facade.mjs', import.meta.url).href) as {
  loadRouteMap(file: string): Promise<RouteMap>;
  createFacade(options: { routeMap: RouteMap; targets: { ts: Target; legacy: Target } }): Promise<{ server: import('node:http').Server; close(): Promise<void> }>;
};

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-integrity-'));
const marker = 'PHASE1A_REAL_SKILL_INPUT';
const arch = new ArchServer(workspace, path.join(workspace, 'arch.log'));
let httpServer: import('node:http').Server;
let facade: Awaited<ReturnType<typeof createFacade>>;
let base: string;
const requests: Array<Array<{ role: string; content: string }>> = [];
let replies = ['<attempt_completion><result>done</result></attempt_completion>'];
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function eventually<T>(probe: () => Promise<T | null> | T | null): Promise<T> {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value !== null) return value;
    await pause(20);
  }
  throw new Error('integrity observation deadline exceeded');
}
async function request(url: string, body?: unknown) {
  const res = await fetch(base + url, {
    ...(body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000)
  });
  return { status: res.status, body: await res.json() as any };
}
async function start(task = 'alpha beta gamma: create result.js and run its tests') {
  const res = await request('/api/agent/start', { task, mode: 'act' });
  assert.equal(res.status, 200);
  return res.body.session_id as string;
}
async function terminal(id: string) {
  return eventually(async () => {
    const { body } = await request('/api/agent/status?id=' + id);
    return ['done', 'error', 'aborted'].includes(body.state) ? body : null;
  });
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
  for (const route of await buildRoutes(workspace, 'integrity', {
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
  facade = await createFacade({ routeMap: await loadRouteMap(path.resolve('common/facade-route-map.json')), targets: { ts: target, legacy: target } });
  const front = facade.server.address();
  assert.ok(front && typeof front === 'object');
  base = `http://127.0.0.1:${front.port}`;
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
      const res = await request('/api/agent/tool', {
        name: 'write_file', approved, sandbox,
        arguments: { path: file, content: 'unauthorized', approved: 'false' }
      });
      assert.ok(res.status >= 400, JSON.stringify(res));
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
  const socket = new WebSocket(base.replace('http:', 'ws:') + '/ws');
  const received: any[] = [];
  socket.on('message', raw => received.push(JSON.parse(String(raw))));
  try {
    await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
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
  const loop = createAgentLoop({ workspace, chatFn: async () => '<write_file><path>session-denied.txt</path><content>denied</content><approved>true</approved></write_file>' });
  const { session_id: id } = loop.start('write');
  const state = await eventually(() => {
    const s = loop.status(id);
    return s.pending_approval ? s : null;
  });
  try {
    assert.throws(() => loop.decide(id, state.pending_approval!.approval_id, 'false' as any));
    await pause(30);
    assert.equal(await fs.access(path.join(workspace, 'session-denied.txt')).then(() => true, () => false), false);
  } finally {
    if (loop.status(id).state === 'awaiting_approval') loop.decide(id, state.pending_approval!.approval_id, 'abort');
  }
});

test('legitimate session approval is one-shot and preserves approved writes', async () => {
  let calls = 0;
  const loop = createAgentLoop({ workspace, audit: createAuditTrail({ workspace }), onEvent: event => arch.events.publish('agent', event),
    chatFn: async () => ++calls === 1 ? '<write_file><path>approved.txt</path><content>trusted session</content></write_file>' : '<attempt_completion><result>done</result></attempt_completion>' });
  const { session_id: id } = loop.start('write approved.txt');
  const pending = await eventually(() => loop.status(id).pending_approval);
  for (const value of [undefined, null, false, true, 'false', 'true', {}, 1]) {
    assert.throws(() => loop.decide(id, pending.approval_id, value as any));
  }
  assert.equal(await fs.access(path.join(workspace, 'approved.txt')).then(() => true, () => false), false);
  loop.decide(id, pending.approval_id, 'approve');
  assert.throws(() => loop.decide(id, pending.approval_id, 'approve'));
  const final = await eventually(() => loop.status(id).state === 'done' ? loop.status(id) : null);
  assert.equal(await fs.readFile(path.join(workspace, 'approved.txt'), 'utf8'), 'trusted session');
  assert.equal(final.verification?.execution, 'succeeded');
  assert.equal(final.verification?.state, 'unavailable');
  assert.equal(final.verification?.passed, false);
  assert.equal(final.verification?.audit, 'persisted');
});

test('direct aliases and sandbox read cannot create an unauthorized sandbox', async () => {
  for (const name of ['str_replace_editor', 'execute_bash', 'run_command', 'desktop_action', 'switch_mode']) {
    const res = await request('/api/agent/tool', { name, approved: true, sandbox: 'never-created', arguments: { approved: 'true', path: 'x', content: 'y', command: 'node --version', target: 'act' } });
    assert.equal(res.status, 403, name);
  }
  const read = await request('/api/agent/tool', { name: 'read_file', sandbox: 'never-created', arguments: { path: 'missing' } });
  assert.ok(read.status >= 400);
  assert.equal(await fs.access(path.join(workspace, '.aide/sandboxes/never-created')).then(() => true, () => false), false);
  const valid = await request('/api/agent/tool', { name: 'read_file', arguments: { path: 'skills/SKILL.md' } });
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
    const final = await terminal(await start());
    assert.equal(final.state, 'done');
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
  const pending = await eventually(async () => {
    const { body } = await request('/api/agent/status?id=' + id);
    return body.pending_approval ?? null;
  });
  assert.equal((await request('/api/agent/decision', { session_id: id, approval_id: pending.approval_id, decision: 'approve' })).status, 200);
  const final = await terminal(id);
  assert.equal(final.verification.execution, 'failed');
  assert.equal(final.verification.state, 'failed');
  assert.equal(final.verification.passed, false);
  replies = ['<attempt_completion><result>done</result></attempt_completion>'];
});

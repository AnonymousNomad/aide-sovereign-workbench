import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type http from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { ArchServer } from '../../node/src/server.ts';
import { AgentStreamEvent } from '../../common/contracts/agent.ts';
import { pairFixture } from './authority-fixture.ts';

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-a1-arch-'));
let server: ArchServer;
let httpServer: http.Server;
let base: string;
let owner: Awaited<ReturnType<typeof pairFixture>>;

const scriptedReplies: string[] = [];
let scriptIndex = 0;

before(async () => {
  await fs.writeFile(path.join(workspace, 'README.md'), '# demo\n\nhello line\n', 'utf8');
  server = new ArchServer(workspace, path.join(workspace, 'arch-a1.log'));
  const { buildRoutes } = await import('../../node/src/openapi.ts');
  const routes = await buildRoutes(workspace, 'test', {
    authority: server.authority,
    events: server.events,
    agentChatFn: async () => {
      const reply = scriptedReplies[Math.min(scriptIndex, scriptedReplies.length - 1)] ?? '';
      scriptIndex += 1;
      return reply;
    }
  });
  for (const route of routes) server.route(route);
  httpServer = await server.listen(0);
  const address = httpServer.address();
  assert.ok(address && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}`;
  owner = await pairFixture(server, base);
});

after(async () => {
  server.events.close();
  await server.logger.flush();
  httpServer.closeAllConnections?.();
  await new Promise<void>(resolve => httpServer.close(() => resolve()));
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await fs.rm(workspace, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!['EBUSY', 'ENOTEMPTY', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
});

type Envelope<T> = { ok: boolean; data?: T; error?: { code: string; message: string } };

async function post<T>(pathName: string, payload: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: Envelope<T> }> {
  const response = await owner.request(pathName, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000)
  });
  return { status: response.status, body: (await response.json()) as Envelope<T> };
}

async function get<T>(pathName: string): Promise<{ status: number; body: Envelope<T> }> {
  const response = await owner.request(pathName, { signal: AbortSignal.timeout(30000) });
  return { status: response.status, body: (await response.json()) as Envelope<T> };
}

async function startSession<T>(payload: { task: string; mode?: 'plan' | 'act'; chat_source?: 'local' | 'provider' }, taskId: string): Promise<{ status: number; body: Envelope<T> }> {
  const headers = await owner.approve('POST', '/api/agent/start', payload, taskId);
  return post<T>('/api/agent/start', payload, headers);
}

async function decideSession<T>(sessionId: string, approvalId: string, decision: 'approve' | 'reject' | 'abort', taskId: string): Promise<{ status: number; body: Envelope<T> }> {
  const payload = { session_id: sessionId, approval_id: approvalId, decision };
  const headers = await owner.approve('POST', '/api/agent/decision', payload, taskId);
  return post<T>('/api/agent/decision', payload, headers);
}

function wsSubscribe(channels: string[]): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const url = base.replace('http://', 'ws://') + '/ws';
    const token = owner.headers.Authorization.slice(7);
    const socket = new WebSocket(url, { headers: { Origin: 'http://fixture.local' } });
    const timer = setTimeout(() => reject(new Error('ws auth timeout')), 5000);
    socket.on('open', () => socket.send(JSON.stringify({ type: 'authenticate', token })));
    socket.on('message', raw => {
      const message = JSON.parse(String(raw)) as { type?: string };
      if (message.type !== 'authenticated') return;
      clearTimeout(timer);
      socket.send(JSON.stringify({ type: 'subscribe', channels }));
      resolve(socket);
    });
    socket.on('error', reject);
  });
}

function nextEvent(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise(resolve => {
    const handler = (raw: unknown): void => {
      const parsed = JSON.parse(String(raw)) as Record<string, unknown>;
      socket.off('message', handler);
      resolve(parsed);
    };
    socket.on('message', handler);
  });
}

test('agent stream event contract validates every emitted shape', () => {
  const samples = [
    { event: 'message', session_id: 's1', text: 'hi' },
    { event: 'tool_call', session_id: 's1', tool: 'write_file', args: { path: 'a.txt' } },
    { event: 'tool_result', session_id: 's1', tool: 'write_file', ok: true, output: 'wrote' },
    {
      event: 'awaiting_approval',
      session_id: 's1',
      approval: {
        approval_id: 'ap1',
        session_id: 's1',
        tool: 'run_command',
        args_preview: { command: 'dir' },
        risks: ['network-command'],
        preview: null,
        created_at: Date.now()
      }
    },
    { event: 'done', session_id: 's1', summary: 'finished' },
    { event: 'error', session_id: 's1', error: 'boom' },
    { event: 'aborted', session_id: 's1' }
  ];
  for (const sample of samples) {
    const parsed = AgentStreamEvent.safeParse(sample);
    assert.ok(parsed.success, `event shape must validate: ${sample.event}`);
  }
});

test('agent routes enforce strict contracts and error envelopes', async () => {
  const badStart = await post('/api/agent/start', { task: '', mode: 'act' });
  assert.equal(badStart.status, 400);
  assert.equal(badStart.body.error?.code, 'BAD_REQUEST');

  const unknownStatus = await get('/api/agent/status?id=nope');
  assert.equal(unknownStatus.status, 404);
  assert.equal(unknownStatus.body.error?.code, 'NOT_FOUND');

  const missingQuery = await get('/api/agent/status');
  assert.equal(missingQuery.status, 400);

  const list = await get<{ sessions: unknown[] }>('/api/agent/sessions');
  assert.equal(list.status, 200);
  assert.ok(Array.isArray(list.body.data?.sessions));

  const badDecision = await post('/api/agent/decision', { session_id: 'nope', approval_id: 'nope', decision: 'maybe' });
  assert.equal(badDecision.status, 400);

  const decisionUnknownSession = await decideSession('nope', 'nope', 'approve', 'task:agent-decision-unknown');
  assert.equal(decisionUnknownSession.status, 404);
});

test('e2e scripted session over HTTP: read → approved write → done, zero egress entries', async () => {
  const journalPath = path.join(workspace, '.aide', 'egress', 'journal.jsonl');

  scriptIndex = 0;
  scriptedReplies.length = 0;
  scriptedReplies.push(
    '<read_file>\n<path>README.md</path>\n</read_file>',
    '<replace_in_file>\n<path>README.md</path>\n<content>\n<<<<<<< SEARCH\nhello line\n=======\naudit-approved line\n>>>>>>> REPLACE\n</content>\n</replace_in_file>'
  );

  const socket = await wsSubscribe(['agent']);
  void nextEvent(socket);
  const start = await startSession<{ session_id: string }>({ task: 'update the readme greeting', mode: 'act' }, 'task:agent-e2e-start');
  assert.equal(start.status, 200);
  const sessionId = start.body.data?.session_id as string;
  assert.ok(sessionId);

  let sawApproval = false;
  let sawToolApproval = false;
  let lastDecided: string | null = null;
  const deadline = Date.now() + 15000;
  let finalState = '';
  while (Date.now() < deadline) {
    const status = await get<{ state: string; pending_approval: { approval_id: string; tool?: string } | null }>(`/api/agent/status?id=${sessionId}`);
    finalState = status.body.data?.state ?? '';
    if (finalState === 'awaiting_approval' && status.body.data?.pending_approval && status.body.data.pending_approval.approval_id !== lastDecided) {
      sawApproval = true;
      const pending = status.body.data.pending_approval;
      lastDecided = pending.approval_id;
      const decision = await decideSession(sessionId, pending.approval_id, 'approve', `task:agent-e2e-decision-${pending.approval_id}`);
      assert.equal(decision.status, 200);
      if (pending.tool !== 'checkpoint.snapshot' && !sawToolApproval) {
        sawToolApproval = true;
        assert.equal(scriptedReplies.length, 2, 'the model must not be called again before the write decision');
        scriptedReplies.push('<attempt_completion>\n<result>readme updated</result>\n</attempt_completion>');
      }
      continue;
    }
    if (['done', 'error', 'aborted'].includes(finalState)) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  socket.close();

  assert.ok(sawApproval, 'session must pause for human approval before writing');
  assert.equal(finalState, 'done');
  const readme = await fs.readFile(path.join(workspace, 'README.md'), 'utf8');
  assert.ok(readme.includes('audit-approved line'));

  const journalExists = await fs.access(journalPath).then(() => true).catch(() => false);
  assert.equal(journalExists, false, 'purely-local agent session must produce zero egress journal entries');
});

// --- H2 chat_source provider guards ---
test('agent: chat_source provider without consent is refused FORBIDDEN before any egress', async () => {
  const res = await startSession({ task: 'route me to a provider', mode: 'act', chat_source: 'provider' }, 'task:agent-provider-consent');
  assert.equal(res.status, 403);
  assert.equal(res.body.ok, false);
  assert.match(res.body.error?.message ?? '', /consent/i);
});

test('agent: chat_source local (explicit) starts normally with scripted replies', async () => {
  scriptedReplies.push('<attempt_completion>\n<result>local-ok</result>\n</attempt_completion>');
  const res = await startSession<{ session_id: string }>({ task: 'local only', mode: 'act', chat_source: 'local' }, 'task:agent-local-start');
  assert.equal(res.status, 200);
  assert.match(res.body.data!.session_id, /-/);
});

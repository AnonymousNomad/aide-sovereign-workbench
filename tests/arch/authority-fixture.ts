import assert from 'node:assert/strict';
import type { ArchServer } from '../../node/src/server.ts';
import { createExecutionAuthority, type ExecutionHandle } from '../../node/src/services/execution-authority.mjs';
import type { AgentLoopService } from '../../node/src/services/agent-loop.mjs';
import { TaskService } from '../../node/src/services/task-service.mjs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { TaskEventT } from '../../common/contracts/tasks.ts';

// Direct-service fixtures still pair and explicitly approve each exact action.
// No universal credential, fake actor, or production bypass is involved.
export async function pairServiceFixture(workspace: string) {
  const records: Array<Readonly<Record<string, unknown>>> = [];
  const authority = createExecutionAuthority({ workspace, record: async event => { records.push(event); return { persisted: true }; } });
  const origin = 'http://fixture.local';
  const paired = await authority.pair(authority.control.createPairing(origin), origin);
  const owner = authority.authenticate(paired.token, origin);
  async function approveAndExecute<T>(kind: string, body: unknown, taskId: string, execute: (execution: ExecutionHandle) => T | Promise<T>) {
    const input = { workspace, kind, taskId, args: { body } };
    const op = await authority.prepare(owner, input);
    assert.equal(op.state, 'pending');
    await authority.decide(owner, op.operation_id, 'approve');
    return authority.execute(owner, op.operation_id, input, (_, execution) => execute(execution));
  }
  function startAgent(loop: AgentLoopService, task: string, mode: 'plan' | 'act' = 'act', chat?: Parameters<AgentLoopService['start']>[2], options: NonNullable<Parameters<AgentLoopService['start']>[3]> = {}) {
    const request = { task, mode, ...(options.architectEditor === undefined ? {} : { architectEditor: options.architectEditor }) };
    return approveAndExecute('agent.start', request, 'fixture-start', execution => loop.start(task, mode, chat, { ...options, request, execution }));
  }
  function decideAgent(loop: AgentLoopService, sessionId: string, approvalId: string, decision: 'approve' | 'reject' | 'abort') {
    const body = { session_id: sessionId, approval_id: approvalId, decision };
    return approveAndExecute('agent.decision', body, sessionId, execution => loop.decide(sessionId, approvalId, decision, execution));
  }
  return { authority, owner, records, approveAndExecute, startAgent, decideAgent };
}

// A positive task fixture approves only the explicitly requested task graph
// and explicitly selected cache phases. Every proposal is inspected and bound
// independently. Negative tests use the authority directly, not this helper.
export async function taskServiceFixture(workspace: string, onEvent: (event: TaskEventT) => void = () => {}) {
  const fixture = await pairServiceFixture(workspace);
  const policies = new Map<string, { commands: Array<{ command: string; args: string[] }>; cache: string[] }>();
  const errors: unknown[] = [];
  const started = new Set<string>();
  const startWaiters = new Map<string, () => void>();
  const pendingDecisions = new Set<Promise<void>>();
  const service = new TaskService({ workspace, authority: fixture.authority, onEvent: event => {
    onEvent(event);
    if (event.event === 'started') { started.add(event.job_id); startWaiters.get(event.job_id)?.(); }
    if (event.event !== 'authority' || event.authority_state.state !== 'pending') return;
    const id = event.authority_state.operation_id;
    assert.ok(id);
    const decision = (async () => {
      try {
        const op = fixture.authority.inspect(fixture.owner, id);
        const policy = policies.get(op.task_id);
        assert.ok(policy, 'unexpected task must never be approved');
        assert.equal(op.workspace, workspace);
        assert.equal(op.state, 'pending');
        const body = (op.args as { body: Record<string, unknown> }).body;
        if (op.kind === 'tasks.command') {
          assert.equal(body.cwd, workspace);
          assert.ok(policy.commands.some(command => command.command === body.command && JSON.stringify(command.args) === JSON.stringify(body.args)), 'command must match the requested fixture graph');
          assert.equal(body.environment_digest, createHash('sha256').update(JSON.stringify(process.env)).digest('hex'));
        } else {
          assert.equal(op.kind, 'cache.mutate');
          assert.ok(policy.cache.includes(String(body.action)), 'cache phase must be explicitly enabled by this test');
          assert.equal(body.root, path.join(workspace, '.aide', 'cache', 'builds'));
          assert.ok(Array.isArray(body.targets));
          for (const target of body.targets as Array<{ path: string }>) assert.equal(path.dirname(target.path), body.root);
        }
        await fixture.authority.decide(fixture.owner, id, 'approve');
      } catch (error) {
        errors.push(error);
        await fixture.authority.decide(fixture.owner, id, 'reject');
      }
    })();
    pendingDecisions.add(decision);
    void decision.finally(() => pendingDecisions.delete(decision));
  } });
  let sequence = 0;
  const run = async (label: string, cache: Array<'get' | 'record'> = []) => {
    const input = await service.describeRun(label, `fixture-task-${++sequence}`);
    const commands: Array<{ command: string; args: string[] }> = [];
    const collect = (node: { task: { command: string; args?: string[] }; deps: unknown[] }) => {
      commands.push({ command: node.task.command, args: node.task.args ?? [] });
      for (const dep of node.deps) collect(dep as typeof node);
    };
    collect(input.args.body.plan as Parameters<typeof collect>[0]);
    policies.set(input.taskId, { commands, cache });
    return fixture.approveAndExecute(input.kind, input.args.body, input.taskId, execution => service.run(label, execution));
  };
  const stop = (id: string) => fixture.approveAndExecute('tasks.stop', { job_id: id }, `fixture-stop-${id}`, execution => service.stop(id, execution));
  const close = async () => {
    for (const job of service.status().jobs) if (job.status === 'running') await stop(job.job_id);
    await Promise.all(pendingDecisions);
    // Read fixture-owned ChildProcess objects only; never discover/adopt by PID.
    const owned = (service as unknown as { jobs: Map<string, { child?: { pid?: number; exitCode: number | null; signalCode: string | null } }> }).jobs;
    const children = [...owned.values()].flatMap(job => job.child ? [job.child] : []);
    for (const child of children) assert.ok(child.exitCode !== null || child.signalCode !== null, 'fixture child exit must be observed');
    console.log(JSON.stringify({ taskFixtureClosed: workspace, children: children.map(child => ({ pid: child.pid, exitCode: child.exitCode, signalCode: child.signalCode })) }));
    fixture.authority.control.close();
    if (errors.length) throw new AggregateError(errors, 'task fixture refused unexpected operations');
  };
  const waitStarted = (id: string) => started.has(id) ? Promise.resolve() : new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { startWaiters.delete(id); reject(new Error('fixture command did not start')); }, 5000);
    startWaiters.set(id, () => { clearTimeout(timer); startWaiters.delete(id); resolve(); });
  });
  return { service, run, stop, close, waitStarted, authority: fixture.authority, owner: fixture.owner, records: fixture.records };
}

// The fixture owns the composition root, not an HTTP token-mint endpoint.
// Pair through the production route; mutation approval is always explicit.
export async function pairFixture(arch: ArchServer, base: string, origin = 'http://fixture.local') {
  const proof = arch.authority.control.createPairing(origin);
  const exchange = await fetch(`${base}/api/authority/pair`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-AIDE-API-Format': 'envelope-v1' },
    body: JSON.stringify({ proof }), signal: AbortSignal.timeout(5000)
  });
  const paired = await exchange.json() as { ok: boolean; data: { token: string; actor_id: string } };
  assert.equal(exchange.status, 200);
  assert.equal(paired.ok, true);
  assert.equal(typeof paired.data.token, 'string');
  const headers = { Authorization: `Bearer ${paired.data.token}`, Origin: origin, 'Content-Type': 'application/json', 'X-AIDE-API-Format': 'envelope-v1' };
  const request = (pathname: string, init: RequestInit = {}): Promise<Response> => {
    const requestHeaders = new Headers(headers);
    new Headers(init.headers).forEach((value, key) => requestHeaders.set(key, value));
    return fetch(`${base}${pathname}`, { ...init, headers: requestHeaders, signal: init.signal ?? AbortSignal.timeout(5000) });
  };
  async function propose(method: string, pathname: string, body: unknown, taskId: string) {
    const response = await request('/api/authority/prepare', { method: 'POST', body: JSON.stringify({ method, path: pathname, body, task_id: taskId }) });
    const envelope = await response.json() as { ok: boolean; data: { operation_id: string; state: string } };
    assert.equal(response.status, 200);
    assert.equal(envelope.ok, true);
    return envelope.data;
  }
  async function decide(id: string, decision: 'approve' | 'reject') {
    return request('/api/authority/decision', { method: 'POST', body: JSON.stringify({ operation_id: id, decision }) });
  }
  async function approve(method: string, pathname: string, body: unknown, taskId: string) {
    const operation = await propose(method, pathname, body, taskId);
    assert.equal(operation.state, 'pending');
    const decision = await decide(operation.operation_id, 'approve');
    assert.equal(decision.status, 200);
    const envelope = await decision.json() as { ok: boolean };
    assert.equal(envelope.ok, true);
    return { 'X-AIDE-Operation': operation.operation_id, 'X-AIDE-Task': taskId };
  }
  return { request, propose, decide, approve, headers, actorId: paired.data.actor_id };
}

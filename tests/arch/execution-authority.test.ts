import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createExecutionAuthority } from '../../node/src/services/execution-authority.mjs';
import { normalizeOperation } from '../../common/security/operation-policy.mjs';
import type { ExecutionHandle } from '../../node/src/services/execution-authority.mjs';

async function fixture() {
  let now = 1000;
  const records: Array<Readonly<Record<string, unknown>>> = [];
  let failAt = '';
  let hold: (() => Promise<void>) | undefined;
  const authority = createExecutionAuthority({ workspace: 'workspace-1', clock: () => now, operationTtlMs: 100, sessionTtlMs: 1000,
    record: async event => { records.push(event); if (hold && event.decision === 'consumed') await hold(); return { persisted: event.decision !== failAt }; } });
  const origin = 'http://127.0.0.1:4173';
  const paired = await authority.pair(authority.control.createPairing(origin), origin);
  const owner = authority.authenticate(paired.token, origin);
  const input = { workspace: 'workspace-1', taskId: 'task-1', kind: 'workspace.write', args: { path: 'a.txt', content: 'approved content' } };
  return { authority, owner, input, paired, origin, records, advance: (ms: number) => { now += ms; }, fail: (decision: string) => { failAt = decision; }, hold: (fn: () => Promise<void>) => { hold = fn; } };
}

test('decision wait observes canonical approval, rejection, revocation and expiry without granting permission', async () => {
  for (const decision of ['approve', 'reject', 'revoke', 'expire'] as const) {
    const f = await fixture();
    const op = await f.authority.prepare(f.owner, f.input);
    const waiting = f.authority.waitForDecision(f.owner, op.operation_id);
    const checked = decision === 'approve' ? waiting.then(value => assert.equal(value.state, 'approved')) : assert.rejects(waiting);
    if (decision === 'revoke') f.authority.control.revoke(f.owner);
    else if (decision === 'expire') f.advance(101);
    else await f.authority.decide(f.owner, op.operation_id, decision);
    await checked;
    assert.equal(f.records.filter(record => record.decision === 'consumed').length, 0);
    f.authority.control.close();
  }
});

test('pairing requires a single-use supervisor proof; claims and origins cannot mint actors', async () => {
  const f = await fixture();
  await assert.rejects(f.authority.pair('x'.repeat(43), f.origin), { code: 'FORBIDDEN' });
  assert.throws(() => f.authority.authenticate(f.paired.token, 'http://untrusted.invalid'), { code: 'FORBIDDEN' });
  await assert.rejects(f.authority.prepare({ ...f.owner }, f.input), { code: 'FORBIDDEN' });
  const proof = f.authority.control.createPairing(f.origin);
  await f.authority.pair(proof, f.origin);
  await assert.rejects(f.authority.pair(proof, f.origin), { code: 'FORBIDDEN' });
});

test('authentication is not mutation approval; forged approved fields confer nothing', async () => {
  for (const approved of [true, false, 'false', null, 1, {}]) {
    const f = await fixture();
    const input = { ...f.input, args: { ...f.input.args, approved } };
    const op = await f.authority.prepare(f.owner, input);
    let mutations = 0;
    await assert.rejects(f.authority.execute(f.owner, op.operation_id, input, () => mutations++), { code: 'CONFLICT' });
    assert.equal(mutations, 0);
  }
});

test('read-only policy needs no mutation approval and execution is still single-use', async () => {
  const f = await fixture();
  const input = { ...f.input, kind: 'workspace.read', args: { path: 'a.txt' } };
  const op = await f.authority.prepare(f.owner, input);
  assert.equal(op.state, 'approved');
  assert.equal(await f.authority.execute(f.owner, op.operation_id, input, () => 'contents'), 'contents');
  await assert.rejects(f.authority.execute(f.owner, op.operation_id, input, () => 'again'), { code: 'CONFLICT' });
});

test('approved immutable descriptor binds content, task, operation, actor and workspace', async () => {
  const f = await fixture();
  const op = await f.authority.prepare(f.owner, f.input);
  await f.authority.decide(f.owner, op.operation_id, 'approve');
  const other = f.authority.control.delegate(f.owner, 'agent', ['workspace.write']);
  let mutations = 0;
  for (const input of [{ ...f.input, taskId: 'other' }, { ...f.input, workspace: 'other' },
    { ...f.input, args: { path: 'b.txt', content: 'changed' } }, { ...f.input, kind: 'git.mutate' }]) {
    await assert.rejects(f.authority.execute(f.owner, op.operation_id, input, () => mutations++));
  }
  await assert.rejects(f.authority.execute(other, op.operation_id, f.input, () => mutations++), { code: 'FORBIDDEN' });
  assert.equal(mutations, 0);
  const normalized = normalizeOperation(f.input);
  assert.ok(Object.isFrozen(normalized) && Object.isFrozen(normalized.args));
  assert.equal(await f.authority.execute(f.owner, op.operation_id, f.input, () => ++mutations), 1);
});

test('agent cannot self-approve or acquire permission-administration scope', async () => {
  const f = await fixture();
  const agent = f.authority.control.delegate(f.owner, 'agent', ['workspace.write']);
  const op = await f.authority.prepare(agent, f.input);
  await assert.rejects(f.authority.decide(agent, op.operation_id, 'approve'), { code: 'FORBIDDEN' });
  assert.throws(() => f.authority.control.delegate(agent, 'agent', ['workspace.write']), { code: 'FORBIDDEN' });
  assert.throws(() => f.authority.control.delegate(f.owner, 'agent', ['desktop.grants']), { code: 'FORBIDDEN' });
  const peerSession = await f.authority.pair(f.authority.control.createPairing(f.origin), f.origin);
  const peer = f.authority.authenticate(peerSession.token, f.origin);
  await assert.rejects(f.authority.decide(peer, op.operation_id, 'approve'), { code: 'FORBIDDEN' });
  await f.authority.decide(f.owner, op.operation_id, 'approve');
  assert.equal(await f.authority.execute(agent, op.operation_id, f.input, () => 'approved'), 'approved');
});

test('expiry and revocation prevent execution with zero side effects', async () => {
  for (const action of ['expire', 'revoke', 'revoke-all']) {
    const f = await fixture();
    const op = await f.authority.prepare(f.owner, f.input);
    await f.authority.decide(f.owner, op.operation_id, 'approve');
    if (action === 'expire') f.advance(101);
    else if (action === 'revoke') f.authority.control.revoke(f.owner);
    else f.authority.control.revokePending();
    let mutations = 0;
    await assert.rejects(f.authority.execute(f.owner, op.operation_id, f.input, () => mutations++));
    assert.equal(mutations, 0);
  }
});

test('concurrent replay cannot cross a pending audit write', async () => {
  const f = await fixture();
  const op = await f.authority.prepare(f.owner, f.input);
  await f.authority.decide(f.owner, op.operation_id, 'approve');
  let release!: () => void;
  let entered!: () => void;
  const atReceipt = new Promise<void>(resolve => { entered = resolve; });
  const receipt = new Promise<void>(resolve => { release = resolve; });
  f.hold(async () => { entered(); await receipt; });
  let mutations = 0;
  const first = f.authority.execute(f.owner, op.operation_id, f.input, () => ++mutations);
  await atReceipt;
  await assert.rejects(f.authority.execute(f.owner, op.operation_id, f.input, () => ++mutations), { code: 'CONFLICT' });
  assert.equal(mutations, 0);
  release();
  assert.equal(await first, 1);
  assert.equal(mutations, 1);
});

test('revocation during audit persistence stops the reserved operation', async () => {
  const f = await fixture();
  const op = await f.authority.prepare(f.owner, f.input);
  await f.authority.decide(f.owner, op.operation_id, 'approve');
  f.hold(async () => { f.authority.control.revokePending(); });
  let mutations = 0;
  await assert.rejects(f.authority.execute(f.owner, op.operation_id, f.input, () => mutations++), { code: 'CONFLICT' });
  assert.equal(mutations, 0);
});

test('required decision/consumption receipts fail closed; completion failure never permits replay', async () => {
  for (const phase of ['approve', 'consumed', 'execution-succeeded']) {
    const f = await fixture();
    const op = await f.authority.prepare(f.owner, f.input);
    f.fail(phase);
    let mutations = 0;
    if (phase === 'approve') await assert.rejects(f.authority.decide(f.owner, op.operation_id, 'approve'), { code: 'NOT_READY' });
    else {
      await f.authority.decide(f.owner, op.operation_id, 'approve');
      await assert.rejects(f.authority.execute(f.owner, op.operation_id, f.input, () => ++mutations), { code: 'NOT_READY' });
    }
    assert.equal(mutations, phase === 'execution-succeeded' ? 1 : 0);
    await assert.rejects(f.authority.execute(f.owner, op.operation_id, f.input, () => ++mutations));
    assert.equal(mutations, phase === 'execution-succeeded' ? 1 : 0);
    assert.ok(!JSON.stringify(f.records).includes(f.paired.token));
  }
});

test('unknown operations and malformed non-JSON descriptors are rejected', async () => {
  const f = await fixture();
  for (const input of [{ ...f.input, kind: 'unknown' }, { ...f.input, args: { x: undefined } },
    { ...f.input, args: { x: Number.NaN } }, { ...f.input, args: new Date() }]) {
    await assert.rejects(f.authority.prepare(f.owner, input), { code: 'BAD_REQUEST' });
  }
});

test('execution handles are opaque, argument-bound and invalid after executor returns', async () => {
  const f = await fixture();
  const body = { path: 'bound.txt', content: 'exact' };
  const input = { ...f.input, args: { body } };
  const op = await f.authority.prepare(f.owner, input);
  await f.authority.decide(f.owner, op.operation_id, 'approve');
  let saved!: ExecutionHandle;
  await f.authority.execute(f.owner, op.operation_id, input, (_descriptor, execution) => {
    saved = execution;
    assert.equal(f.authority.assertExecution(execution, input.kind, body).actor, f.owner);
    assert.throws(() => f.authority.assertExecution({ ...execution }, input.kind, body), { code: 'FORBIDDEN' });
    assert.throws(() => f.authority.assertExecution(execution, input.kind, { ...body, content: 'altered' }), { code: 'FORBIDDEN' });
    assert.throws(() => f.authority.assertExecution(execution, 'git.mutate', body), { code: 'FORBIDDEN' });
  });
  assert.throws(() => f.authority.assertExecution(saved, input.kind, body), { code: 'FORBIDDEN' });
});

async function telegramFixture() {
  const f = await fixture();
  const binding = { chat_id: -111, user_id: 222 };
  const grant = { ...f.input, kind: 'authority.grant', args: { body: binding } };
  const op = await f.authority.prepare(f.owner, grant);
  await f.authority.decide(f.owner, op.operation_id, 'approve');
  const port = await f.authority.execute(f.owner, op.operation_id, grant, (_d, execution) => f.authority.control.telegramAdapter(execution, binding));
  const update = (id: number, text: string, chatId = -111, userId = 222) => ({ update_id: id, message: { chat: { id: chatId }, from: { id: userId }, text } });
  return { ...f, port, update };
}

test('Telegram identities need private ingress proof, exact action confirmation and single-use consumption', async () => {
  const f = await telegramFixture();
  assert.throws(() => f.authority.claimTelegramMessage({}), { code: 'FORBIDDEN' });
  assert.throws(() => f.port.receive(f.update(1, '/ask', -999)), { code: 'FORBIDDEN' });
  assert.throws(() => f.port.receive(f.update(1, '/ask', -111, 999)), { code: 'FORBIDDEN' });
  const ask = f.port.receive(f.update(1, '/ask'));
  const message = f.authority.claimTelegramMessage(ask);
  assert.throws(() => f.authority.claimTelegramMessage(ask), { code: 'FORBIDDEN' });
  assert.throws(() => f.port.receive(f.update(1, '/ask')), { code: 'FORBIDDEN' });
  const input = { ...f.input, taskId: message.taskId, kind: 'desktop.action', args: { body: { op: 'move_file', target: 'a', destination: 'b' } } };
  const op = await f.authority.prepare(message.actor, input);
  let effects = 0;
  await assert.rejects(f.authority.execute(message.actor, op.operation_id, input, () => effects++), { code: 'CONFLICT' });
  await assert.rejects(f.authority.decide(message.actor, op.operation_id, 'approve'), { code: 'FORBIDDEN' });
  const vague = f.port.receive(f.update(2, 'YES')); f.authority.claimTelegramMessage(vague);
  await assert.rejects(f.authority.decideTelegram(vague, op.operation_id, 'approve'), { code: 'FORBIDDEN' });
  assert.equal(effects, 0);
  const yes = f.port.receive(f.update(3, `YES ${op.operation_id}`)); f.authority.claimTelegramMessage(yes);
  await f.authority.decideTelegram(yes, op.operation_id, 'approve');
  await assert.rejects(f.authority.execute(message.actor, op.operation_id, { ...input, taskId: 'other' }, () => effects++), { code: 'CONFLICT' });
  assert.equal(effects, 0);
  await f.authority.execute(message.actor, op.operation_id, input, () => effects++);
  await assert.rejects(f.authority.execute(message.actor, op.operation_id, input, () => effects++), { code: 'CONFLICT' });
  await assert.rejects(f.authority.decideTelegram(yes, op.operation_id, 'approve'), { code: 'FORBIDDEN' });
  assert.equal(effects, 1);
  assert.ok(f.records.some(row => row.decision === 'telegram-bound'));
  assert.ok(f.records.some(row => row.decision === 'approve' && row.approver_id === f.owner.id && row.actor_id === message.actor.id));
});

test('Telegram confirmation cannot cross expiry, revocation or another adapter binding', async () => {
  for (const failure of ['expiry', 'revoke', 'close', 'other-binding']) {
    const f = await telegramFixture();
    const msg = f.authority.claimTelegramMessage(f.port.receive(f.update(1, '/ask')));
    const input = { ...f.input, kind: 'desktop.action', args: { body: { op: 'launch_app', target: 'fixture' } } };
    const op = await f.authority.prepare(msg.actor, input);
    const handle = f.port.receive(f.update(2, `YES ${op.operation_id}`)); f.authority.claimTelegramMessage(handle);
    if (failure === 'expiry') f.advance(101);
    if (failure === 'revoke') f.authority.control.revoke(f.owner);
    if (failure === 'close') f.port.close();
    if (failure === 'other-binding') {
      const other = await telegramFixture();
      const foreign = other.port.receive(other.update(1, `YES ${op.operation_id}`)); other.authority.claimTelegramMessage(foreign);
      await assert.rejects(f.authority.decideTelegram(foreign, op.operation_id, 'approve'), { code: 'FORBIDDEN' });
    } else await assert.rejects(f.authority.decideTelegram(handle, op.operation_id, 'approve'));
    let effects = 0;
    await assert.rejects(f.authority.execute(msg.actor, op.operation_id, input, () => effects++));
    assert.equal(effects, 0);
  }
});

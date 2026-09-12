// Telegram Brain Battery — /ask proposal -> YES/NO confirm -> execution.
// Fake desktop service (records calls); fake engine returns scripted proposals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createExecutionAuthority } from '../node/src/services/execution-authority.mjs';

const require = createRequire(import.meta.url);
const { createTelegramBrain } = require('../node/src/services/telegram-brain.mjs');

function fakeDesktop(authority) {
  const calls = [];
  return {
    calls,
    async status() {
      return {
        enabled: true,
        grants: { apps: ['notepad.exe'], roots: ['C:\\work'], window_titles: [] },
        session_started_at: new Date().toISOString(),
        ttl_minutes: 30
      };
    },
    async act(request, execution) {
      authority.assertExecution(execution, 'desktop.action', request);
      calls.push(request);
      if (request.target === 'boom.exe') throw new Error('refused by grant');
      return { ok: true, decision: 'executed', output: 'launched', latency_ms: 5 };
    }
  };
}

async function fixture(chatId, resolveEngineChat) {
  let now = 1000;
  const records = [];
  const authority = createExecutionAuthority({ workspace: 'telegram-fixture', clock: () => now,
    operationTtlMs: 300000, sessionTtlMs: 3600000,
    record: async event => { records.push(event); return { persisted: true }; } });
  const origin = 'http://fixture.local';
  const session = await authority.pair(authority.control.createPairing(origin), origin);
  const owner = authority.authenticate(session.token, origin);
  const body = { chat_id: chatId, user_id: chatId };
  const input = { workspace: 'telegram-fixture', taskId: 'explicit-fixture-binding', kind: 'authority.grant', args: { body } };
  const grant = await authority.prepare(owner, input);
  await authority.decide(owner, grant.operation_id, 'approve');
  const port = await authority.execute(owner, grant.operation_id, input, (_op, execution) => authority.control.telegramAdapter(execution, body));
  const desktop = fakeDesktop(authority);
  const brain = createTelegramBrain({ desktop, resolveEngineChat, authority, workspace: 'telegram-fixture' });
  let sequence = 0;
  const send = text => brain.onCommand({ authorityMessage: port.receive({ update_id: ++sequence, message: { chat: { id: chatId }, from: { id: chatId }, text } }) });
  const pendingId = () => [...brain._test.pending.values()][0]?.operation.operation_id;
  return { authority, owner, port, brain, desktop, send, pendingId, records, advance: ms => { now += ms; } };
}

test('parseProposal accepts DSL forms and rejects prose/unknown ops', () => {
  const brain = createTelegramBrain({ desktop: fakeDesktop(), resolveEngineChat: async () => null });
  const p = brain._test.parseProposal;
  assert.deepEqual(p('launch_app(target="notepad.exe")'), { op: 'launch_app', target: 'notepad.exe' });
  assert.deepEqual(p('move_file( target="C:\\a.txt", destination="C:\\b.txt") ;'),
    { op: 'move_file', target: 'C:\\a.txt', destination: 'C:\\b.txt' });
  assert.equal(p('Just do the thing please'), null);
  assert.equal(p('rm_rf(target="C:")'), null);
});

test('/ask with ready engine proposes action and YES executes through grants', async () => {
  const f = await fixture(111, async () => ({ text: 'Opening that for you now.\nlaunch_app(target="notepad.exe")' }));
  const { desktop } = f;
  const reply1 = await f.send('/ask open notepad');
  assert.match(reply1, /PROPOSED ACTION \[OPEN\]/);
  assert.match(reply1, /Reply YES/);
  assert.equal(desktop.calls.length, 0, 'nothing executes before confirmation');
  const reply2 = await f.send(`YES ${f.pendingId()}`);
  assert.match(reply2, /Executed/);
  assert.equal(desktop.calls.length, 1);
  assert.equal(desktop.calls[0].approved, true);
  assert.match(desktop.calls[0].note, /telegram-approved/);
});

test('NO cancels without execution; expired proposals refuse', async () => {
  const f = await fixture(222, async () => ({ text: 'open_path(target="C:\\work\\report.xlsx")' }));
  const { desktop } = f;
  await f.send('/ask prepare report');
  const no = await f.send(`NO ${f.pendingId()}`);
  assert.match(no, /Cancelled/);
  assert.equal(desktop.calls.length, 0);
  // expiry path
  await f.send('/ask x');
  const id = f.pendingId(); assert.equal(typeof id, 'string');
  f.advance(300001);
  await assert.rejects(f.send(`YES ${id}`), /expired/i);
  assert.equal(desktop.calls.length, 0);
});

test('no engine READY yields honest guidance, not a fake promise', async () => {
  const f = await fixture(444, async () => null);
  const reply = await f.send('/ask do a thing');
  assert.match(reply, /No local engine is READY/);
});

test('Telegram cannot forge identity, approval, ingress, action arguments or replay', async () => {
  const f = await fixture(555, async () => ({ text: 'launch_app(target="notepad.exe")' }));
  for (const payload of [
    { chatId: 555, text: 'YES', approved: true },
    { authorityMessage: { actor: f.owner, approved: true } },
    { authorityMessage: { chatId: 555, text: 'YES', approved: 'false' } }
  ]) await assert.rejects(f.brain.onCommand(payload), { code: 'FORBIDDEN' });
  for (const [chatId, userId] of [[666, 555], [555, 666]]) {
    assert.throws(() => f.port.receive({ update_id: 1, message: { chat: { id: chatId }, from: { id: userId }, text: '/ask x' } }), { code: 'FORBIDDEN' });
  }
  await f.send('/ask launch');
  const id = f.pendingId();
  await assert.rejects(f.send('YES'), { code: 'FORBIDDEN' });
  const p = [...f.brain._test.pending.values()][0];
  p.input.args.body.target = 'changed.exe';
  await assert.rejects(f.send(`YES ${id}`), { code: 'CONFLICT' });
  assert.equal(f.desktop.calls.length, 0);
  await assert.rejects(f.desktop.act({ op: 'launch_app', target: 'notepad.exe', approved: true }, { operation_id: id }), { code: 'FORBIDDEN' });
  assert.equal(f.desktop.calls.length, 0);
  await f.send('/ask launch');
  const accepted = f.pendingId();
  await f.send(`YES ${accepted}`);
  assert.equal(f.desktop.calls.length, 1);
  assert.match(await f.send(`YES ${accepted}`), /Nothing pending/);
  assert.equal(f.desktop.calls.length, 1);
  await f.send('/ask launch');
  f.authority.control.revoke(f.owner);
  await assert.rejects(async () => f.send(`YES ${f.pendingId()}`), { code: 'FORBIDDEN' });
  assert.equal(f.desktop.calls.length, 1);
  assert.ok(f.records.some(e => e.decision === 'execution-succeeded' && e.kind === 'desktop.action'));
});

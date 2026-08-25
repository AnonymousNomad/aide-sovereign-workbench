// Telegram Brain Battery — /ask proposal -> YES/NO confirm -> execution.
// Fake desktop service (records calls); fake engine returns scripted proposals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createTelegramBrain } = require('../node/src/services/telegram-brain.mjs');

function fakeDesktop() {
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
    async act(request) {
      calls.push(request);
      if (request.target === 'boom.exe') throw new Error('refused by grant');
      return { ok: true, decision: 'executed', output: 'launched', latency_ms: 5 };
    }
  };
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
  const desktop = fakeDesktop();
  const brain = createTelegramBrain({
    desktop,
    resolveEngineChat: async () => ({ text: 'Opening that for you now.\nlaunch_app(target="notepad.exe")' })
  });
  const reply1 = await brain.onCommand({ chatId: 111, text: '/ask open notepad' });
  assert.match(reply1, /PROPOSED ACTION \[OPEN\]/);
  assert.match(reply1, /Reply YES/);
  assert.equal(desktop.calls.length, 0, 'nothing executes before confirmation');
  const reply2 = await brain.onCommand({ chatId: 111, text: 'YES' });
  assert.match(reply2, /Executed/);
  assert.equal(desktop.calls.length, 1);
  assert.equal(desktop.calls[0].approved, true);
  assert.match(desktop.calls[0].note, /telegram-approved/);
});

test('NO cancels without execution; expired proposals refuse', async () => {
  const desktop = fakeDesktop();
  const brain = createTelegramBrain({
    desktop,
    resolveEngineChat: async () => ({ text: 'open_path(target="C:\\work\\report.xlsx")' })
  });
  await brain.onCommand({ chatId: 222, text: '/ask prepare report' });
  const no = await brain.onCommand({ chatId: 222, text: 'NO' });
  assert.match(no, /Cancelled/);
  assert.equal(desktop.calls.length, 0);
  // expiry path
  await brain.onCommand({ chatId: 333, text: '/ask x' }).catch(() => {});
  const p = brain._test.pending.get(333);
  if (p) {
    p.proposed_at = Date.now() - 6 * 60 * 1000;
    const expired = await brain.onCommand({ chatId: 333, text: 'YES' });
    assert.match(expired, /expired/i);
  }
});

test('no engine READY yields honest guidance, not a fake promise', async () => {
  const brain = createTelegramBrain({ desktop: fakeDesktop(), resolveEngineChat: async () => null });
  const reply = await brain.onCommand({ chatId: 444, text: '/ask do a thing' });
  assert.match(reply, /No local engine is READY/);
});

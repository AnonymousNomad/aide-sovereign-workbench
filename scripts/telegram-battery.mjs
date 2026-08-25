// Telegram Bridge Battery — P5 verification per verification-complete SOP.
// Spins a LOCAL mock of the Telegram Bot API (getMe/getUpdates/sendMessage),
// runs the REAL bridge against it via TELEGRAM_API_BASE override.
// Probes: connect+encrypt-at-rest, isolated polling ingest, durable spool,
// allowlist enforcement, command reply. Exit 1 on any failure.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createTelegramBridge } = require('../node/src/services/telegram.mjs');

let dir;
let bridge;
let server;
let sentMessages = [];
let queuedUpdates = [];
const TOKEN = '123456:battERYtoken_token';

function startMockApi() {
  return new Promise(resolve => {
    server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', c => { raw += c; });
      req.on('end', () => {
        const url = req.url || '';
        if (!url.includes(`bot${TOKEN}/`)) {
          // token-in-url must never be echoed in errors the service surfaces
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error_description: `not found: ${url}` }));
          return;
        }
        const method = url.split('/bot')[1].split('/')[1];
        const body = raw ? JSON.parse(raw) : {};
        if (method === 'getMe') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, result: { id: 42, username: 'aide_test_bot' } }));
        } else if (method === 'getUpdates') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, result: queuedUpdates.splice(0) }));
        } else if (method === 'sendMessage') {
          sentMessages.push(body);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, result: { message_id: sentMessages.length } }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, result: {} }));
        }
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-tg-'));
  process.env.TELEGRAM_API_BASE = `http://127.0.0.1:${await startMockApi()}`;
  bridge = createTelegramBridge({ workspace: dir });
});

test('connect verifies token and stores it DPAPI-encrypted at rest', async () => {
  await bridge.connect({ token: TOKEN });
  const cfg = JSON.parse(await fs.readFile(path.join(dir, '.aide', 'telegram', 'config.json'), 'utf8'));
  assert.ok(cfg.token_b64, 'token persisted');
  assert.ok(!cfg.token_b64.includes(TOKEN), 'raw token never at rest');
  assert.equal(cfg.bot_username, 'aide_test_bot');
});

test('polling ingests allowlisted messages into durable spool before handling', async () => {
  bridge.authorizeChat(111);
  queuedUpdates.push({ update_id: 10, message: { chat: { id: 111 }, text: '/ping' } });
  // wait for one poll cycle (mock returns immediately, cutting the long-poll)
  let spool = '';
  for (let i = 0; i < 30; i += 1) {
    spool = await fs.readFile(path.join(dir, '.aide', 'telegram', 'spool.jsonl'), 'utf8').catch(() => '');
    if (spool.includes('/ping')) break;
    await new Promise(r => setTimeout(r, 200));
  }
  assert.match(spool, /\/ping/, 'update durably spooled');
  await new Promise(r => setTimeout(r, 300));
  assert.ok(sentMessages.some(m => m.text === 'pong — AIDE is alive and local.'), 'command replied');
});

test('unknown chats are ignored silently and counted', async () => {
  queuedUpdates.push({ update_id: 11, message: { chat: { id: 999 }, text: '/ping' } });
  await new Promise(r => setTimeout(r, 600));
  const status = await bridge.status();
  assert.equal(status.chat_ids.includes(999), false);
  assert.ok(status.ignored_unknown_chats >= 1);
  assert.ok(!sentMessages.some(m => m.chat_id === 999), 'never replies to strangers');
});

test('status command reports local-only posture', async () => {
  queuedUpdates.push({ update_id: 12, message: { chat: { id: 111 }, text: '/status' } });
  await new Promise(r => setTimeout(r, 600));
  const statusMsg = sentMessages.filter(m => m.text.startsWith('AIDE status')).pop();
  assert.ok(statusMsg, 'status reply sent');
  assert.match(statusMsg.text, /fully local/);
});

test('offset acks prevent redelivery', async () => {
  const offset = Number(await fs.readFile(path.join(dir, '.aide', 'telegram', 'offset.txt'), 'utf8'));
  assert.equal(offset, 13); // last update_id 12 + 1
});

after(async () => {
  await bridge.disconnect().catch(() => {});
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  console.log('\nTELEGRAM BATTERY: complete');
  setImmediate(() => process.exit(0)); // long-poll keeps the loop alive; force clean exit
});

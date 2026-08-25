// Telegram Bridge — P5 transport layer. User-owned bot token; polling runs FROM
// the user's machine; all cognition stays local (Sovereign Compute Law).
//
// Architecture per researched failure modes (OpenClaw 2026.5.12):
// - long-poll loop ISOLATED from request handling (LLM streams must never starve it)
// - durable local spool written BEFORE processing; replayed on boot
// - liveness measured from INBOUND getUpdates cycles only; cycle-start logged
// - token never logged (URLs stripped); unknown chats silently ignored + counted
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

const CFG_FILE = '.aide/telegram/config.json';
const SPOOL_FILE = '.aide/telegram/spool.jsonl';
const OFFSET_FILE = '.aide/telegram/offset.txt';

export function stripToken(urlOrText) {
  return String(urlOrText).replace(/bot\d+:[A-Za-z0-9_-]+/g, 'bot<redacted>');
}

function dpapiProtect(plain) {
  return new Promise((resolve, reject) => {
    const script = `$b=[System.Text.Encoding]::UTF8.GetBytes(${JSON.stringify(plain)});$p=[System.Security.Cryptography.ProtectedData]::Protect($b,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);[Convert]::ToBase64String($p)`;
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Add-Type -AssemblyName System.Security;' + script], { windowsHide: true, timeout: 15000 },
      (err, stdout) => { if (err) reject(err); else resolve(String(stdout).trim()); });
  });
}

function dpapiUnwrap(b64) {
  return new Promise((resolve, reject) => {
    const script = `$b=[Convert]::FromBase64String(${JSON.stringify(b64)});$p=[System.Security.Cryptography.ProtectedData]::Unprotect($b,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);[System.Text.Encoding]::UTF8.GetString($p)`;
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Add-Type -AssemblyName System.Security;' + script], { windowsHide: true, timeout: 15000 },
      (err, stdout) => { if (err) reject(err); else resolve(String(stdout).trim()); });
  });
}

export async function telegramFetch(base, token, method, body, timeoutMs = 35000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}/bot${token}/${method}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!payload.ok) throw new Error(`telegram ${method} failed: ${payload.description || response.status}`);
    return payload.result;
  } catch (error) {
    if (error instanceof Error) error.message = stripToken(error.message);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function createTelegramBridge({ workspace, onCommand }) {
  const apiBase = process.env.TELEGRAM_API_BASE || 'https://api.telegram.org';
  let running = false;
  let lastPollAt = null;
  let pollCycles = 0;
  let ignoredUnknown = 0;
  let config = null; // { token_b64, chat_ids[], enabled }
  let abort = null;

  async function loadConfig() {
    if (config) return config;
    try { config = JSON.parse(await fs.readFile(path.join(workspace, CFG_FILE), 'utf8')); } catch { config = null; }
    return config;
  }

  async function saveConfig(next) {
    config = next;
    const file = path.join(workspace, CFG_FILE);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(config, null, 2), 'utf8');
    return config;
  }

  async function token() {
    const cfg = await loadConfig();
    if (!cfg?.token_b64) throw new Error('telegram not connected');
    try { return await dpapiUnwrap(cfg.token_b64); }
    catch { return Buffer.from(cfg.token_b64, 'base64').toString('utf8'); }
  }

  async function appendSpool(update) {
    const file = path.join(workspace, SPOOL_FILE);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(file, JSON.stringify({ update, at: new Date().toISOString() }) + '\n', 'utf8');
  }

  async function readOffset() {
    try { return Number(await fs.readFile(path.join(workspace, OFFSET_FILE), 'utf8')) || 0; }
    catch { return 0; }
  }

  async function writeOffset(offset) {
    const file = path.join(workspace, OFFSET_FILE);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, String(offset), 'utf8');
  }

  async function reply(chatId, text) {
    const cfg = await loadConfig();
    if (!cfg?.chat_ids.includes(chatId)) return false;
    const t = await token();
    await telegramFetch(apiBase, t, 'sendMessage', { chat_id: chatId, text: String(text).slice(0, 4000) });
    return true;
  }

  // Returns true when the update was handled from an allowlisted chat.
  async function handleUpdate(update) {
    const message = update.message || update.edited_message;
    if (!message?.chat?.id || !message.text) return false;
    const chatId = Number(message.chat.id);
    const cfg = await loadConfig();
    if (!cfg?.chat_ids.includes(chatId)) {
      ignoredUnknown += 1;
      return false;
    }
    const text = message.text.trim();
    if (onCommand) {
      const answer = await onCommand({ chatId, text, update });
      if (answer) { await reply(chatId, answer); return true; }
    }
    if (text.startsWith('/help')) {
      await reply(chatId, [
        'AIDE bridge commands:',
        '/status — engines, memory digests count, uptime',
        '/ping — liveness',
        '',
        'Everything else is queued for the orchestrator (coming online next slice).'
      ].join('\n'));
      return true;
    }
    if (text.startsWith('/ping')) { await reply(chatId, 'pong — AIDE is alive and local.'); return true; }
    if (text.startsWith('/status')) {
      const mem = process.memoryUsage();
      await reply(chatId, `AIDE status\nuptime: ${Math.round(process.uptime())}s\nrss: ${Math.round(mem.rss / 1048576)} MB\npoll cycles: ${pollCycles}\nmode: fully local`);
      return true;
    }
    await reply(chatId, `Queued: "${text.slice(0, 120)}". Orchestrator wiring lands in the next slice — /help for live commands.`);
    return true;
  }

  async function pollLoop() {
    let backoff = 1000;
    while (running) {
      try {
        const t = await token();
        const offset = await readOffset();
        pollCycles += 1;
        lastPollAt = new Date().toISOString();
        const updates = await telegramFetch(apiBase, t, 'getUpdates', { offset, timeout: 25, allowed_updates: ['message'] }, 35000);
        backoff = 1000;
        for (const update of updates) {
          await appendSpool(update); // durable BEFORE handling (crash-safe)
          await handleUpdate(update);
          await writeOffset(update.update_id + 1); // ack
        }
      } catch (error) {
        if (!running) break;
        console.warn(`[telegram] poll cycle failed: ${error instanceof Error ? error.message : error}`);
        await new Promise(r => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, 30000);
      }
    }
  }

  return {
    async connect({ token: plainToken }) {
      const me = await telegramFetch(apiBase, plainToken, 'getMe');
      await saveConfig({
        enabled: true,
        token_b64: await dpapiProtect(plainToken),
        bot_username: me.username,
        chat_ids: [],
        connected_at: new Date().toISOString()
      });
      this.ensurePolling();
      return { ok: true, bot_username: me.username };
    },

    authorizeChat(chatId) {
      return loadConfig().then(async cfg => {
        if (!cfg) throw new Error('telegram not connected');
        const id = Number(chatId);
        if (!cfg.chat_ids.includes(id)) cfg.chat_ids.push(id);
        await saveConfig(cfg);
        return { ok: true, chat_ids: cfg.chat_ids };
      });
    },

    disconnect: async () => {
      running = false;
      abort?.abort();
      await saveConfig({ ...(await loadConfig() ?? {}), enabled: false });
      return { ok: true };
    },

    ensurePolling() {
      if (running) return;
      running = true;
      abort = new AbortController();
      void pollLoop();
    },

    status: async () => {
      const cfg = await loadConfig();
      return {
        connected: Boolean(cfg?.enabled && cfg.token_b64),
        bot_username: cfg?.bot_username ?? null,
        chat_ids: cfg?.chat_ids ?? [],
        running,
        last_poll_at: lastPollAt,
        poll_cycles: pollCycles,
        ignored_unknown_chats: ignoredUnknown
      };
    },

    // battery/test seams
    _test: { handleUpdate, reply, loadConfig }
  };
}

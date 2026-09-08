#!/usr/bin/env node
// Stage 3 — Signal -> SFT pair generator (fine-tune lane wire-in).
// Reads .aide/training/signal-*.jsonl (selfimprove.mjs EMIT contract), generates
// a CORRECTED completion per signal, keeps it only if it passes a deterministic
// must-contain gate for its stage_hint, appends openai-format rows to the signals
// store, and merges (dedup by normalized prompt) into the master sft corpus.
//
// Contract (skills/aide-fine-tune-lane-wire-in Stage 3):
//   - engine completion at temp 0.0-0.2, 1-2 attempts
//   - keep ONLY if deterministic must-contain gate passes for stage_hint
//   - never feed the model its own failure as the answer
//   - output: {"messages":[{system},{user: prompt},{assistant: corrected}]}
//
// Idempotent + zero-safe: no signals on disk -> exits 0 with "no signals" note.
// Exit codes: 0 = ok, 1 = engine/generation failure, 2 = write failure.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.AIDE_SELFIMPROVE_ROOT
  ? path.resolve(process.env.AIDE_SELFIMPROVE_ROOT)
  : path.resolve(__dirname, '..');
const SIGNAL_DIR = process.env.AIDE_SIGNAL_DIR
  ? path.resolve(process.env.AIDE_SIGNAL_DIR)
  : path.join(root, '.aide', 'training');
const REGION = process.env.AIDE_SIGNALS_REGION
  ? process.env.AIDE_SIGNALS_REGION
  : path.join('E:', 'felon_workspace', 'cipher_v2');
const OUT_DIR = path.join(REGION, 'sft_train');
const MASTER = path.join(REGION, 'sft_train.jsonl');

const ENGINE = process.env.AIDE_SIGNALS_ENGINE || 'http://127.0.0.1:8091';
const MODEL = process.env.AIDE_SIGNALS_MODEL || 'aide';

const DRY_RUN = process.env.AIDE_SIGNALS_DRY_RUN === '1';
const MAX_ATTEMPTS = 2;

const SLEEP_MS = ['format', 'distill', 'preference'].includes(process.env.AIDE_SIGNAL_FORCE_HINT)
  ? 0
  : Number(process.env.AIDE_SIGNALS_SLEEP_MS || 0);

// Deterministic must-contain gates per stage_hint (R3: no unverified output).
const MUST_CONTAIN = {
  // SFT/format failures: completion must structurally close the chat
  sft: (s) => s.length > 40 && s.includes('```') === false && !/\bTODO\b|FIXME\b/i.test(s),
  // Distill/reasoning failures: a clean trace must not reproduce the failure verbatim
  distill: (s) => s.length > 80 && !/gives up|i can not|i can't|stuck|failed( |$)/i.test(s),
  // Preference failures (rejection/desktop-refusal): completion must be a refusal-safe retry
  preference: (s) => s.length > 30 && !/(###|##)\s*(system|user)\b/i.test(s),
};
const gate = (hint) => MUST_CONTAIN[hint] || MUST_CONTAIN.sft;
const stageHintOf = (row) => (row && row.stage_hint) || 'sft';

function log(...a) { console.log(`[signals>pairs] ${new Date().toISOString()}`, ...a); }

function readSignals() {
  if (!fs.existsSync(SIGNAL_DIR)) { log(`signal dir missing: ${SIGNAL_DIR}`); return []; }
  const files = fs.readdirSync(SIGNAL_DIR).filter((f) => /^signal-.*\.jsonl$/.test(f)).sort();
  if (!files.length) { log('no signal-*.jsonl files'); return []; }
  const rows = [];
  for (const f of files) {
    const p = path.join(SIGNAL_DIR, f);
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try { rows.push({ ...JSON.parse(t), _file: f }); } catch { log(`skip bad json in ${f}`); }
    }
  }
  return rows;
}

async function genCompletion(prompt, hint) {
  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: 'You are the AIDE training assistant. Given a task that FAILED a verification gate, produce the corrected, complete, verifiable answer. Be exact. Do not leave TODOs.' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.2,
    max_tokens: 1024,
    stream: false,
  };
  let lastErr = null;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 120000);
      const res = await fetch(`${ENGINE}/v1/chat/completions`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body), signal: ctrl.signal,
      });
      clearTimeout(to);
      if (!res.ok) { lastErr = new Error(`engine ${res.status}`); if (i === MAX_ATTEMPTS - 1) return null; continue; }
      const j = await res.json();
      const txt = (j.choices?.[0]?.message?.content || '').trim();
      if (gate(hint)(txt)) return txt;
      lastErr = new Error(`gate FAILED on attempt ${i + 1}`);
    } catch (e) { lastErr = e; }
    if (SLEEP_MS) await new Promise((r) => setTimeout(r, SLEEP_MS));
  }
  if (lastErr) log(`genCompletion failed: ${lastErr.message}`);
  return null;
}

async function main() {
  const signals = readSignals();
  log(`${signals.length} signal rows on disk`);
  if (!signals.length) { log('ZERO signals — idempotent no-op (Stage 4 proceeds on master corpus)'); return 0; }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const outFile = path.join(OUT_DIR, `signals-${today}.jsonl`);

  // Dedup against signals already appended today + the master corpus.
  const seen = new Set();
  for (const f of [outFile, MASTER].filter((p) => fs.existsSync(p))) {
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try { const r = JSON.parse(t); const m = (r.messages || []).find((x) => x.role === 'user'); if (m) seen.add(norm(m.content)); } catch {}
    }
  }

  let appended = 0;
  let failed = 0;
  for (const s of signals) {
    const prompt = s.prompt || '(no prompt captured)';
    const key = norm(prompt);
    if (seen.has(key)) { log(`skip dup: ${key.slice(0, 60)}`); continue; }
    const hint = stageHintOf(s);
    const corrected = await genCompletion(prompt, hint);
    if (!corrected) { failed++; log(`no compliant correction (${hint}): ${key.slice(0, 60)}`); continue; }
    const row = promptHasSystem(s) ? buildRowWithSystem(s, corrected) : buildRow(prompt, corrected);
    const line = JSON.stringify(row);
    if (!DRY_RUN) await fs.appendFile(outFile, line + '\n', 'utf8');
    seen.add(key);
    appended++;
    log(`+ ${hint} | ${key.slice(0, 60)}`);
  }

  log(`appended=${appended} failed=${failed} to ${outFile}`);
  if (failed) { log('NOTE: failed signals need hand-written corrections before training (R3)'); return 1; }
  return 0;
}

function norm(s) { return s.replace(/\s+/g, ' ').trim().toLowerCase(); }

function promptHasSystem(s) {
  return Array.isArray(s.original_event?.messages)
    ? true
    : (Array.isArray(s.original_event?.conversation));
}

function buildRow(prompt, corrected) {
  return { messages: [
    { role: 'system', content: 'You are the AIDE research assistant with tool access.' },
    { role: 'user', content: prompt },
    { role: 'assistant', content: corrected },
  ] };
}

function buildRowWithSystem(s, corrected) {
  const conv = s.original_event?.messages || s.original_event?.conversation || [];
  const sys = conv.find((m) => (m.role || m.sender) === 'system');
  const user = conv.find((m) => (m.role || m.sender) === 'user');
  return { messages: [
    { role: 'system', content: sys?.content || 'You are the AIDE research assistant with tool access.' },
    { role: 'user', content: user?.content || s.prompt || '(no prompt captured)' },
    { role: 'assistant', content: corrected },
  ] };
}

try {
  process.exitCode = await main();
} catch (e) {
  console.error('[signals>pairs] FATAL', e);
  process.exitCode = 2;
}
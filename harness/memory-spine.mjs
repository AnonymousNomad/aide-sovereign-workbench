// Memory Spine — X1.a event spine for Helix Memory (aide-helix-memory skill).
// Deterministic work-memory: merges the event sources AIDE already captures
// (cipher-state bus, ships.log) into one time-indexed stream and rolls up
// day digests under .aide/memory/. Zero model involvement; zero new deps.
import { promises as fs } from 'node:fs';
import path from 'node:path';

const CIPHER_FILE = '.aide/cipher-state.jsonl';
const SHIPS_FILE = '.aide/metrics/ships.log';
const MEMORY_DIR = '.aide/memory';
const DAYS_DIR = '.aide/memory/days';

function localDateOf(iso) {
  // Digest bucketing uses the LOCAL calendar date of the event timestamp.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function readJsonl(file) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return raw.split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

// Normalized work event: { at, kind, detail }
// kinds today: ship | approval | rejection | abort (bus-derived).
export async function readWorkEvents(workspace, { since, until } = {}) {
  const [cipher, ships] = await Promise.all([
    readJsonl(path.join(workspace, CIPHER_FILE)),
    readJsonl(path.join(workspace, SHIPS_FILE))
  ]);
  const events = [];
  for (const entry of cipher) {
    const at = typeof entry.at === 'string' ? entry.at : null;
    if (!at) continue;
    if (entry.type === 'ship') {
      events.push({ at, kind: 'ship', detail: { message: entry.message || '', files_count: Number(entry.files_count) || 0 } });
    } else if (entry.type === 'approval' || entry.type === 'rejection') {
      events.push({ at, kind: entry.type, detail: { tool: entry.tool || '', pattern: entry.pattern || '', summary: entry.summary || '' } });
    } else if (entry.type === 'abort') {
      events.push({ at, kind: 'abort', detail: { tool: entry.tool || '' } });
    }
  }
  for (const entry of ships) {
    const at = typeof entry.at === 'string' ? entry.at : null;
    if (!at) continue;
    events.push({ at, kind: 'ship_intent', detail: { intent: entry.intent || '', message: entry.message || '' } });
  }
  let out = events.sort((a, b) => a.at.localeCompare(b.at));
  if (since) out = out.filter(e => e.at >= since);
  if (until) out = out.filter(e => e.at <= until);
  return out;
}

// Deterministic rollup for one local calendar date.
export function buildDayDigest(dateStr, events) {
  const digest = {
    date: dateStr,
    ships: 0,
    files_touched: 0,
    approvals: 0,
    rejections: 0,
    aborts: 0,
    ship_intents: 0,
    tools_used: {},
    highlights: []
  };
  for (const event of events) {
    if (localDateOf(event.at) !== dateStr) continue;
    if (event.kind === 'ship') {
      digest.ships += 1;
      digest.files_touched += event.detail.files_count;
      if (event.detail.message) {
        // Contract caps highlights at 220 chars; truncate the source message
        // BEFORE composing so the cap always holds.
        digest.highlights.push(`shipped: ${event.detail.message.slice(0, 200)}`);
      }
    } else if (event.kind === 'approval') {
      digest.approvals += 1;
      digest.tools_used[event.detail.tool] = (digest.tools_used[event.detail.tool] || 0) + 1;
    } else if (event.kind === 'rejection') {
      digest.rejections += 1;
      digest.tools_used[event.detail.tool] = (digest.tools_used[event.detail.tool] || 0) + 1;
    } else if (event.kind === 'abort') {
      digest.aborts += 1;
    } else if (event.kind === 'ship_intent') {
      digest.ship_intents += 1;
    }
  }
  digest.highlights = digest.highlights.slice(0, 10);
  return digest;
}

export async function writeDayDigest(workspace, digest) {
  const file = path.join(workspace, DAYS_DIR, `${digest.date}.json`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(digest, null, 2), 'utf8');
  return file;
}

export async function readDayDigest(workspace, dateStr) {
  try {
    return JSON.parse(await fs.readFile(path.join(workspace, DAYS_DIR, `${dateStr}.json`), 'utf8'));
  } catch { return null; }
}

export async function listDayDigests(workspace, { from, to } = {}) {
  let names = [];
  try {
    names = (await fs.readdir(path.join(workspace, DAYS_DIR)))
      .filter(n => /^\d{4}-\d{2}-\d{2}\.json$/.test(n))
      .map(n => n.replace('.json', ''))
      .sort();
  } catch { return []; }
  if (from) names = names.filter(d => d >= from);
  if (to) names = names.filter(d => d <= to);
  return names;
}

// Regenerate digests for every local date present in the event stream
// within [from, to] (inclusive, YYYY-MM-DD or omitted = all). Idempotent.
export async function refreshDayDigests(workspace, { from, to } = {}) {
  const untilIso = to ? `${to}T23:59:59.999Z` : undefined;
  const events = await readWorkEvents(workspace, { since: from ? `${from}T00:00:00.000Z` : undefined, until: untilIso });
  const dates = [...new Set(events.map(e => localDateOf(e.at)).filter(Boolean))].sort();
  const written = [];
  for (const date of dates) {
    if (from && date < from) continue;
    if (to && date > to) continue;
    const digest = buildDayDigest(date, events);
    await writeDayDigest(workspace, digest);
    written.push(date);
  }
  return written;
}

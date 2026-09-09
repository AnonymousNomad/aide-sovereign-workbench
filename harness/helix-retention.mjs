// Helix Retention - X3 of Helix Memory (aide-helix-memory).
// Rolls up day digests into monthly summaries (after day 31) and
// monthly into yearly (after month 13). Pure file IO, no LLM, no
// dependencies on other helix files. Idempotent and re-runnable.
//
// Contract (enforced):
//   Day 1-30  : full digest at .aide/memory/days/YYYY-MM-DD.json
//   Day 31-365: monthly summary at .aide/memory/months/YYYY-MM.json
//   Day 366+  : yearly summary at .aide/memory/years/YYYY.json
//
// No data is deleted. A day digest stays on disk even after it has
// been rolled up; the rollup is additive.
//
// Age tiering (whole-bucket, never partial): a month earns its monthly
// summary once the month is older than 30 days; a year earns its yearly
// summary once the year is older than 365 days. Current-month/current-year
// detail always stays at day granularity.
import { promises as fs } from 'node:fs';
import path from 'node:path';

const MEMORY_DIR = '.aide/memory';
const DAYS_SUBDIR = 'days';
const MONTHS_SUBDIR = 'months';
const YEARS_SUBDIR = 'years';

function nowIso() {
  return new Date().toISOString();
}

function monthKey(dateStr) {
  return String(dateStr).slice(0, 7);
}

function yearKey(dateStr) {
  return String(dateStr).slice(0, 4);
}

async function ensureDir(workspace, sub) {
  const dir = path.join(workspace, MEMORY_DIR, sub);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; }
}

async function listDateFiles(workspace, sub) {
  const dir = path.join(workspace, MEMORY_DIR, sub);
  try {
    const names = await fs.readdir(dir);
    return names.filter(n => /^\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort();
  } catch { return []; }
}

// Sum a set of day digests into one rollup object. Counters add, tool
// usage merges, highlights concatenate under the 10-item cap.
function sumDigests(digests) {
  const out = {
    ships: 0,
    files_touched: 0,
    approvals: 0,
    rejections: 0,
    aborts: 0,
    ship_intents: 0,
    tools_used: {},
    highlights: []
  };
  for (const d of digests) {
    if (!d) continue;
    out.ships += d.ships ?? 0;
    out.files_touched += d.files_touched ?? 0;
    out.approvals += d.approvals ?? 0;
    out.rejections += d.rejections ?? 0;
    out.aborts += d.aborts ?? 0;
    out.ship_intents += d.ship_intents ?? 0;
    for (const [tool, count] of Object.entries(d.tools_used ?? {})) {
      out.tools_used[tool] = (out.tools_used[tool] ?? 0) + count;
    }
    for (const h of (d.highlights ?? [])) {
      if (out.highlights.length >= 10) break;
      out.highlights.push(String(h).slice(0, 220));
    }
  }
  return out;
}

// Days since the local calendar date `dateStr` (YYYY-MM-DD).
function daysSince(dateStr) {
  const then = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(then.getTime())) return Infinity;
  return Math.floor((Date.now() - then.getTime()) / 86400000);
}

// Idempotent rollup: returns { monthly: string[], yearly: string[] } of
// written summary keys. Re-runnable; existing summaries are overwritten
// with the current aggregate (additive in the sense that day digests are
// never removed and summaries are redrivable from them).
export async function rollup(workspace) {
  const dayFiles = await listDateFiles(workspace, DAYS_SUBDIR);
  const dayDigests = new Map();
  for (const f of dayFiles) {
    const d = await readJson(path.join(workspace, MEMORY_DIR, DAYS_SUBDIR, f));
    if (d) dayDigests.set(f.replace('.json', ''), d);
  }

  // Bucket every day digest by month and by year.
  const months = new Map(); // YYYY-MM -> digest[]
  const years = new Map(); // YYYY -> digest[]
  for (const [dateStr, digest] of dayDigests) {
    const m = monthKey(dateStr);
    const y = yearKey(dateStr);
    if (!months.has(m)) months.set(m, []);
    months.get(m).push(digest);
    if (!years.has(y)) years.set(y, []);
    years.get(y).push(digest);
  }

  const writtenMonthly = [];
  for (const [month, digests] of months) {
    const lastDay = month + '-28'; // safe floor; ages from month start
    if (daysSince(lastDay) < 31) continue; // still in the daily window
    const sum = sumDigests(digests);
    const file = path.join(workspace, MEMORY_DIR, MONTHS_SUBDIR, `${month}.json`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ month, ...sum }, null, 2), 'utf8');
    writtenMonthly.push(month);
  }

  const writtenYearly = [];
  for (const [year, digests] of years) {
    if (daysSince(`${year}-01-01`) < 366) continue; // still in the monthly tier
    const sum = sumDigests(digests);
    const file = path.join(workspace, MEMORY_DIR, YEARS_SUBDIR, `${year}.json`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ year, ...sum }, null, 2), 'utf8');
    writtenYearly.push(year);
  }

  return { monthly: writtenMonthly.sort(), yearly: writtenYearly.sort() };
}

// Read a monthly or yearly summary by key. Blank target = the newest
// summary available (used by probes and the UI for a "state" line).
export async function readSummary(workspace, kind, key) {
  const subs = { month: MONTHS_SUBDIR, year: YEARS_SUBDIR };
  const sub = subs[kind];
  if (!sub) return null;
  if (key) return readJson(path.join(workspace, MEMORY_DIR, sub, `${key}.json`));
  try {
    const names = (await fs.readdir(path.join(workspace, MEMORY_DIR, sub)))
      .filter(n => n.endsWith('.json'))
      .sort();
    if (!names.length) return null;
    return readJson(path.join(workspace, MEMORY_DIR, sub, names[names.length - 1]));
  } catch { return null; }
}

export async function status(workspace) {
  const days = await listDateFiles(workspace, DAYS_SUBDIR);
  const months = await listSummaryFiles(workspace, MONTHS_SUBDIR);
  const years = await listSummaryFiles(workspace, YEARS_SUBDIR);
  return {
    days: days.length,
    months: months.length,
    years: years.length
  };
}

async function listSummaryFiles(workspace, sub) {
  const dir = path.join(workspace, MEMORY_DIR, sub);
  try {
    const names = await fs.readdir(dir);
    return names.filter(n => n.endsWith('.json')).sort();
  } catch { return []; }
}
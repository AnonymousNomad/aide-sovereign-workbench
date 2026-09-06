// Helix Retention - X3 of Helix Memory (aide-helix-memory).
//
// Deterministic, archive-only retention for the 30-day memory contract:
//   age 0-30d  : keep full day digests at .aide/memory/days/YYYY-MM-DD.json
//   age 31-365d: additive month summaries at .aide/memory/months/YYYY-MM.json
//   age 366d+  : additive year summaries at .aide/memory/years/YYYY.json
//
// Nothing is deleted. Every summary carries its source dates and generation
// time so recall can show provenance and a rerun can be checked for drift.
// No model or network is involved; this is safe to run during idle time.
import { promises as fs } from 'node:fs';
import path from 'node:path';

const MEMORY_DIR = '.aide/memory';
const DAYS_SUBDIR = 'days';
const MONTHS_SUBDIR = 'months';
const YEARS_SUBDIR = 'years';
const DAY_MS = 86400000;

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function dateMs(dateStr) {
  const value = Date.parse(`${dateStr}T00:00:00.000Z`);
  return Number.isFinite(value) ? value : null;
}

function ageDays(dateStr, asOf) {
  const date = dateMs(dateStr);
  const now = dateMs(asOf);
  if (date === null || now === null) return null;
  return Math.floor((now - date) / DAY_MS);
}

function monthKey(dateStr) {
  return String(dateStr).slice(0, 7);
}

function yearKey(dateStr) {
  return String(dateStr).slice(0, 4);
}

function monthEnd(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  if (!year || !monthNumber) return null;
  return new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
}

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; }
}

async function listFiles(workspace, subdir, pattern) {
  try {
    const names = await fs.readdir(path.join(workspace, MEMORY_DIR, subdir));
    return names.filter(name => pattern.test(name)).sort();
  } catch { return []; }
}

async function writeJsonAtomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, file);
}

function addNumber(out, key, value) {
  const n = Number(value);
  if (Number.isFinite(n)) out[key] = (out[key] || 0) + n;
}

function mergeDigest(out, digest) {
  for (const key of ['ships', 'files_touched', 'approvals', 'rejections', 'aborts', 'ship_intents']) addNumber(out, key, digest?.[key]);
  for (const [tool, count] of Object.entries(digest?.tools_used || {})) addNumber(out.tools_used, tool, count);
  for (const highlight of Array.isArray(digest?.highlights) ? digest.highlights : []) {
    if (out.highlights.length < 20 && !out.highlights.includes(String(highlight))) out.highlights.push(String(highlight).slice(0, 220));
  }
}

function summaryBase(periodType, period, generatedAt) {
  return {
    schema: 'aide-helix-retention-1',
    period_type: periodType,
    period,
    generated_at: generatedAt,
    source_dates: [],
    source_files: [],
    ships: 0,
    files_touched: 0,
    approvals: 0,
    rejections: 0,
    aborts: 0,
    ship_intents: 0,
    tools_used: {},
    highlights: []
  };
}

function finalizeSummary(out, sourceDates, sourceFiles) {
  out.source_dates = [...new Set(sourceDates)].sort();
  out.source_files = [...new Set(sourceFiles)].sort();
  out.highlights = out.highlights.slice(0, 20);
  return out;
}

async function buildMonthly(workspace, asOf, generatedAt) {
  const names = await listFiles(workspace, DAYS_SUBDIR, /^\d{4}-\d{2}-\d{2}\.json$/);
  const grouped = new Map();
  for (const name of names) {
    const date = name.slice(0, 10);
    const age = ageDays(date, asOf);
    if (age === null || age <= 30 || age > 365) continue;
    const digest = await readJson(path.join(workspace, MEMORY_DIR, DAYS_SUBDIR, name));
    if (!digest) continue;
    const key = monthKey(date);
    if (!grouped.has(key)) grouped.set(key, summaryBase('month', key, generatedAt));
    const summary = grouped.get(key);
    mergeDigest(summary, digest);
    summary.source_dates.push(date);
    summary.source_files.push(path.join(MEMORY_DIR, DAYS_SUBDIR, name).replaceAll(path.sep, '/'));
  }
  const written = [];
  for (const [month, summary] of grouped) {
    finalizeSummary(summary, summary.source_dates, summary.source_files);
    const file = path.join(workspace, MEMORY_DIR, MONTHS_SUBDIR, `${month}.json`);
    await writeJsonAtomic(file, summary);
    written.push(month);
  }
  return written.sort();
}

async function buildYearly(workspace, asOf, generatedAt) {
  const names = await listFiles(workspace, MONTHS_SUBDIR, /^\d{4}-\d{2}\.json$/);
  const grouped = new Map();
  for (const name of names) {
    const month = name.slice(0, 7);
    const end = monthEnd(month);
    const age = end ? ageDays(end, asOf) : null;
    if (age === null || age <= 365) continue;
    const summary = await readJson(path.join(workspace, MEMORY_DIR, MONTHS_SUBDIR, name));
    if (!summary) continue;
    const year = yearKey(month);
    if (!grouped.has(year)) grouped.set(year, summaryBase('year', year, generatedAt));
    const yearly = grouped.get(year);
    mergeDigest(yearly, summary);
    yearly.source_dates.push(...(Array.isArray(summary.source_dates) ? summary.source_dates : []));
    yearly.source_files.push(path.join(MEMORY_DIR, MONTHS_SUBDIR, name).replaceAll(path.sep, '/'));
  }
  const written = [];
  for (const [year, summary] of grouped) {
    finalizeSummary(summary, summary.source_dates, summary.source_files);
    const file = path.join(workspace, MEMORY_DIR, YEARS_SUBDIR, `${year}.json`);
    await writeJsonAtomic(file, summary);
    written.push(year);
  }
  return written.sort();
}

/** Refresh additive month/year rollups using an explicit calendar date. */
export async function refreshRetention(workspace, { asOf = todayUtc() } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || dateMs(asOf) === null) {
    throw new Error(`asOf must be an ISO calendar date (YYYY-MM-DD), got ${asOf}`);
  }
  const generatedAt = new Date().toISOString();
  const months = await buildMonthly(workspace, asOf, generatedAt);
  const years = await buildYearly(workspace, asOf, generatedAt);
  const days = await listFiles(workspace, DAYS_SUBDIR, /^\d{4}-\d{2}-\d{2}\.json$/);
  const monthFiles = await listFiles(workspace, MONTHS_SUBDIR, /^\d{4}-\d{2}\.json$/);
  const yearFiles = await listFiles(workspace, YEARS_SUBDIR, /^\d{4}\.json$/);
  return {
    as_of: asOf,
    day_digests: days.length,
    monthly_summaries: months,
    yearly_summaries: years,
    warm_day_count: days.filter(name => { const age = ageDays(name.slice(0, 10), asOf); return age !== null && age >= 0 && age <= 30; }).length,
    monthly_summary_count: monthFiles.length,
    yearly_summary_count: yearFiles.length
  };
}

export async function readMonthlySummary(workspace, month) {
  if (!/^\d{4}-\d{2}$/.test(month)) return null;
  return readJson(path.join(workspace, MEMORY_DIR, MONTHS_SUBDIR, `${month}.json`));
}

export async function readYearlySummary(workspace, year) {
  if (!/^\d{4}$/.test(year)) return null;
  return readJson(path.join(workspace, MEMORY_DIR, YEARS_SUBDIR, `${year}.json`));
}

export async function listMonthlySummaries(workspace) {
  return listFiles(workspace, MONTHS_SUBDIR, /^\d{4}-\d{2}\.json$/);
}

export async function listYearlySummaries(workspace) {
  return listFiles(workspace, YEARS_SUBDIR, /^\d{4}\.json$/);
}

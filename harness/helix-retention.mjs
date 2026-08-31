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

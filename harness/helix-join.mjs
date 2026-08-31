// Helix Join - distillation from episodic (day digests) to semantic (patterns).
// X2 of Helix Memory (aide-helix-memory). Reads .aide/memory/days/*.json,
// extracts durable patterns from the events, writes/updates
// .aide/memory/patterns.jsonl. Deterministic v1: no LLM, statistical only.
//
// Extraction rules (in priority order):
//   P1. Tool affinity - a tool used >= 3 times with >= 60% approval.
//   P2. File affinity - a file touched in >= 3 different days.
//   P3. Highlight frequency - a highlight string seen in >= 2 days.
//
// Demotion rules (run at every refresh):
//   D1. rejection_count >= 3 AND last_rejection_at > last_approval_at -> demoted.
//   D2. last_seen_at > 30 days ago -> archived (kept on disk, not injected).
//
// All writes are idempotent and re-runnable.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { listDayDigests, readDayDigest } from './memory-spine.mjs';

const MEMORY_DIR = '.aide/memory';
const PATTERNS_FILE = path.join(MEMORY_DIR, 'patterns.jsonl');
const PATTERN_STATUS = Object.freeze({ active: 'active', demoted: 'demoted', archived: 'archived' });

function nowIso() {
  return new Date().toISOString();
}

function isoMinusDays(days) {
  return new Date(Date.now() - days * 86400000).toISOString();
}

async function readPatterns(workspace) {
  try {
    const raw = await fs.readFile(path.join(workspace, PATTERNS_FILE), 'utf8');
    return raw.split('\n').filter(Boolean).map(function (line) {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

async function writePatterns(workspace, patterns) {
  await fs.mkdir(path.join(workspace, MEMORY_DIR), { recursive: true });
  const lines = patterns.map(function (p) { return JSON.stringify(p); }).join('\n');
  await fs.writeFile(path.join(workspace, PATTERNS_FILE), lines ? lines + '\n' : '', 'utf8');
}

function patternId(text) {
  return 'p_' + String(text).toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 64);
}
// Extraction rule P1: tool affinity. A tool is pattern-worthy when used
// >= 3 times with >= 60% approval rate.
async function extractToolAffinities(workspace, opts) {
  const from = (opts && opts.from) || undefined;
  const to = (opts && opts.to) || undefined;
  const dates = await listDayDigests(workspace, { from, to });
  const toolStats = new Map();
  for (const date of dates) {
    const digest = await readDayDigest(workspace, date);
    if (!digest || !digest.tools_used) continue;
    for (const tool of Object.keys(digest.tools_used)) {
      const count = digest.tools_used[tool];
      const prev = toolStats.get(tool) || { approved: 0, total: 0, last_seen: null };
      prev.total += count;
      prev.approved += Math.min(count, digest.approvals || 0);
      prev.last_seen = date;
      toolStats.set(tool, prev);
    }
  }
  const out = [];
  for (const tool of toolStats.keys()) {
    const stats = toolStats.get(tool);
    if (stats.total < 3) continue;
    const rate = stats.approved / stats.total;
    if (rate < 0.6) continue;
    out.push({
      text: '[tool] ' + tool + ' is a frequent tool (used ' + stats.total + 'x, approval ' + Math.round(rate * 100) + '%)',
      evidence_count: stats.total,
      approval_count: stats.approved,
      rejection_count: stats.total - stats.approved,
      last_seen_at: stats.last_seen,
    });
  }
  return out;
}

// Extraction rule P2: file affinity. A file path that appears in highlights of
// >= 3 different days becomes a pattern.
async function extractFileAffinities(workspace, opts) {
  const from = (opts && opts.from) || undefined;
  const to = (opts && opts.to) || undefined;
  const dates = await listDayDigests(workspace, { from, to });
  const fileDays = new Map();
  const re = /[\w./-]+\.(?:mjs|ts|mts|js|json|md|ps1|cjs|sh)\b/g;
  for (const date of dates) {
    const digest = await readDayDigest(workspace, date);
    if (!digest || !Array.isArray(digest.highlights)) continue;
    for (const h of digest.highlights) {
      const matches = String(h).match(re);
      if (!matches) continue;
      for (const f of matches) {
        if (!fileDays.has(f)) fileDays.set(f, new Set());
        fileDays.get(f).add(date);
      }
    }
  }
  const out = [];
  for (const file of fileDays.keys()) {
    const daysSet = fileDays.get(file);
    if (daysSet.size < 3) continue;
    const sortedDays = [...daysSet].sort();
    out.push({
      text: '[file] ' + file + ' is a long-lived file (touched across ' + daysSet.size + ' days)',
      evidence_count: daysSet.size,
      approval_count: daysSet.size,
      rejection_count: 0,
      last_seen_at: sortedDays[sortedDays.length - 1],
    });
  }
  return out;
}

// Extraction rule P3: highlight frequency. A highlight message that appears in
// >= 2 different days becomes a pattern.
async function extractHighlightFrequency(workspace, opts) {
  const from = (opts && opts.from) || undefined;
  const to = (opts && opts.to) || undefined;
  const dates = await listDayDigests(workspace, { from, to });
  const highlightDays = new Map();
  for (const date of dates) {
    const digest = await readDayDigest(workspace, date);
    if (!digest || !Array.isArray(digest.highlights)) continue;
    for (const h of digest.highlights) {
      const key = String(h).trim().toLowerCase().slice(0, 200);
      if (key.length < 10) continue;
      if (!highlightDays.has(key)) highlightDays.set(key, new Set());
      highlightDays.get(key).add(date);
    }
  }
  const out = [];
  for (const key of highlightDays.keys()) {
    const daysSet = highlightDays.get(key);
    if (daysSet.size < 2) continue;
    const sortedDays = [...daysSet].sort();
    out.push({
      text: '[recurring] ' + key,
      evidence_count: daysSet.size,
      approval_count: daysSet.size,
      rejection_count: 0,
      last_seen_at: sortedDays[sortedDays.length - 1],
    });
  }
  return out;
}


// Merge new candidates into the existing pattern store. Same-text patterns
// refresh their counters; new patterns get a fresh id and active status.
function mergePatterns(existing, candidates, opts) {
  const now = (opts && opts.now) || nowIso();
  const byId = new Map();
  for (const p of existing) byId.set(p.id, p);
  for (const cand of candidates) {
    const id = patternId(cand.text);
    const prev = byId.get(id);
    if (prev) {
      prev.evidence_count = cand.evidence_count;
      prev.approval_count = cand.approval_count;
      prev.rejection_count = cand.rejection_count;
      prev.last_seen_at = cand.last_seen_at;
      if (prev.status !== PATTERN_STATUS.active) prev.status = PATTERN_STATUS.active;
      prev.last_refreshed_at = now;
    } else {
      byId.set(id, {
        id: id,
        text: cand.text,
        created_at: now,
        last_seen_at: cand.last_seen_at,
        last_refreshed_at: now,
        evidence_count: cand.evidence_count,
        approval_count: cand.approval_count,
        rejection_count: cand.rejection_count,
        status: PATTERN_STATUS.active,
      });
    }
  }
  const arr = [...byId.values()];
  arr.sort(function (a, b) { return b.evidence_count - a.evidence_count; });
  return arr;
}

// Apply demotion + archive rules.
function applyLifecycle(patterns, opts) {
  const now = (opts && opts.now) || nowIso();
  const thirtyDaysAgo = isoMinusDays(30);
  for (const p of patterns) {
    if (p.status === PATTERN_STATUS.archived) continue;
    const hasRecentRejection = p.last_rejection_at && (!p.last_approval_at || p.last_rejection_at > p.last_approval_at);
    if (p.rejection_count >= 3 && (!p.last_approval_at || hasRecentRejection)) {
      p.status = PATTERN_STATUS.demoted;
      p.demoted_at = now;
    }
    if (p.last_seen_at && p.last_seen_at < thirtyDaysAgo) {
      p.status = PATTERN_STATUS.archived;
      p.archived_at = now;
    }
  }
  return patterns;
}

// Public: refresh the pattern store. Reads all available day digests, extracts
// new candidates, merges with the store, applies lifecycle rules, writes back.
export async function refresh(workspace, opts) {
  opts = opts || {};
  const now = nowIso();
  const existing = await readPatterns(workspace);
  const toolCand = await extractToolAffinities(workspace, opts);
  const fileCand = await extractFileAffinities(workspace, opts);
  const highCand = await extractHighlightFrequency(workspace, opts);
  const candidates = toolCand.concat(fileCand, highCand);
  const merged = mergePatterns(existing, candidates, { now: now });
  const lifecycle = applyLifecycle(merged, { now: now });
  await writePatterns(workspace, lifecycle);
  let active = 0, demoted = 0, archived = 0;
  for (const p of lifecycle) {
    if (p.status === 'active') active++;
    else if (p.status === 'demoted') demoted++;
    else if (p.status === 'archived') archived++;
  }
  return {
    candidates_seen: candidates.length,
    patterns_total: lifecycle.length,
    active: active,
    demoted: demoted,
    archived: archived,
  };
}

// Public: list active patterns (for injection into the system prompt).
export async function listActive(workspace, opts) {
  opts = opts || {};
  const limit = opts.limit || 15;
  const all = await readPatterns(workspace);
  const out = [];
  for (const p of all) {
    if (p.status !== PATTERN_STATUS.active) continue;
    out.push('[learned] ' + p.text);
    if (out.length >= limit) break;
  }
  return out;
}

// Public: record a user feedback (approval or rejection) on a pattern.
export async function recordFeedback(workspace, patternIdStr, decision) {
  const all = await readPatterns(workspace);
  const now = nowIso();
  let touched = false;
  for (const p of all) {
    if (p.id !== patternIdStr) continue;
    if (decision === 'approve') {
      p.approval_count = (p.approval_count || 0) + 1;
      p.last_approval_at = now;
    } else if (decision === 'reject') {
      p.rejection_count = (p.rejection_count || 0) + 1;
      p.last_rejection_at = now;
    }
    touched = true;
  }
  if (touched) {
    const lifecycle = applyLifecycle(all, { now: now });
    await writePatterns(workspace, lifecycle);
  }
  return touched;
}

// Public: status snapshot (for tests + UI).
export async function status(workspace) {
  const all = await readPatterns(workspace);
  let active = 0, demoted = 0, archived = 0;
  let lastRefreshed = null;
  for (const p of all) {
    if (p.status === 'active') active++;
    else if (p.status === 'demoted') demoted++;
    else if (p.status === 'archived') archived++;
    if (p.last_refreshed_at && (!lastRefreshed || p.last_refreshed_at > lastRefreshed)) {
      lastRefreshed = p.last_refreshed_at;
    }
  }
  return {
    file: path.join(workspace, PATTERNS_FILE),
    total: all.length,
    active: active,
    demoted: demoted,
    archived: archived,
    last_refreshed_at: lastRefreshed,
  };
}

// Memory recall for AIDE — the harness-as-intelligence layer (Gap #4).
//
// Reads .aide/memory/sessions.jsonl (one line per chat turn summary) and
// returns the top-N memories most relevant to the current user message.
// Honest BM25-style scoring on (intent + skills_invoked + files_touched +
// summary + outcome) so the model sees real prior context without a
// heavy embedding dependency.
import { promises as fs } from 'node:fs';
import path from 'node:path';

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'must', 'shall', 'can', 'to', 'of', 'in',
  'for', 'on', 'with', 'at', 'by', 'from', 'as', 'is', 'it', 'this',
  'that', 'these', 'those', 'i', 'you', 'he', 'she', 'we', 'they',
  'me', 'him', 'her', 'us', 'them', 'my', 'your', 'his', 'its', 'our',
  'their', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'else', 'when',
  'where', 'why', 'how', 'what', 'which', 'who', 'whom', 'whose',
  'just', 'also', 'very', 'too', 'so', 'than', 'like', 'into', 'out',
  'up', 'down', 'over', 'under', 'again', 'further', 'once', 'here',
  'there', 'some', 'any', 'all', 'each', 'every', 'no', 'not', 'only',
  'own', 'same', 'than', 'too', 'very', 'can', 'will', 'just', 'should'
]);

function tokenize(s) {
  if (!s) return [];
  return String(s).toLowerCase()
    .replace(/[^a-z0-9_\-./]+/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2 && !STOP_WORDS.has(t));
}

function termFreq(tokens) {
  const tf = new Map();
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
  return tf;
}

// Per-field term frequency. The query is matched against the union of all
// per-field term maps; each field's contribution is scaled by its weight.
function memoryFieldTfs(mem, weights) {
  const out = new Map(); // field -> tf
  for (const field of Object.keys(weights)) {
    const v = mem[field];
    const toks = [];
    if (Array.isArray(v)) for (const item of v) toks.push(...tokenize(String(item)));
    else if (v) toks.push(...tokenize(String(v)));
    if (toks.length) out.set(field, termFreq(toks));
  }
  return out;
}

function scoreMemory(fieldTfs, weights, queryTf, idf) {
  let s = 0;
  for (const [field, weight] of Object.entries(weights)) {
    const mTf = fieldTfs.get(field);
    if (!mTf) continue;
    for (const [term, mtf] of mTf) {
      const qtf = queryTf.get(term);
      if (!qtf) continue;
      s += weight * mtf * (idf.get(term) || 0);
    }
  }
  return s;
}

export function createMemoryRecall({ workspace }) {
  const memFile = path.join(workspace, '.aide', 'memory', 'sessions.jsonl');
  const WEIGHTS = { intent: 2.0, skills_invoked: 3.0, files_touched: 2.5, summary: 1.0, outcome: 1.5 };
  const MAX_MEMORIES = 500;
  const BUDGET_TOKENS = 800;

  async function loadMemories() {
    let raw;
    try { raw = await fs.readFile(memFile, 'utf8'); } catch { return []; }
    const out = [];
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        const obj = JSON.parse(t);
        if (obj && obj.session_id && obj.ts) out.push(obj);
      } catch { /* skip malformed */ }
      if (out.length >= MAX_MEMORIES) break;
    }
    return out;
  }

  async function buildIdf(memories) {
    const df = new Map();
    const N = memories.length;
    // DF over union of all per-field terms
    for (const m of memories) {
      const seen = new Set();
      for (const fieldTf of memoryFieldTfs(m, WEIGHTS).values()) {
        for (const term of fieldTf.keys()) {
          if (seen.has(term)) continue;
          seen.add(term);
          df.set(term, (df.get(term) || 0) + 1);
        }
      }
    }
    const idf = new Map();
    for (const [term, c] of df) {
      idf.set(term, Math.log(1 + (N - c + 0.5) / (c + 0.5)));
    }
    return idf;
  }

  async function recall(query, opts) {
    const topN = (opts && opts.topN) || 5;
    const memories = await loadMemories();
    if (memories.length === 0) return { hits: [], degraded: true, reason: 'no memories yet', approxTokens: 0 };
    const idf = await buildIdf(memories);
    const qTokens = tokenize(query);
    if (qTokens.length === 0) return { hits: [], degraded: true, reason: 'empty query', approxTokens: 0 };
    const qTf = termFreq(qTokens);
    const scored = memories.map(m => {
      const fieldTfs = memoryFieldTfs(m, WEIGHTS);
      return { memory: m, score: scoreMemory(fieldTfs, WEIGHTS, qTf, idf) };
    }).filter(s => s.score > 0);
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, topN);
    const hits = top.map(s => ({
      session_id: s.memory.session_id,
      ts: s.memory.ts,
      intent: s.memory.intent,
      summary: s.memory.summary,
      skills_invoked: s.memory.skills_invoked || [],
      files_touched: s.memory.files_touched || [],
      outcome: s.memory.outcome,
      score: Math.round(s.score * 100) / 100
    }));
    let chars = 0;
    const trimmed = [];
    for (const h of hits) {
      const est = JSON.stringify(h).length;
      if ((chars + est) / 4 > BUDGET_TOKENS) break;
      chars += est;
      trimmed.push(h);
    }
    return { hits: trimmed, degraded: false, approxTokens: Math.round(chars / 4) };
  }

  async function remember(entry) {
    if (!entry || !entry.session_id || !entry.ts) throw new Error('memory entry needs session_id and ts');
    await fs.mkdir(path.dirname(memFile), { recursive: true });
    await fs.appendFile(memFile, JSON.stringify(entry) + '\n', 'utf8');
  }

  async function status() {
    const memories = await loadMemories();
    return { count: memories.length, file: memFile, lastTs: memories.length ? memories[memories.length - 1].ts : null };
  }

  return { recall, remember, status };
}

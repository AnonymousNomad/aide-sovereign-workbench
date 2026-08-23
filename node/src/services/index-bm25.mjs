const EPSILON = 1e-9;

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'is', 'it', 'for', 'on',
  'with', 'as', 'at', 'by', 'from', 'this', 'that', 'be', 'are', 'was',
]);

export function tokenize(text) {
  const tokens = [];
  for (const raw of String(text).toLowerCase().split(/[^a-z0-9_$]+/)) {
    if (raw.length === 0 || raw.length > 64) continue;
    if (STOPWORDS.has(raw)) continue;
    tokens.push(raw);
  }
  return tokens;
}

export function createBm25(docs) {
  const docTokens = docs.map(tokenize);
  const docCount = docs.length;
  let totalLen = 0;
  const termDocFreq = new Map();
  for (const tokens of docTokens) {
    totalLen += tokens.length;
    for (const t of new Set(tokens)) {
      termDocFreq.set(t, (termDocFreq.get(t) ?? 0) + 1);
    }
  }
  const avgLen = docCount > 0 ? totalLen / docCount : 0;
  const idf = new Map();
  for (const [term, df] of termDocFreq) {
    idf.set(term, Math.log(1 + (docCount - df + 0.5) / (df + 0.5)));
  }
  const k1 = 1.2;
  const b = 0.75;

  function scores(queryText) {
    const out = new Array(docCount).fill(0);
    const qTokens = tokenize(queryText);
    const qFreq = new Map();
    for (const t of qTokens) qFreq.set(t, (qFreq.get(t) ?? 0) + 1);
    docTokens.forEach((tokens, i) => {
      const len = tokens.length;
      if (len === 0) return;
      const tf = new Map();
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      let score = 0;
      for (const [term] of qFreq) {
        const f = tf.get(term);
        if (!f) continue;
        const w = idf.get(term) ?? 0;
        score += w * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * len) / avgLen)));
      }
      out[i] = score;
    });
    return out;
  }

  function search(queryText, limit = 50) {
    const all = scores(queryText);
    const hits = [];
    all.forEach((s, i) => {
      if (s > EPSILON) hits.push({ index: i, score: s });
    });
    hits.sort((a, c) => c.score - a.score);
    return hits.slice(0, limit);
  }

  return { scores, search };
}

export function rrfFuse(lists, { k = 20, limit = 10 } = {}) {
  const fused = new Map();
  for (const list of lists) {
    list.forEach((entry, rank) => {
      const cur = fused.get(entry.id) ?? { id: entry.id, score: 0, ranks: {} };
      cur.score += 1 / (k + rank + 1);
      cur.ranks[entry.source] = rank + 1;
      fused.set(entry.id, cur);
    });
  }
  return [...fused.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// Cipher State Bus — one truth, all components read/write.
// Every meaningful event appends here. Every component queries relevant entries.
import { promises as fs } from 'node:fs';
import path from 'node:path';

const STATE_FILE = '.aide/cipher-state.jsonl';
const MAX_ENTRIES = 5000;

export function createStateBus(workspace) {
  const filePath = path.join(workspace, STATE_FILE);

  async function append(event) {
    if (!event || typeof event !== 'object') return;
    const entry = { ...event, at: new Date().toISOString() };
    await fs.mkdir(path.dirname(filePath), { recursive: true }).catch(() => {});
    await fs.appendFile(filePath, JSON.stringify(entry) + '\n').catch(() => {});
  }

  async function readState({ type, since, limit = 100 } = {}) {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      let entries = raw.split('\n').filter(Boolean).map(line => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter(Boolean);
      if (type) entries = entries.filter(e => e.type === type);
      if (since) entries = entries.filter(e => e.at >= since);
      return entries.slice(-limit).reverse(); // newest first
    } catch { return []; }
  }

  async function getLearned(minCount = 3, limit = 10) {
    // Extract patterns that appear >= minCount times with positive outcomes
    const approvals = await readState({ type: 'approval', limit: 500 });
    const patterns = {};
    for (const entry of approvals) {
      if (!entry.pattern || !entry.decision) continue;
      if (!patterns[entry.pattern]) patterns[entry.pattern] = { count: 0, approved: 0 };
      patterns[entry.pattern].count += 1;
      if (entry.decision === 'approve') patterns[entry.pattern].approved += 1;
    }
    return Object.entries(patterns)
      .filter(([, stats]) => stats.count >= minCount && stats.approved / stats.count >= 0.6)
      .sort((a, b) => b[1].approved - a[1].approved)
      .slice(0, limit)
      .map(([pattern]) => `[learned] ${pattern}`);
  }

  return { append, readState, getLearned };
}

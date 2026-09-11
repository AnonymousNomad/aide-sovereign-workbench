// Cipher State Bus — unified event log that all components append to and query.
// Every meaningful interaction appends here. Every component queries relevant entries.
import { promises as fs } from 'node:fs';
import path from 'node:path';

const STATE_FILE = '.aide/cipher-state.jsonl';

export function createStateBus(workspace) {
  const filePath = path.join(workspace, STATE_FILE);

  async function append(event) {
    let handle;
    try {
      if (!event || typeof event !== 'object') throw new Error('invalid state event');
      const entry = { ...event, at: new Date().toISOString() };
      const line = JSON.stringify(entry) + '\n';
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      handle = await fs.open(filePath, 'a');
      await handle.writeFile(line);
      await handle.sync();
      await handle.close();
      handle = null;
      return { persisted: true };
    } catch (error) {
      // Observable does not mean fatal: callers choose their own policy.
      return { persisted: false, error: String(error?.message ?? error).slice(0, 500) };
    } finally {
      if (handle) await handle.close().catch(() => {});
    }
  }

  async function readState({ type, since, limit = 100 } = {}) {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      let entries = raw.split('\n').filter(Boolean).map(line => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter(Boolean);
      if (type) entries = entries.filter(e => e.type === type);
      if (since) entries = entries.filter(e => e.at >= since);
      return entries.slice(-limit).reverse();
    } catch { return []; }
  }

  async function getPreferences(minCount = 3, limit = 15) {
    const approvals = await readState({ type: 'approval', limit: 500 });
    const rejections = await readState({ type: 'rejection', limit: 500 });
    const patterns = {};
    for (const entry of approvals) {
      if (!entry.pattern || !entry.decision) continue;
      if (!patterns[entry.pattern]) patterns[entry.pattern] = { count: 0, approved: 0 };
      patterns[entry.pattern].count += 1;
      if (entry.decision === 'approve') patterns[entry.pattern].approved += 1;
    }
    for (const entry of rejections) {
      if (!entry.pattern || !entry.decision || entry.decision !== 'reject') continue;
      if (!patterns[entry.pattern]) patterns[entry.pattern] = { count: 0, approved: 0 };
      patterns[entry.pattern].count += 1;
    }
    return Object.entries(patterns)
      .filter(([, stats]) => stats.count >= minCount && stats.approved / stats.count >= 0.6)
      .sort((a, b) => b[1].approved - a[1].approved)
      .slice(0, limit)
      .map(([pattern]) => `[learned] ${pattern}`);
  }

  return { append, readState, getPreferences };
}

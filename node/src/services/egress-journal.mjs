import path from 'node:path';
import { mkdirSync, appendFileSync } from 'node:fs';

const DIR = '.aide';
const SUBDIR = 'egress';
const FILE = 'journal';

export function logEgress(workspace, entry) {
  const dir = path.join(workspace, DIR, SUBDIR);
  const file = path.join(dir, `${FILE}.jsonl`);
  try {
    mkdirSync(dir, { recursive: true });
    appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n', { encoding: 'utf8' });
  } catch {
    // egress journaling must never break the operation it audits
  }
}

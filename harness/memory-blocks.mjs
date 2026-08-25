// Memory Blocks — X1.b of Helix Memory. Pinned core blocks (MemGPT-shaped):
// always-in-context identity for project/user/task, hard-capped so any model
// budget survives injection. Inspectable markdown on disk (dual-store law:
// human-readable profile + searchable spine lives elsewhere).
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { estimateTokens } from './scaffold.mjs';

const BLOCKS_DIR = '.aide/memory/blocks';
export const BLOCK_CAPS = Object.freeze({ project: 800, user: 400, task: 600 });
const BLOCK_NAMES = Object.freeze(['project', 'user', 'task']);

export class BlockCapError extends Error {
  constructor(name, tokens, cap) {
    super(`memory block "${name}" would be ${tokens} tokens; cap is ${cap}. Shorten the content.`);
    this.code = 'BLOCK_CAP';
  }
}

function blockPath(workspace, name) {
  return path.join(workspace, BLOCKS_DIR, `${name}.md`);
}

// Returns {project,user,task} with '' for missing/unreadable files.
export async function readBlocks(workspace) {
  const out = { project: '', user: '', task: '' };
  await Promise.all(BLOCK_NAMES.map(async name => {
    try {
      out[name] = await fs.readFile(blockPath(workspace, name), 'utf8');
    } catch { /* missing block = empty */ }
  }));
  return out;
}

// Cap enforced at WRITE time with honest error; empty content deletes.
export async function writeBlock(workspace, name, content) {
  if (!BLOCK_NAMES.includes(name)) throw new Error(`unknown memory block: ${name}`);
  const text = String(content ?? '');
  const tokens = estimateTokens([{ content: text }]);
  if (text.trim() === '') {
    await fs.rm(blockPath(workspace, name), { force: true }).catch(() => {});
    return { name, tokens: 0, deleted: true };
  }
  const cap = BLOCK_CAPS[name];
  if (tokens > cap) throw new BlockCapError(name, tokens, cap);
  const file = blockPath(workspace, name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text, 'utf8');
  return { name, tokens, deleted: false };
}

// One bounded line for session-open recency (hot window surface).
export async function recentWorkLine(workspace) {
  const daysDir = path.join(workspace, '.aide/memory/days');
  let names = [];
  try {
    names = (await fs.readdir(daysDir)).filter(n => /^\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort().slice(-2);
  } catch { return ''; }
  const parts = [];
  for (const n of names) {
    try {
      const d = JSON.parse(await fs.readFile(path.join(daysDir, n), 'utf8'));
      parts.push(`${d.date}: ${d.ships} shipped, ${d.approvals}a/${d.rejections}r tool decisions`);
    } catch { /* skip corrupt */ }
  }
  return parts.length ? `[recent work] ${parts.join(' | ')}` : '';
}

// [memory] section composed into the scaffold system slot. Empty when
// nothing to say — never inject empty headers.
export function composeMemorySection(blocks, workLine) {
  const sections = [];
  if (blocks.project?.trim()) sections.push(`[memory:project]\n${blocks.project.trim()}`);
  if (blocks.user?.trim()) sections.push(`[memory:user]\n${blocks.user.trim()}`);
  if (blocks.task?.trim()) sections.push(`[memory:task]\n${blocks.task.trim()}`);
  if (workLine?.trim()) sections.push(workLine.trim());
  return sections.length ? '\n\n' + sections.join('\n\n') : '';
}

// Context Gatherer — read live workspace state for the harness scaffold.
// Pure function of (workspace, openPaths, activePath, history). Used by the
// agent loop to inject the model's real working environment into L3.5 of the
// scaffold (between L3 workspace facts and L4 session overrides). Capped:
// 2k tokens active file, 500 diff, 200 terminal tail, 200 diagnostics, 1k
// open-tabs summary. Total ceiling 4k tokens (~16k chars). Everything
// truncated with explicit "(... N more)" markers so the model sees the
// shape and not just the cut.
//
// Deterministic: same inputs => same output. No I/O beyond reading files.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

const CAP_ACTIVE_FILE_CHARS = 8000;
const CAP_DIFF_CHARS = 2000;
const CAP_TERMINAL_CHARS = 800;
const CAP_DIAGNOSTICS_CHARS = 800;
const CAP_OPEN_TABS_SUMMARY_CHARS = 2000;
const CAP_TOTAL_CHARS = 16000;

function truncate(text, cap, marker = '\n[...truncated]') {
  if (!text) return '';
  if (text.length <= cap) return text;
  return text.slice(0, cap) + marker;
}

function escapeForPrompt(text) {
  return String(text).replace(/```/g, '`\u200b`\u200b`').slice(0, CAP_TOTAL_CHARS);
}

async function readActiveFile(workspace, relativePath) {
  if (!relativePath) return { path: null, content: '', truncated: false };
  const absolute = path.resolve(workspace, relativePath);
  if (!absolute.startsWith(workspace)) return { path: relativePath, content: '', truncated: false, error: 'path escaped workspace' };
  try {
    const text = await fs.readFile(absolute, 'utf8');
    return { path: relativePath, content: truncate(text, CAP_ACTIVE_FILE_CHARS), truncated: text.length > CAP_ACTIVE_FILE_CHARS, bytes: Buffer.byteLength(text) };
  } catch (error) {
    return { path: relativePath, content: '', truncated: false, error: error.message };
  }
}

async function readGitDiff(workspace) {
  try {
    const { stdout } = await execFileP('git', ['diff', '--no-ext-diff', '--no-color'], { cwd: workspace, maxBuffer: 1024 * 1024 });
    return { diff: truncate(stdout || '', CAP_DIFF_CHARS), bytes: Buffer.byteLength(stdout || '') };
  } catch (error) {
    return { diff: '', error: error.message };
  }
}

async function readTerminalTail(workspace) {
  // The daemon keeps a tail of the last terminal run output in .aide/logs/term-tail.log
  // (written by /api/terminal/run). If the file is missing, return empty.
  const tailFile = path.join(workspace, '.aide', 'logs', 'term-tail.log');
  try {
    const text = await fs.readFile(tailFile, 'utf8');
    return { tail: truncate(text, CAP_TERMINAL_CHARS), bytes: Buffer.byteLength(text) };
  } catch (error) {
    return { tail: '', error: error.message };
  }
}

async function readDiagnostics(workspace) {
  // Diagnostics are stored in .aide/logs/diagnostics.jsonl (one record per line).
  // Keep the last N lines, formatted as path:line:severity:message.
  const diagFile = path.join(workspace, '.aide', 'logs', 'diagnostics.jsonl');
  try {
    const text = await fs.readFile(diagFile, 'utf8');
    const lines = text.split('\n').filter(Boolean);
    const tail = lines.slice(-20).map(line => {
      try {
        const d = JSON.parse(line);
        return `${d.path || '?'}:${d.line || '?'}:${d.severity || '?'}:${d.message || ''}`;
      } catch { return line; }
    }).join('\n');
    return { diagnostics: truncate(tail, CAP_DIAGNOSTICS_CHARS), count: lines.length };
  } catch (error) {
    return { diagnostics: '', count: 0, error: error.message };
  }
}

function formatOpenTabs(openPaths, activePath) {
  if (!Array.isArray(openPaths) || openPaths.length === 0) return '';
  const list = openPaths.map(p => p === activePath ? `* ${p}` : `  ${p}`).join('\n');
  return truncate(list, CAP_OPEN_TABS_SUMMARY_CHARS);
}

export async function gatherWorkspaceContext({ workspace, openPaths = [], activePath = null, git = true, terminal = true, diagnostics = true } = {}) {
  if (!workspace) throw new Error('workspace is required');
  const root = path.resolve(workspace);
  // Run all four gatherers in parallel regardless of which sections are
  // enabled; each gatherer is cheap (a stat or a file read) and the
  // destructuring order is then stable. Enabled flags just control whether
  // the result is rendered into the final text.
  const [activeFile, diff, term, diag] = await Promise.all([
    activePath ? readActiveFile(root, activePath) : Promise.resolve({ path: null, content: '', truncated: false }),
    git ? readGitDiff(root) : Promise.resolve({ diff: '' }),
    terminal ? readTerminalTail(root) : Promise.resolve({ tail: '' }),
    diagnostics ? readDiagnostics(root) : Promise.resolve({ diagnostics: '', count: 0 })
  ]);
  const openTabs = formatOpenTabs(openPaths, activePath);
  const parts = [];
  if (openTabs) parts.push(`Open files:\n${openTabs}`);
  if (activeFile?.path && activeFile.content) {
    parts.push(`Active file (${activeFile.path}${activeFile.truncated ? ', truncated' : ''}):\n\`\`\`\n${activeFile.content}\n\`\`\``);
  } else if (activeFile?.path && activeFile.error) {
    parts.push(`Active file (${activeFile.path}): [error: ${activeFile.error}]`);
  }
  if (diff?.diff) {
    parts.push(`Uncommitted git diff:\n\`\`\`diff\n${diff.diff}\n\`\`\``);
  }
  if (term?.tail) {
    parts.push(`Last terminal output (tail):\n\`\`\`\n${term.tail}\n\`\`\``);
  }
  if (diag?.diagnostics) {
    parts.push(`Current diagnostics (${diag.count} total):\n${diag.diagnostics}`);
  }
  const body = parts.join('\n\n');
  const text = `[live workspace context]\n${body}\n[end live workspace context]`;
  return {
    text: escapeForPrompt(text),
    activeFile,
    diff,
    terminal: term,
    diagnostics: diag,
    openTabs: { count: openPaths.length, active: activePath }
  };
}

// Helper exposed for the agent loop: append a line to the terminal tail file.
export async function appendTerminalTail({ workspace, program, args, code, stdout, stderr }) {
  if (!workspace) return;
  const tailFile = path.join(workspace, '.aide', 'logs', 'term-tail.log');
  const line = JSON.stringify({ at: new Date().toISOString(), program, args, code, stdout: String(stdout || '').slice(-2000), stderr: String(stderr || '').slice(-500) }) + '\n';
  try {
    await fs.mkdir(path.dirname(tailFile), { recursive: true});
    await fs.appendFile(tailFile, line, 'utf8');
  } catch { /* best-effort */ }
}

// Helper exposed for the agent loop: append a diagnostic record.
export async function appendDiagnostic({ workspace, path: filePath, line, severity, message }) {
  if (!workspace) return;
  const diagFile = path.join(workspace, '.aide', 'logs', 'diagnostics.jsonl');
  const line2 = JSON.stringify({ at: new Date().toISOString(), path: filePath, line, severity, message }) + '\n';
  try {
    await fs.mkdir(path.dirname(diagFile), { recursive: true});
    await fs.appendFile(diagFile, line2, 'utf8');
  } catch { /* best-effort */ }
}

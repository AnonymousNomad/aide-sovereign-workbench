import path from 'node:path';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import { logEgress } from './egress-journal.mjs';
import { escapeCmdArg } from './task-service.mjs';

const NETWORK_TOKENS = ['curl', 'wget', 'invoke-webrequest', 'invoke-restmethod', 'iwr ', 'irm ', 'http://', 'https://', 'ftp', 'netcat', 'telnet', 'ssh ', 'scp '];
const HARD_DENY_SEGMENTS = ['.git'];
const PROTECTED_PREFIXES = ['.aide/', 'package-lock.json'];
const INVISIBLE_CHARS = /[\u200b-\u200f\u202a-\u202e\u2060-\u2064\u{feff}\u{e0000}-\u{e007f}]/gu;
const READ_WINDOW_DEFAULT = 100;
const TOOL_OUTPUT_CAP = 16000;
const COMMAND_OUTPUT_CAP = 8000;
const COMMAND_TIMEOUT_MS = 120000;

export class ToolError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
  }
}

export function resolveInsideWorkspace(workspace, relativePath) {
  if (typeof relativePath !== 'string' || relativePath.trim() === '') {
    throw new ToolError('VALIDATION', 'path must be a non-empty string');
  }
  const root = path.resolve(workspace);
  const abs = path.resolve(root, relativePath);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new ToolError('JAIL_ESCAPE', `path escapes the workspace: ${relativePath}`);
  }
  return abs;
}

export function relativeInside(workspace, abs) {
  const root = path.resolve(workspace);
  return path.relative(root, abs).split(path.sep).join('/');
}

export async function ensureRealInsideWorkspace(workspace, abs) {
  let real = abs;
  try {
    real = await fs.realpath(abs);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const parent = path.dirname(abs);
    try {
      real = path.join(await fs.realpath(parent), path.basename(abs));
    } catch {
      throw new ToolError('VALIDATION', `parent directory does not exist: ${relativeInside(workspace, parent)}`);
    }
  }
  resolveInsideWorkspace(workspace, real);
  const rel = relativeInside(workspace, real);
  for (const segment of HARD_DENY_SEGMENTS) {
    if (rel === segment || rel.startsWith(segment + '/')) {
      throw new ToolError('DENIED', `access to ${segment}/ is not permitted`);
    }
  }
  return real;
}

export function findInvisibleChars(text) {
  const matches = typeof text === 'string' ? text.match(INVISIBLE_CHARS) : null;
  return matches ? [...new Set(matches.map(ch => 'U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')))] : [];
}

export function isProtectedPath(rel) {
  return PROTECTED_PREFIXES.some(prefix => rel === prefix.slice(0, -1) || rel.startsWith(prefix));
}

export function isNetworkSuspiciousCommand(commandText) {
  const lowered = String(commandText).toLowerCase();
  return NETWORK_TOKENS.some(token => lowered.includes(token));
}

export function computeRisks(workspace, toolName, args) {
  const risks = [];
  if (toolName === 'write_file' || toolName === 'replace_in_file') {
    try {
      const abs = resolveInsideWorkspace(workspace, String(args.path ?? ''));
      if (isProtectedPath(relativeInside(workspace, abs))) risks.push('protected-file');
    } catch {
      // jail violation surfaces at execute time with the precise error
    }
    const invisible = findInvisibleChars(String(args.content ?? ''));
    if (invisible.length > 0) risks.push(`invisible-characters:${invisible.join(',')}`);
  }
  if (toolName === 'run_command' && isNetworkSuspiciousCommand(String(args.command ?? ''))) {
    risks.push('network-command');
  }
  return risks;
}

function normalizeNewlines(text) {
  return String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function repairBlockSyntax(text) {
  let t = normalizeNewlines(text);
  t = t.replace(/<{3,}\s*SEARCH\s*/g, '<<<<<<< SEARCH\n');
  t = t.replace(/={3,}\s*\n/g, '=======\n');
  t = t.replace(/>{3,}\s*REPLACE\s*/g, '>>>>>>> REPLACE\n');
  t = t.replace(/<<<<<<< SEARCH(?!\n)/g, '<<<<<<< SEARCH\n');
  t = t.replace(/=======\s*\n(?=>>>>>>>)/g, '=======\n');
  t = t.replace(/>>>>>>> REPLACE(?!\n)/g, '>>>>>>> REPLACE\n');
  return t;
}

export function parseSearchReplaceBlocks(blocksText) {
  const text = repairBlockSyntax(blocksText);
  const blocks = [];
  const re = /(?:^|\n)[ \t]*<{5,}[ \t]*SEARCH[ \t]*\n([\s\S]*?)\n?[ \t]*={5,}[ \t]*\n([\s\S]*?)\n?[ \t]*>{5,}[ \t]*REPLACE/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    blocks.push({ search: match[1], replace: match[2] });
  }
  if (blocks.length === 0 && text.trim() !== '') {
    throw new ToolError('VALIDATION', 'no SEARCH/REPLACE blocks found; expected "<<<<<<< SEARCH ... ======= ... >>>>>>> REPLACE"');
  }
  return blocks;
}

function stripTrailing(lines) {
  return lines.map(line => line.replace(/[ \t]+$/, ''));
}

function stripLeading(lines) {
  return lines.map(line => line.replace(/^[ \t]*/, ''));
}

function indentOf(line) {
  const match = /^[ \t]*/.exec(line);
  return match ? match[0] : '';
}

function findLoose(haystackLines, needleLines) {
  if (needleLines.length === 0 || needleLines.length > haystackLines.length) return -1;
  const hayTrim = stripTrailing(haystackLines);
  const needleTrim = stripTrailing(needleLines);
  outer1: for (let i = 0; i + needleLines.length <= hayTrim.length; i++) {
    for (let j = 0; j < needleTrim.length; j++) {
      if (hayTrim[i + j] !== needleTrim[j]) continue outer1;
    }
    return i;
  }
  const hayBare = stripLeading(hayTrim);
  const needleBare = stripLeading(needleTrim);
  outer2: for (let i = 0; i + needleLines.length <= hayBare.length; i++) {
    for (let j = 0; j < needleBare.length; j++) {
      if (hayBare[i + j] !== needleBare[j]) continue outer2;
    }
    return i;
  }
  return -1;
}

export function applySearchReplace(content, blocks) {
  let working = normalizeNewlines(content);
  const applied = [];
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    if (block.search.trim() === '') {
      throw Object.assign(new Error(`block ${index + 1}: empty SEARCH creates a new file; use write_file instead of replace_in_file`), { name: 'ToolError', code: 'VALIDATION' });
    }
    const needleLines = block.search.split('\n');
    const replaceLinesRaw = block.replace.split('\n');
    const hayLines = working.split('\n');
    let start = hayLines.join('\n').indexOf(block.search);
    let strategy = 'exact';
    if (start === -1) {
      const lineStart = findLoose(hayLines, needleLines);
      if (lineStart === -1) {
        throw new ToolError(
          'NO_MATCH',
          `SEARCH block ${index + 1} of ${blocks.length} did not match the file. Re-read the file and copy the exact current content into SEARCH (leading whitespace matters less than exact characters); make several small blocks instead of one large one.`
        );
      }
      strategy = 'loose';
      const baseIndent = indentOf(hayLines[lineStart]);
      const firstNeedleIndent = indentOf(needleLines[0]);
      const replacementIndented = replaceLinesRaw.map(line => {
        if (line.trim() === '') return '';
        const ind = indentOf(line);
        if (firstNeedleIndent && ind.startsWith(firstNeedleIndent)) {
          return baseIndent + ind.slice(firstNeedleIndent.length) + line.trim();
        }
        if (!firstNeedleIndent) {
          return baseIndent + ind + line.trim();
        }
        return baseIndent + line.trim();
      });
      hayLines.splice(lineStart, needleLines.length, ...replacementIndented);
      working = hayLines.join('\n');
    } else {
      const end = start + block.search.length;
      working = working.slice(0, start) + block.replace + working.slice(end);
    }
    applied.push({ block: index + 1, strategy });
  }
  return { content: working, applied };
}

function capOutput(text, cap) {
  const value = String(text ?? '');
  if (value.length <= cap) return value;
  return value.slice(0, cap) + `\n... [truncated ${value.length - cap} chars]`;
}

export function splitCommandLine(line) {
  const parts = [];
  let current = '';
  let quote = null;
  for (const ch of String(line)) {
    if (quote !== null) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ' ' || ch === '\t') {
      if (current !== '') parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current !== '') parts.push(current);
  return parts;
}

function runChild(command, args, workspace, timeoutMs) {
  return new Promise((resolve, reject) => {
    let child;
    const options = { cwd: workspace, env: process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] };
    try {
      if (path.sep === '\\' && /\.(cmd|bat)$/i.test(command)) {
        const line = [command, ...args].map(escapeCmdArg).join(' ');
        child = spawn('cmd.exe', ['/d', '/s', '/c', `"${line}"`], { ...options, windowsVerbatimArguments: true });
      } else {
        child = spawn(command, args, options);
      }
    } catch (error) {
      reject(error);
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill();
        if (path.sep === '\\') {
          spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        }
      } catch {}
      resolve({ code: null, signal: 'TIMEOUT', stdout, stderr, timedOut: true });
    }, timeoutMs);
    child.stdout?.on('data', chunk => {
      if (stdout.length < COMMAND_OUTPUT_CAP * 4) stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', chunk => {
      if (stderr.length < COMMAND_OUTPUT_CAP * 4) stderr += chunk.toString('utf8');
    });
    child.on('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, timedOut: false });
    });
  });
}

export function createAgentTools({ workspace, rg }) {
  const rootAbs = path.resolve(workspace);

  async function jailedRead(relPath) {
    const abs = resolveInsideWorkspace(rootAbs, relPath);
    const real = await ensureRealInsideWorkspace(rootAbs, abs);
    return { abs, real, rel: relativeInside(rootAbs, real) };
  }

  const tools = [
    {
      name: 'read_file',
      description: 'Read part of a file. Returns numbered lines.',
      params: ['path', 'offset', 'limit'],
      required: ['path'],
      readOnly: true,
      async execute(args) {
        const { real, rel } = await jailedRead(args.path);
        const stat = await fs.stat(real).catch(() => null);
        if (stat === null) throw new ToolError('NOT_FOUND', `file not found: ${rel}`);
        if (stat.isDirectory()) throw new ToolError('VALIDATION', `${rel} is a directory; use list_dir`);
        const raw = await fs.readFile(real, 'utf8');
        const lines = normalizeNewlines(raw).split('\n');
        const offset = Math.max(1, parseInt(args.offset, 10) || 1);
        const limit = Math.min(400, Math.max(1, parseInt(args.limit, 10) || READ_WINDOW_DEFAULT));
        const slice = lines.slice(offset - 1, offset - 1 + limit);
        const body = slice.map((line, i) => `${String(offset + i).padStart(5)} | ${line}`).join('\n');
        const more = offset - 1 + slice.length < lines.length ? `\n... (${lines.length - (offset - 1 + slice.length)} more lines; use offset)` : '';
        return { ok: true, output: capOutput(`${rel} lines ${offset}-${offset - 1 + slice.length} of ${lines.length}\n${body}${more}`, TOOL_OUTPUT_CAP) };
      }
    },
    {
      name: 'list_dir',
      description: 'List a directory inside the workspace.',
      params: ['path'],
      required: [],
      readOnly: true,
      async execute(args) {
        const targetRel = args.path && args.path.trim() !== '' ? args.path : '.';
        const { real, rel } = await jailedRead(targetRel);
        const entries = await fs.readdir(real, { withFileTypes: true });
        const visible = entries.filter(entry => !entry.name.startsWith('.')).slice(0, 200);
        const listing = visible.map(entry => entry.name + (entry.isDirectory() ? '/' : '')).join('\n');
        return { ok: true, output: capOutput(`${rel || '.'} (${visible.length} entries)\n${listing}`, TOOL_OUTPUT_CAP) };
      }
    },
    {
      name: 'search',
      description: 'Search file contents across the workspace. Concise file-first results.',
      params: ['query'],
      readOnly: true,
      async execute(args) {
        const query = String(args.query ?? '').trim();
        if (query === '') throw new ToolError('VALIDATION', 'query must be a non-empty string');
        if (!rg || !rg.available()) throw new ToolError('NOT_READY', 'search backend unavailable');
        const result = await rg.search({ query, maxResults: 50 });
        const byFile = new Map();
        for (const match of result.matches) {
          if (!byFile.has(match.path)) byFile.set(match.path, []);
          byFile.get(match.path).push(match);
        }
        const sections = [];
        for (const [file, matches] of byFile) {
          sections.push(file + '\n' + matches.slice(0, 3).map(match => `  ${match.line_number}: ${match.line_text.trim().slice(0, 120)}`).join('\n'));
        }
        const header = `${byFile.size} file(s) matched${result.truncated ? ' (results truncated)' : ''}`;
        return { ok: true, output: capOutput(header + (sections.length ? '\n' + sections.join('\n') : '\nno matches'), TOOL_OUTPUT_CAP) };
      }
    },
    {
      name: 'write_file',
      description: 'Create or overwrite a file with full content.',
      params: ['path', 'content'],
      readOnly: false,
      async execute(args) {
        const { real, rel } = await jailedRead(args.path);
        const invisible = findInvisibleChars(String(args.content ?? ''));
        if (invisible.length > 0) {
          throw new ToolError('DENIED', `content contains invisible characters (${invisible.join(',')}) that could hide instructions; remove them`);
        }
        await fs.mkdir(path.dirname(real), { recursive: true });
        await fs.writeFile(real, normalizeNewlines(String(args.content ?? '')), 'utf8');
        return { ok: true, output: `wrote ${rel} (${Buffer.byteLength(String(args.content ?? ''), 'utf8')} bytes)` };
      }
    },
    {
      name: 'replace_in_file',
      description: 'Apply SEARCH/REPLACE blocks to one file. SEARCH must match current content exactly; empty SEARCH is invalid here.',
      params: ['path', 'content'],
      readOnly: false,
      async execute(args) {
        const { real, rel } = await jailedRead(args.path);
        const invisible = findInvisibleChars(String(args.content ?? ''));
        if (invisible.length > 0) {
          throw new ToolError('DENIED', `content contains invisible characters (${invisible.join(',')}) that could hide instructions; remove them`);
        }
        let before;
        try {
          before = await fs.readFile(real, 'utf8');
        } catch {
          throw new ToolError('NOT_FOUND', `file not found: ${rel}; create it with write_file`);
        }
        const blocks = parseSearchReplaceBlocks(String(args.content ?? ''));
        const { content: after, applied } = applySearchReplace(before, blocks);
        await fs.writeFile(real, after, 'utf8');
        return { ok: true, output: `applied ${applied.length} block(s) to ${rel} [${applied.map(a => `#${a.block}:${a.strategy}`).join(', ')}]` };
      }
    },
    {
      name: 'run_command',
      description: 'Run one shell command in the workspace. Output is captured and truncated.',
      params: ['command'],
      readOnly: false,
      async execute(args) {
        const line = String(args.command ?? '').trim();
        if (line === '') throw new ToolError('VALIDATION', 'command must be a non-empty string');
        const parts = splitCommandLine(line);
        if (parts.length === 0) throw new ToolError('VALIDATION', 'command could not be parsed');
        if (isNetworkSuspiciousCommand(line)) {
          logEgress(rootAbs, { action: 'agent-run-command-network', url: line.slice(0, 300) });
        }
        const result = await runChild(parts[0], parts.slice(1), rootAbs, COMMAND_TIMEOUT_MS);
        const status = result.timedOut ? 'timed out' : result.code === null ? `killed (${result.signal})` : `exit ${result.code}`;
        const combined = [`$ ${line}`, result.stdout.trim(), result.stderr.trim()].filter(section => section !== '').join('\n');
        return { ok: !result.timedOut && result.code === 0, output: capOutput(`${combined}\n[${status}]`, COMMAND_OUTPUT_CAP) };
      }
    },
    {
      name: 'switch_mode',
      description: 'Request switching between PLAN (read-only) and ACT (full access) modes. Requires user approval.',
      params: ['target'],
      readOnly: false,
      async execute() {
        return { ok: true, output: 'switch requested' };
      }
    },
    {
      name: 'attempt_completion',
      description: 'Finish the task with a short summary of what was done.',
      params: ['result'],
      readOnly: true,
      async execute(args) {
        return { ok: true, output: String(args.result ?? '').slice(0, 4000), terminal: true };
      }
    }
  ];

  return { tools, rootAbs };
}



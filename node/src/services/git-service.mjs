import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const MAX_DIFF_BYTES = 1024 * 1024;
const MAX_LOG_COMMITS = 200;

function resolveWorkspacePath(workspaceRoot, relativePath) {
  const normalized = String(relativePath).replace(/\\/g, '/').replace(/^\.\//, '');
  const absolute = path.resolve(workspaceRoot, normalized);
  if (absolute !== path.resolve(workspaceRoot) && !absolute.startsWith(path.resolve(workspaceRoot) + path.sep)) return null;
  return { relative: normalized.split('/').join('/') };
}

export function parseStatusPorcelainV2(text) {
  const lines = text.split('\n');
  const result = {
    git_repo: true,
    branch: null,
    oid: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    detached: false,
    changes: []
  };
  const isConflictXY = xy => xy === 'UU' || xy === 'AA' || xy === 'DD' || xy.includes('U');
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    if (line.length === 0) continue;
    if (line.startsWith('# branch.oid ')) result.oid = line.slice('# branch.oid '.length) || null;
    else if (line.startsWith('# branch.head ')) {
      const head = line.slice('# branch.head '.length);
      if (head === '(detached)') result.detached = true;
      else if (head && head !== '(unknown)') result.branch = head;
    } else if (line.startsWith('# branch.upstream ')) result.upstream = line.slice('# branch.upstream '.length);
    else if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+)\s+-(\d+)/.exec(line);
      if (m) {
        result.ahead = Number(m[1]);
        result.behind = Number(m[2]);
      }
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      const tokens = line.split(' ');
      const xy = tokens[1];
      const modeSrc = tokens[2];
      const prefixLength = tokens.slice(0, 8).join(' ').length + 1;
      let p = line.slice(prefixLength);
      if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
      const change = {
        path: p,
        x: xy[0],
        y: xy[1],
        staged: xy[0] !== '.' && xy[0] !== '?',
        untracked: false,
        conflict: isConflictXY(xy)
      };
      if (modeSrc === '160000') continue;
      result.changes.push(change);
    } else if (line.startsWith('? ')) {
      let p = line.slice(2);
      if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
      result.changes.push({ path: p, x: '?', y: '?', staged: false, untracked: true, conflict: false });
    } else if (line.startsWith('u ')) {
      const tokens = line.split(' ');
      result.changes.push({ path: tokens.at(-1), x: 'U', y: 'U', staged: false, untracked: false, conflict: true });
    }
  }
  return result;
}

export function splitUnifiedDiff(text) {
  const hunks = [];
  let currentFileHeader = [];
  let currentHunk = null;
  let fileIndex = 0;
  const flushHunk = () => {
    if (currentHunk) hunks.push(currentHunk);
    currentHunk = null;
  };
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.startsWith('diff --git ')) {
      flushHunk();
      currentFileHeader = [line];
      continue;
    }
    if (line.startsWith('@@')) {
      flushHunk();
      fileIndex += 1;
      currentHunk = { index: fileIndex, header: line, lines: [] };
      continue;
    }
    if (currentHunk) {
      if (line.startsWith('\\')) {
        currentHunk.lines.push(line);
        continue;
      }
      if (line.startsWith('+') || line.startsWith('-') || line.startsWith(' ') || line.length === 0) {
        currentHunk.lines.push(line);
        continue;
      }
      flushHunk();
    }
    if (!currentHunk && currentFileHeader.length > 0 && (line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('new file') || line.startsWith('deleted file'))) {
      currentFileHeader.push(line);
    }
  }
  flushHunk();
  hunks.fileHeaders = currentFileHeader;
  return hunks;
}

export function buildPatch(fileHeaderLines, selectedHunks) {
  const header = fileHeaderLines.filter(l => l.startsWith('diff --git ') || l.startsWith('index ') || l.startsWith('--- ') || l.startsWith('+++ ') || l.startsWith('new file') || l.startsWith('deleted file'));
  const body = [];
  for (const hunk of selectedHunks) {
    body.push(hunk.header);
    body.push(...hunk.lines);
  }
  return `${header.join('\n')}\n${body.join('\n')}\n`;
}

export function parseBlamePorcelain(text) {
  const lines = [];
  let current = null;
  for (const raw of text.split('\n')) {
    if (raw.startsWith('\t')) {
      if (current) lines.push({ ...current, text: raw.slice(1).replace(/\r$/, '') });
      current = null;
      continue;
    }
    const headerMatch = /^([0-9a-f]{40}) (\d+) (\d+)(?: (\d+))?$/.exec(raw);
    if (headerMatch) {
      current = { commit: headerMatch[1], line_number: Number(headerMatch[3]) };
      continue;
    }
    if (current && /^author /.test(raw)) current.author = raw.slice(7);
  }
  return lines;
}

export class GitService {
  constructor({ workspace }) {
    this.workspace = workspace;
  }

  run(args, opts = {}) {
    return new Promise((resolve, reject) => {
      const child = execFile(
        'git',
        ['-C', this.workspace, '--no-pager', ...args],
        {
          shell: false,
          timeout: opts.timeoutMs ?? 15000,
          maxBuffer: 64 * 1024 * 1024,
          windowsHide: true,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo' }
        },
        (error, stdout, stderr) => {
          if (error) {
            const err = new Error(String(stderr || error.message));
            err.code = error.code;
            err.killed = error.killed === true;
            reject(err);
            return;
          }
          resolve({ stdout: String(stdout), stderr: String(stderr) });
        }
      );
      child.stdin?.on('error', () => {});
      if (typeof opts.input === 'string') child.stdin?.end(opts.input, 'utf8');
    });
  }

  async hasRepo() {
    try {
      await this.run(['rev-parse', '--is-inside-work-tree'], { timeoutMs: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  guard(relativePath) {
    const resolved = resolveWorkspacePath(this.workspace, relativePath);
    if (!resolved) throw Object.assign(new Error(`path escapes workspace: ${relativePath}`), { name: 'PATH_ESCAPE' });
    return resolved.relative;
  }

  async status() {
    const { stdout } = await this.run(['status', '--porcelain=v2', '--branch', '--no-renames'], { timeoutMs: 10000 });
    return parseStatusPorcelainV2(stdout);
  }

  async diff(pathArg, cached) {
    const args = ['diff', '-U3'];
    if (cached) args.push('--cached');
    if (pathArg !== undefined) args.push('--', this.guard(pathArg));
    const { stdout } = await this.run(args);
    return { text: stdout.length > MAX_DIFF_BYTES ? stdout.slice(0, MAX_DIFF_BYTES) : stdout, truncated: stdout.length > MAX_DIFF_BYTES };
  }

  async stage(paths) {
    const safe = paths.map(p => this.guard(p));
    await this.run(['add', '--', ...safe], { timeoutMs: 20000 });
  }

  async unstage(paths) {
    const safe = paths.map(p => this.guard(p));
    await this.run(['restore', '--staged', '--', ...safe], { timeoutMs: 20000 });
  }

  async commit(message) {
    const cleaned = String(message).replace(/\0/g, '').trim();
    if (cleaned.length === 0) throw Object.assign(new Error('commit message is empty'), { name: 'EMPTY_MESSAGE' });
    const attempt = () => this.run(['commit', '-m', cleaned], { timeoutMs: 20000 });
    let result;
    try {
      result = await attempt();
    } catch (error) {
      if (/refs\/heads|lock/i.test(String(error.message))) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        result = await attempt();
      } else {
        throw error;
      }
    }
    const oidLine = /(?:^|\n)\[.+?\s([0-9a-f]{7,40})\]/.exec(result.stdout);
    const oid = oidLine ? oidLine[1] : (await this.run(['rev-parse', 'HEAD'])).stdout.trim();
    return { oid };
  }

  async branches() {
    const { stdout } = await this.run(['branch', '--format=%(HEAD)%(refname:short)']);
    return {
      branches: stdout
        .split('\n')
        .map(l => l.replace(/\r$/, ''))
        .filter(Boolean)
        .map(line => ({ name: line.slice(1), current: line.startsWith('*') }))
    };
  }

  parseLog(stdout) {
    return stdout
      .split('\n')
      .map(l => l.replace(/\r$/, ''))
      .filter(Boolean)
      .map(line => {
        const [oid, short, author, date, subject] = line.split('\t');
        return { oid, short, author, date, subject };
      });
  }

  async log(limit) {
    const n = Math.min(MAX_LOG_COMMITS, limit ?? 50);
    const { stdout } = await this.run(['log', `-n${n}`, '--format=%H%x09%h%x09%an%x09%aI%x09%s']);
    return { commits: this.parseLog(stdout) };
  }

  async fileLog(pathArg, limit) {
    const safe = this.guard(pathArg);
    const n = Math.min(MAX_LOG_COMMITS, limit ?? 50);
    const { stdout } = await this.run(['log', `-n${n}`, '--follow', '--format=%H%x09%h%x09%an%x09%aI%x09%s', '--', safe]);
    return { commits: this.parseLog(stdout) };
  }

  async hunks(pathArg) {
    const safe = this.guard(pathArg);
    const diffResult = await this.diff(safe, false);
    return { hunks: splitUnifiedDiff(diffResult.text), truncated: diffResult.truncated };
  }

  async stageHunks(pathArg, indexes) {
    const safe = this.guard(pathArg);
    const diffResult = await this.diff(safe, false);
    const all = splitUnifiedDiff(diffResult.text);
    const wanted = new Set(indexes);
    const selected = all.filter(hunk => wanted.has(hunk.index));
    if (selected.length !== indexes.length) throw Object.assign(new Error('hunk index out of range'), { name: 'BAD_REQUEST' });
    const headers = ['diff --git'];
    const patch = buildPatch(this.extractFileHeader(diffResult.text), selected);
    await this.run(['apply', '--cached', '--whitespace=nowarn', '-'], { timeoutMs: 20000, input: patch });
    void headers;
    return { staged_indexes: [...wanted].sort((a, b) => a - b) };
  }

  extractFileHeader(diffText) {
    const lines = [];
    for (const raw of diffText.split('\n')) {
      const line = raw.replace(/\r$/, '');
      if (line.startsWith('@@')) break;
      if (line.startsWith('diff --git ') || line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('new file') || line.startsWith('deleted file')) lines.push(line);
    }
    return lines;
  }

  async unstageHunks(pathArg, indexes) {
    const safe = this.guard(pathArg);
    const diffResult = await this.diff(safe, true);
    const all = splitUnifiedDiff(diffResult.text);
    const wanted = new Set(indexes);
    const selected = all.filter(hunk => wanted.has(hunk.index));
    if (selected.length !== indexes.length) throw Object.assign(new Error('hunk index out of range'), { name: 'BAD_REQUEST' });
    const patch = buildPatch(this.extractFileHeader(diffResult.text), selected);
    await this.run(['apply', '--cached', '-R', '--whitespace=nowarn', '-'], { timeoutMs: 20000, input: patch });
    return { staged_indexes: [...wanted].sort((a, b) => a - b) };
  }

  async blame(pathArg) {
    const safe = this.guard(pathArg);
    const { stdout } = await this.run(['blame', '-p', '--', safe]);
    const lines = parseBlamePorcelain(stdout);
    const capped = lines.length > 50000 ? lines.slice(0, 50000) : lines;
    return { lines: capped, truncated: lines.length > 50000 };
  }
}

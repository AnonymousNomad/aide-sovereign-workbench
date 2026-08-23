import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';

const FILE_CACHE_TTL_MS = 5000;
const MAX_FILES = 50000;
const SEARCH_HARD_TIMEOUT_MS = 10000;

function dataText(field) {
  if (!field) return '';
  if (typeof field.text === 'string') return field.text;
  if (typeof field.bytes === 'string') return '<binary>';
  return '';
}

export function fuzzyScore(query, candidate) {
  const q = query.toLowerCase();
  const c = candidate.toLowerCase();
  if (q.length === 0) return null;
  let score = 0;
  let qi = 0;
  let prevMatch = -2;
  for (let ci = 0; ci < c.length && qi < q.length; ci += 1) {
    if (c[ci] !== q[qi]) continue;
    score += 8;
    if (ci === 0) score += 12;
    else {
      const prior = c[ci - 1];
      if ('/_.-'.includes(prior)) score += 8;
      else if (candidate[ci - 1] >= 'a' && candidate[ci - 1] <= 'z' && candidate[ci] >= 'A' && candidate[ci] <= 'Z') score += 6;
    }
    if (ci === prevMatch + 1) score += 8;
    prevMatch = ci;
    qi += 1;
  }
  if (qi < q.length) return null;
  return score;
}

export class RgService {
  constructor({ workspace, spawnChild = spawn }) {
    this.workspace = workspace;
    this.spawnChild = spawnChild;
    this.rgPath = null;
    this.fileCache = { files: [], at: 0 };
  }

  locateRg() {
    if (this.rgPath) return this.rgPath;
    const candidates = [process.env.AIDE_RG, 'rg'].filter(Boolean);
    for (const candidate of candidates) {
      try {
        const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8', timeout: 5000 });
        if (probe.status === 0 && /ripgrep/i.test(probe.stdout ?? '')) {
          this.rgPath = candidate;
          return this.rgPath;
        }
      } catch {
        /* keep probing */
      }
    }
    throw new Error('ripgrep not found; install ripgrep or set AIDE_RG');
  }

  available() {
    try {
      this.locateRg();
      return true;
    } catch {
      return false;
    }
  }

  listFiles() {
    const age = Date.now() - this.fileCache.at;
    if (age < FILE_CACHE_TTL_MS && this.fileCache.files.length > 0) return Promise.resolve({ files: this.fileCache.files, truncated: false, cache_age_ms: age });
    return new Promise((resolve, reject) => {
      const rg = this.locateRg();
      const child = this.spawnChild(rg, ['--files', '.'], { cwd: this.workspace, windowsHide: true });
      let out = '';
      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', chunk => {
        out += chunk;
      });
      child.once('error', error => reject(error));
      child.once('exit', code => {
        const all = out.split(/\r?\n/).filter(Boolean).map(line => line.replace(/\\/g, '/').replace(/^\.\//, ''));
        const truncated = all.length > MAX_FILES;
        const files = truncated ? all.slice(0, MAX_FILES) : all;
        this.fileCache = { files, at: Date.now() };
        resolve({ files, truncated, cache_age_ms: 0 });
        void code;
      });
    });
  }

  quickOpen(q, limit = 50) {
    return this.listFiles().then(({ files, cache_age_ms }) => {
      const scored = [];
      for (const file of files) {
        const score = fuzzyScore(String(q), file);
        if (score !== null) scored.push({ path: file, score });
      }
      scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
      return { files: scored.slice(0, limit), cache_age_ms };
    });
  }

  search({ query, isRegex = false, caseSensitive = false, maxResults = 1000, fileGlob }) {
    const started = Date.now();
    const rg = this.locateRg();
    const args = ['--json', '-e', query];
    if (!caseSensitive) args.push('-i');
    if (!isRegex) args.push('-F');
    if (fileGlob) args.push('-g', fileGlob);
    args.push('.');
    return new Promise((resolve, reject) => {
      const child = this.spawnChild(rg, args, { cwd: this.workspace, windowsHide: true });
      let buffer = '';
      let killed = false;
      const timer = setTimeout(() => {
        killed = true;
        child.kill();
      }, SEARCH_HARD_TIMEOUT_MS);
      const matches = [];
      let sawMore = false;
      const finish = () => {
        clearTimeout(timer);
        resolve({
          matches,
          truncated: killed || sawMore,
          elapsed_ms: Date.now() - started
        });
      };
      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', chunk => {
        buffer += chunk;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('{')) continue;
          let message;
          try {
            message = JSON.parse(line);
          } catch {
            continue;
          }
          if (message.type !== 'match') continue;
          if (matches.length >= maxResults) {
            sawMore = true;
            killed = true;
            child.kill();
            break;
          }
          const data = message.data ?? {};
          matches.push({
            path: dataText(data.path).replace(/\\/g, '/'),
            line_number: typeof data.line_number === 'number' ? data.line_number : 0,
            line_text: dataText(data.lines).replace(/[\r\n]+$/, ''),
            submatches: (data.submatches ?? []).map(sub => ({
              text: dataText(sub.match),
              start: sub.start ?? 0,
              end: sub.end ?? 0
            }))
          });
        }
      });
      let stderrTail = '';
      child.stderr?.setEncoding('utf8');
      child.stderr?.on('data', chunk => {
        stderrTail = `${stderrTail}${chunk}`.slice(-2000);
      });
      child.once('error', error => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('exit', () => {
        if (/regex parse error|unrecognized flag|error:/i.test(stderrTail) && matches.length === 0) {
          clearTimeout(timer);
          reject(new Error(`rg failed: ${stderrTail.trim().split('\n')[0]}`));
          return;
        }
        finish();
      });
    });
  }

  resolveWorkspacePath(relativePath) {
    const normalized = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, '');
    const absolute = path.resolve(this.workspace, normalized);
    if (!absolute.startsWith(path.resolve(this.workspace))) return null;
    return absolute;
  }
}

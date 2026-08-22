import path from 'node:path';

const REGEX_CACHE = new Map();

function compile(regexp) {
  let re = REGEX_CACHE.get(regexp);
  if (!re) {
    re = new RegExp(regexp);
    REGEX_CACHE.set(regexp, re);
  }
  return re;
}

function normalizeSeverity(raw) {
  if (raw === undefined || raw === null || raw === '') return 'error';
  const value = String(raw).toLowerCase();
  if (/^(error|fatal|err)\b/.test(value)) return 'error';
  if (/^(warn)/.test(value)) return 'warning';
  if (/^(info|information|note|hint)\b/.test(value)) return 'info';
  return 'error';
}

function capture(match, index) {
  if (index === undefined) return undefined;
  const value = match[index];
  return value === undefined ? undefined : value.trim();
}

export class MatcherSession {
  constructor(matcher) {
    this.patterns = Array.isArray(matcher.pattern) ? matcher.pattern : [matcher.pattern];
    this.background = matcher.background ?? null;
    this.active = this.background ? this.background.activeOnStart === true : true;
    this.sawBegin = this.active && this.background ? true : false;
    this.i = 0;
    this.acc = {};
    this.declaredFile = null;
    this.currentFile = null;
    this.lastLoopIdx = null;
    this.last = this.patterns.length - 1;
  }

  push(line) {
    if (this.background) {
      if (compile(this.background.beginsPattern).test(line)) {
        this.active = true;
        this.sawBegin = true;
        return [];
      }
      if (compile(this.background.endsPattern).test(line)) {
        this.active = false;
        return [];
      }
      if (!this.active) return [];
    }
    return this.processLine(line);
  }

  isBackgroundReady() {
    return this.background !== null && this.sawBegin && !this.active;
  }

  processLine(line) {
    let hit = this.tryFrom(line, this.i);
    if (!hit && this.i > 0) hit = this.tryRange(line, 0, this.i - 1);
    if (!hit) {
      this.i = this.lastLoopIdx ?? 0;
      return [];
    }
    const { idx, match } = hit;
    const pattern = this.patterns[idx];

    if (pattern.kind === 'file') {
      this.currentFile = capture(match, pattern.file) ?? null;
      this.acc = {};
      this.declaredFile = null;
      this.i = Math.min(idx + 1, this.last);
      return [];
    }

    if (pattern.file !== undefined) this.declaredFile = capture(match, pattern.file) ?? null;
    for (const key of ['line', 'column', 'severity', 'code', 'message']) {
      if (pattern[key] !== undefined) {
        const value = capture(match, pattern[key]);
        if (value !== undefined && value !== '') this.acc[key] = value;
      }
    }

    const file = this.declaredFile ?? this.currentFile;
    const complete = Boolean(file && this.acc.line);

    if (complete) {
      const problem = {
        file,
        line: Number.parseInt(this.acc.line, 10),
        column: this.acc.column !== undefined ? Number.parseInt(this.acc.column, 10) : null,
        severity: normalizeSeverity(this.acc.severity),
        message: this.acc.message ?? '',
        code: this.acc.code ?? null
      };
      this.acc = {};
      this.declaredFile = null;
      if (pattern.loop) {
        this.lastLoopIdx = idx;
        this.i = idx;
      } else {
        this.i = idx === this.last ? 0 : idx + 1;
        if (this.i !== idx + 1) this.currentFile = null;
      }
      return [problem];
    }

    if (idx < this.last) {
      this.i = idx + 1;
      return [];
    }
    this.acc = {};
    this.declaredFile = null;
    this.i = pattern.loop ? idx : 0;
    return [];
  }

  tryFrom(line, start) {
    return this.tryRange(line, start, this.last);
  }

  tryRange(line, from, to) {
    for (let idx = from; idx <= to; idx++) {
      const match = compile(this.patterns[idx].regexp).exec(line);
      if (match) return { idx, match };
    }
    return null;
  }
}

export function extractRawProblems(matcher, text) {
  const session = new MatcherSession(matcher);
  const problems = [];
  const seen = new Set();
  const lines = text.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  for (const line of lines) {
    for (const problem of session.push(line)) {
      const key = `${problem.file}|${problem.line}|${problem.column}|${problem.message}`;
      if (!seen.has(key)) {
        seen.add(key);
        problems.push(problem);
      }
    }
  }
  return problems;
}

function containedInWorkspace(absolute, workspaceRoot) {
  const rel = path.relative(workspaceRoot, absolute);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : null;
}

function toPosix(p) {
  return p.split(path.sep).join('/');
}

export function resolveRawProblems(matcher, rawProblems, { workspaceRoot, cwd } = {}) {
  if (!workspaceRoot) throw new Error('resolveRawProblems requires workspaceRoot');
  const root = path.resolve(workspaceRoot);
  const base = cwd ? path.resolve(cwd) : root;
  const problems = [];
  let dropped = 0;
  const seen = new Set();
  for (const problem of rawProblems) {
    const location = matcher.fileLocation ?? 'relative';
    const absolute =
      location === 'absolute'
        ? path.resolve(problem.file)
        : path.resolve(location === 'relative' ? base : path.resolve(root, location[1]), problem.file);
    const rel = containedInWorkspace(absolute, root);
    if (!rel) {
      dropped += 1;
      continue;
    }
    const key = `${rel}|${problem.line}|${problem.column}|${problem.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    problems.push({ ...problem, file: toPosix(rel) });
  }
  return { problems, dropped };
}

export function parseProblems(matcher, text, options = {}) {
  return resolveRawProblems(matcher, extractRawProblems(matcher, text), options);
}

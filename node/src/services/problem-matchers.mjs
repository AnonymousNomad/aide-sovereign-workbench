export class MatcherError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'MATCHER';
    this.detail = detail;
  }
}

export const BUILTIN_MATCHERS = {
  tsc: {
    name: 'tsc',
    owner: 'tsc',
    source: 'tsc',
    applyTo: 'allDocuments',
    fileLocation: 'relative',
    pattern: {
      regexp: '^(.+?)\\((\\d+),(\\d+)\\):\\s+(error|warning)\\s+(TS\\d+):\\s+(.*)$',
      file: 1,
      line: 2,
      column: 3,
      severity: 4,
      code: 5,
      message: 6
    }
  },
  'eslint-stylish': {
    name: 'eslint-stylish',
    owner: 'eslint',
    source: 'eslint',
    applyTo: 'allDocuments',
    fileLocation: 'relative',
    pattern: [
      { regexp: '^([^\\s].*)$', kind: 'file', file: 1 },
      {
        regexp: '^\\s+(\\d+):(\\d+)\\s+(error|warning|info)\\s+(.+?)\\s{2,}(\\S+)\\s*$',
        line: 1,
        column: 2,
        severity: 3,
        message: 4,
        code: 5,
        loop: true
      }
    ]
  },
  'eslint-compact': {
    name: 'eslint-compact',
    owner: 'eslint',
    source: 'eslint',
    applyTo: 'allDocuments',
    fileLocation: 'relative',
    pattern: {
      regexp: '^(.+?):\\s+line (\\d+), col (\\d+), (Error|Warning|Info) - (.+?) \\((\\S+)\\)$',
      file: 1,
      line: 2,
      column: 3,
      severity: 4,
      message: 5,
      code: 6
    }
  },
  msbuild: {
    name: 'msbuild',
    owner: 'msbuild',
    source: 'msbuild',
    applyTo: 'allDocuments',
    fileLocation: 'relative',
    pattern: {
      regexp: '^(.+?)\\((\\d+),(\\d+)\\):\\s+(error|warning)\\s+([A-Za-z]+\\d+):\\s+(.*?)(?:\\s+\\[.+?\\])?\\s*$',
      file: 1,
      line: 2,
      column: 3,
      severity: 4,
      code: 5,
      message: 6
    }
  },
  'cargo-rustc': {
    name: 'cargo-rustc',
    owner: 'rustc',
    source: 'rustc',
    applyTo: 'allDocuments',
    fileLocation: 'relative',
    pattern: [
      { regexp: '^(warning|error|note)(?:\\[(.+)\\])?: (.*)$', severity: 1, code: 2, message: 3 },
      { regexp: '^\\s*-->\\s+(.+):(\\d+):(\\d+)\\s*$', file: 1, line: 2, column: 3 }
    ]
  },
  'node-trace': {
    name: 'node-trace',
    owner: 'node',
    source: 'node',
    applyTo: 'allDocuments',
    fileLocation: 'absolute',
    pattern: {
      regexp: '^\\s*at\\s+.*\\((.+?):(\\d+):(\\d+)\\)\\s*$',
      file: 1,
      line: 2,
      column: 3
    }
  }
};

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkPattern(pattern, where) {
  if (!isPlainObject(pattern)) throw new MatcherError(`${where} must be an object`, { where });
  if (typeof pattern.regexp !== 'string' || pattern.regexp.length === 0) {
    throw new MatcherError(`${where}.regexp must be a non-empty string`, { where });
  }
  for (const key of ['file', 'line', 'column', 'severity', 'code', 'message']) {
    const value = pattern[key];
    if (value === undefined) continue;
    if (!Number.isInteger(value) || value < 1) {
      throw new MatcherError(`${where}.${key} must be a positive integer capture-group index`, { where });
    }
  }
  if (pattern.kind !== undefined && pattern.kind !== 'file' && pattern.kind !== 'location') {
    throw new MatcherError(`${where}.kind must be "file" or "location"`, { where });
  }
  if (pattern.loop !== undefined && typeof pattern.loop !== 'boolean') {
    throw new MatcherError(`${where}.loop must be a boolean`, { where });
  }
}

function checkBackground(background, where) {
  if (!isPlainObject(background)) throw new MatcherError(`${where} must be an object`, { where });
  if (typeof background.activeOnStart !== 'boolean') {
    throw new MatcherError(`${where}.activeOnStart must be a boolean`, { where });
  }
  for (const key of ['beginsPattern', 'endsPattern']) {
    if (typeof background[key] !== 'string' || background[key].length === 0) {
      throw new MatcherError(`${where}.${key} must be a non-empty string`, { where });
    }
  }
}

export function normalizeProblemMatcher(value) {
  if (!isPlainObject(value)) throw new MatcherError('problemMatcher must be a string or an object', {});
  for (const key of ['name', 'owner']) {
    if (typeof value[key] !== 'string' || value[key].length === 0) {
      throw new MatcherError(`problemMatcher.${key} must be a non-empty string`, { key });
    }
  }
  const patterns = Array.isArray(value.pattern) ? value.pattern : [value.pattern];
  if (patterns.length === 0) throw new MatcherError('problemMatcher.pattern must have at least one entry', {});
  patterns.forEach((pattern, i) => checkPattern(pattern, `problemMatcher.pattern[${i}]`));
  if (value.applyTo !== undefined && value.applyTo !== 'allDocuments' && value.applyTo !== 'openDocuments') {
    throw new MatcherError('problemMatcher.applyTo must be "allDocuments" or "openDocuments"', {});
  }
  if (value.fileLocation !== undefined) {
    const loc = value.fileLocation;
    const ok =
      loc === 'relative' ||
      loc === 'absolute' ||
      (Array.isArray(loc) && loc.length === 2 && loc[0] === 'relative' && typeof loc[1] === 'string' && loc[1].length > 0);
    if (!ok) throw new MatcherError('problemMatcher.fileLocation must be "relative", "absolute" or ["relative", basePath]', {});
  }
  if (value.background !== undefined) checkBackground(value.background, 'problemMatcher.background');
  return value;
}

export function resolveProblemMatcher(reference, extraMatchers = {}) {
  if (typeof reference === 'string') {
    const name = reference.startsWith('$') ? reference.slice(1) : reference;
    const matcher = BUILTIN_MATCHERS[name] ?? extraMatchers[name];
    if (!matcher) {
      throw new MatcherError(`unknown problem matcher "${reference}"`, { reference, known: [...new Set([...Object.keys(BUILTIN_MATCHERS), ...Object.keys(extraMatchers)])] });
    }
    return matcher;
  }
  return normalizeProblemMatcher(reference);
}

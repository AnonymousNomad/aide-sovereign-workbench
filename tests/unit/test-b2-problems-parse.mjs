import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { BUILTIN_MATCHERS, resolveProblemMatcher, normalizeProblemMatcher, MatcherError } from '../../node/src/services/problem-matchers.mjs';
import { extractRawProblems, parseProblems, MatcherSession } from '../../node/src/services/problem-parser.mjs';
import { validateTaskDefinition } from '../../node/src/services/task-service.mjs';

const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-b2-problems-'));
await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });

const TSC_SAMPLE = [
  '',
  'src/index.ts(10,5): error TS2304: Cannot find name foo.',
  'src/index.ts(12,1): warning TS6133: bar is declared but its value is never read.',
  'Found 2 errors.'
].join('\n');

test('1. tsc sample output parses to exact diagnostics', () => {
  const { problems, dropped } = parseProblems(BUILTIN_MATCHERS.tsc, TSC_SAMPLE, { workspaceRoot });
  assert.equal(dropped, 0);
  assert.deepEqual(problems, [
    { file: 'src/index.ts', line: 10, column: 5, severity: 'error', message: 'Cannot find name foo.', code: 'TS2304' },
    { file: 'src/index.ts', line: 12, column: 1, severity: 'warning', message: 'bar is declared but its value is never read.', code: 'TS6133' }
  ]);
});

const ESLINT_STYLISH = [
  'src/a.js',
  "  1:10  error    'x' is defined but never used  no-unused-vars",
  '  2:1   warning  Missing semicolon  semi',
  '',
  'src/b.js',
  '  3:5   error    Unexpected console statement  no-console'
].join('\n');

test('2. eslint-stylish multi-file block switches files via header pattern', () => {
  const { problems, dropped } = parseProblems(BUILTIN_MATCHERS['eslint-stylish'], ESLINT_STYLISH, { workspaceRoot });
  assert.equal(dropped, 0);
  assert.deepEqual(problems.map(p => [p.file, p.line, p.severity, p.code]), [
    ['src/a.js', 1, 'error', 'no-unused-vars'],
    ['src/a.js', 2, 'warning', 'semi'],
    ['src/b.js', 3, 'error', 'no-console']
  ]);
});

test('3. chunk boundaries are invisible once lines are reassembled (service buffers whole lines)', () => {
  const full = [
    'first noise line',
    "src/index.ts(10,5): error TS2304: Cannot find name 'foo'.",
    'tail noise'
  ].join('\n');
  const cut = full.indexOf("Cannot") + 3;
  assert.notEqual(full.slice(0, cut).split('\n').length, 1);
  const joined = extractRawProblems(BUILTIN_MATCHERS.tsc, full.slice(0, cut) + full.slice(cut));
  const whole = extractRawProblems(BUILTIN_MATCHERS.tsc, full);
  assert.deepEqual(joined, whole);
  assert.equal(joined.length, 1);
});

test('4. relative paths resolve inside the workspace; escapes are dropped with dropped count', async () => {
  const matcher = BUILTIN_MATCHERS.tsc;
  const inside = parseProblems(matcher, 'src/index.ts(1,1): error TS1: x.', { workspaceRoot });
  assert.equal(inside.problems[0].file, 'src/index.ts');

  const escape = parseProblems(matcher, '../outside.ts(1,1): error TS1: x.', { workspaceRoot });
  assert.deepEqual(escape.problems, []);
  assert.equal(escape.dropped, 1);

  const absoluteOutside = parseProblems(BUILTIN_MATCHERS['node-trace'], '    at f (' + path.resolve(workspaceRoot, '..', 'evil.js') + ':3:9)', { workspaceRoot });
  assert.equal(absoluteOutside.dropped, 1);

  const absoluteInside = parseProblems(BUILTIN_MATCHERS['node-trace'], `    at f (${path.join(workspaceRoot, 'src', 'a.js')}:3:9)`, { workspaceRoot });
  assert.deepEqual(absoluteInside.problems.map(p => p.file), ['src/a.js']);
  assert.equal(absoluteInside.dropped, 0);

  const based = parseProblems({ ...BUILTIN_MATCHERS.tsc, fileLocation: ['relative', 'docs'] }, 'readme.md(2,2): error TS1: y.', { workspaceRoot });
  assert.deepEqual(based.problems.map(p => p.file), ['docs/readme.md']);
});

test('5. background begin/end patterns gate which lines are scanned', () => {
  const watcher = {
    name: 'watch-demo',
    owner: 'demo',
    background: { activeOnStart: false, beginsPattern: '\\*{5}', endsPattern: '^Watching for' },
    pattern: { regexp: '^(.+?):(\\d+): (.*)$', file: 1, line: 2, message: 3 }
  };
  const text = [
    'idle line should be skipped: src/never.ts:99: nope',
    '***** compile start *****',
    'src/x.ts:1: boom',
    'Watching for file changes.',
    'src/y.ts:2: after end must be skipped'
  ].join('\n');
  const problems = extractRawProblems(watcher, text);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].file, 'src/x.ts');
});

test('7. duplicate problems dedupe by file|line|column|message', () => {
  const line = 'src/index.ts(10,5): error TS2304: Cannot find name foo.';
  const problems = extractRawProblems(BUILTIN_MATCHERS.tsc, `${line}\n${line}`);
  assert.equal(problems.length, 1);
});

test('eslint-compact and msbuild formats parse with codes and severities', () => {
  const compact = parseProblems(
    BUILTIN_MATCHERS['eslint-compact'],
    'src/a.js: line 4, col 8, Error - Unexpected token (no-unused-vars)',
    { workspaceRoot }
  );
  assert.deepEqual(compact.problems[0], { file: 'src/a.js', line: 4, column: 8, severity: 'error', message: 'Unexpected token', code: 'no-unused-vars' });

  const msbuild = parseProblems(
    BUILTIN_MATCHERS.msbuild,
    'Subdir/App.cs(10,5): error CS1002: ; expected [App.csproj]',
    { workspaceRoot }
  );
  assert.deepEqual(msbuild.problems[0], { file: 'Subdir/App.cs', line: 10, column: 5, severity: 'error', message: '; expected', code: 'CS1002' });

  const msbuildPlain = parseProblems(BUILTIN_MATCHERS.msbuild, 'App.cs(3,1): warning CS0168: variable declared but never used', { workspaceRoot });
  assert.equal(msbuildPlain.problems[0].severity, 'warning');
});

test('cargo-rustc two-pattern pipeline merges message line with location line', () => {
  const text = ['warning: unused variable: `x`', ' --> src/main.rs:2:9'].join('\n');
  const { problems, dropped } = parseProblems(BUILTIN_MATCHERS['cargo-rustc'], text, { workspaceRoot });
  assert.equal(dropped, 0);
  assert.deepEqual(problems, [{ file: 'src/main.rs', line: 2, column: 9, severity: 'warning', message: 'unused variable: `x`', code: null }]);
});

test('rustc bracketed codes and consecutive pairs keep pipeline state clean', () => {
  const text = [
    'error[E0308]: mismatched types',
    ' --> src/lib.rs:5:5',
    '   | help lines that match nothing',
    'note: second diagnostic without code',
    ' --> src/lib.rs:9:1'
  ].join('\n');
  const problems = extractRawProblems(BUILTIN_MATCHERS['cargo-rustc'], text);
  assert.deepEqual(problems.map(p => [p.code, p.message, p.line]), [
    ['E0308', 'mismatched types', 5],
    [null, 'second diagnostic without code', 9]
  ]);
});

test('severity normalization maps variants and defaults to error', () => {
  const matcher = {
    name: 'sev',
    owner: 'sev',
    pattern: { regexp: '^(.+?):(\\d+):\\s*([A-Za-z]+): (.*)$', file: 1, line: 2, severity: 3, message: 4 }
  };
  const rows = [
    ['a.js:1: Error: x', 'error'],
    ['a.js:1: fatal: x', 'error'],
    ['a.js:1: Warning: x', 'warning'],
    ['a.js:1: note: x', 'info'],
    ['a.js:1: hint: x', 'info'],
    ['a.js:1: banana: x', 'error']
  ];
  for (const [line, expected] of rows) {
    assert.equal(extractRawProblems(matcher, line)[0].severity, expected, line);
  }
  const noSeverity = extractRawProblems(BUILTIN_MATCHERS['eslint-stylish'], 'b.js\n  1:1  info  hi  rule-x', '');
  assert.equal(noSeverity[0].severity, 'info');
});

test('loop continuation survives noise lines between problem rows of one file', () => {
  const text = [
    'src/a.js',
    '  1:1  error  first  r1',
    'some unrelated noise line',
    '  2:2  warning  second  r2'
  ].join('\n');
  const problems = extractRawProblems(BUILTIN_MATCHERS['eslint-stylish'], text);
  assert.deepEqual(problems.map(p => [p.line, p.message]), [[1, 'first'], [2, 'second']]);
});

test('inline matcher validation rejects malformed definitions', () => {
  assert.throws(() => normalizeProblemMatcher({ name: 'x' }), MatcherError);
  assert.throws(() => normalizeProblemMatcher({ name: 'x', owner: 'y', pattern: { regexp: '' } }), MatcherError);
  assert.throws(() => normalizeProblemMatcher({ name: 'x', owner: 'y', pattern: { regexp: 'a', line: 0 } }), MatcherError);
  assert.throws(() => normalizeProblemMatcher({ name: 'x', owner: 'y', pattern: { regexp: 'a', kind: 'bogus' } }), MatcherError);
  assert.throws(() => normalizeProblemMatcher({ name: 'x', owner: 'y', pattern: { regexp: 'a' }, fileLocation: ['absolute', 'p'] }), MatcherError);
  assert.throws(() => normalizeProblemMatcher({ name: 'x', owner: 'y', pattern: { regexp: 'a' }, background: { activeOnStart: 'yes', beginsPattern: 'b', endsPattern: 'e' } }), MatcherError);
  assert.doesNotThrow(() => normalizeProblemMatcher({ name: 'x', owner: 'y', pattern: [{ regexp: 'f', kind: 'file', file: 1 }, { regexp: 'l', loop: true }] }));
});

test('resolveProblemMatcher handles $refs, bare names, workspace extras and unknown names', () => {
  assert.equal(resolveProblemMatcher('$tsc').name, 'tsc');
  assert.equal(resolveProblemMatcher('tsc').name, 'tsc');
  const extra = { custom: { name: 'custom', owner: 'me', pattern: { regexp: 'x' } } };
  assert.equal(resolveProblemMatcher('$custom', extra).name, 'custom');
  assert.throws(() => resolveProblemMatcher('$nope'), error => error instanceof MatcherError);
});

test('task validator accepts string and inline matchers, rejects junk', () => {
  validateTaskDefinition({ label: 'a', type: 'shell', command: 'x', problemMatcher: '$tsc' }, 0);
  validateTaskDefinition({ label: 'a', type: 'shell', command: 'x', problemMatcher: { name: 'n', owner: 'o', pattern: { regexp: 'r' } } }, 0);
  validateTaskDefinition({ label: 'a', type: 'shell', command: 'x', problemMatcher: ['$tsc', { name: 'n', owner: 'o', pattern: { regexp: 'r' } }] }, 0);
  assert.throws(() => validateTaskDefinition({ label: 'a', type: 'shell', command: 'x', problemMatcher: '' }, 0));
  assert.throws(() => validateTaskDefinition({ label: 'a', type: 'shell', command: 'x', problemMatcher: [] }, 0));
  assert.throws(() => validateTaskDefinition({ label: 'a', type: 'shell', command: 'x', problemMatcher: {} }, 0));
  assert.throws(() => validateTaskDefinition({ label: 'a', type: 'shell', command: 'x', problemMatcher: 42 }, 0));
});

test('multiple matchers over one output merge into distinct problems', () => {
  const text = [
    "src/index.ts(10,5): error TS2304: Cannot find name 'foo'.",
    'src/index.ts: line 10, col 5, Error - second opinion (rule-x)'
  ].join('\n');
  const problems = [
    ...parseProblems(BUILTIN_MATCHERS.tsc, text, { workspaceRoot }).problems,
    ...parseProblems(BUILTIN_MATCHERS['eslint-compact'], text, { workspaceRoot }).problems
  ];
  assert.equal(problems.length, 2);
  assert.deepEqual(problems.map(p => p.code), ['TS2304', 'rule-x']);
});

test('MatcherSession exposes incremental parsing for streaming consumers', () => {
  const session = new MatcherSession(BUILTIN_MATCHERS.tsc);
  assert.deepEqual(session.push('noise'), []);
  assert.equal(session.push(TSC_SAMPLE.split('\n')[1]).length, 1);
});

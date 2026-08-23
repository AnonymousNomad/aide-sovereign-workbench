import assert from 'node:assert/strict';
import test from 'node:test';
import { parseStatusPorcelainV2, splitUnifiedDiff, buildPatch, parseBlamePorcelain } from '../../node/src/services/git-service.mjs';

test('porcelain v2 parser handles branch headers, tracked, untracked, conflicts', () => {
  const fixture = [
    '# branch.oid deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    '# branch.head main',
    '# branch.upstream origin/main',
    '# branch.ab +3 -1',
    '1 .M N... 100644 100644 100644 abc def modified.txt',
    '1 M. N... 100644 100644 100644 abc ghi staged.txt',
    '? untracked-file.txt',
    'u UU N... 100644 100644 100644 100644 abc def ghi conflict.txt',
    ''
  ].join('\n');
  const parsed = parseStatusPorcelainV2(fixture);
  assert.equal(parsed.branch, 'main');
  assert.equal(parsed.upstream, 'origin/main');
  assert.equal(parsed.ahead, 3);
  assert.equal(parsed.behind, 1);
  assert.equal(parsed.detached, false);
  assert.equal(parsed.changes.length, 4);

  const modified = parsed.changes[0];
  assert.deepEqual({ path: modified.path, x: modified.x, y: modified.y, staged: modified.staged }, { path: 'modified.txt', x: '.', y: 'M', staged: false });
  const staged = parsed.changes[1];
  assert.equal(staged.staged, true);
  const untracked = parsed.changes[2];
  assert.deepEqual({ path: untracked.path, untracked: untracked.untracked }, { path: 'untracked-file.txt', untracked: true });
  const conflict = parsed.changes[3];
  assert.deepEqual({ path: conflict.path, conflict: conflict.conflict }, { path: 'conflict.txt', conflict: true });
});

test('porcelain v2 parser survives unborn branch and detached head without crashing', () => {
  const unborn = ['# branch.oid ', '# branch.head (unknown)', '? new.txt', ''].join('\n');
  const parsedUnborn = parseStatusPorcelainV2(unborn);
  assert.equal(parsedUnborn.branch, null);
  assert.equal(parsedUnborn.oid, null);

  const detached = ['# branch.oid abc', '# branch.head (detached)', '', ''].join('\n');
  const parsedDetached = parseStatusPorcelainV2(detached);
  assert.equal(parsedDetached.detached, true);
  assert.equal(parsedDetached.branch, null);
});

test('porcelain v2 keeps paths containing spaces intact', () => {
  const fixture = ['1 .M N... 100644 100644 100644 abc def my file with spaces.txt', ''].join('\n');
  const parsed = parseStatusPorcelainV2(fixture);
  assert.equal(parsed.changes[0].path, 'my file with spaces.txt');
});

const DIFF_FIXTURE = [
  'diff --git a/one.txt b/one.txt',
  'index aaa..bbb 100644',
  '--- a/one.txt',
  '+++ b/one.txt',
  '@@ -1,4 +1,5 @@',
  ' context one',
  '-old line',
  '+new line',
  '+added line',
  ' context two',
  ' context three',
  '@@ -10,3 +11,4 @@',
  ' ctx a',
  '+inserted',
  ' ctx b',
  ' ctx c',
  'diff --git a/two.txt b/two.txt',
  'index ccc..ddd 100644',
  '--- a/two.txt',
  '+++ b/two.txt',
  "@@ -1,2 +1,2 @@", // eslint-disable-line no-irregular-whitespace
  '-two old',
  '+two new'
].join('\n');

test('unified diff splitter yields stable per-file hunk indexes and exact bodies', () => {
  const hunks = splitUnifiedDiff(DIFF_FIXTURE);
  assert.equal(hunks.length, 3);
  assert.deepEqual(hunks.map(h => h.index), [1, 2, 3]);
  assert.match(hunks[0].header, /^@@ -1,4 \+1,5 @@$/);
  assert.equal(hunks[0].lines[0], ' context one');
  assert.equal(hunks[0].lines.at(-1), ' context three');
  assert.match(hunks[1].header, /^@@ -10,3 \+11,4 @@$/);
  assert.deepEqual(hunks[2].lines, ['-two old', '+two new']);
});

test('buildPatch reconstructs an applyable patch from file header plus selected hunks', () => {
  const hunks = splitUnifiedDiff(DIFF_FIXTURE);
  const header = ['diff --git a/two.txt b/two.txt', 'index ccc..ddd 100644', '--- a/two.txt', '+++ b/two.txt'];
  const patch = buildPatch(header, [hunks[2]]);
  for (const required of ['diff --git a/two.txt b/two.txt', '+++ b/two.txt', hunks[2].header, '+two new']) {
    assert.ok(patch.includes(required));
  }
  assert.ok(!patch.includes('one.txt'));
});

test('blame porcelain pairs commit blocks with content lines and authors', () => {
  const fixture = [
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1 1 1',
    'author Jane Dev',
    '\tfirst line',
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 2 2',
    'author Bob',
    '\tsecond line'
  ].join('\n');
  const lines = parseBlamePorcelain(fixture);
  assert.deepEqual(lines, [
    { commit: 'a'.repeat(40), line_number: 1, author: 'Jane Dev', text: 'first line' },
    { commit: 'b'.repeat(40), line_number: 2, author: 'Bob', text: 'second line' }
  ]);
});

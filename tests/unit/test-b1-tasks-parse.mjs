import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTasksJson, validateTaskDefinition, detectNpmTasks, normalizeGroup, resolveCommand, TaskFileError } from '../../node/src/services/task-service.mjs';

const VALID = JSON.stringify({
  version: '2.0.0',
  tasks: [
    { label: 'build', type: 'shell', command: 'npm', args: ['run', 'build'], group: 'build' },
    { label: 'watch', type: 'process', command: 'node', args: ['watch.js'], isBackground: true, group: { kind: 'build', isDefault: true }, problemMatcher: ['$tsc'] }
  ]
});

test('parseTasksJson accepts a valid v2 file with group forms and problemMatcher passthrough', () => {
  const parsed = parseTasksJson(VALID);
  assert.equal(parsed.version, '2.0.0');
  assert.equal(parsed.tasks.length, 2);
  assert.equal(parsed.tasks[0].label, 'build');
  assert.deepEqual(normalizeGroup(parsed.tasks[1].group), { groupKind: 'build', groupIsDefault: true });
  assert.deepEqual(normalizeGroup(parsed.tasks[0].group), { groupKind: 'build', groupIsDefault: false });
  assert.deepEqual(normalizeGroup(undefined), {});
});

test('parseTasksJson rejects malformed files with TaskFileError detail', () => {
  const cases = [
    '{ not json',
    '{"version":"1.0.0","tasks":[]}',
    '{"version":"2.0.0"}',
    '{"version":"2.0.0","tasks":{},"extra":1}',
    '{"version":"2.0.0","tasks":[{"label":"x"}]}',
    '{"version":"2.0.0","tasks":[{"label":"","type":"shell","command":"x"}]}',
    '{"version":"2.0.0","tasks":[{"label":"x","type":"magic","command":"x"}]}',
    '{"version":"2.0.0","tasks":[{"label":"x","type":"shell","command":"x","unknownKey":1}]}'
  ];
  for (const raw of cases) {
    assert.throws(() => parseTasksJson(raw), error => error instanceof TaskFileError, `should reject: ${raw}`);
  }
  try {
    parseTasksJson('{"version":"2.0.0","tasks":[{"label":"x","type":"shell","command":"x","unknownKey":1}]}');
  } catch (error) {
    assert.match(error.message, /unknownKey/);
    assert.ok(error.detail);
  }
});

test('validateTaskDefinition enforces strict runOptions and dependsOn shapes', () => {
  assert.doesNotThrow(() => validateTaskDefinition({ label: 'a', type: 'process', command: 'node', runOptions: { runOn: 'folderOpen' }, dependsOn: ['b'] }, 0));
  assert.throws(() => validateTaskDefinition({ label: 'a', type: 'process', command: 'node', runOptions: { runOn: 'whenever' } }, 0), TaskFileError);
  assert.throws(() => validateTaskDefinition({ label: 'a', type: 'process', command: 'node', dependsOn: [42] }, 0), TaskFileError);
  assert.throws(() => validateTaskDefinition({ label: 'a', type: 'process', command: 'node', args: [1] }, 0), TaskFileError);
});

test('detectNpmTasks extracts scripts as process tasks and tolerates bad package.json', () => {
  const detected = detectNpmTasks(JSON.stringify({ name: 'demo', scripts: { build: 'tsc', empty: '' } }));
  assert.deepEqual(
    detected.map(task => task.label),
    ['npm: build', 'npm: empty']
  );
  assert.equal(detected[0].source, 'detected');
  assert.deepEqual(detectNpmTasks('not json'), []);
  assert.deepEqual(detectNpmTasks(JSON.stringify({ scripts: null })), []);
});

test('resolveCommand adds .cmd shims on Windows only for bare known names', t => {
  if (process.platform !== 'win32') {
    t.skip('windows-only behavior');
    return;
  }
  assert.equal(resolveCommand('process', 'npm'), 'npm.cmd');
  assert.equal(resolveCommand('process', 'npx'), 'npx.cmd');
  assert.equal(resolveCommand('process', 'node'), 'node');
  assert.equal(resolveCommand('process', '.\\npm.cmd'), '.\\npm.cmd');
});

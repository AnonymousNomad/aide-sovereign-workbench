import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TaskManager } from './manager.mjs';

const manager = new TaskManager({ manifestPath: path.join(process.cwd(), 'tasks/manifest.json'), workspace: process.cwd() });
await manager.load();
assert.ok(manager.list().some(task => task.id === 'test'));
assert.throws(() => manager.run('not-allowlisted'), /not allowlisted/);
console.log('task manager core passed');

// --- B2b: problem matchers feed the diagnostics store ---

const tmp = await mkdtemp(path.join(os.tmpdir(), 'aide-b2b-tasks-'));
const manifestPath = path.join(tmp, 'manifest.json');
await writeFile(manifestPath, JSON.stringify({
  tasks: [
    { id: 'tsc-fail', label: 'Typecheck demo', program: 'node', args: ['-e', 'console.error(String.raw`src/index.ts(10,5): error TS2304: Cannot find name foo.`)'], problemMatcher: '$tsc' },
    { id: 'multi-matcher', label: 'Multi', program: 'node', args: ['-e', 'console.error(String.raw`src/a.js: line 4, col 8, Error - Unexpected token (rule-x)`); console.error(String.raw`src/index.ts(2,1): warning TS6133: unused.`)'], problemMatcher: ['$eslint-compact', '$tsc'] },
    { id: 'plain', label: 'No matcher', program: 'node', args: ['-e', 'console.error("just noise")'] },
    { id: 'escaper', label: 'Escape attempt', program: 'node', args: ['-e', 'console.error(String.raw`../outside.ts(1,1): error TS1: x.`)'], problemMatcher: '$tsc' },
    { id: 'bad-ref', label: 'Bad matcher ref', program: 'node', args: ['-e', ''], problemMatcher: '$does-not-exist' }
  ]
}));
const workspaceRoot = path.join(tmp, 'ws');
await mkdir(path.join(workspaceRoot, 'src'), { recursive: true });

const m2 = new TaskManager({ manifestPath, workspace: workspaceRoot });
await m2.load();

function waitForStatus(managerInstance, expected, label) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      const status = managerInstance.status();
      if (status.status === expected || status.code !== null && status.status !== 'running' && status.status !== 'stopping') {
        clearInterval(timer);
        resolve(status);
      } else if (Date.now() - started > 15000) {
        clearInterval(timer);
        reject(new Error(`timed out waiting for ${label}; last=${JSON.stringify(status)}`));
      }
    }, 50);
  });
}

await m2.run('tsc-fail');
await waitForStatus(m2, undefined, 'tsc-fail');
let problems = m2.problemsList();
assert.equal(problems.length, 1, `expected exactly 1 problem, got ${JSON.stringify(problems)}`);
assert.equal(problems[0].uri, 'file:///workspace/src/index.ts');
assert.equal(problems[0].range.start.line, 9);
assert.equal(problems[0].range.start.column, 4);
assert.equal(problems[0].severity, 1);
assert.match(problems[0].message, /Cannot find name foo/);
assert.match(problems[0].source, /tsc-fail/);

await m2.run('tsc-fail');
await waitForStatus(m2, undefined, 'tsc-fail rerun');
problems = m2.problemsList();
assert.equal(problems.length, 1, 'rerun must replace, not duplicate');

await m2.run('plain');
await waitForStatus(m2, undefined, 'plain');
assert.equal(m2.problemsList().length, 1, 'matcher-less task adds nothing');

await m2.run('multi-matcher');
await waitForStatus(m2, undefined, 'multi-matcher');
problems = m2.problemsList();
assert.equal(problems.length, 3, `eslint-compact+tsc merged, got ${JSON.stringify(problems.map(p => p.message))}`);
assert.deepEqual(problems.filter(p => p.uri.includes('index.ts') && p.severity === 2).length, 1);

await m2.run('escaper');
await waitForStatus(m2, undefined, 'escaper');
problems = m2.problemsList();
assert.equal(problems.length, 3, 'escaping paths are dropped entirely');
assert.ok(problems.every(p => !p.uri.includes('outside')), 'no escaped uri leaked');

m2.clearProblems();
assert.equal(m2.problemsList().length, 0, 'clearProblems empties the store');

assert.throws(() => m2.run('bad-ref'), /unknown problem matcher/);
console.log('task manager problem-matcher integration passed');



import assert from 'node:assert/strict';
import { evaluateExecution, evaluateVeritas, renderVeritasReport } from './veritas.mjs';
import { parseVeritasArgs, renderHelp } from './run-veritas.mjs';

const blocked = evaluateVeritas({
  taskClass: 'code-change',
  evidenceScore: 0.5,
  checks: {
    compile: true,
    tests: false,
    'secret-scan': false,
    'patch-parse': true
  }
});

assert.equal(blocked.status, 'abstain-needs-evidence');
assert.equal(blocked.evidence_level, 'weak');
assert.deepEqual(blocked.failed_checks, ['tests', 'secret-scan']);
assert.deepEqual(blocked.failed_oaths.map(oath => oath.id), ['evidence-over-confidence', 'protect-the-user']);

const verified = evaluateExecution({
  taskClass: 'security-or-publish',
  execution: {
    passed: true,
    checks: {
      compile: true,
      tests: true,
      'git-diff': true,
      'secret-scan': true
    }
  }
});

assert.equal(verified.status, 'verified');
assert.equal(verified.threshold, 0.98);

const report = renderVeritasReport({
  taskClass: 'code-change',
  veritas: blocked,
  execution: {
    results: [
      { name: 'compile', passed: true },
      { name: 'tests', passed: false },
      { name: 'secret-scan', passed: false }
    ]
  }
});

assert.match(report, /# Veritas Report/);
assert.match(report, /Evidence over confidence/);
assert.match(report, /Protect the user/);
assert.match(report, /Do not present the work as verified/);

const parsed = parseVeritasArgs([
  '--report',
  '--task-class',
  'security-or-publish',
  '--workspace',
  '.',
  '--output',
  'artifacts/veritas.md'
]);
assert.equal(parsed.format, 'report');
assert.equal(parsed.taskClass, 'security-or-publish');
assert.match(parsed.output.replaceAll('\\', '/'), /artifacts\/veritas\.md$/);

assert.throws(() => parseVeritasArgs(['--task-class', 'unknown']), /unknown task class/);
assert.throws(() => parseVeritasArgs(['--workspace']), /requires a value/);
assert.match(renderHelp(), /Task classes:/);

console.log('veritas test passed');

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';

const allowed = new Set([
  'AGENT_NOTES.md', 'common/contracts/agent.ts', 'common/contracts/audit.ts', 'common/openapi.json',
  'harness/cipher-state.mjs', 'harness/cipher-state.d.mts', 'node/src/events.ts',
  'node/src/openapi.ts', 'node/src/routes/agent.ts',
  'node/src/services/agent-loop.mjs', 'node/src/services/agent-loop.d.mts',
  'node/src/services/audit-trail.mjs', 'node/src/services/audit-trail.d.mts',
  'node/src/services/skills-loader.mjs', 'node/src/services/skills-loader.d.mts',
  'tests/arch/agent-execution-integrity.test.ts', 'tests/arch/closed-loop-mission.test.ts',
  'tests/arch/audit-routes.test.ts', 'tests/arch/events-contract.test.ts',
  'tests/arch/ws-events.test.ts', 'tests/arch/agent-routes.test.ts', 'tests/unit/test-agent-loop-tier.mjs'
]);
function git(...args) {
  const result = spawnSync('git', args, { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
const changes = git('diff', '--name-only').trim().split(/\r?\n/).filter(Boolean);
assert.deepEqual(changes.filter(file => !allowed.has(file)), [], 'tracked mutation outside approved boundary');
git('diff', '--check');
const tier = 'tests/unit/test-agent-loop-tier.mjs';
const assertions = source => source.split(/\r?\n/).filter(line => /^\s*assert\./.test(line));
const current = await readFile(tier, 'utf8');
assert.deepEqual(assertions(current), assertions(git('show', `HEAD:${tier}`)), 'tier prompt assertions must remain unchanged');
assert.doesNotMatch(current, /setTimeout|sleep|ENOTEMPTY/, 'tier synchronization must not hide a cleanup race');
const syntax = [];
for (const file of changes.filter(file => file.endsWith('.mjs'))) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', windowsHide: true });
  syntax.push({ file, code: result.status, stderr: result.stderr });
  assert.equal(result.status, 0, result.stderr);
}
const report = {
  at: new Date().toISOString(), head: git('rev-parse', 'HEAD').trim(), freeMemoryBytes: os.freemem(),
  trackedFiles: changes, diffCheck: 'passed', boundaryCheck: 'passed', syntax,
  tierAssertionsUnchanged: assertions(current).length,
  trackedDiffStat: git('diff', '--stat'), trackedNumstat: git('diff', '--numstat'),
  newIntegrityTestLines: (await readFile('tests/arch/agent-execution-integrity.test.ts', 'utf8')).split('\n').length,
  note: 'Untracked Phase-0 docs and four operator scripts predate Phase 1A; not staged or modified by this repair.'
};
await writeFile(new URL('./phase1a-static.json', import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

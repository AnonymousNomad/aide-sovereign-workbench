import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LearnerState } from './learner-state.mjs';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-learner-'));
const statePath = path.join(dir, 'learner-state.json');

try {
  const state = new LearnerState({ statePath });
  const snap = await state.load();
  assert.equal(snap.schema_version, 1);
  assert.deepEqual(snap.skills, {});
  assert.equal(state.dueReviews().length, 0);

  const first = await state.recordAttempt('python:loops', { passed: true });
  assert.equal(first.attempts, 1);
  assert.equal(first.passes, 1);
  assert.ok(first.mastery > 0.5, 'pass raises mastery from 0.5');
  assert.equal(first.interval_days, 1);

  const fail = await state.recordAttempt('python:loops', { passed: false, misconceptionTags: ['off-by-one'] });
  assert.equal(fail.streak, 0);
  assert.equal(fail.interval_days, 1);
  assert.ok(fail.mastery < first.mastery, 'fail lowers mastery');
  assert.equal(fail.misconceptions['off-by-one'], 1);
  await assert.rejects(() => state.recordAttempt('x', { passed: 'yes' }), /boolean/);

  const reviews = state.dueReviews(new Date(Date.now() + 2 * 86400000).toISOString());
  assert.ok(reviews.some(r => r.skillId === 'python:loops'), 'skill due after interval passes');
  assert.equal(state.dueReviews(new Date(Date.now() - 86400000).toISOString()).length, 0, 'not due immediately');

  const reloaded = new LearnerState({ statePath });
  const again = await reloaded.load();
  const persisted = again.skills['python:loops'];
  assert.ok(persisted && persisted.attempts === 2 && persisted.passes === 1, 'state survives reload');

  await fs.writeFile(statePath, '{corrupt json!!');
  const healed = new LearnerState({ statePath });
  const healedSnap = await healed.load();
  assert.deepEqual(healedSnap.skills, {}, 'corrupt file resets to empty');
  assert.ok(!(await fs.stat(`${statePath}.bak`).then(() => true, () => false)) === false || true);
  const bakExists = await fs.stat(`${statePath}.bak`).then(() => true, () => false);
  assert.equal(bakExists, true, 'corrupt original preserved as .bak');

  const progressPath = path.join(dir, 'tutor-progress.json');
  await fs.writeFile(progressPath, JSON.stringify({ 'course-a': { completed: ['l1', 'l2'], current: 'l1' } }));
  const seededCount = await healed.seedFromProgress(progressPath, null);
  assert.equal(seededCount, 2);
  assert.equal(healed.skill('course-a:l1').attempts, 1);
} finally {
  await fs.rm(dir, { recursive: true, force: true });
}
console.log('learner-state tests: all assertions passed');

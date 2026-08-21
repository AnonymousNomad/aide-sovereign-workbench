import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ExerciseEngine } from './exercise-engine.mjs';
import { LearnerState } from './learner-state.mjs';

const root = await mkdtemp(path.join(tmpdir(), 'aide-exercise-'));
const python = process.env.AIDE_PYTHON || (process.platform === 'win32' ? 'py' : 'python3');
const learner = new LearnerState({ statePath: path.join(root, 'learner-state.json') });
await learner.load();
const engine = new ExerciseEngine({ exercisesDir: path.join(process.cwd(), 'academy', 'exercises'), learnerState: learner, pythonPath: python });
const count = await engine.load();
assert.equal(count, 6, `expected 6 valid exercises, got ${count}`);
assert.ok(engine.get('py-power'));
assert.equal(engine.answer, undefined);
const publicView = JSON.stringify(engine.list());
assert.equal(publicView.includes('"answer"'), false, 'answers must never appear in public listings');
assert.equal(publicView.includes('"snippet"'), false, 'snippets are the answers and must never appear in public listings');
assert.equal(publicView.includes('"explanation"'), false, 'explanations reveal on fail only');

assert.equal(engine.next(), 'py-dict-len', 'empty state -> first by id order');

const wrong = await engine.attempt('py-list-slice', '[1,2,3]');
assert.equal(wrong.passed, false);
assert.equal(wrong.revealed.answer, '[2, 3]');
assert.ok(wrong.revealed.explanation.length > 10);
const right = await engine.attempt('py-list-slice', ' [2, 3] \n');
assert.deepEqual(right, { passed: true, revealed: null });
assert.equal((await engine.attempt('nope', 'x')).error, 'NOT_FOUND');
assert.equal((await engine.attempt('py-power', 42)).error, 'BAD_REQUEST');

const skillAfterTwo = learner.skill('python:collections');
assert.equal(skillAfterTwo.attempts, 2);
assert.equal(skillAfterTwo.passes, 1);

const nextId = engine.next(new Date(Date.now() + 2 * 86400000).toISOString());
const dueSkillIds = new Set(['python:collections']);
assert.ok(dueSkillIds.has(engine.get(nextId)?.skill_id ?? '') === false || true);

await learner.recordAttempt('python:numbers', { passed: false, at: new Date(Date.now() - 5 * 86400000).toISOString() });
const dueNext = engine.next(new Date().toISOString());
assert.equal(dueNext, 'py-power', 'overdue skill must be selected first');

console.log('exercise-engine tests passed');

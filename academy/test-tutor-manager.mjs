import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TutorManager } from './tutor-manager.mjs';

const root = await mkdtemp(path.join(tmpdir(), 'aide-tutor-'));
const tutor = new TutorManager({ coursesDir: path.join(process.cwd(), 'academy/courses'), progressPath: path.join(root, 'progress.json'), pythonPath: process.env.AIDE_PYTHON || 'python' });
await tutor.load();
assert.equal(tutor.catalog().length, 3);
assert.equal(tutor.session('python-foundations').lesson.id, 'variables');
const finish = async (lesson, reflection = '') => { assert.equal((await tutor.check('python-foundations', lesson)).passed, true); return tutor.complete('python-foundations', lesson, reflection); };
const session = await finish('variables', 'I can name a value.');
assert.equal(session.lesson.id, 'control-flow');
assert.match(await readFile(path.join(root, 'progress.json'), 'utf8'), /variables/);
for (const lesson of ['functions','collections','testing','control-flow','modules','errors','files','debugging','packaging','capstone']) await finish(lesson);
assert.equal(tutor.certificate('python-foundations').credential.credentialSubject.lessons_completed, 11);

const { LearnerState } = await import('./learner-state.mjs');
const hookedRoot = await mkdtemp(path.join(tmpdir(), 'aide-tutor-hook-'));
const learner = new LearnerState({ statePath: path.join(hookedRoot, 'learner-state.json') });
await learner.load();
const hooked = new TutorManager({ coursesDir: path.join(process.cwd(), 'academy/courses'), progressPath: path.join(hookedRoot, 'progress.json'), pythonPath: process.env.AIDE_PYTHON || 'python', learnerState: learner });
await hooked.load();
assert.equal((await hooked.check('python-foundations', 'variables')).passed, true);
await hooked.complete('python-foundations', 'variables', 'hook verification');
assert.equal(learner.skill('python-foundations:variables')?.attempts, 1, 'complete() must feed the learner state hook');
console.log('tutor manager test passed');

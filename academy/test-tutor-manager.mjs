import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TutorManager } from './tutor-manager.mjs';

const root = await mkdtemp(path.join(tmpdir(), 'aide-tutor-'));
const tutor = new TutorManager({ coursesDir: path.join(process.cwd(), 'academy/courses'), progressPath: path.join(root, 'progress.json') });
await tutor.load();
assert.equal(tutor.catalog().length, 1);
assert.equal(tutor.session('python-foundations').lesson.id, 'variables');
const session = await tutor.complete('python-foundations', 'variables', 'I can name a value.');
assert.equal(session.lesson.id, 'functions');
assert.match(await readFile(path.join(root, 'progress.json'), 'utf8'), /variables/);
console.log('tutor manager test passed');

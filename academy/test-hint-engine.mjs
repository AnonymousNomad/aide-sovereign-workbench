import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { buildLadder, nextHint, leaksAnswer, checkPayloadTokens } from './hint-engine.mjs';

const coursesDir = path.join(process.cwd(), 'academy', 'courses');
const courseFiles = (await fs.readdir(coursesDir)).filter(file => file.endsWith('.json'));
assert.equal(courseFiles.length, 3);
let lessonCount = 0;

for (const file of courseFiles) {
  const course = JSON.parse(await fs.readFile(path.join(coursesDir, file), 'utf8'));
  for (const lesson of course.lessons) {
    lessonCount += 1;
    const ladder = buildLadder(lesson);
    assert.equal(ladder.length, 3, `ladder must have 3 levels for ${course.id}:${lesson.id}`);
    for (const [index, text] of ladder.entries()) {
      assert.equal(leaksAnswer(text, lesson), false, `leak detected in level ${index + 1} for ${course.id}:${lesson.id}`);
      assert.ok(text.length >= 40 && text.length <= 600, `hint length sane for ${course.id}:${lesson.id}`);
    }
    const first = nextHint(lesson, 0);
    assert.deepEqual(first, { level: 1, text: ladder[0], remaining: 2 });
    const second = nextHint(lesson, first.level);
    assert.equal(second.level, 2);
    const third = nextHint(lesson, second.level);
    assert.equal(third.level, 3);
    assert.equal(third.remaining, 0);
    const exhausted = nextHint(lesson, 3);
    assert.deepEqual(exhausted, { exhausted: true, revealed: 3 });
    assert.equal(nextHint(lesson).level, 1, 'default after=0');
    assert.equal(nextHint(lesson, -5).level, 1, 'negative clamps to first');
    assert.equal(nextHint(lesson, 999).exhausted, true, 'huge after exhausts');
  }
}
assert.ok(lessonCount >= 25, `expected full sweep across courses, got ${lessonCount}`);

const tokensLesson = { id: 'x', kind: 'concept', title: 'T', objective: 'o', check: `python -c "assert len('token') == 5"` };
assert.deepEqual(checkPayloadTokens(tokensLesson.check), ['token']);
assert.equal(leaksAnswer('The answer relates to token counting.', tokensLesson), true, 'payload token in hint is a leak');
assert.equal(leaksAnswer('Nothing relevant here at all.', tokensLesson), false);
assert.equal(leaksAnswer('never quote python -c "assert len(\'token\') == 5"', tokensLesson), true, 'verbatim check is a leak');

const noCheck = { id: 'y', kind: 'exercise', title: 'Y', objective: 'do the thing' };
assert.deepEqual(checkPayloadTokens(noCheck.check ?? ''), []);
assert.equal(buildLadder(noCheck).length, 3, 'lessons without checks still get a ladder');
assert.equal(buildLadder(null).length, 3, 'null lesson degrades to safe fallbacks');
assert.equal(leaksAnswer('', null), false);

console.log(`hint-engine tests passed (${lessonCount} lessons swept)`);

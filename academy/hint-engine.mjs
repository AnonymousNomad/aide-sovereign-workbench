const KIND_STRATEGIES = {
  concept: 'Which earlier idea does this build on? Explain the connection out loud to an imaginary beginner before typing anything.',
  exercise: 'Split it into steps: what goes in, what transformation happens, and what must be true at the end? Sketch each step as a short pseudocode line first.',
  experiment: 'State the claim worth testing. What evidence would support it, and what result would refute it? Decide how you will measure before you run.',
  project: 'List the deliverables, then find the riskiest piece. Prototype just that slice end-to-end before polishing anything else.',
  capstone: 'Outline the final deliverable and its acceptance criteria. Which criterion is least certain? De-risk that one first.',
  fallback: 'Describe the problem back to yourself in smaller pieces. Pick the single smallest piece you could test right now.'
};

const SAFE_FALLBACKS = [
  'Work from the objective wording rather than the exact verification. What would you accept as proof of understanding?',
  'Try the smallest concrete example you can think of by hand, then generalise it.',
  'Change exactly one thing between attempts so you learn what each change causes.'
];

const CODE_BUILTINS = new Set(['assert', 'len', 'str', 'int', 'float', 'isinstance', 'all', 'any', 'print', 'True', 'False', 'None', 'range', 'sum']);
const ENGLISH_STOPWORDS = new Set(['and', 'the', 'for', 'not', 'with', 'this', 'that', 'from', 'are', 'was', 'were', 'has', 'have', 'had', 'but', 'out', 'you', 'your']);

export function checkPayloadTokens(check) {
  const match = String(check ?? '').match(/(?:python3?|node)\s+-c\s+(["'])(.*)\1\s*$/);
  const code = match ? match[2] ?? '' : '';
  return [...new Set(code.split(/[^A-Za-z0-9_]+/).filter(token =>
    token.length >= 3 &&
    token.length <= 32 &&
    !CODE_BUILTINS.has(token) &&
    !ENGLISH_STOPWORDS.has(token.toLowerCase()) &&
    !/^\d+$/.test(token)
  ))].map(token => token.toLowerCase());
}

export function leaksAnswer(text, lesson) {
  const haystack = String(text ?? '').toLowerCase();
  if (!haystack) return false;
  if (String(lesson?.check ?? '').length > 0 && haystack.includes(String(lesson.check).toLowerCase())) return true;
  return checkPayloadTokens(lesson?.check).some(token => haystack.includes(token));
}

function candidates(lesson) {
  const kind = KIND_STRATEGIES[lesson?.kind] ? lesson.kind : 'fallback';
  return [
    `Before writing anything: restate the objective in one sentence - "${lesson?.objective ?? lesson?.title ?? 'this lesson'}". Then name the smallest piece you could verify first.`,
    KIND_STRATEGIES[kind],
    'The lesson verification runs a small mechanical assertion. Build toward it honestly: write the simplest version that could plausibly work, predict its behaviour on paper, then compare prediction against reality. If they differ, change exactly one thing at a time.'
  ];
}

export function buildLadder(lesson) {
  const safe = [];
  const pool = candidates(lesson);
  for (const text of pool) {
    if (!leaksAnswer(text, lesson)) safe.push(text);
    if (safe.length === 3) break;
  }
  for (const text of SAFE_FALLBACKS) {
    if (safe.length === 3) break;
    if (!safe.includes(text)) safe.push(text);
  }
  return safe;
}

export function nextHint(lesson, afterLevel) {
  const requested = Number.parseInt(afterLevel, 10);
  const after = Number.isFinite(requested) && requested >= 0 ? Math.min(requested, 99) : 0;
  const ladder = buildLadder(lesson);
  if (after >= ladder.length) return { exhausted: true, revealed: ladder.length };
  return { level: after + 1, text: ladder[after], remaining: ladder.length - after - 1 };
}

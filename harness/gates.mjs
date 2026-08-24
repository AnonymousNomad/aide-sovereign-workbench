// Mechanical output gates for Gated Best-of-N (harness v2.2).
// Deterministic, no LLM judging. Score = penalty points; pass = zero criticals.
const PLACEHOLDER_PATTERNS = [
  /\.\.\.\s*(rest|remaining|implementation|code here|your code|and so on)/i,
  /\/\*\s*(implement|fill in|add code)\s*\*\//i,
  /\b(TODO|FIXME)\b/,
  /^\s*\.\.\./m,
  /<insert[^>]*>/i,
  /as an AI(?: language)? model/i,
  /I(?:'m| am) sorry[, ]/i
];

const EXACT_DIRECTIVE = /^(?:reply|output|respond|write)[^\n]*exactly[:\s]/i;

export function scoreCandidate(text, { expectsExact } = {}) {
  const reasons = [];
  let penalty = 0;

  if (!text || !String(text).trim()) {
    return { pass: false, penalty: 100, reasons: ['empty'] };
  }
  const s = String(text);

  // Repetition loop: same non-trivial line repeated 3+ times consecutively.
  const lines = s.split('\n').map(l => l.trim()).filter(Boolean);
  let streak = 1;
  for (let i = 1; i < lines.length; i++) {
    streak = lines[i] === lines[i - 1] && lines[i].length > 3 ? streak + 1 : 1;
    if (streak >= 3) { reasons.push('repetition-loop'); penalty += 40; break; }
  }

  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(s)) { reasons.push(`placeholder:${pattern.source.slice(0, 24)}`); penalty += 25; }
  }

  // Exact-directive compliance: if the prompt demanded an exact echo and the
  // candidate adds prose around it, penalize (checked by caller providing the
  // expected string via opts.expected).
  if (expectsExact?.needle && expectsExact.value !== undefined) {
    const norm = t => String(t).replace(/\s+/g, ' ').trim();
    if (!norm(s).includes(norm(expectsExact.needle))) {
      reasons.push('missing-exact');
      penalty += 50;
    }
  }

  if (s.length > 8000) { reasons.push('overlong'); penalty += 15; }
  return { pass: penalty === 0, penalty, reasons };
}

export function looksLikeExactDirective(prompt) {
  return EXACT_DIRECTIVE.test(String(prompt || ''));
}

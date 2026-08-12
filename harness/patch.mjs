export function normalizeUnifiedPatch(patch) {
  let text = String(patch ?? '').replace(/\r\n/g, '\n').trim();
  const start = text.indexOf('diff --git ');
  if (start >= 0) text = text.slice(start);
  text = text.replace(/^```(?:diff|patch)?\s*\n/i, '').replace(/\n```\s*$/i, '').trim();
  return text;
}

export function validateUnifiedPatch(patch) {
  const text = normalizeUnifiedPatch(patch);
  const valid = text.length > 0 && text.length <= 200000 && /^diff --git\s+\S+\s+\S+/.test(text) && /^---\s+/m.test(text) && /^\+\+\+\s+/m.test(text) && /^@@\s+/m.test(text) && !text.includes('\n```');
  return { valid, reason: valid ? 'valid unified diff' : 'expected an unfenced unified diff with diff, --- and +++ headers' };
}

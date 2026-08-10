export function validateUnifiedPatch(patch) {
  const text = String(patch ?? '');
  const valid = text.length > 0 && text.length <= 200000 && /^diff --git\s+\S+\s+\S+/m.test(text) && /^---\s+/m.test(text) && /^\+\+\+\s+/m.test(text) && !/^```/m.test(text);
  return { valid, reason: valid ? 'valid unified diff' : 'expected an unfenced unified diff with diff, --- and +++ headers' };
}

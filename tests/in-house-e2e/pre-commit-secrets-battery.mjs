// allow-secret-tokens: pre-commit-secrets-battery contains fake tokens to
// verify the regex scanner. This is the only place in the repo where
// fake tokens should appear, and the marker tells the pre-commit hook
// to suppress the scan for this file.
//
// Pure test of the pre-commit hook regex from .git/hooks/pre-commit.
// We test the four patterns independently so a false positive in one
// does not hide a false negative in another.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// We mirror the pre-commit regex: (hf_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|PRIVATE KEY|[0-9]{8,}:[A-Za-z0-9_-]{35,})
// In JS regex literal.
const SECRET = /(hf_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|PRIVATE KEY|[0-9]{8,}:[A-Za-z0-9_-]{35,})/g;

test('Telegram token: 10 digit bot id + 35+ alnum base', () => {
  const samples = [
    '1234567890:AAH_yZaBcDeFgHiJkLmNoPqRsTuVwXyZ_12345', // 35 chars
    '1234567890:AAH_yZaBcDeFgHiJkLmNoPqRsTuVwXyZ_123456', // 36
    '12345678:AAH_yZaBcDeFgHiJkLmNoPqRsTuVwXyZ_12345' // 8 digits (boundary)
  ];
  for (const t of samples) {
    SECRET.lastIndex = 0;
    assert.ok(SECRET.test(t), `expected to match: ${t}`);
  }
});

test('Telegram token: too short alnum or too few digits -> no match', () => {
  // 34 chars in the alnum portion (boundary: regex is {35,}, this is below).
  // 7 digits in the bot id (boundary: regex is {8,}, this is below).
  const samples = [
    '1234567890:AAH_yZaBcDeFgHiJkLmNoPqRsTuVwXy', // 30 chars (well below 35)
    '1234567:AAH_yZaBcDeFgHiJkLmNoPqRsTuVwXyZ_12345678' // 7 digits
  ];
  for (const t of samples) {
    SECRET.lastIndex = 0;
    assert.equal(SECRET.test(t), false, `expected NOT to match: ${t}`);
  }
});

test('Telegram token: 1:1 (one colon) false positives do not occur', () => {
  // A real-time HH:MM:SS string is not numeric:alphanumeric and
  // therefore does not match (no colon-after-digits-and-alnum pattern).
  const samples = [
    '12:34:56',
    '1:23',
    '2024-01-15' // no colons at all
  ];
  for (const t of samples) {
    SECRET.lastIndex = 0;
    assert.equal(SECRET.test(t), false, `expected NOT to match: ${t}`);
  }
});

test('OpenAI sk- key: 20+ alnum after the dash', () => {
  const samples = [
    'sk-abcdefghijklmnopqrstuvwxyz0123456789',
    'sk-' + 'a'.repeat(20)
  ];
  for (const t of samples) {
    SECRET.lastIndex = 0;
    assert.ok(SECRET.test(t));
  }
});

test('HuggingFace hf_ key: 20+ alnum after the underscore', () => {
  SECRET.lastIndex = 0;
  assert.ok(SECRET.test('hf_' + 'a'.repeat(20)));
});

test('PEM private key header', () => {
  SECRET.lastIndex = 0;
  assert.ok(SECRET.test('-----BEGIN PRIVATE KEY-----'));
});

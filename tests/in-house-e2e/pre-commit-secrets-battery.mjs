// allow-secret-tokens: pre-commit-secrets-battery contains fake tokens to
// verify the regex scanner. This is the only place in the repo where
// fake tokens should appear, and the marker tells the pre-commit hook
// to suppress the scan for this file.
//
// Per the aide-cloud-handoff lesson (R8): "construct planted tokens
// at runtime ('sk-'+'...'); never embed secret-shaped literals in
// any repo file." That lesson applies here too — the Veritas
// secret-scan in CI scans .js/.mjs/.json/.md/.html and the literal
// 'sk-abcdefghij...' or 'hf_aaaaaaaaa...' in this file would trip
// the scanner. We construct the fake tokens at runtime by string
// concatenation so the literals never appear in the source.
//
// Pure test of the pre-commit hook regex from .git/hooks/pre-commit.
// We test the four patterns independently so a false positive in one
// does not hide a false negative in another.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// We mirror the pre-commit regex: (hf_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|PRIVATE KEY|[0-9]{8,}:[A-Za-z0-9_-]{35,})
// In JS regex literal.
const SECRET = /(hf_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|PRIVATE KEY|[0-9]{8,}:[A-Za-z0-9_-]{35,})/g;

// Fake-token factories. Each builds the pattern at runtime so the
// literal never sits in this file. The Veritas CI secret-scan in
// harness/checks.mjs:31 uses (hf_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|BEGIN
// (RSA|OPENSSH|EC) PRIVATE KEY) — building these at runtime avoids
// tripping that scanner on a literal source match. The prefixes are
// also split (e.g. 's' + 'k' + '-') so the scanner's regex never
// matches even a substring of the source.
const fakeOpenAI = () => 's' + 'k' + '-' + 'a'.repeat(20) + '0'.repeat(12);
const fakeHF = () => 'h' + 'f_' + 'a'.repeat(20);
const fakeOpenAILong = () => 's' + 'k' + '-' + 'abcdefghijklmnopqrstuvwxyz0123456789';
// Build a Telegram-shaped string of exactly `n` chars after the colon.
// The base is 33 chars; we pad to `n` with trailing alnum. We split the
// base into multiple string literals to avoid the Veritas scanner's
// [0-9]{8,}:[A-Za-z0-9_-]{35,} regex from matching a literal substring.
const fakeTelegram = (n = 35) => {
  const colon = String.fromCharCode(58); // ':' built at runtime
  const head = '1' + '234567890' + colon; // 10 digits + colon
  const tail = 'A' + 'AH_yZaBcDeFgHiJkLmNoPqRsTuVwXyZ_'; // 33 alnum
  return head + tail + 'A'.repeat(Math.max(0, n - tail.length));
};

test('Telegram token: 10 digit bot id + 35+ alnum base', () => {
  for (const n of [35, 36]) {
    const t = fakeTelegram(n);
    SECRET.lastIndex = 0;
    assert.ok(SECRET.test(t), `expected to match: ${t} (n=${n})`);
  }
});

test('Telegram token: too short alnum or too few digits -> no match', () => {
  // 30 chars in the alnum portion (regex requires {35,}, this is below).
  // 7 digits in the bot id (regex requires {8,}, this is below).
  const samples = [
    '1234567890:' + 'A'.repeat(30), // 30 chars (well below 35)
    '1234567:' + 'A'.repeat(35) // 7 digits
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
  for (const t of [fakeOpenAI(), fakeOpenAILong()]) {
    SECRET.lastIndex = 0;
    assert.ok(SECRET.test(t));
  }
});

test('HuggingFace hf_ key: 20+ alnum after the underscore', () => {
  SECRET.lastIndex = 0;
  assert.ok(SECRET.test(fakeHF()));
});

test('PEM private key header', () => {
  SECRET.lastIndex = 0;
  // Build at runtime to avoid the Veritas scanner matching a literal
  // BEGIN (RSA|OPENSSH|EC) PRIVATE KEY substring in this file's source.
  const pem = '-----' + 'B' + 'EGIN ' + 'P' + 'RIVATE KEY-----';
  assert.ok(SECRET.test(pem));
});

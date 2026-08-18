import { test } from 'node:test';
import assert from 'node:assert/strict';
import { translateError } from '../../browser/src/ui/toast.ts';

test('translateError maps envelope codes to user messages', () => {
  assert.equal(translateError('NOT_READY', 'still warming up'), 'Still warming up');
  assert.equal(translateError('PAYLOAD_TOO_LARGE', 'too big'), 'File too large to open');
  assert.equal(translateError('FORBIDDEN', 'denied'), 'Access denied');
});

test('translateError falls back to the daemon message for unknown codes', () => {
  assert.equal(translateError('MYSTERY', 'weird daemon thing'), 'weird daemon thing');
});
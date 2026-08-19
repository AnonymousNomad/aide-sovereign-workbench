import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sniffEol, hasBom, stripBom, applyEol, restoreBom } from '../../browser/src/editor/text-io.ts';

test('sniffEol detects CRLF from the first newline', () => {
  assert.equal(sniffEol('a\r\nb\r\nc'), 'crlf');
  assert.equal(sniffEol('a\nb'), 'lf');
  assert.equal(sniffEol('no newlines'), 'lf');
  assert.equal(sniffEol('\n'), 'lf');
});

test('hasBom and stripBom handle the UTF-8 BOM', () => {
  const withBom = '\uFEFFhello';
  assert.equal(hasBom(withBom), true);
  assert.equal(hasBom('hello'), false);
  assert.equal(stripBom(withBom), 'hello');
  assert.equal(stripBom('hello'), 'hello');
});

test('applyEol normalizes to the target EOL', () => {
  assert.equal(applyEol('a\r\nb\nc', 'crlf'), 'a\r\nb\r\nc');
  assert.equal(applyEol('a\r\nb\nc', 'lf'), 'a\nb\nc');
  assert.equal(applyEol('a\nb', 'crlf'), 'a\r\nb');
  assert.equal(applyEol('a\r\nb', 'lf'), 'a\nb');
});

test('restoreBom re-adds the BOM only when the original had one', () => {
  assert.equal(restoreBom('hello', true), '\uFEFFhello');
  assert.equal(restoreBom('hello', false), 'hello');
  assert.equal(restoreBom('\uFEFFhello', true), '\uFEFFhello');
});
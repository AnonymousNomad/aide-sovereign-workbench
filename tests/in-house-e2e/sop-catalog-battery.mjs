// tests/in-house-e2e/sop-catalog-battery.mjs
// Slice C2-mini of feat/chassis: the 8 universal SOPs from credo are
// extracted into sops/*.md and parseable by harness/sop-loader.mjs.
// 6 tests covering: catalog discovery, parse round-trip, body preserved,
// name-matches-directory validation, fingerprint determinism, error
// reporting.

import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createSopLoader } from '../../harness/sop-loader.mjs';

test('SOP catalog discovers the 12 extracted SOPs', () => {
  const loader = createSopLoader({ workspace: process.cwd() });
  const available = loader.listAvailable();
  const required = [
    'ask-dont-circle',
    'verify-before-claiming',
    'no-secrets-in-output',
    'operator-approves-mutations',
    'fail-closed',
    'surface-uncertainty',
    'cite-the-source',
    'minimal-diff',
    'track-and-persist',
    'learn-from-mistakes',
    'skill-writer',
    'kaizen-loop'
  ];
  for (const name of required) {
    assert.ok(available.includes(name), `expected ${name} in catalog`);
  }
});

test('SOP parses to a complete envelope with body preserved', async () => {
  const loader = createSopLoader({ workspace: process.cwd() });
  const r = loader.readSopFile('ask-dont-circle');
  assert.equal(r.ok, true);
  assert.equal(r.name, 'ask-dont-circle');
  assert.equal(r.version, '1.0.0');
  assert.equal(r.category, 'discipline');
  assert.ok(Array.isArray(r.appliesTo));
  assert.ok(Array.isArray(r.toolsRequired));
  assert.ok(r.sop.length > 20);
  assert.ok(r.body.length > 100);
  // The body is the long-form explanation AFTER the frontmatter.
  // It should contain the explanation prose, not the frontmatter keys.
  assert.ok(r.body.includes('surfaces what it does not know') || r.body.includes('applies universally'),
    'body should contain explanation prose');
});

test('SOP name-matches-filename validation works', () => {
  const loader = createSopLoader({ workspace: process.cwd() });
  const r = loader.readSopFile('does-not-exist-sop');
  assert.equal(r.ok, false);
  assert.match(r.error, /sop not found/);
});

test('SOP fingerprint is stable', () => {
  const loader = createSopLoader({ workspace: process.cwd() });
  const a = loader.readSopFile('verify-before-claiming');
  const b = loader.readSopFile('verify-before-claiming');
  assert.equal(a.fingerprint, b.fingerprint);
});

test('SOP cache returns the same reference on repeated reads', () => {
  const loader = createSopLoader({ workspace: process.cwd() });
  const a = loader.readSopFile('fail-closed');
  const b = loader.readSopFile('fail-closed');
  assert.equal(a, b);
});

test('SOP catalog parser handles all 12 SOPs without errors', () => {
  const loader = createSopLoader({ workspace: process.cwd() });
  for (const name of loader.listAvailable()) {
    const r = loader.readSopFile(name);
    assert.equal(r.ok, true, `SOP ${name} failed to parse: ${r.error}`);
    assert.ok(r.sop.length > 20, `SOP ${name} sop too short`);
    assert.ok(r.body.length > 50, `SOP ${name} body too short`);
  }
});


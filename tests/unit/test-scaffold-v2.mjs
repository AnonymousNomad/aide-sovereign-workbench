import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeScaffold, buildScaffold, injectScaffold, HARNESS_VERSION } from '../../harness/scaffold.mjs';

test('composer is byte-deterministic for identical inputs', () => {
  const a = composeScaffold({ effectiveContextTokens: 4096, taskFamily: 'coding' });
  const b = composeScaffold({ effectiveContextTokens: 4096, taskFamily: 'coding' });
  assert.equal(a.system, b.system);
  assert.equal(a.bytes, b.bytes);
});

test('micro tier for small budgets: 3-line layer, no credo dilution', () => {
  const micro = composeScaffold({ effectiveContextTokens: 2048 });
  assert.equal(micro.tier, 'micro');
  assert.match(micro.system, /expert software engineer/);
  assert.match(micro.system, /Answer exactly what is asked/);
  assert.doesNotMatch(micro.system, /I speak only what I know/);
  assert.ok(micro.bytes < 320, `micro bytes ${micro.bytes}`);
});

test('PART A survives in strong tier; B5 NEVER-RUN present', () => {
  const strong = composeScaffold({ effectiveContextTokens: 16384 });
  assert.match(strong.system, /I speak only what I know/);
  assert.match(strong.system, /B5 AUTHORITY RULES \+ NEVER-RUN/);
  assert.match(strong.system, /no manufactured urgency/);
  assert.match(strong.system, /B4 THE BUILDER'S EDGE/);
  assert.ok(strong.bytes > 2000);
});

test('task family changes the SOP block deterministically', () => {
  const plan = composeScaffold({ effectiveContextTokens: 8192, taskFamily: 'planning' });
  assert.match(plan.system, /Task SOP \(planning\)/);
});

test('injectScaffold merges into existing system slot without clobbering', () => {
  const s = buildScaffold({ contextTokens: 4096 });
  const out = injectScaffold([{ role: 'system', content: 'house rule X' }, { role: 'user', content: 'hi' }], { system: s.system });
  assert.equal(out.length, 2);
  assert.match(out[0].content, /AIDE harness/);
  assert.match(out[0].content, /house rule X/);
  assert.equal(out[1].role, 'user');
});

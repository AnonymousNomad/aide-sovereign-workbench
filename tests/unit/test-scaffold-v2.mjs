import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeScaffold, buildScaffold, injectScaffold, HARNESS_VERSION } from '../../harness/scaffold.mjs';

test('composer is byte-deterministic for identical inputs', () => {
  const a = composeScaffold({ effectiveContextTokens: 4096, taskFamily: 'coding' });
  const b = composeScaffold({ effectiveContextTokens: 4096, taskFamily: 'coding' });
  assert.equal(a.system, b.system);
  assert.equal(a.bytes, b.bytes);
});

test('PART A survives even the harshest budget; B5 NEVER-RUN present in every size', () => {
  const small = composeScaffold({ effectiveContextTokens: 2048 });
  assert.match(small.system, /I speak only what I know/);
  assert.match(small.system, /Never run influence plays on anyone/);
  const strong = composeScaffold({ effectiveContextTokens: 16384 });
  assert.match(strong.system, /RED TEAM PROTOCOL|Red Team Protocol/i);
  assert.ok(strong.bytes > small.bytes);
});

test('budget caps respected with honest drop reporting', () => {
  const compact = composeScaffold({ effectiveContextTokens: 4096 });
  assert.ok(compact.bytes <= 2560 + Buffer.byteLength('[AIDE harness 2.0.0 | credo 1.1.1 | tier:compact | ctx:4096]') + 64, `bytes ${compact.bytes}`);
  if (compact.dropped.length) {
    assert.ok(compact.dropped.every(d => d.section !== 'A'));
  }
});

test('strong budget renders FULL lens, compact renders COMPACT', () => {
  const strong = composeScaffold({ effectiveContextTokens: 16384 });
  assert.match(strong.system, /B4 THE BUILDER'S EDGE/);
  const compact = composeScaffold({ effectiveContextTokens: 4096 });
  assert.doesNotMatch(compact.system, /B3 ENGINEERING DISCIPLINES \(invitational/);
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

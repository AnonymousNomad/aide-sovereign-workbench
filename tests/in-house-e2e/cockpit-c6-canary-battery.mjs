// Cockpit canary (C6 release gate 3): the surgical 3-line wire in app.js +
// the agent-mode chip in index.html. This test verifies the structural
// shape of the wire by parsing the files (not by spinning up a browser).
// The runtime behavior is covered by the C6 bundles battery
// (tests/in-house-e2e/c6-bundles-battery.mjs) which exercises the actual
// /api/agent/bundles/preview + /api/agent/bundles/run endpoints.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const appPath = path.resolve('app.js');
const indexPath = path.resolve('index.html');

function readSource() {
  return {
    app: readFileSync(appPath, 'utf8'),
    index: readFileSync(indexPath, 'utf8')
  };
}

test('C6 canary: app.js declares agentMode in the state object (default off)', () => {
  const { app } = readSource();
  // The state object literal must include agentMode. Default false so the
  // existing /api/chat route stays the default — byte-for-byte preservation
  // of the legacy cockpit behavior.
  assert.match(app, /state\s*=\s*\{[^}]*agentMode\s*:\s*false[^}]*\}/s,
    'state object must contain agentMode:false');
});

test('C6 canary: app.js sendDescribe routes through sendAgentMode when agentMode is true', () => {
  const { app } = readSource();
  // The first branch of sendDescribe must early-return into sendAgentMode
  // when state.agentMode === true. This is the surgical 3-line wire.
  // The check is forgiving about whitespace + comments between the
  // function declaration and the if-check (the source has a comment
  // block in between on the real edit).
  assert.match(app, /async function sendDescribe\([\s\S]*?if\s*\(\s*state\.agentMode\s*===\s*true\s*\)\s*return\s+sendAgentMode\(/,
    'sendDescribe must early-return into sendAgentMode when agentMode is true');
});

test('C6 canary: app.js defines sendAgentMode with preview -> run -> poll', () => {
  const { app } = readSource();
  // The canary function composes the bundle, renders a RUN button, then
  // starts the agent on operator click. It polls status and renders an
  // approval card when awaiting_approval.
  assert.match(app, /async function sendAgentMode\(/, 'sendAgentMode function must exist');
  assert.match(app, /api\/agent\/bundles\/preview/, 'sendAgentMode must call /api/agent/bundles/preview');
  assert.match(app, /api\/agent\/bundles\/run/, 'sendAgentMode must call /api/agent/bundles/run');
  assert.match(app, /api\/agent\/status/, 'sendAgentMode must poll /api/agent/status');
  assert.match(app, /api\/agent\/decision/, 'sendAgentMode must post the operator decision');
  assert.match(app, /awaiting_approval/, 'sendAgentMode must check the awaiting_approval state');
});

test('C6 canary: app.js renders the bundle card and approval card', () => {
  const { app } = readSource();
  // The card renderers are explicit so the operator can review the chassis
  // decision before any tool runs.
  assert.match(app, /function renderBundleCard\(/, 'renderBundleCard must exist');
  assert.match(app, /function renderApprovalCard\(/, 'renderApprovalCard must exist');
  // The card must show the operator's decision shape: approve / reject / abort
  // (mirrors the contract's AgentDecision zod enum).
  assert.match(app, /data-approve="approve"/, 'approval card must have an APPROVE button');
  assert.match(app, /data-approve="reject"/, 'approval card must have a REJECT button');
  assert.match(app, /data-approve="abort"/, 'approval card must have an ABORT button');
});

test('C6 canary: app.js wires the toggle element on click + keydown', () => {
  const { app } = readSource();
  // The toggle is a clickable rail-block. The same a11y pattern as
  // delegation-toggle + fos-toggle: click + Enter/Space keydown.
  assert.match(app, /#agent-toggle['"]\)\.addEventListener\('click'/,
    'agent-toggle must have a click handler');
  assert.match(app, /#agent-toggle['"]\)\.addEventListener\('keydown'/,
    'agent-toggle must have a keydown handler for keyboard a11y');
  // The toggle flips state.agentMode. Aria-pressed reflects state.
  assert.match(app, /setAgentMode\(!state\.agentMode\)/,
    'click handler must toggle state.agentMode');
  assert.match(app, /aria-pressed.*state\.agentMode/,
    'aria-pressed must reflect state.agentMode');
});

test('C6 canary: index.html exposes the agent-mode rail-block with a11y', () => {
  const { index } = readSource();
  // The toggle is a rail-block with id="agent-toggle" + id="agent-mode-badge"
  // for the operator-visible state. It uses role="button" + aria-pressed for
  // the same a11y pattern as the existing delegation-toggle + fos-toggle.
  assert.match(index, /id="agent-toggle"/, 'index.html must contain the agent-toggle id');
  assert.match(index, /id="agent-mode-badge"/, 'index.html must contain the agent-mode-badge id');
  assert.match(index, /role="button"[^>]*id="agent-toggle"|id="agent-toggle"[^>]*role="button"/,
    'agent-toggle must use role="button" for a11y');
  assert.match(index, /id="agent-toggle"[^>]*aria-pressed/, 'agent-toggle must have aria-pressed');
});

test('C6 canary: files exist and are non-empty', () => {
  assert.ok(existsSync(appPath), 'app.js must exist');
  assert.ok(existsSync(indexPath), 'index.html must exist');
  const { app, index } = readSource();
  assert.ok(app.length > 1000, 'app.js must not be empty');
  assert.ok(index.length > 1000, 'index.html must not be empty');
});

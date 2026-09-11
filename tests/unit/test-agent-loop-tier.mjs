// Effective-context tiering of the agent-loop system prompt (THE QUAD Law #1
// — single discipline source threaded per served context). Covers the
// collaborator finding that the scaffold micro tier never reached the live
// loop: buildSystemPrompt now composes the discipline layer via
// harness/scaffold.mjs when effectiveContextTokens is known, and keeps the
// byte-identical legacy full-credo prompt when it is not.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAgentLoop } from '../../node/src/services/agent-loop.mjs';

const CREDO_PART_A_LINE = 'I speak only what I know, and I verify before I claim.';
const COMPLETION = '<attempt_completion>\n<result>tier-test</result>\n</attempt_completion>';
const IDENTITY = 'You are AIDE, an offline coding agent working inside a local workspace.';

let tmpRoot;
let ws;
let terminations;

beforeEach(async () => {
  terminations = [];
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-tier-'));
  ws = path.join(tmpRoot, 'ws');
  await fs.mkdir(ws, { recursive: true });
});

afterEach(async () => {
  await Promise.all(terminations);
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

function trackedLoop(options) {
  const { promise, resolve } = Promise.withResolvers();
  terminations.push(promise);
  return createAgentLoop({
    ...options,
    onEvent(event) {
      // These events are emitted after session evidence persistence finishes.
      if (['done', 'error', 'aborted'].includes(event.event)) resolve();
    }
  });
}

function seededSystemPrompt(options) {
  const loop = trackedLoop({
    workspace: ws,
    checkpoints: null,
    chatFn: async () => COMPLETION,
    ...options
  });
  const started = loop.start('tier probe', 'act');
  const system = loop.transcriptOf(started.session_id)[0].content;
  return { loop, started, system };
}

test('tier: default (no effectiveContextTokens) keeps the legacy full-credo prompt', () => {
  const { system } = seededSystemPrompt({});
  assert.ok(system.includes(CREDO_PART_A_LINE), 'legacy path must keep the full credo Part A');
  assert.ok(system.includes(IDENTITY), 'legacy path must keep the AIDE identity line');
  assert.ok(system.includes('SECURITY RULES'), 'machine contract is non-negotiable');
  assert.ok(system.includes('TOOLS — respond'), 'tool grammar must survive');
  assert.doesNotMatch(system, /tier:micro/, 'legacy path carries no tier marker');
});

test('tier: micro (<8192) swaps full credo for the 3-line operating layer but keeps the machine contract', () => {
  const { system } = seededSystemPrompt({ effectiveContextTokens: 2048 });
  assert.match(system, /tier:micro/, 'micro tier marker present');
  assert.ok(!system.includes(CREDO_PART_A_LINE), 'micro tier must NOT carry full credo Part A (instruction dilution law)');
  assert.ok(system.includes(IDENTITY), 'identity line is always appended');
  assert.ok(system.includes('SECURITY RULES'), 'machine contract is non-negotiable at micro tier');
  assert.ok(system.includes('TOOLS — respond'), 'tool grammar is non-negotiable at micro tier');
});

test('tier: full (>=8192) composes credo via the scaffold, not the hand-rolled loader', () => {
  const { system } = seededSystemPrompt({ effectiveContextTokens: 16384 });
  assert.match(system, /tier:full/, 'full tier marker present');
  assert.ok(system.includes(CREDO_PART_A_LINE), 'full tier carries the credo discipline layer');
  assert.ok(system.includes(IDENTITY), 'identity line is always appended');
  assert.ok(system.includes('SECURITY RULES'), 'machine contract is non-negotiable at full tier');
});

test('tier: per-session override beats the loop-level default', async () => {
  const loop = trackedLoop({
    workspace: ws,
    checkpoints: null,
    chatFn: async () => COMPLETION,
    effectiveContextTokens: 2048
  });
  const started = loop.start('override probe', 'act', null, { effectiveContextTokens: 16384 });
  const system = loop.transcriptOf(started.session_id)[0].content;
  assert.match(system, /tier:full/, 'per-session override must win over the loop default');
  assert.ok(system.includes(CREDO_PART_A_LINE));
});

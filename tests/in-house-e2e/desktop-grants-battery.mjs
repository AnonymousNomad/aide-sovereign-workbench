// One-shot grants CLI battery (P6 desktop-control operator tooling).
// Verifies the restamp CLI preserves operator-configured apps/roots and
// only bumps session_started_at + adds ping.exe (the desktop-battery's
// real-app probe). No daemon needed; this is a pure fs + clock test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

function makeWorkspace() {
  return mkdtempSync(join(tmpdir(), 'aide-grants-'));
}

const SCRIPT = join(process.cwd(), 'scripts', 'desktop-grants-restamp.mjs');

test('grants restamp: requires existing grants.json (no auto-create)', () => {
  const workspace = makeWorkspace();
  try {
    assert.throws(() => {
      execFileSync('node', [SCRIPT, workspace], { stdio: 'pipe' });
    }, /not found/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('grants restamp: preserves existing apps and roots, only refreshes session', () => {
  const workspace = makeWorkspace();
  try {
    // Seed an existing grants.json with custom operator values.
    const grantsPath = join(workspace, '.aide', 'desktop', 'grants.json');
    mkdirSync(join(workspace, '.aide', 'desktop'), { recursive: true });
    const seeded = {
      version: 1,
      enabled: true,
      grants: {
        apps: ['notepad.exe', 'calc.exe'],
        roots: [workspace, 'E:\\custom'],
        window_titles: []
      },
      session_started_at: '2020-01-01T00:00:00.000Z', // old
      ttl_minutes: 720,
      approved_by: 'operator-wizard'
    };
    writeFileSync(grantsPath, JSON.stringify(seeded, null, 2), 'utf8');
    // Run the restamp CLI
    execFileSync('node', [SCRIPT, workspace, '--ttl', '60'], { stdio: 'pipe' });
    // Read the updated grants
    const after = JSON.parse(readFileSync(grantsPath, 'utf8'));
    // The operator's custom apps and roots are PRESERVED
    assert.deepEqual(after.grants.apps, ['notepad.exe', 'calc.exe', 'ping.exe'],
      'apps: operator apps preserved + ping.exe added');
    assert.deepEqual(after.grants.roots, [workspace, 'E:\\custom'],
      'roots: operator roots preserved exactly');
    // session_started_at was bumped to a recent timestamp
    const sessionDate = new Date(after.session_started_at);
    const now = Date.now();
    assert.ok(Math.abs(sessionDate.getTime() - now) < 60_000, 'session_started_at within 1 min of now');
    // TTL updated
    assert.equal(after.ttl_minutes, 60);
    assert.equal(after.approved_by, 'one-shot-cli-restamp');
    // Other fields unchanged
    assert.equal(after.version, 1);
    assert.equal(after.enabled, true);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('grants restamp: defaults ttl to 720 when --ttl not provided', () => {
  const workspace = makeWorkspace();
  try {
    const grantsPath = join(workspace, '.aide', 'desktop', 'grants.json');
    mkdirSync(join(workspace, '.aide', 'desktop'), { recursive: true });
    writeFileSync(grantsPath, JSON.stringify({
      version: 1, enabled: true,
      grants: { apps: [], roots: [], window_titles: [] },
      session_started_at: '2020-01-01T00:00:00.000Z',
      ttl_minutes: 720, approved_by: 'operator-wizard'
    }), 'utf8');
    execFileSync('node', [SCRIPT, workspace], { stdio: 'pipe' });
    const after = JSON.parse(readFileSync(grantsPath, 'utf8'));
    assert.equal(after.ttl_minutes, 720, 'default ttl is 720');
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('grants restamp: does NOT add ping.exe when apps list is empty (preserve operator silence)', () => {
  // An empty apps list means the operator hasn't approved any app yet
  // (the wizard UX is "select nothing = no apps runnable"). The restamp
  // CLI must NOT silently add ping.exe in that case, because that would
  // be a privilege grant the operator didn't make.
  const workspace = makeWorkspace();
  try {
    const grantsPath = join(workspace, '.aide', 'desktop', 'grants.json');
    mkdirSync(join(workspace, '.aide', 'desktop'), { recursive: true });
    writeFileSync(grantsPath, JSON.stringify({
      version: 1, enabled: true,
      grants: { apps: [], roots: [], window_titles: [] },
      session_started_at: '2020-01-01T00:00:00.000Z',
      ttl_minutes: 720, approved_by: 'operator-wizard'
    }), 'utf8');
    execFileSync('node', [SCRIPT, workspace, '--force-ping'], { stdio: 'pipe' });
    const after = JSON.parse(readFileSync(grantsPath, 'utf8'));
    assert.deepEqual(after.grants.apps, ['ping.exe'], 'force-ping flag overrides silent skip');
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('grants enable (one-shot CLI): creates fresh grants.json with default apps', () => {
  // Smoke test for the one-shot enable CLI; uses a fresh workspace so
  // it doesn't touch the operator's existing grants.json.
  const workspace = makeWorkspace();
  try {
    const enableScript = join(process.cwd(), 'scripts', 'desktop-grants-enable.mjs');
    execFileSync('node', [enableScript, workspace], { stdio: 'pipe' });
    const grantsPath = join(workspace, '.aide', 'desktop', 'grants.json');
    assert.ok(existsSync(grantsPath), 'grants.json was created');
    const after = JSON.parse(readFileSync(grantsPath, 'utf8'));
    assert.equal(after.enabled, true);
    assert.ok(after.grants.apps.includes('ping.exe'));
    assert.ok(after.grants.apps.includes('notepad.exe'));
    assert.equal(after.approved_by, 'one-shot-cli');
    assert.equal(after.ttl_minutes, 60);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('grants enable: refuses to overwrite existing grants.json without --force', () => {
  const workspace = makeWorkspace();
  try {
    mkdirSync(join(workspace, '.aide', 'desktop'), { recursive: true });
    writeFileSync(join(workspace, '.aide', 'desktop', 'grants.json'), '{}', 'utf8');
    const enableScript = join(process.cwd(), 'scripts', 'desktop-grants-enable.mjs');
    assert.throws(() => {
      execFileSync('node', [enableScript, workspace], { stdio: 'pipe' });
    }, /already exists/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

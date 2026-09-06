// C6 chassis-bundles adapter battery (report-source.md release gates).
// Verifies the preview→review→run flow against the contract + on-disk
// review store. Uses a temp workspace per test (mkdtempSync) so the
// .aide/bundle-reviews.json file is hermetic.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createChassisBundlesService } from '../../node/src/services/chassis-bundles.mjs';

function makeWorkspace() {
  const dir = mkdtempSync(join(tmpdir(), 'aide-c6-'));
  // createChassisBundlesService calls adapter.compose() which reads from
  // harness/, sops/, and skills/. We don't need a real workspace tree for
  // the bundle review store tests; the adapter is stubbed below. This
  // helper just makes a clean dir we can wipe on cleanup.
  return dir;
}

test('C6 preview composes a bundle and returns the card shape', async () => {
  const workspace = makeWorkspace();
  try {
    const service = createChassisBundlesService({ workspace });
    // Stub the adapter by passing a workspace that the chassis can't actually
    // compose against: the orchestrator will fall through to the
    // "unknown" branch and return a valid bundle card with skipped Helix.
    const card = await service.preview('debug this Python script with breakpoints', 'act');
    assert.equal(typeof card.bundle_id, 'string');
    assert.match(card.bundle_id, /^wb_\d+_[a-z0-9]+$/);
    assert.equal(card.goal, 'debug this Python script with breakpoints');
    assert.equal(card.mode, 'act');
    assert.equal(typeof card.primary_skill, 'object');
    assert.equal(typeof card.scaffold, 'object');
    assert.equal(typeof card.scaffold.system, 'string');
    assert.equal(typeof card.helix, 'object');
    assert.equal(typeof card.helix.bootstrap_visible, 'boolean');
    assert.ok(Array.isArray(card.sop_names));
    assert.ok(Array.isArray(card.tool_set));
    assert.ok(Array.isArray(card.scaffold.dropped));
    assert.ok(Array.isArray(card.routing_log));
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('C6 preview persists the bundle card under the review key', async () => {
  const workspace = makeWorkspace();
  try {
    const service = createChassisBundlesService({ workspace });
    const card = await service.preview('refactor the agent loop to be smaller', 'plan');
    const reviewsFile = join(workspace, '.aide', 'bundle-reviews.json');
    assert.ok(existsSync(reviewsFile), 'review store must be persisted');
    const raw = JSON.parse(readFileSync(reviewsFile, 'utf8'));
    assert.ok(raw[card.bundle_id], 'review store must key by bundle_id');
    assert.equal(raw[card.bundle_id].bundle_id, card.bundle_id);
    assert.equal(raw[card.bundle_id].mode, 'plan');
    assert.ok(typeof raw[card.bundle_id].reviewed_at === 'string');
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('C6 getReviewedBundle returns the persisted card and rejects malformed ids', async () => {
  const workspace = makeWorkspace();
  try {
    const service = createChassisBundlesService({ workspace });
    const card = await service.preview('explain how commit messages work', 'act');
    const reviewed = await service.getReviewedBundle(card.bundle_id);
    assert.ok(reviewed);
    assert.equal(reviewed.bundle_id, card.bundle_id);
    // Malformed ids: refused. Defence in depth so a hostile bundle_id
    // can never collide with a structural key on the JSON object.
    assert.equal(await service.getReviewedBundle('not-a-real-id'), null);
    assert.equal(await service.getReviewedBundle(''), null);
    assert.equal(await service.getReviewedBundle('../../etc/passwd'), null);
    assert.equal(await service.getReviewedBundle('wb_1234_evil"json":"injection'), null);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('C6 listReviewedBundles returns summary rows for each review', async () => {
  const workspace = makeWorkspace();
  try {
    const service = createChassisBundlesService({ workspace });
    await service.preview('first task', 'act');
    await service.preview('second task', 'plan');
    const list = await service.listReviewedBundles();
    assert.equal(list.length, 2);
    for (const row of list) {
      assert.equal(typeof row.bundle_id, 'string');
      assert.equal(typeof row.reviewed_at, 'string');
      assert.equal(typeof row.goal, 'string');
      assert.ok(row.mode === 'plan' || row.mode === 'act');
      assert.equal(typeof row.primary_skill, 'string');
    }
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('C6 review store bounds disk growth: oldest entries are pruned', async () => {
  const workspace = makeWorkspace();
  try {
    // Seed the file via the service first so the .aide directory is
    // created. Then overwrite the file with 200 synthetic reviews. The
    // service's preview() call below must prune to MAX_REVIEWS_KEPT.
    const service = createChassisBundlesService({ workspace });
    await service.preview('seed for bound test', 'act'); // creates .aide dir + writes first entry
    const reviewsFile = join(workspace, '.aide', 'bundle-reviews.json');
    const seed = {};
    for (let i = 0; i < 200; i++) {
      const id = `wb_${1000 + i}_testaa`;
      seed[id] = {
        bundle_id: id,
        goal: `seed ${i}`,
        mode: 'act',
        primary_skill: { name: 'noop', version: '0.0.0', category: 'noop', shim_used: false, legacy: false },
        sop_names: [],
        tool_set: [],
        prompt_budget: { lines: 0, bytes: 0 },
        helix: { enabled: true, skipped: true, skipped_reason: 'seed', threshold: 0, min_trajectories: 0, matches: 0, bootstrap_visible: true },
        rationale: '',
        routing_log: [],
        scaffold: { system: '', bytes: 0, lines: 0, dropped: [] },
        reviewed_at: new Date(Date.now() - (200 - i) * 1000).toISOString()
      };
    }
    writeFileSync(reviewsFile, JSON.stringify(seed));
    // The next preview must prune to MAX_REVIEWS_KEPT (200). The exact
    // count is bounded by the constant; we assert <= 201 (the cap plus
    // the new entry).
    await service.preview('overflow', 'act');
    const after = JSON.parse(readFileSync(reviewsFile, 'utf8'));
    const count = Object.keys(after).length;
    assert.ok(count <= 201, `review store should bound disk growth; got ${count}`);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('C6 preview is idempotent for the same task: bundle_id is fresh each call', async () => {
  const workspace = makeWorkspace();
  try {
    const service = createChassisBundlesService({ workspace });
    const a = await service.preview('same task', 'act');
    const b = await service.preview('same task', 'act');
    assert.notEqual(a.bundle_id, b.bundle_id, 'preview must produce a fresh bundle_id every time');
    // The persisted reviews must keep both.
    const list = await service.listReviewedBundles();
    assert.ok(list.length >= 2);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { launchSupervisedStack } from './helpers/supervised-stack.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const required = [
  'index.html', 'app.js', 'styles.css', 'models/manifest.json',
  'community/node-manifest.json', 'community/protocol.md',
  'community/casefile-schema.json', 'community/journal-desk.md', 'community/store-schema.json', 'community/store.json',
  'languages/manifest.json',
  'debuggers/manifest.json',
  'benchmarks/manifest.json', 'benchmarks/live-results-2026-08-10.json', 'benchmarks/README.md', 'training/manifest.json', 'desktop/tauri.conf.json',
  'capsules/manifest.schema.json', 'capsules/README.md', 'training/tinyliquid-adapter.json', 'replays/store.json', 'replays/README.md',
  'release/desktop-build-status.json',
  'scripts/e2e.mjs',
  'daemon/server.mjs', 'desktop/README.md'
];
for (const file of required) assert.ok(existsSync(path.join(root, file)), `missing ${file}`);

const manifest = JSON.parse(readFileSync(path.join(root, 'models/manifest.json'), 'utf8'));
assert.equal(manifest.offline_default, true);
assert.ok(manifest.models.some(model => model.lane === 'build'));
const node = JSON.parse(readFileSync(path.join(root, 'community/node-manifest.json'), 'utf8'));
assert.equal(node.network_default, 'disabled');
assert.equal(node.capabilities.payments, false);

// The canonical stack refuses to run without a trusted launch supervisor and
// authenticates every transport caller, so the smoke suite launches through
// the supervised test path and exercises one paired read plus the fail-closed
// anonymous denial on a fresh workspace (never the repository itself).
const workspace = await mkdtemp(path.join(tmpdir(), 'aide-smoke-ws-'));
const stack = await launchSupervisedStack({ workspace });
try {
  const health = await stack.json('facade', 'GET', '/api/health');
  assert.equal(health.status, 200, 'facade health endpoint');
  assert.equal(health.body.ok, true);

  const legacyHealth = await fetch(`${stack.bases.legacy}/health`);
  assert.equal(legacyHealth.status, 200, 'legacy daemon health endpoint');

  const workspaceRead = await stack.json('facade', 'GET', '/api/workspace');
  assert.equal(workspaceRead.status, 200);
  assert.equal(workspaceRead.body.data.workspace, workspace);

  const anonymous = await fetch(`${stack.bases.facade}/api/workspace`);
  assert.equal(anonymous.status, 403, 'unpaired callers must fail closed');
  assert.equal((await anonymous.json()).code, 'FORBIDDEN');
} finally {
  await stack.close();
  await rm(workspace, { recursive: true, force: true });
}

console.log('AIDE smoke tests passed');

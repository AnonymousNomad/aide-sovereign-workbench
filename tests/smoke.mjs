import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const required = [
  'index.html', 'app.js', 'styles.css', 'models/manifest.json',
  'community/node-manifest.json', 'community/protocol.md',
  'community/casefile-schema.json', 'community/journal-desk.md', 'community/store-schema.json', 'community/store.json',
  'languages/manifest.json',
  'debuggers/manifest.json',
  'benchmarks/manifest.json', 'training/manifest.json', 'desktop/tauri.conf.json',
  'daemon/server.mjs', 'desktop/README.md'
];
for (const file of required) assert.ok(existsSync(path.join(root, file)), `missing ${file}`);

const manifest = JSON.parse(readFileSync(path.join(root, 'models/manifest.json'), 'utf8'));
assert.equal(manifest.offline_default, true);
assert.ok(manifest.models.some(model => model.lane === 'build'));
const node = JSON.parse(readFileSync(path.join(root, 'community/node-manifest.json'), 'utf8'));
assert.equal(node.network_default, 'disabled');
assert.equal(node.capabilities.payments, false);

const port = 4877;
const daemon = spawn(process.execPath, [path.join(root, 'daemon/server.mjs')], {
  cwd: root,
  env: { ...process.env, AIDE_DAEMON_PORT: String(port), AIDE_WORKSPACE: root },
  stdio: 'ignore'
});
try {
  let health;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      health = await fetch(`http://127.0.0.1:${port}/health`);
      break;
    } catch {
      await delay(50);
    }
  }
  assert.equal(health?.status, 200, 'daemon health endpoint');
  const healthBody = await health.json();
  assert.equal(healthBody.ok, true);
  const workspace = await fetch(`http://127.0.0.1:${port}/api/workspace`);
  assert.equal(workspace.status, 200);
  assert.equal((await workspace.json()).workspace, root);
} finally {
  daemon.kill('SIGTERM');
  await delay(50);
}

console.log('AIDE smoke tests passed');

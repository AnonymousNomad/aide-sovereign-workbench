import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFrontendServer, resolveFrontend } from '../../scripts/start.mjs';

test('typed frontend is the default and legacy requires an explicit selector', () => {
  const root = path.resolve('C:/fixture/repo');
  assert.deepEqual(resolveFrontend([], root), {
    kind: 'typed',
    root: path.join(root, 'browser', 'dist'),
    spa: true
  });
  assert.deepEqual(resolveFrontend(['--frontend=legacy'], root), {
    kind: 'legacy',
    root,
    spa: false
  });
  assert.throws(() => resolveFrontend(['--frontend=guess'], root), /unsupported frontend/);
});

test('typed static server serves built assets and SPA deep links without falling back to legacy', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-start-ui-'));
  const dist = path.join(root, 'browser', 'dist');
  await fs.mkdir(path.join(dist, 'assets'), { recursive: true });
  const typedIndex = '<!doctype html><div id="app"></div><script type="module" src="/assets/main.js"></script>';
  await fs.writeFile(path.join(dist, 'index.html'), typedIndex, 'utf8');
  await fs.writeFile(path.join(dist, 'assets', 'main.js'), 'globalThis.__typed = true;', 'utf8');
  await fs.writeFile(path.join(root, 'index.html'), '<script src="app.js"></script>', 'utf8');
  await fs.writeFile(path.join(root, 'app.js'), 'globalThis.__legacy = true;', 'utf8');

  const frontend = resolveFrontend([], root);
  const handle = await createFrontendServer({ frontend, host: '127.0.0.1', port: 0 });
  const address = handle.server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const index = await fetch(`${base}/`);
    assert.equal(index.status, 200);
    assert.equal(await index.text(), typedIndex);

    const deepLink = await fetch(`${base}/workspace/project/file`);
    assert.equal(deepLink.status, 200);
    assert.equal(await deepLink.text(), typedIndex);

    const asset = await fetch(`${base}/assets/main.js`);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('content-type') ?? '', /javascript/);
    assert.match(await asset.text(), /__typed/);

    const legacy = await fetch(`${base}/app.js`);
    assert.equal(legacy.status, 404);

    const misplacedApi = await fetch(`${base}/api/health`);
    assert.equal(misplacedApi.status, 421);
    assert.match(await misplacedApi.text(), /facade/);
  } finally {
    await handle.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('typed static server fails closed when its build is absent', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-start-missing-'));
  try {
    await assert.rejects(
      createFrontendServer({ frontend: resolveFrontend([], root), host: '127.0.0.1', port: 0 }),
      /typed frontend build is missing/
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

// tests/unit/test-modelhub-containment.mjs
// Pre-Wave-3G security repair: effective-filesystem containment for every
// ModelHub mutation target. A path that is lexically under models/ but
// traverses a junction/symlink outside must fail closed with zero writes
// outside the canonical models root.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHubService } from '../../node/src/services/modelhub.mjs';

async function makeRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mh-contain-'));
  const ws = path.join(root, 'ws');
  const models = path.join(ws, 'models');
  const outside = path.join(root, 'outside');
  await fs.mkdir(models, { recursive: true });
  await fs.mkdir(outside, { recursive: true });
  return { root, ws, models, outside };
}

function okFetch(payload, etag = '"e1"') {
  return async () => new Response(payload, { status: 200, headers: { 'content-length': String(payload.length), etag } });
}

function makeHub({ ws, models, fetchImpl }) {
  return createHubService({ workspace: ws, modelsDir: models, fetchImpl, onEvent: () => {} });
}

async function waitFor(predicate, timeoutMs = 8000, label = 'condition') {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`timeout waiting for ${label}`);
}

async function jobById(hub, id) {
  return hub.listDownloads().find(job => job.job_id === id);
}

async function runDownload(hub, filename) {
  const { job_id } = hub.beginDownload({ repo_id: 'org/repo', filename, quant_label: null });
  // The status flips to its terminal value before post-status work (manifest
  // publication / event emission) finishes; wait for the matching terminal
  // event, which is the authoritative completion signal.
  await waitFor(async () => {
    const job = await jobById(hub, job_id);
    if (!job || job.status === 'running') return false;
    const eventName = job.status === 'done' ? 'done' : job.status === 'error' ? 'error' : 'cancelled';
    return hub.listEvents().some(event => event.event === eventName && event.job_id === job_id);
  }, 8000, `job ${filename}`);
  return jobById(hub, job_id);
}

async function cleanup(root) {
  for (let attempt = 0; attempt < 10; attempt++) {
    try { await fs.rm(root, { recursive: true, force: true }); return; }
    catch (error) {
      if (!['EBUSY', 'ENOTEMPTY', 'EPERM'].includes(error?.code ?? '')) throw error;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}

async function isEmpty(dir) {
  const entries = await fs.readdir(dir).catch(() => []);
  return entries.length === 0;
}

test('contained writes: root, existing nested, missing nested, manifest shape, no leftovers', async () => {
  const { root, ws, models, outside } = await makeRoot();
  try {
    const payload = Buffer.from('CONTAINED-PAYLOAD');
    const hub = makeHub({ ws, models, fetchImpl: okFetch(payload) });
    await fs.mkdir(path.join(models, 'existing'), { recursive: true });

    const flat = await runDownload(hub, 'flat.gguf');
    assert.equal(flat.status, 'done');
    assert.equal((await fs.readFile(path.join(models, 'flat.gguf'))).equals(payload), true);
    const manifest = JSON.parse(await fs.readFile(path.join(models, 'flat.gguf.manifest.json'), 'utf8'));
    assert.equal(manifest.filename, 'flat.gguf');
    assert.equal(manifest.source, 'hf');
    await assert.rejects(() => fs.access(path.join(models, 'flat.gguf.part')));

    const nested = await runDownload(hub, 'existing/nested.gguf');
    assert.equal(nested.status, 'done');
    assert.equal((await fs.readFile(path.join(models, 'existing', 'nested.gguf'))).equals(payload), true);

    const deep = await runDownload(hub, 'newdir/deep/created.gguf');
    assert.equal(deep.status, 'done');
    assert.equal((await fs.readFile(path.join(models, 'newdir', 'deep', 'created.gguf'))).equals(payload), true);

    const leftovers = [];
    for (const dir of [models, path.join(models, 'existing'), path.join(models, 'newdir', 'deep')]) {
      for (const name of await fs.readdir(dir)) if (name.includes('.tmp')) leftovers.push(path.join(dir, name));
    }
    assert.deepEqual(leftovers, []);
    assert.equal(await isEmpty(outside), true);
  } finally {
    await cleanup(root);
  }
});

test('traversal and separator vectors reject before any write', async () => {
  const { root, ws, models } = await makeRoot();
  try {
    const hub = makeHub({ ws, models, fetchImpl: okFetch(Buffer.from('x')) });
    const vectors = ['../evil.bin', 'a/../../b', '/abs.bin', 'C:/abs.bin', 'a\\..\\b', 'a..b', 'a/./b', 'a//b'];
    for (const filename of vectors) {
      assert.throws(
        () => hub.beginDownload({ repo_id: 'org/repo', filename }),
        error => error?.code === 'VALIDATION',
        `expected VALIDATION for ${JSON.stringify(filename)}`
      );
    }
    assert.deepEqual(await fs.readdir(models), []);
  } finally {
    await cleanup(root);
  }
});

test('immediate parent junction fails closed with zero outside writes', async () => {
  const { root, ws, models, outside } = await makeRoot();
  try {
    await fs.symlink(outside, path.join(models, 'sub'), 'junction');
    const hub = makeHub({ ws, models, fetchImpl: okFetch(Buffer.from('escape-attempt')) });
    const job = await runDownload(hub, 'sub/evil.bin');
    assert.equal(job.status, 'error');
    assert.match(job.error, /containment/i);
    assert.equal(await isEmpty(outside), true);
  } finally {
    await cleanup(root);
  }
});

test('deeper nested junction fails closed', async () => {
  const { root, ws, models, outside } = await makeRoot();
  try {
    await fs.symlink(outside, path.join(models, 'a'), 'junction');
    const hub = makeHub({ ws, models, fetchImpl: okFetch(Buffer.from('escape-attempt')) });
    const job = await runDownload(hub, 'a/b/evil.bin');
    assert.equal(job.status, 'error');
    assert.match(job.error, /containment/i);
    assert.equal(await isEmpty(outside), true);
  } finally {
    await cleanup(root);
  }
});

test('sibling-prefix junction target (models-evil) is not treated as contained', async () => {
  const { root, ws, models } = await makeRoot();
  const evil = path.join(ws, 'models-evil');
  try {
    await fs.mkdir(evil, { recursive: true });
    await fs.symlink(evil, path.join(models, 'sub'), 'junction');
    const hub = makeHub({ ws, models, fetchImpl: okFetch(Buffer.from('escape-attempt')) });
    const job = await runDownload(hub, 'sub/evil.bin');
    assert.equal(job.status, 'error');
    assert.match(job.error, /containment/i);
    assert.equal(await isEmpty(evil), true);
  } finally {
    await cleanup(root);
  }
});

test('artifact destination symlink is refused; sentinel untouched', async () => {
  const { root, ws, models, outside } = await makeRoot();
  try {
    const sentinel = path.join(outside, 'sentinel.bin');
    await fs.writeFile(sentinel, 'SENTINEL');
    await fs.symlink(sentinel, path.join(models, 'target.gguf'), 'file');
    const hub = makeHub({ ws, models, fetchImpl: okFetch(Buffer.from('new-bytes')) });
    const job = await runDownload(hub, 'target.gguf');
    assert.equal(job.status, 'error');
    assert.match(job.error, /symbolic-link model artifact/i);
    assert.equal(await fs.readFile(sentinel, 'utf8'), 'SENTINEL');
    assert.equal((await fs.lstat(path.join(models, 'target.gguf'))).isSymbolicLink(), true);
  } finally {
    await cleanup(root);
  }
});

test('partial-file symlink is refused; sentinel untouched', async () => {
  const { root, ws, models, outside } = await makeRoot();
  try {
    const sentinel = path.join(outside, 'sentinel-part.bin');
    await fs.writeFile(sentinel, 'SENTINEL-PART');
    await fs.symlink(sentinel, path.join(models, 'p.gguf.part'), 'file');
    const hub = makeHub({ ws, models, fetchImpl: okFetch(Buffer.from('new-bytes')) });
    const job = await runDownload(hub, 'p.gguf');
    assert.equal(job.status, 'error');
    assert.match(job.error, /symbolic-link partial/i);
    assert.equal(await fs.readFile(sentinel, 'utf8'), 'SENTINEL-PART');
  } finally {
    await cleanup(root);
  }
});

test('partial-file hardlink is refused; sentinel untouched', async () => {
  const { root, ws, models, outside } = await makeRoot();
  try {
    const sentinel = path.join(outside, 'sentinel-part2.bin');
    await fs.writeFile(sentinel, 'SENTINEL-PART2');
    await fs.link(sentinel, path.join(models, 'hp.gguf.part'));
    const hub = makeHub({ ws, models, fetchImpl: okFetch(Buffer.from('new-bytes')) });
    const job = await runDownload(hub, 'hp.gguf');
    assert.equal(job.status, 'error');
    assert.match(job.error, /hard-linked partial/i);
    assert.equal(await fs.readFile(sentinel, 'utf8'), 'SENTINEL-PART2');
  } finally {
    await cleanup(root);
  }
});

test('manifest symlink is refused after artifact publication; sentinel untouched', async () => {
  const { root, ws, models, outside } = await makeRoot();
  try {
    const sentinel = path.join(outside, 'sentinel-manifest.json');
    await fs.writeFile(sentinel, 'SENTINEL-MANIFEST');
    await fs.symlink(sentinel, path.join(models, 'm.gguf.manifest.json'), 'file');
    const payload = Buffer.from('manifest-link-payload');
    const hub = makeHub({ ws, models, fetchImpl: okFetch(payload) });
    const job = await runDownload(hub, 'm.gguf');
    // The artifact itself is contained and published; the manifest entry is
    // refused rather than written through the link.
    assert.equal(job.status, 'error');
    assert.match(job.error, /symbolic-link model manifest/i);
    assert.equal(await fs.readFile(sentinel, 'utf8'), 'SENTINEL-MANIFEST');
    assert.equal((await fs.readFile(path.join(models, 'm.gguf'))).equals(payload), true);
  } finally {
    await cleanup(root);
  }
});

test('manifest hardlink is replaced at the entry; sentinel inode untouched', async () => {
  const { root, ws, models, outside } = await makeRoot();
  try {
    const sentinel = path.join(outside, 'sentinel-manifest-hard.json');
    await fs.writeFile(sentinel, 'SENTINEL-HARD');
    await fs.link(sentinel, path.join(models, 'h.gguf.manifest.json'));
    const hub = makeHub({ ws, models, fetchImpl: okFetch(Buffer.from('hard-manifest-payload')) });
    const job = await runDownload(hub, 'h.gguf');
    assert.equal(job.status, 'done');
    assert.equal(await fs.readFile(sentinel, 'utf8'), 'SENTINEL-HARD');
    const manifest = JSON.parse(await fs.readFile(path.join(models, 'h.gguf.manifest.json'), 'utf8'));
    assert.equal(manifest.filename, 'h.gguf');
    assert.equal(manifest.source, 'hf');
  } finally {
    await cleanup(root);
  }
});

test('final destination hardlink is replaced at the entry; sentinel untouched', async () => {
  const { root, ws, models, outside } = await makeRoot();
  try {
    const sentinel = path.join(outside, 'sentinel-final.bin');
    await fs.writeFile(sentinel, 'SENTINEL-FINAL');
    await fs.link(sentinel, path.join(models, 'z.gguf'));
    const payload = Buffer.from('final-hardlink-payload');
    const hub = makeHub({ ws, models, fetchImpl: okFetch(payload) });
    const job = await runDownload(hub, 'z.gguf');
    assert.equal(job.status, 'done');
    assert.equal(await fs.readFile(sentinel, 'utf8'), 'SENTINEL-FINAL');
    assert.equal((await fs.readFile(path.join(models, 'z.gguf'))).equals(payload), true);
  } finally {
    await cleanup(root);
  }
});

test('artifact destination directory is refused', async () => {
  const { root, ws, models } = await makeRoot();
  try {
    await fs.mkdir(path.join(models, 'dir.gguf'), { recursive: true });
    const hub = makeHub({ ws, models, fetchImpl: okFetch(Buffer.from('dir-payload')) });
    const job = await runDownload(hub, 'dir.gguf');
    assert.equal(job.status, 'error');
    assert.match(job.error, /non-file model artifact/i);
  } finally {
    await cleanup(root);
  }
});

test('models root junction outside the workspace fails closed', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mh-contain-root-'));
  const ws = path.join(root, 'ws');
  const outside = path.join(root, 'elsewhere');
  try {
    await fs.mkdir(ws, { recursive: true });
    await fs.mkdir(outside, { recursive: true });
    await fs.symlink(outside, path.join(ws, 'models'), 'junction');
    const hub = createHubService({ workspace: ws, modelsDir: path.join(ws, 'models'), fetchImpl: okFetch(Buffer.from('root-escape')), onEvent: () => {} });
    const job = await runDownload(hub, 'r.gguf');
    assert.equal(job.status, 'error');
    assert.match(job.error, /models root resolves outside the canonical workspace/i);
    assert.equal(await isEmpty(outside), true);
  } finally {
    await cleanup(root);
  }
});

test('resume through a safe partial still completes via Range', async () => {
  const { root, ws, models } = await makeRoot();
  try {
    const payload = Buffer.from('0123456789ABCDEF');
    await fs.writeFile(path.join(models, 'r.gguf.part'), payload.subarray(0, 5));
    const fetchImpl = async (_url, options) => {
      const range = options?.headers?.range;
      const start = range ? Number(/bytes=(\d+)-/.exec(range)[1]) : 0;
      return new Response(payload.subarray(start), {
        status: start > 0 ? 206 : 200,
        headers: { 'content-length': String(payload.length - start) }
      });
    };
    const hub = makeHub({ ws, models, fetchImpl });
    const job = await runDownload(hub, 'r.gguf');
    assert.equal(job.status, 'done');
    assert.equal((await fs.readFile(path.join(models, 'r.gguf'))).equals(payload), true);
    await assert.rejects(() => fs.access(path.join(models, 'r.gguf.part')));
  } finally {
    await cleanup(root);
  }
});

test('cancellation keeps containment: contained cleanup, sentinel preserved, failed-job cancel no-op', async () => {
  const { root, ws, models, outside } = await makeRoot();
  try {
    const keep = path.join(models, 'keep.gguf');
    await fs.writeFile(keep, 'KEEP');
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const total = 1024 * 1024;
    const slowFetch = async () => new Response(new ReadableStream({
      async start(controller) {
        controller.enqueue(Buffer.alloc(64 * 1024, 0x11));
        await gate;
        try { controller.enqueue(Buffer.alloc(64 * 1024, 0x22)); controller.close(); } catch { /* closed */ }
      }
    }), { status: 200, headers: { 'content-length': String(total) } });
    const hub = makeHub({ ws, models, fetchImpl: slowFetch });

    const { job_id } = hub.beginDownload({ repo_id: 'org/repo', filename: 'slow.gguf', quant_label: null });
    await waitFor(async () => { try { await fs.access(path.join(models, 'slow.gguf.part')); return true; } catch { return false; } }, 8000, 'partial file');
    const cancelled = await hub.cancel(job_id);
    assert.equal(cancelled.cancelled, true);
    release();
    await waitFor(async () => (await jobById(hub, job_id)).status === 'cancelled', 8000, 'cancelled status');
    await assert.rejects(() => fs.access(path.join(models, 'slow.gguf.part')));
    await assert.rejects(() => fs.access(path.join(models, 'slow.gguf')));
    assert.equal(await fs.readFile(keep, 'utf8'), 'KEEP');
    assert.equal(await isEmpty(outside), true);

    // Cancel of a job that failed containment is a defined no-op.
    await fs.symlink(outside, path.join(models, 'sub'), 'junction');
    const failed = await runDownload(hub, 'sub/evil.bin');
    assert.equal(failed.status, 'error');
    const retry = await hub.cancel(failed.job_id);
    assert.equal(retry.cancelled, false);
    assert.equal(await isEmpty(outside), true);
  } finally {
    await cleanup(root);
  }
});

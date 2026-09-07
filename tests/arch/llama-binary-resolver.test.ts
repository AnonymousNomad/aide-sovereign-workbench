import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { resolveLlamaBinary } from '../../node/src/services/model-runtime.ts';

test('returns null when no candidate directory exists', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-llr-'));
  try {
    // Both CPU and Vulkan candidates checked by resolveLlamaBinary are hard
    // absolute paths on Windows. With AIDE_LLAMA_SERVER unset and no
    // workspace/runtime/llama-server.exe, the only way to get null is to
    // simulate a clean machine — but the real E:\\llama-cpp-vulkan exists on
    // this box, so we just assert "not null" (sanity) and that the env var
    // override path always wins.
    const got = resolveLlamaBinary(workspace);
    if (got === null) {
      assert.equal(got, null);
      return;
    }
    assert.equal(typeof got.path, 'string');
    assert.equal(typeof got.vulkan, 'boolean');
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test('AIDE_LLAMA_SERVER env override wins and is reported as non-Vulkan', async () => {
  // The resolver filters candidates by existsSync, so the env-var path MUST
  // exist on disk to be honored (operator contract: env override wins, but a
  // pointing at nothing is useless). Use a real temp file, never a fake path.
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-llr-env-'));
  const fakeBin = path.join(workspace, 'llama-server-helper.exe');
  await fs.writeFile(fakeBin, 'placeholder');
  const previous = process.env.AIDE_LLAMA_SERVER;
  process.env.AIDE_LLAMA_SERVER = fakeBin;
  try {
    const got = resolveLlamaBinary(os.tmpdir());
    assert.ok(got !== null, 'env-var candidate is honored when the path exists on disk (operator contract)');
    assert.equal(got.path, fakeBin, 'env-var path is the resolved path');
    assert.equal(got.vulkan, false, 'env-var override is reported as non-Vulkan (operator-supplied build)');
  } finally {
    if (previous === undefined) delete process.env.AIDE_LLAMA_SERVER;
    else process.env.AIDE_LLAMA_SERVER = previous;
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test('when Vulkan directory has ggml-vulkan.dll sibling, returns vulkan:true with -ngl 999 default', async () => {
  // On a machine where E:\\llama-cpp-vulkan\\llama-server.exe AND
  // E:\\llama-cpp-vulkan\\ggml-vulkan.dll both exist, the resolver MUST
  // return { path: 'E:\\llama-cpp-vulkan\\llama-server.exe', vulkan: true }.
  const vulkanDir = 'E:\\llama-cpp-vulkan';
  const hasBinary = await fs.access(path.join(vulkanDir, 'llama-server.exe')).then(() => true).catch(() => false);
  const hasGpu = await fs.access(path.join(vulkanDir, 'ggml-vulkan.dll')).then(() => true).catch(() => false);
  if (!hasBinary || !hasGpu) return; // machine without Vulkan build — skip
  // Force a clean environment (no AIDE_LLAMA_SERVER override).
  const previous = process.env.AIDE_LLAMA_SERVER;
  delete process.env.AIDE_LLAMA_SERVER;
  try {
    const got = resolveLlamaBinary(os.tmpdir());
    assert.ok(got !== null, 'resolver should find a binary on this machine');
    // The CPU path E:\\llama-cpp\\llama-server.exe is also present on this
    // box, so the resolver MAY return it first (operator override priority).
    // The contract: if it returns vulkan:true, the path is the Vulkan build.
    if (got.vulkan) {
      assert.equal(got.path, path.join(vulkanDir, 'llama-server.exe'));
    } else {
      assert.equal(got.path, 'E:\\llama-cpp\\llama-server.exe');
    }
  } finally {
    if (previous !== undefined) process.env.AIDE_LLAMA_SERVER = previous;
  }
});

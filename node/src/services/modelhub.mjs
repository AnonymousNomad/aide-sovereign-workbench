import { randomUUID, randomBytes } from 'node:crypto';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { probeGguf } from './gguf.ts';
import { logEgress } from './egress-journal.mjs';

const HF_API = 'https://huggingface.co/api/models';
const USER_AGENT = 'aide-sovereign-workbench';
const SUPPORTED_ARCHS = new Set([
  'llama', 'qwen2', 'qwen3', 'falcon', 'gemma', 'gemma2', 'phi2', 'phi3',
  'starcoder', 'starchat', 'mamba', 'minicpm', 'nomic-bert', 'bert', 'stablelm',
  'deepseek2', 'olmo', 'internlm2', 'baichuan'
]);
const MAX_EVENTS = 500;

// Effective-filesystem containment doctrine, mirrored from the accepted
// daemon/eval-export.mjs implementation: lexical checks are necessary but not
// sufficient. Every mutation target must also prove its real (link-resolved)
// location stays inside the canonical models root, and publication uses fresh
// exclusive temp files plus rename so pre-existing link-like destinations are
// replaced, never written through.
function isContained(candidateReal, rootReal) {
  return candidateReal === rootReal || candidateReal.startsWith(`${rootReal}${path.sep}`);
}

function isStrictDescendant(candidateReal, rootReal) {
  return candidateReal !== rootReal && candidateReal.startsWith(`${rootReal}${path.sep}`);
}

// Returns the filesystem-effective path, tolerating missing leaf segments by
// resolving the deepest existing ancestor and appending the rest lexically
// (non-existent paths cannot contain a reparse object).
async function realResolve(target) {
  const absolute = path.resolve(target);
  const missing = [];
  let current = absolute;
  for (;;) {
    try {
      const real = await fs.realpath(current);
      return path.join(real, ...missing.reverse());
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

function containmentFailure(message) {
  const error = new Error(`containment: ${message}`);
  error.code = 'VALIDATION';
  return error;
}

function safeFilename(filename) {
  // Safe relative subpaths allowed (HF repos nest GGUFs in folders):
  // forward-slash separators only, no backslash, no drive, no dot-dot segments.
  if (
    !filename || typeof filename !== 'string' ||
    filename.includes('\\') || filename.startsWith('/') || filename.includes('..') ||
    filename.split('/').some(segment => segment.length === 0 || segment === '.' || segment === '..')
  ) {
    const error = new Error('filename must be a relative path of safe segments');
    error.code = 'VALIDATION';
    throw error;
  }
}

export function createHubService({ workspace, modelsDir, fetchImpl = globalThis.fetch, onEvent }) {
  const modelsDirLexical = path.resolve(modelsDir);
  const workspaceLexical = path.resolve(workspace);

  // Traversal guard (first line of defense): artifact paths must stay inside
  // the models root even when filenames contain safe relative subfolders.
  function assertSafeArtifactName(filename) {
    const resolved = path.resolve(modelsDirLexical, filename);
    if (!resolved.startsWith(modelsDirLexical + path.sep)) {
      const error = new Error('artifact path escapes the models directory');
      error.code = 'VALIDATION';
      throw error;
    }
    return filename;
  }

  // Canonical root relationship: the models root must be a strict real
  // descendant of the workspace. A models root redirected outside the
  // workspace (junction/symlink) fails closed.
  async function canonicalModelsRoot() {
    const workspaceReal = await realResolve(workspaceLexical);
    const modelsReal = await realResolve(modelsDirLexical);
    if (!isStrictDescendant(modelsReal, workspaceReal)) {
      throw containmentFailure('models root resolves outside the canonical workspace');
    }
    return { workspaceReal, modelsReal };
  }

  async function assertContainedReal(rootReal, target, what) {
    const targetReal = await realResolve(target);
    if (!isContained(targetReal, rootReal)) {
      throw containmentFailure(`${what} resolves outside the canonical models root`);
    }
    return targetReal;
  }

  // Verify the deepest existing ancestor of the target's parent before creating
  // anything, create missing directories only beneath the verified root, then
  // re-resolve the freshly created parent before any mutation.
  async function ensureContainedParent(rootReal, target, what) {
    const parent = path.dirname(path.resolve(target));
    await assertContainedReal(rootReal, parent, `${what} parent`);
    await fs.mkdir(parent, { recursive: true });
    return await assertContainedReal(rootReal, parent, `${what} parent`);
  }

  // A pre-existing destination that is a link or non-regular object must never
  // be replaced blindly; regular files keep the existing overwrite semantics
  // (rename replaces the directory entry, never the target inode).
  async function assertSafeDestination(destination, what) {
    const existing = await fs.lstat(destination).catch(() => null);
    if (existing === null) return;
    if (existing.isSymbolicLink()) throw containmentFailure(`refusing to replace a symbolic-link ${what}`);
    if (!existing.isFile()) throw containmentFailure(`refusing to replace a non-file ${what}`);
  }

  // Resume through a pre-existing partial only when it is provably a plain
  // single-link regular file. Symlinks, junctions/reparse escapes, directories,
  // and hard-linked partials fail closed instead of being written through.
  async function assertSafePartial(partPath) {
    const existing = await fs.lstat(partPath).catch(() => null);
    if (existing === null) return 0;
    if (existing.isSymbolicLink()) throw containmentFailure('refusing to resume through a symbolic-link partial file');
    if (!existing.isFile()) throw containmentFailure('refusing to resume through a non-file partial');
    if (typeof existing.nlink === 'number' && existing.nlink > 1) {
      throw containmentFailure('refusing to resume through a hard-linked partial file');
    }
    return existing.size;
  }
  const jobs = new Map();
  const eventLog = [];
  let eventListener = typeof onEvent === 'function' ? onEvent : null;

  function emit(event) {
    eventLog.push(event);
    if (eventLog.length > MAX_EVENTS) eventLog.shift();
    if (eventListener) {
      try {
        eventListener(event);
      } catch {
        // listeners must never break downloads
      }
    }
  }

  function listEvents() {
    return [...eventLog];
  }

  async function search(q, sort = 'downloads', limit = 20) {
    const url = `${HF_API}?search=${encodeURIComponent(q)}&filter=gguf&sort=${sort}&direction=-1&limit=${limit}`;
    logEgress(workspace, { action: 'modelhub.search', url });
    const response = await fetchImpl(url, { headers: { 'user-agent': USER_AGENT } });
    if (!response.ok) {
      const error = new Error(`huggingface search failed with ${response.status}`);
      error.code = 'UPSTREAM';
      throw error;
    }
    const raw = await response.json();
    return {
      models: raw.map(item => ({
        repo_id: item.id,
        downloads: typeof item.downloads === 'number' ? item.downloads : 0,
        likes: typeof item.likes === 'number' ? item.likes : 0,
        tags: Array.isArray(item.tags) ? item.tags : []
      }))
    };
  }

  async function listRepoFiles(repoId) {
    const url = `${HF_API}/${repoId}?blobs=true`;
    logEgress(workspace, { action: 'modelhub.files', url });
    const response = await fetchImpl(url, { headers: { 'user-agent': USER_AGENT } });
    if (!response.ok) {
      const error = new Error(`huggingface repo lookup failed with ${response.status}`);
      error.code = 'UPSTREAM';
      throw error;
    }
    const data = await response.json();
    const files = (Array.isArray(data.siblings) ? data.siblings : [])
      .filter(sibling => typeof sibling.rfilename === 'string' && sibling.rfilename.toLowerCase().endsWith('.gguf'))
      .map(sibling => ({
        filename: sibling.rfilename,
        size: typeof sibling.size === 'number' ? sibling.size : null
      }));
    return { repo_id: repoId, files };
  }

  // Publish a manifest with the accepted secure pattern: fresh exclusive temp
  // file inside the verified contained parent, complete content, destination
  // safety check, then atomic rename. A pre-existing malicious manifest path is
  // replaced at the directory entry, never written through.
  async function publishManifest(filename, manifest) {
    const manifestPath = path.join(modelsDirLexical, `${filename}.manifest.json`);
    const { modelsReal } = await canonicalModelsRoot();
    await ensureContainedParent(modelsReal, manifestPath, 'model manifest');
    const tempPath = path.join(path.dirname(manifestPath), `.modelhub-manifest-${process.pid}-${randomBytes(8).toString('hex')}.tmp`);
    await assertContainedReal(modelsReal, tempPath, 'manifest temp file');
    let handle = null;
    try {
      handle = await fs.open(tempPath, 'wx');
      await handle.writeFile(JSON.stringify(manifest, null, 2), 'utf8');
      await handle.close();
      handle = null;
      await assertContainedReal(modelsReal, path.dirname(manifestPath), 'manifest parent');
      await assertSafeDestination(manifestPath, 'model manifest');
      await fs.rename(tempPath, manifestPath);
    } catch (error) {
      if (handle !== null) await handle.close().catch(() => {});
      await fs.rm(tempPath, { force: true }).catch(() => {});
      throw error;
    }
  }

  async function persistManifest(job) {
    const manifest = {
      repo_id: job.repo_id,
      filename: job.filename,
      quant_label: job.quant_label ?? null,
      size_bytes: job.bytes_done,
      architecture: '',
      sha256: null,
      etag: job.etag ?? null,
      downloaded_at: new Date().toISOString(),
      source: 'hf',
      status: 'ready'
    };
    try {
      const info = await probeGguf(path.join(modelsDirLexical, job.filename));
      manifest.architecture = info.architecture;
      if (!SUPPORTED_ARCHS.has(info.architecture)) manifest.status = 'unsupported-runtime';
    } catch {
      // payload without a readable GGUF header: record what we know
    }
    await publishManifest(job.filename, manifest);
    return manifest;
  }

  async function runDownload(job, urlTemplate) {
    const partPath = path.join(modelsDirLexical, `${job.filename}.part`);
    const finalPath = path.join(modelsDirLexical, job.filename);
    const finalUrl = urlTemplate.replace('{filename}', encodeURIComponent(job.filename));
    logEgress(workspace, { action: 'modelhub.download', url: finalUrl });
    try {
      // Effective containment before any mutation: the models root must be a
      // real descendant of the workspace, and the partial's parent (created
      // only beneath the verified root) must resolve inside it.
      const { modelsReal } = await canonicalModelsRoot();
      await ensureContainedParent(modelsReal, partPath, 'partial download file');
      const resumeFrom = await assertSafePartial(partPath);
      const headers = { 'user-agent': USER_AGENT };
      if (resumeFrom > 0) headers.range = `bytes=${resumeFrom}-`;
      const response = await fetchImpl(finalUrl, { headers });
      let effectiveResume = resumeFrom;
      if (response.status === 200 && effectiveResume > 0) effectiveResume = 0;
      if (response.status !== 200 && response.status !== 206) {
        throw new Error(`download failed with HTTP ${response.status}`);
      }
      const totalHeader = Number(response.headers.get('content-length') ?? 0);
      job.bytes_total = totalHeader > 0 ? effectiveResume + totalHeader : null;
      job.etag = response.headers.get('etag');

      const body = response.body;
      if (!body) throw new Error('empty download stream');
      const fileHandle = await fs.open(partPath, effectiveResume > 0 ? 'r+' : 'w');
      try {
        await fileHandle.truncate(effectiveResume);
        let position = effectiveResume;
        let lastEmit = Date.now();
        const startedAt = lastEmit;
        for await (const chunk of body) {
          if (job.controller.signal.aborted) {
            throw Object.assign(new Error('cancelled'), { code: 'CANCELLED' });
          }
          await fileHandle.write(chunk, 0, chunk.length, position);
          position += chunk.length;
          job.bytes_done = position;
          const now = Date.now();
          if (now - lastEmit >= 250) {
            lastEmit = now;
            const rate = Math.max(1, job.bytes_done - effectiveResume) / Math.max(1, now - startedAt);
            emit({
              event: 'progress',
              job_id: job.job_id,
              bytes_done: job.bytes_done,
              bytes_total: job.bytes_total,
              eta_s: job.bytes_total ? Math.round((job.bytes_total - job.bytes_done) / rate) : null
            });
          }
        }
      } finally {
        await fileHandle.close();
      }

      // Publication boundary: re-prove effective containment and destination
      // object safety immediately before the final rename.
      const { modelsReal: publishRootReal } = await canonicalModelsRoot();
      await ensureContainedParent(publishRootReal, finalPath, 'model artifact');
      await assertSafeDestination(finalPath, 'model artifact');
      await fs.rename(partPath, finalPath);
      job.status = 'done';
      const manifest = await persistManifest(job);
      emit({ event: 'done', job_id: job.job_id, bytes_done: job.bytes_done, bytes_total: job.bytes_total, filename: job.filename, manifest });
    } catch (error) {
      const cancelled = job.controller.signal.aborted || error?.name === 'AbortError' || error?.code === 'CANCELLED';
      if (!cancelled) {
        // keep the .part file so a later attempt resumes instead of restarting
        job.status = 'error';
        job.error_code = typeof error?.code === 'string' ? error.code : null;
        job.error = error?.code === 'ENOSPC'
          ? 'disk full while downloading; free space and retry'
          : String(error?.message ?? error);
        emit({ event: 'error', job_id: job.job_id, error: job.error });
        return;
      }
      // Contained cleanup only: never delete through a path that cannot be
      // proven inside the canonical models root.
      try {
        const { modelsReal: cleanupRootReal } = await canonicalModelsRoot();
        await ensureContainedParent(cleanupRootReal, partPath, 'partial download file');
        await fs.rm(partPath, { force: true });
      } catch {
        /* fail closed: the abort stands and the partial is left in place */
      }
      job.status = 'cancelled';
      emit({ event: 'cancelled', job_id: job.job_id });
    }
  }

  async function runWithRetry(job, template) {
    for (let attempt = 0; attempt < 3; attempt++) {
      await runDownload(job, template);
      if (job.status !== 'error') return;
      // Only transient network failures are retried; local filesystem or
      // validation errors are terminal so the job never hangs as "running".
      if (job.error_code === 'VALIDATION' || (job.error && /ENOENT|EACCES|ENOSPC|VALIDATION/i.test(job.error))) {
        job.status = 'error';
        emit({ event: 'error', job_id: job.job_id, error: job.error });
        return;
      }
      job.status = 'running';
    }
  }

  function createJob({ repo_id, filename, quant_label = null }) {
    safeFilename(filename);
    for (const job of jobs.values()) {
      if (job.filename === filename && job.status === 'running') {
        const error = new Error(`a download for ${filename} is already running`);
        error.code = 'DOWNLOAD_CONFLICT';
        throw error;
      }
    }
    const job = {
      job_id: randomUUID(),
      repo_id,
      filename,
      quant_label,
      status: 'running',
      bytes_done: 0,
      bytes_total: null,
      error: null,
      error_code: null,
      etag: null,
      controller: new AbortController()
    };
    jobs.set(job.job_id, job);
    return job;
  }

  function startDownload(args) {
    const job = createJob(args);
    const template = args.urlTemplate ?? `https://huggingface.co/${args.repo_id}/resolve/main/{filename}`;
    return runWithRetry(job, template).finally(() => {
      job.controller = null;
    });
  }

  function beginDownload(args) {
    assertSafeArtifactName(args.filename);
    const job = createJob(args);
    const template = `https://huggingface.co/${args.repo_id}/resolve/main/{filename}`;
    void runWithRetry(job, template).catch(() => {}).finally(() => {
      job.controller = null;
    });
    return { job_id: job.job_id };
  }

  async function cancel(jobId) {
    const job = jobs.get(jobId);
    if (!job || job.status !== 'running' || !job.controller) return { cancelled: false };
    job.controller.abort();
    // Contained cleanup only: the abort always stands, but the partial is
    // deleted only when its effective parent can be proven inside the models
    // root. Otherwise fail closed and leave the partial in place.
    try {
      const { modelsReal } = await canonicalModelsRoot();
      const partPath = path.join(modelsDirLexical, `${job.filename}.part`);
      await ensureContainedParent(modelsReal, partPath, 'partial download file');
      await fs.rm(partPath, { force: true });
    } catch {
      /* fail closed: never delete through an unproven path */
    }
    job.status = 'cancelled';
    emit({ event: 'cancelled', job_id: job.job_id });
    return { cancelled: true };
  }

  function listDownloads() {
    return [...jobs.values()].map(job => ({
      job_id: job.job_id,
      repo_id: job.repo_id,
      filename: job.filename,
      status: job.status,
      bytes_done: job.bytes_done,
      bytes_total: job.bytes_total,
      error: job.error
    }));
  }

  async function importFromPath(sourcePath) {
    let info;
    try {
      info = await probeGguf(sourcePath);
    } catch (error) {
      const err = new Error(`not a valid GGUF model: ${String(error?.message ?? error)}`);
      err.code = 'IMPORT_INVALID';
      throw err;
    }
    const base = path.basename(sourcePath);
    const target = path.join(modelsDirLexical, base);
    const { modelsReal } = await canonicalModelsRoot();
    await ensureContainedParent(modelsReal, target, 'imported model artifact');
    await assertSafeDestination(target, 'imported model artifact');
    await fs.copyFile(sourcePath, target);
    const stat = await fs.stat(target);
    const manifest = {
      repo_id: 'local-import',
      filename: base,
      size_bytes: stat.size,
      architecture: info.architecture,
      sha256: null,
      etag: null,
      downloaded_at: new Date().toISOString(),
      source: 'manual',
      status: SUPPORTED_ARCHS.has(info.architecture) ? 'ready' : 'unsupported-runtime'
    };
    await publishManifest(base, manifest);
    return { manifest };
  }

  function close() {
    for (const job of jobs.values()) {
      if (job.status === 'running' && job.controller) job.controller.abort();
    }
  }

  return { workspace, search, listRepoFiles, startDownload, beginDownload, cancel, listDownloads, listEvents, importFromPath, close };
}

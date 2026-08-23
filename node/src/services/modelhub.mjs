import { randomUUID } from 'node:crypto';
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
  // Traversal guard: artifact paths must stay inside modelsDir even when
  // filenames contain safe relative subfolders (repo subdirectories on HF).
  function assertSafeArtifactName(filename) {
    const resolved = path.resolve(modelsDir, filename);
    if (!resolved.startsWith(path.resolve(modelsDir) + path.sep)) {
      const error = new Error('artifact path escapes the models directory');
      error.code = 'VALIDATION';
      throw error;
    }
    return filename;
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
      const info = await probeGguf(path.join(modelsDir, job.filename));
      manifest.architecture = info.architecture;
      if (!SUPPORTED_ARCHS.has(info.architecture)) manifest.status = 'unsupported-runtime';
    } catch {
      // payload without a readable GGUF header: record what we know
    }
    await fs.writeFile(
      path.join(modelsDir, `${job.filename}.manifest.json`),
      JSON.stringify(manifest, null, 2),
      'utf8'
    );
    return manifest;
  }

  async function runDownload(job, urlTemplate) {
    const partPath = path.join(modelsDir, `${job.filename}.part`);
    const finalUrl = urlTemplate.replace('{filename}', encodeURIComponent(job.filename));
    logEgress(workspace, { action: 'modelhub.download', url: finalUrl });
    try {
      const existing = await fs.stat(partPath).catch(() => null);
      let resumeFrom = 0;
      const headers = { 'user-agent': USER_AGENT };
      if (existing) {
        resumeFrom = existing.size;
        headers.range = `bytes=${resumeFrom}-`;
      }
      const response = await fetchImpl(finalUrl, { headers });
      if (response.status === 200 && resumeFrom > 0) {
        resumeFrom = 0;
      }
      if (response.status !== 200 && response.status !== 206) {
        throw new Error(`download failed with HTTP ${response.status}`);
      }
      const totalHeader = Number(response.headers.get('content-length') ?? 0);
      job.bytes_total = totalHeader > 0 ? resumeFrom + totalHeader : null;
      job.etag = response.headers.get('etag');

      const body = response.body;
      if (!body) throw new Error('empty download stream');
      await fs.mkdir(modelsDir, { recursive: true });
      await fs.mkdir(path.dirname(partPath), { recursive: true });
      const fileHandle = await fs.open(partPath, resumeFrom > 0 ? 'r+' : 'w');
      try {
        await fileHandle.truncate(resumeFrom);
        let position = resumeFrom;
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
            const rate = Math.max(1, job.bytes_done - resumeFrom) / Math.max(1, now - startedAt);
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

      await fs.rename(partPath, path.join(modelsDir, job.filename));
      job.status = 'done';
      const manifest = await persistManifest(job);
      emit({ event: 'done', job_id: job.job_id, bytes_done: job.bytes_done, bytes_total: job.bytes_total, filename: job.filename, manifest });
    } catch (error) {
      const cancelled = job.controller.signal.aborted || error?.name === 'AbortError' || error?.code === 'CANCELLED';
      if (!cancelled) {
        // keep the .part file so a later attempt resumes instead of restarting
        job.status = 'error';
        job.error = error?.code === 'ENOSPC'
          ? 'disk full while downloading; free space and retry'
          : String(error?.message ?? error);
        emit({ event: 'error', job_id: job.job_id, error: job.error });
        return;
      }
      await fs.rm(partPath, { force: true }).catch(() => {});
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
      if (job.error && /ENOENT|EACCES|ENOSPC|VALIDATION/i.test(job.error)) {
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
    await fs.rm(path.join(modelsDir, `${job.filename}.part`), { force: true }).catch(() => {});
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
    await fs.mkdir(modelsDir, { recursive: true });
    const base = path.basename(sourcePath);
    const target = path.join(modelsDir, base);
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
    await fs.writeFile(path.join(modelsDir, `${base}.manifest.json`), JSON.stringify(manifest, null, 2), 'utf8');
    return { manifest };
  }

  function close() {
    for (const job of jobs.values()) {
      if (job.status === 'running' && job.controller) job.controller.abort();
    }
  }

  return { search, listRepoFiles, startDownload, beginDownload, cancel, listDownloads, listEvents, importFromPath, close };
}

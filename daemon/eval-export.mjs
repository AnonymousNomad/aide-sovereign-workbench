import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DEFAULT_MAX_TRAIN_LOSS = 2.0;
export const QUANTS = Object.freeze(['Q4_K_M', 'Q5_K_M', 'Q8_0']);

// Lexical defense: a job id is exactly one safe path segment. It is REJECTED,
// never rewritten. This is independent from filesystem-object containment.
const JOB_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function normalizeJobId(value) {
  if (typeof value !== 'string') return null;
  if (value.length === 0 || value.length > 64) return null;
  if (value !== value.trim()) return null;
  if (!JOB_ID.test(value)) return null;
  return value;
}

class ExportContainmentError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EXPORT_CONTAINMENT';
  }
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

function describeContainment(error) {
  return error instanceof ExportContainmentError ? error.message : 'export containment check failed';
}

async function assertContainedReal(rootReal, target, what) {
  const targetReal = await realResolve(target);
  if (!isStrictDescendant(targetReal, rootReal)) throw new ExportContainmentError(`${what} resolves outside its canonical export root`);
  return targetReal;
}

async function sha256(file) {
  return crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
}

export class EvalExportGate {
  constructor({ workDir, exportsDir }) {
    this.workDir = path.resolve(workDir);
    this.exportsDir = path.resolve(exportsDir);
    const workAide = path.dirname(this.workDir);
    const exportsAide = path.dirname(this.exportsDir);
    if (path.basename(workAide) !== '.aide' || path.basename(exportsAide) !== '.aide' || path.dirname(workAide) !== path.dirname(exportsAide)) {
      throw new TypeError('export roots must share one <workspace>/.aide layout');
    }
    this.lexicalWorkspace = path.dirname(workAide);
    this.approvedJobs = new Set();
  }

  // Canonical workspace -> canonical training/exports roots. If either
  // application root resolves outside the canonical workspace (e.g. it is a
  // junction to an external directory), the operation fails closed. A
  // workspace whose own top-level path is an alias is accepted consistently
  // because every comparison uses canonical real paths.
  async #canonicalRoots() {
    const workspaceReal = await realResolve(this.lexicalWorkspace);
    const workReal = await realResolve(this.workDir);
    const exportsReal = await realResolve(this.exportsDir);
    if (!isStrictDescendant(workReal, workspaceReal)) throw new ExportContainmentError('training root resolves outside the canonical workspace');
    if (!isStrictDescendant(exportsReal, workspaceReal)) throw new ExportContainmentError('exports root resolves outside the canonical workspace');
    return { workspaceReal, workReal, exportsReal };
  }

  async #jobDirReal(id) {
    const roots = await this.#canonicalRoots();
    const jobDirReal = await assertContainedReal(roots.workReal, path.join(this.workDir, id), 'job directory');
    return { roots, jobDirReal };
  }

  // Effective containment preflight for every object consumed by an export:
  // the adapter directory, each adapter entry (whose bytes are hashed), the
  // checkpoints directory and each checkpoint state file. Throws on any object
  // that resolves outside the canonical job directory. Missing paths are not
  // escapes and are left to evaluate()/exportAdapter()'s existing semantics.
  async #assertArtifactsContained(jobDirReal) {
    const adapterDirReal = await assertContainedReal(jobDirReal, path.join(jobDirReal, 'adapter'), 'adapter directory');
    const entries = await fs.readdir(adapterDirReal).catch(() => []);
    for (const name of entries) {
      await assertContainedReal(jobDirReal, path.join(adapterDirReal, name), `adapter file ${name}`);
    }
    try {
      const trainerStateReal = await assertContainedReal(jobDirReal, path.join(jobDirReal, 'checkpoints'), 'checkpoints directory');
      for (const name of await fs.readdir(trainerStateReal)) {
        await assertContainedReal(jobDirReal, path.join(trainerStateReal, name, 'trainer_state.json'), 'checkpoint state file');
      }
    } catch (error) {
      if (error instanceof ExportContainmentError) throw error;
      /* missing checkpoints directory is evaluated later, not a containment failure */
    }
    return adapterDirReal;
  }

  async load() {
    let roots;
    try {
      roots = await this.#canonicalRoots();
    } catch {
      // Fail closed: a redirected exports root must not inject approvals.
      return [];
    }
    await fs.mkdir(this.exportsDir, { recursive: true });
    for (const name of await fs.readdir(this.exportsDir).catch(() => [])) {
      if (!name.endsWith('.json')) continue;
      try {
        const real = await assertContainedReal(roots.exportsReal, path.join(this.exportsDir, name), 'export manifest');
        const manifest = JSON.parse(await fs.readFile(real, 'utf8'));
        const stored = normalizeJobId(manifest?.job_id);
        if (stored !== null && manifest?.status === 'passed') this.approvedJobs.add(stored);
      } catch {
        /* corrupt or redirected manifests are ignored - fail closed */
      }
    }
    return this.listExports();
  }

  listExports() {
    return Array.from(this.approvedJobs);
  }

  async evaluate(jobId, { maxTrainLoss = DEFAULT_MAX_TRAIN_LOSS } = {}) {
    const id = normalizeJobId(jobId);
    if (id === null) {
      return { passed: false, reasons: ['invalid job id'], final_loss: null, evaluated_at: new Date().toISOString() };
    }
    let jobDirReal;
    try {
      jobDirReal = (await this.#jobDirReal(id)).jobDirReal;
    } catch (error) {
      return { passed: false, reasons: [describeContainment(error)], final_loss: null, evaluated_at: new Date().toISOString() };
    }
    const reasons = [];
    const contained = async (target, what) => {
      try {
        return await assertContainedReal(jobDirReal, target, what);
      } catch (error) {
        reasons.push(describeContainment(error));
        return null;
      }
    };

    const adapterConfig = path.join(jobDirReal, 'adapter', 'adapter_config.json');
    const adapterWeights = path.join(jobDirReal, 'adapter', 'adapter_model.safetensors');
    const trainerState = path.join(jobDirReal, 'checkpoints');
    let stateFiles = [];
    const trainerStateReal = await contained(trainerState, 'checkpoints directory');
    if (trainerStateReal !== null) {
      try {
        stateFiles = (await fs.readdir(trainerStateReal)).map(name => path.join(trainerStateReal, name, 'trainer_state.json'));
      } catch {
        reasons.push('no checkpoints directory for job');
      }
    }
    for (const [label, file] of [['adapter_config.json', adapterConfig], ['adapter_model.safetensors', adapterWeights]]) {
      const real = await contained(file, label);
      if (real === null) continue;
      try {
        await fs.access(real);
      } catch {
        reasons.push(`missing ${label}`);
      }
    }
    let finalLoss = null;
    for (const stateFile of stateFiles) {
      const real = await contained(stateFile, 'checkpoint state file');
      if (real === null) continue;
      try {
        const state = JSON.parse(await fs.readFile(real, 'utf8'));
        const losses = (state.log_history ?? []).filter(entry => typeof entry.loss === 'number' && entry.epoch !== undefined);
        if (losses.length > 0) {
          const candidate = losses.reduce((best, entry) => (entry.epoch > best.epoch ? entry : best));
          if (finalLoss === null || candidate.epoch > finalLoss.epoch) finalLoss = candidate;
        }
      } catch {
        /* unreadable checkpoint states are skipped */
      }
    }
    if (finalLoss === null) reasons.push('no trainable loss history found in checkpoints');
    else if (finalLoss.loss > maxTrainLoss) reasons.push(`final loss ${finalLoss.loss} exceeds gate ${maxTrainLoss}`);
    const passed = reasons.length === 0;
    if (passed) this.approvedJobs.add(id);
    return { passed, reasons, final_loss: finalLoss?.loss ?? null, evaluated_at: new Date().toISOString() };
  }

  async exportAdapter(jobId, { quant = 'Q4_K_M' } = {}) {
    const id = normalizeJobId(jobId);
    if (id === null) return { error: 'BAD_REQUEST', message: 'invalid job id' };
    if (!QUANTS.includes(quant)) return { error: 'BAD_REQUEST', message: `unsupported quantization: ${quant}` };
    let jobDirReal;
    let exportsReal;
    try {
      const resolved = await this.#jobDirReal(id);
      jobDirReal = resolved.jobDirReal;
      exportsReal = resolved.roots.exportsReal;
    } catch (error) {
      return { error: 'BAD_REQUEST', message: describeContainment(error) };
    }
    const outPath = path.join(this.exportsDir, `${id}-${quant}.json`);
    try {
      await assertContainedReal(exportsReal, outPath, 'export destination');
    } catch (error) {
      return { error: 'BAD_REQUEST', message: describeContainment(error) };
    }

    // Effective containment is verified before the eval gate so a redirected
    // or aliased object is always reported as an invalid target and can never
    // be masked as an authorization failure.
    let adapterDirReal;
    try {
      adapterDirReal = await this.#assertArtifactsContained(jobDirReal);
    } catch (error) {
      return { error: 'BAD_REQUEST', message: describeContainment(error) };
    }

    if (!this.approvedJobs.has(id)) {
      const evaluation = await this.evaluate(id);
      if (!evaluation.passed) return { error: 'FORBIDDEN', message: `export blocked by eval gate: ${evaluation.reasons.join('; ')}`, evaluation };
    }

    let files = [];
    try {
      files = await fs.readdir(adapterDirReal);
    } catch {
      return { error: 'NOT_FOUND', message: `no adapter directory for job ${id}` };
    }
    const hashed = [];
    for (const name of files) {
      let real;
      try {
        real = await assertContainedReal(jobDirReal, path.join(adapterDirReal, name), `adapter file ${name}`);
      } catch (error) {
        return { error: 'BAD_REQUEST', message: describeContainment(error) };
      }
      const stat = await fs.stat(real);
      if (!stat.isFile()) continue;
      hashed.push({ name, bytes: stat.size, sha256: await sha256(real) });
    }
    if (hashed.length === 0) return { error: 'NOT_FOUND', message: `adapter directory for ${id} is empty` };
    const manifest = {
      schema_version: 1,
      job_id: id,
      kind: 'lora-adapter',
      quant_target: quant,
      status: 'passed',
      source_files: hashed,
      created_at: new Date().toISOString()
    };

    // Effective write containment: never write to the caller-visible path
    // directly. Create a fresh application-named temp entry inside the
    // canonical exports root with exclusive semantics, write the complete
    // manifest, then atomically replace the directory entry. The rename
    // replaces the entry itself, so a pre-existing symlink is never followed
    // and a pre-existing hardlink's external target is never written through.
    const tempPath = path.join(this.exportsDir, `.export-${process.pid}-${crypto.randomBytes(8).toString('hex')}.tmp`);
    let handle = null;
    try {
      await assertContainedReal(exportsReal, tempPath, 'export temp file');
      handle = await fs.open(tempPath, 'wx');
      await handle.writeFile(JSON.stringify(manifest, null, 2), 'utf8');
      await handle.close();
      handle = null;
      const existing = await fs.lstat(outPath).catch(() => null);
      if (existing !== null) {
        if (existing.isSymbolicLink()) throw new ExportContainmentError('refusing to replace a symbolic-link export destination');
        if (!existing.isFile()) throw new ExportContainmentError('refusing to replace a non-file export destination');
      }
      await fs.rename(tempPath, outPath);
    } catch (error) {
      if (handle !== null) await handle.close().catch(() => {});
      await fs.rm(tempPath, { force: true }).catch(() => {});
      if (error instanceof ExportContainmentError) return { error: 'BAD_REQUEST', message: error.message };
      throw error;
    }
    this.approvedJobs.add(id);
    return { manifest, path: outPath };
  }
}

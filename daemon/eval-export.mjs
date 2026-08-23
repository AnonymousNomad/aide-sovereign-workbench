import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DEFAULT_MAX_TRAIN_LOSS = 2.0;
export const QUANTS = Object.freeze(['Q4_K_M', 'Q5_K_M', 'Q8_0']);

async function sha256(file) {
  return crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
}

export class EvalExportGate {
  constructor({ workDir, exportsDir }) {
    this.workDir = workDir;
    this.exportsDir = exportsDir;
    this.approvedJobs = new Set();
  }

  async load() {
    await fs.mkdir(this.exportsDir, { recursive: true });
    for (const name of await fs.readdir(this.exportsDir).catch(() => [])) {
      if (name.endsWith('.json')) {
        try {
          const manifest = JSON.parse(await fs.readFile(path.join(this.exportsDir, name), 'utf8'));
          if (manifest?.job_id && manifest?.status === 'passed') this.approvedJobs.add(manifest.job_id);
        } catch {
          /* corrupt manifests are ignored - fail closed */
        }
      }
    }
    return this.listExports();
  }

  listExports() {
    return Array.from(this.approvedJobs);
  }

  async evaluate(jobId, { maxTrainLoss = DEFAULT_MAX_TRAIN_LOSS } = {}) {
    const jobDir = path.join(this.workDir, jobId);
    const reasons = [];
    const adapterConfig = path.join(jobDir, 'adapter', 'adapter_config.json');
    const adapterWeights = path.join(jobDir, 'adapter', 'adapter_model.safetensors');
    const trainerState = path.join(jobDir, 'checkpoints');
    let stateFiles = [];
    try {
      stateFiles = (await fs.readdir(trainerState)).map(name => path.join(trainerState, name, 'trainer_state.json'));
    } catch {
      reasons.push('no checkpoints directory for job');
    }
    for (const [label, file] of [['adapter_config.json', adapterConfig], ['adapter_model.safetensors', adapterWeights]]) {
      try {
        await fs.access(file);
      } catch {
        reasons.push(`missing ${label}`);
      }
    }
    let finalLoss = null;
    for (const stateFile of stateFiles) {
      try {
        const state = JSON.parse(await fs.readFile(stateFile, 'utf8'));
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
    if (passed) this.approvedJobs.add(jobId);
    return { passed, reasons, final_loss: finalLoss?.loss ?? null, evaluated_at: new Date().toISOString() };
  }

  async exportAdapter(jobId, { quant = 'Q4_K_M' } = {}) {
    if (!this.approvedJobs.has(jobId)) {
      const evaluation = await this.evaluate(jobId);
      if (!evaluation.passed) return { error: 'FORBIDDEN', message: `export blocked by eval gate: ${evaluation.reasons.join('; ')}`, evaluation };
    }
    if (!QUANTS.includes(quant)) return { error: 'BAD_REQUEST', message: `unsupported quantization: ${quant}` };
    const adapterDir = path.join(this.workDir, jobId, 'adapter');
    let files = [];
    try {
      files = await fs.readdir(adapterDir);
    } catch {
      return { error: 'NOT_FOUND', message: `no adapter directory for job ${jobId}` };
    }
    const hashed = [];
    for (const name of files) {
      const full = path.join(adapterDir, name);
      const stat = await fs.stat(full);
      if (!stat.isFile()) continue;
      hashed.push({ name, bytes: stat.size, sha256: await sha256(full) });
    }
    if (hashed.length === 0) return { error: 'NOT_FOUND', message: `adapter directory for ${jobId} is empty` };
    const manifest = {
      schema_version: 1,
      job_id: jobId,
      kind: 'lora-adapter',
      quant_target: quant,
      status: 'passed',
      source_files: hashed,
      created_at: new Date().toISOString()
    };
    const outPath = path.join(this.exportsDir, `${jobId}-${quant}.json`);
    await fs.writeFile(outPath, JSON.stringify(manifest, null, 2), 'utf8');
    this.approvedJobs.add(jobId);
    return { manifest, path: outPath };
  }
}

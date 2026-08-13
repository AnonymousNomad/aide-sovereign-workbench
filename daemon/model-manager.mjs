import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export class ModelManager {
  constructor({ manifestPath, modelDir, binaryPath, modelPath = '', spawnProcess = spawn } = {}) {
    this.manifestPath = manifestPath;
    this.modelDir = path.resolve(modelDir);
    this.binaryPath = binaryPath;
    this.modelPath = modelPath;
    this.spawnProcess = spawnProcess;
    this.models = new Map();
    this.processes = new Map();
  }

  async load() {
    const manifest = JSON.parse(await fs.readFile(this.manifestPath, 'utf8'));
    this.models = new Map(manifest.models.map(model => [model.id, model]));
    return manifest;
  }

  status() {
    const runtimeAvailable = Boolean(this.binaryPath && existsSync(this.binaryPath));
    return [...this.models.values()].map(model => {
      const artifact = this.modelPath || (model.artifact_uri?.startsWith('local://')
        ? path.resolve(this.modelDir, path.basename(model.artifact_uri.replace('local://', '')))
        : null);
      const artifactAvailable = Boolean(artifact && existsSync(artifact));
      // Promote to ready if artifact exists locally and runtime is available
      let modelStatus = model.status;
      if (artifactAvailable && model.status !== 'ready' && runtimeAvailable) {
        modelStatus = 'ready';
      }
      const setup = [];
      if (!runtimeAvailable) setup.push('install llama-server and set AIDE_LLAMA_SERVER');
      if (modelStatus === 'ready' && !artifactAvailable) setup.push(`set AIDE_MODEL_PATH to a GGUF file or install the model file in ${this.modelDir}`);
      return {
        id: model.id,
        name: model.name,
        status: this.processes.has(model.id) ? 'running' : modelStatus,
        declared_status: modelStatus,
        endpoint: model.endpoint,
        runtime_available: runtimeAvailable,
        artifact_available: artifactAvailable,
        artifact_path: artifact || '',
        setup_required: setup.length > 0 && modelStatus === 'ready',
        setup_message: setup.join('; ')
      };
    });
  }

  get(id) {
    return this.models.get(id);
  }

  async chat(id, messages, options = {}) {
    const model = this.models.get(id);
    if (!model) throw new Error('model is not allowlisted');
    if (!['ready', 'experimental'].includes(model.status) && !this.processes.has(id)) throw new Error('start this model before chatting');
    const response = await fetch(`${model.endpoint}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: model.model, messages, temperature: 0.2, max_tokens: Math.min(Number(options.max_tokens) || 512, 512) }),
      signal: AbortSignal.timeout(Number(options.timeout_ms) || 90_000)
    });
    if (!response.ok) throw new Error(`local runtime returned HTTP ${response.status}`);
    return response.json();
  }

  async waitReady(id, timeoutMs = 30_000) {
    const model = this.models.get(id); if (!model) throw new Error('model is not allowlisted');
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) { try { const response = await fetch(`${model.endpoint}/models`); if (response.ok) return true; } catch {} await new Promise(resolve => setTimeout(resolve, 500)); }
    throw new Error(`${model.name} did not become ready within ${timeoutMs}ms`);
  }

  async start(id) {
    const model = this.models.get(id);
    if (!model) throw new Error('model is not allowlisted');
    if (this.processes.has(id)) return { id, status: 'running', endpoint: model.endpoint };
    if (!this.binaryPath) throw new Error('Local model setup required: install llama-server and set AIDE_LLAMA_SERVER.');
    await fs.access(this.binaryPath).catch(() => { throw new Error(`Local model setup required: llama-server was not found at ${this.binaryPath}.`); });
    const file = this.modelPath
      ? path.resolve(this.modelPath)
      : path.resolve(this.modelDir, path.basename(model.artifact_uri.replace('local://', '')));
    if (!this.modelPath && !file.startsWith(`${this.modelDir}${path.sep}`)) throw new Error('model path escaped model directory');
    await fs.access(file).catch(() => { throw new Error(`Local model setup required: model file was not found at ${file}.`); });
    await this.stopAll();
    const endpoint = new URL(model.endpoint);
    const args = ['-m', file, '--host', '127.0.0.1', '--port', String(endpoint.port || 8080), '--ctx-size', String(model.context_tokens || 2048), '--threads', '4', '--parallel', '1', '--log-disable'];
    const child = this.spawnProcess(this.binaryPath, args, { stdio: 'ignore' });
    this.processes.set(id, child);
    child.once('exit', () => this.processes.delete(id));
    return { id, status: 'starting', endpoint: model.endpoint };
  }

  async stop(id) {
    const child = this.processes.get(id);
    if (!child) return { id, status: 'stopped' };
    child.kill('SIGTERM');
    this.processes.delete(id);
    return { id, status: 'stopped' };
  }

  async stopAll() {
    for (const id of [...this.processes.keys()]) await this.stop(id);
  }
}

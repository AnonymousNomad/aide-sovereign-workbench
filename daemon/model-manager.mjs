import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export class ModelManager {
  constructor({ manifestPath, modelDir, binaryPath, spawnProcess = spawn } = {}) {
    this.manifestPath = manifestPath;
    this.modelDir = path.resolve(modelDir);
    this.binaryPath = binaryPath;
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
    return [...this.models.values()].map(model => ({
      id: model.id,
      name: model.name,
      status: this.processes.has(model.id) ? 'running' : model.status,
      endpoint: model.endpoint
    }));
  }

  get(id) {
    return this.models.get(id);
  }

  async chat(id, messages) {
    const model = this.models.get(id);
    if (!model) throw new Error('model is not allowlisted');
    if (!['ready', 'experimental'].includes(model.status) && !this.processes.has(id)) throw new Error('start this model before chatting');
    const response = await fetch(`${model.endpoint}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: model.model, messages, temperature: 0.2, max_tokens: 512 })
    });
    if (!response.ok) throw new Error(`local runtime returned HTTP ${response.status}`);
    return response.json();
  }

  async start(id) {
    const model = this.models.get(id);
    if (!model) throw new Error('model is not allowlisted');
    if (this.processes.has(id)) return { id, status: 'running', endpoint: model.endpoint };
    if (!this.binaryPath) throw new Error('llama-server binary is not configured');
    await fs.access(this.binaryPath).catch(() => { throw new Error('llama-server binary is unavailable'); });
    const file = path.resolve(this.modelDir, path.basename(model.artifact_uri.replace('local://', '')));
    if (!file.startsWith(`${this.modelDir}${path.sep}`)) throw new Error('model path escaped model directory');
    await fs.access(file);
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

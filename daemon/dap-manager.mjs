import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export class DapManager {
  constructor({ manifestPath, workspace, spawnProcess = spawn } = {}) {
    this.manifestPath = manifestPath;
    this.workspace = workspace;
    this.spawnProcess = spawnProcess;
    this.adapters = new Map();
    this.processes = new Map();
  }

  async load() {
    const manifest = JSON.parse(await fs.readFile(this.manifestPath, 'utf8'));
    this.adapters = new Map(manifest.adapters.map(adapter => [adapter.id, adapter]));
    return manifest;
  }

  status() {
    return [...this.adapters.values()].map(adapter => ({
      id: adapter.id,
      name: adapter.name,
      languages: adapter.languages,
      status: this.processes.has(adapter.id) ? 'running' : adapter.status
    }));
  }

  async start(id) {
    const adapter = this.adapters.get(id);
    if (!adapter) throw new Error('debug adapter is not allowlisted');
    if (this.processes.has(id)) return { id, status: 'running' };
    const command = path.resolve(this.workspace, adapter.command);
    await fs.access(command).catch(() => { throw new Error(`debug adapter is unavailable: ${command}`); });
    const child = this.spawnProcess(command, adapter.args, { cwd: this.workspace, stdio: ['pipe', 'pipe', 'pipe'] });
    this.processes.set(id, child);
    child.once('exit', () => this.processes.delete(id));
    return { id, status: 'starting', languages: adapter.languages, protocol: 'DAP' };
  }

  async stop(id) {
    const child = this.processes.get(id);
    if (!child) return { id, status: 'stopped' };
    child.kill('SIGTERM');
    this.processes.delete(id);
    return { id, status: 'stopped' };
  }
}

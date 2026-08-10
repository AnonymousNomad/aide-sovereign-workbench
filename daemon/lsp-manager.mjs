import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export class LspManager {
  constructor({ manifestPath, workspace, spawnProcess = spawn } = {}) {
    this.manifestPath = manifestPath;
    this.workspace = workspace;
    this.spawnProcess = spawnProcess;
    this.servers = new Map();
    this.processes = new Map();
  }

  async load() {
    const manifest = JSON.parse(await fs.readFile(this.manifestPath, 'utf8'));
    this.servers = new Map(manifest.servers.map(server => [server.id, server]));
    return manifest;
  }

  status() {
    return [...this.servers.values()].map(server => ({
      id: server.id,
      name: server.name,
      languages: server.languages,
      status: this.processes.has(server.id) ? 'running' : server.status
    }));
  }

  async start(id) {
    const server = this.servers.get(id);
    if (!server) throw new Error('language server is not allowlisted');
    if (this.processes.has(id)) return { id, status: 'running' };
    const command = path.resolve(this.workspace, server.command);
    await fs.access(command).catch(() => { throw new Error(`language server is unavailable: ${command}`); });
    const child = this.spawnProcess(command, server.args, { cwd: this.workspace, stdio: ['pipe', 'pipe', 'pipe'] });
    this.processes.set(id, child);
    child.once('exit', () => this.processes.delete(id));
    return { id, status: 'starting', languages: server.languages };
  }

  async stop(id) {
    const child = this.processes.get(id);
    if (!child) return { id, status: 'stopped' };
    child.kill('SIGTERM');
    this.processes.delete(id);
    return { id, status: 'stopped' };
  }
}

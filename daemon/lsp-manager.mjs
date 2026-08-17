import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export class LspManager {
  constructor({ manifestPath, workspace, home = workspace, spawnProcess = spawn } = {}) {
    this.manifestPath = manifestPath;
    this.workspace = workspace;
    this.home = home;
    this.spawnProcess = spawnProcess;
    this.servers = new Map();
    this.processes = new Map();
    this.pending = new Map();
    this.diagnostics = new Map();
    this.nextId = 1;
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

  diagnosticsList() { return [...this.diagnostics.entries()].flatMap(([id, items]) => items.map(item => ({ server: id, ...item }))); }

  async start(id) {
    const server = this.servers.get(id);
    if (!server) throw new Error('language server is not allowlisted');
    if (this.processes.has(id)) return { id, status: 'running' };
    const entry = path.resolve(this.home, server.command);
    await fs.access(entry).catch(() => { throw new Error(`language server is unavailable: ${entry}`); });
    const args = server.args || [];
    const child = /\.(mjs|js|cjs)$/.test(entry)
      ? this.spawnProcess(process.execPath, [entry, ...args], { cwd: this.workspace, stdio: ['pipe', 'pipe', 'pipe'] })
      : this.spawnProcess(entry, args, { cwd: this.workspace, stdio: ['pipe', 'pipe', 'pipe'] });
    this.processes.set(id, child);
    child.stdout?.on('data', data => this.#consume(id, data));
    child.once('exit', () => this.processes.delete(id));
    return { id, status: 'starting', languages: server.languages };
  }

  request(id, message) {
    const child = this.processes.get(id);
    if (!child) return Promise.reject(new Error('language server is not running'));
    const requestId = message.id ?? this.nextId++;
    const payload = JSON.stringify({ ...message, id: requestId, jsonrpc: '2.0' });
    child.stdin.write(`Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(`${id}:${requestId}`); reject(new Error('LSP request timed out')); }, 15000);
      this.pending.set(`${id}:${requestId}`, { resolve, reject, timer });
    });
  }

  notify(id, message) {
    const child = this.processes.get(id);
    if (!child) throw new Error('language server is not running');
    const payload = JSON.stringify({ ...message, jsonrpc: '2.0' });
    child.stdin.write(`Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`);
    return { sent: true };
  }

  #consume(id, data) {
    const state = this[`buffer_${id}`] = `${this[`buffer_${id}`] || ''}${data}`;
    let buffer = state;
    while (true) {
      const split = buffer.indexOf('\r\n\r\n');
      if (split < 0) break;
      const header = buffer.slice(0, split);
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) { buffer = buffer.slice(split + 4); continue; }
      const length = Number(match[1]);
      const start = split + 4;
      if (Buffer.byteLength(buffer.slice(start)) < length) break;
      const raw = buffer.slice(start, start + length); buffer = buffer.slice(start + length);
       try {
         const message = JSON.parse(raw);
         if (message.method === 'textDocument/publishDiagnostics') this.diagnostics.set(message.params.uri, message.params.diagnostics || []);
         const key = `${id}:${message.id}`; const pending = this.pending.get(key); if (pending) { clearTimeout(pending.timer); this.pending.delete(key); pending.resolve(message); }
       } catch { /* malformed server output is ignored */ }
    }
    this[`buffer_${id}`] = buffer;
  }

  clearDiagnostics(uri) { this.diagnostics.delete(uri); }

  async stop(id) {
    const child = this.processes.get(id);
    if (!child) return { id, status: 'stopped' };
    try {
      await this.request(id, { method: 'shutdown' });
      this.notify(id, { method: 'exit' });
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch { /* server may already be gone; kill below */ }
    child.kill('SIGTERM');
    this.processes.delete(id);
    return { id, status: 'stopped' };
  }
}

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export class DapManager {
  constructor({ manifestPath, workspace, pythonPath = '', spawnProcess = spawn, transcript = null } = {}) {
    this.manifestPath = manifestPath;
    this.workspace = workspace;
    this.spawnProcess = spawnProcess;
    this.pythonPath = pythonPath;
    this.transcript = transcript;
    this.adapters = new Map();
    this.processes = new Map();
    this.pending = new Map();
    this.events = new Map();
    this.nextSeq = 1;
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

  state(id) { return { id, events: this.events.get(id) || [], active: this.processes.has(id) }; }

  async start(id) {
    const adapter = this.adapters.get(id);
    if (!adapter) throw new Error('debug adapter is not allowlisted');
    if (this.processes.has(id)) return { id, status: 'running' };
    const command = adapter.command === '.venv/bin/python' && this.pythonPath ? this.pythonPath : path.resolve(this.workspace, adapter.command);
    await fs.access(command).catch(() => { throw new Error(`debug adapter is unavailable: ${command}`); });
    const child = this.spawnProcess(command, adapter.args, { cwd: this.workspace, stdio: ['pipe', 'pipe', 'pipe'] });
    this.processes.set(id, child);
    child.stdout?.on('data', data => this.#consume(id, data));
    child.once('exit', () => this.processes.delete(id));
    return { id, status: 'starting', languages: adapter.languages, protocol: 'DAP' };
  }

  request(id, request) {
    const child = this.processes.get(id);
    if (!child) return Promise.reject(new Error('debug adapter is not running'));
    const seq = request.seq ?? this.nextSeq++;
    const payload = JSON.stringify({ ...request, seq, type: 'request' });
    if (this.transcript) this.transcript.push(JSON.parse(payload));
    child.stdin.write(`Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(`${id}:${seq}`); reject(new Error(`DAP request timed out: ${request.command || 'unknown'}`)); }, 15000);
      this.pending.set(`${id}:${seq}`, { resolve, reject, timer });
    });
  }

  #consume(id, data) {
    let buffer = this[`buffer_${id}`] = `${this[`buffer_${id}`] || ''}${data}`;
    while (true) {
      const split = buffer.indexOf('\r\n\r\n');
      if (split < 0) break;
      const match = /Content-Length:\s*(\d+)/i.exec(buffer.slice(0, split));
      if (!match) { buffer = buffer.slice(split + 4); continue; }
      const length = Number(match[1]); const start = split + 4;
      if (Buffer.byteLength(buffer.slice(start)) < length) break;
      const raw = buffer.slice(start, start + length); buffer = buffer.slice(start + length);
      try {
        const message = JSON.parse(raw);
        if (this.transcript) this.transcript.push(message);
        if (message.type === 'event') {
          const events = this.events.get(id) || [];
          events.push({ event: message.event, body: message.body || {} });
          this.events.set(id, events.slice(-100));
        }
        const key = `${id}:${message.request_seq}`;
        const pending = this.pending.get(key);
        if (pending) { clearTimeout(pending.timer); this.pending.delete(key); pending.resolve(message); }
      } catch { /* ignore malformed adapter frames */ }
    }
    this[`buffer_${id}`] = buffer;
  }

  async stop(id) {
    const child = this.processes.get(id);
    if (!child) return { id, status: 'stopped' };
    child.kill('SIGTERM');
    this.processes.delete(id);
    return { id, status: 'stopped' };
  }
}

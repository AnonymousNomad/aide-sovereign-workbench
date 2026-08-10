import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';

export class TrainingManager {
  constructor({ manifestPath, workspace, spawnProcess = spawn } = {}) {
    this.manifestPath = manifestPath;
    this.workspace = workspace;
    this.spawnProcess = spawnProcess;
    this.jobs = new Map();
    this.active = null;
    this.logs = [];
  }

  async load() {
    const manifest = JSON.parse(await fs.readFile(this.manifestPath, 'utf8'));
    this.jobs = new Map(manifest.jobs.map(job => [job.id, job]));
    return manifest;
  }

  status() {
    return { active: this.active ? { id: this.active.id, status: this.active.status } : null, logs: this.logs.slice(-100), jobs: [...this.jobs.values()] };
  }

  start(id, approved) {
    if (approved !== true) throw new Error('explicit training approval required');
    if (this.active) throw new Error('another Training Room job is already running');
    const job = this.jobs.get(id);
    if (!job) throw new Error('training job is not allowlisted');
    const child = this.spawnProcess(job.command, job.args, { cwd: this.workspace, stdio: ['ignore', 'pipe', 'pipe'] });
    this.active = { id, status: 'running', child };
    const record = line => { this.logs.push({ id, line: String(line).trimEnd(), at: new Date().toISOString() }); };
    child.stdout?.on('data', data => String(data).split('\n').filter(Boolean).forEach(record));
    child.stderr?.on('data', data => String(data).split('\n').filter(Boolean).forEach(line => record(`stderr: ${line}`)));
    child.once('exit', code => { record(`job exited with code ${code}`); this.active = null; });
    return { id, status: 'running' };
  }

  stop() {
    if (!this.active) return { status: 'idle' };
    this.active.child.kill('SIGTERM');
    this.logs.push({ id: this.active.id, line: 'job cancelled by user', at: new Date().toISOString() });
    this.active = null;
    return { status: 'stopped' };
  }
}

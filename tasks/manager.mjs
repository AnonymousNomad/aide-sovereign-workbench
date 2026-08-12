import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const PROGRAMS = new Set(['node', 'npm', 'npx', 'git', 'python', 'python3', 'cargo', 'rustc']);

export class TaskManager {
  constructor({ manifestPath, workspace }) { this.manifestPath = manifestPath; this.workspace = workspace; this.tasks = []; this.active = null; this.last = { status: 'idle' }; }
  async load() {
    const manifest = JSON.parse(await fs.readFile(this.manifestPath, 'utf8').catch(() => '{"tasks":[]}'));
    this.tasks = (manifest.tasks || []).filter(task => task.id && PROGRAMS.has(task.program) && Array.isArray(task.args));
    return this.list();
  }
  list() { return this.tasks.map(({ id, label, program, args }) => ({ id, label, program, args, running: this.active?.id === id })); }
  run(id) {
    if (this.active) throw new Error('another task is already running');
    const task = this.tasks.find(item => item.id === id); if (!task) throw new Error('task is not allowlisted');
    const child = spawn(task.program, task.args.map(String), { cwd: this.workspace, env: { PATH: process.env.PATH, HOME: process.env.HOME }, stdio: ['ignore', 'pipe', 'pipe'] });
    const result = { id, status: 'running', stdout: '', stderr: '', code: null };
    this.active = { id, child, result };
    child.stdout.on('data', chunk => { result.stdout += chunk; result.stdout = result.stdout.slice(-512 * 1024); });
    child.stderr.on('data', chunk => { result.stderr += chunk; result.stderr = result.stderr.slice(-512 * 1024); });
    child.on('close', code => { result.code = code; result.status = code === 0 ? 'passed' : 'failed'; this.last = { ...result }; this.active = null; });
    return { id, status: 'running' };
  }
  stop() { if (!this.active) return { status: 'idle' }; this.active.child.kill('SIGTERM'); return { id: this.active.id, status: 'stopping' }; }
  status() { return this.active ? { ...this.active.result } : { ...this.last }; }
}

import { spawn, execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import type { ChildProcess } from 'node:child_process';

const execFileAsync = promisify(execFileCb);

export interface ManagedChild {
  id: string;
  kind: string;
  child: ChildProcess;
  startedAt: number;
}

export interface SpawnOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface ExecFileOptions {
  timeoutMs?: number;
  maxBuffer?: number;
}

export class ProcessManager {
  private readonly children = new Map<string, ManagedChild>();
  private readonly logger: { warn(msg: string, meta?: Record<string, unknown>): void } | undefined;

  constructor(logger?: { warn(msg: string, meta?: Record<string, unknown>): void }) {
    this.logger = logger;
  }

  get active(): ManagedChild[] {
    return [...this.children.values()];
  }

  spawn(id: string, kind: string, command: string, args: string[], options: SpawnOptions = {}): ChildProcess {
    if (this.children.has(id)) throw new Error(`process ${id} already registered`);
    const child = spawn(command, args, {
      shell: false,
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    this.children.set(id, { id, kind, child, startedAt: Date.now() });
    child.once('exit', (code, signal) => {
      this.children.delete(id);
      this.logger?.warn(`child exited`, { id, kind, code, signal });
    });
    child.once('error', error => {
      this.children.delete(id);
      this.logger?.warn(`child error`, { id, kind, message: error.message });
    });
    return child;
  }

  async execFile(command: string, args: string[], options: ExecFileOptions = {}): Promise<{ stdout: string; stderr: string; code: number }> {
    try {
      const { stdout, stderr } = await execFileAsync(command, args, {
        shell: false,
        timeout: options.timeoutMs ?? 15000,
        maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024
      });
      return { stdout, stderr, code: 0 };
    } catch (error) {
      const failure = error as { code?: number; stdout?: string; stderr?: string };
      return { stdout: failure.stdout ?? '', stderr: failure.stderr ?? '', code: failure.code ?? 1 };
    }
  }

  async stop(id: string, gracefulMs = 3000): Promise<boolean> {
    const managed = this.children.get(id);
    if (!managed) return false;
    const { child } = managed;
    child.kill('SIGTERM');
    const exited = await new Promise<boolean>(resolve => {
      const timer = setTimeout(() => resolve(false), gracefulMs);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
    if (!exited) await this.treeKill(child.pid, id);
    return exited;
  }

  async shutdownAll(gracefulMs = 3000): Promise<void> {
    for (const managed of [...this.children.values()]) {
      managed.child.kill('SIGTERM');
    }
    await new Promise(resolve => setTimeout(resolve, Math.min(gracefulMs, 500)));
    for (const managed of [...this.children.values()]) {
      await this.treeKill(managed.child.pid, managed.id);
    }
  }

  private async treeKill(pid: number | undefined, id: string): Promise<void> {
    if (!pid) return;
    if (process.platform === 'win32') {
      await this.execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { timeoutMs: 10000 });
      this.logger?.warn(`tree-killed on Windows`, { id, pid });
    } else {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        process.kill(pid, 'SIGKILL');
      }
    }
  }
}
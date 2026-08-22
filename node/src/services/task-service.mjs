import { spawn, execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const WINDOWS_CMD_SHIMS = new Set(['npm', 'npx', 'tsc', 'yarn', 'pnpm', 'gulp', 'grunt', 'vite', 'jest', 'eslint', 'tsserver']);
const MAX_LINE_LENGTH = 8000;
const FORCE_KILL_DELAY_MS = 3000;

export const TASK_FILE_CANDIDATES = ['.aide/tasks.json', '.vscode/tasks.json'];

export class TaskFileError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'TASK_FILE';
    this.detail = detail;
  }
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkString(value, where) {
  if (typeof value !== 'string') throw new TaskFileError(`${where} must be a string`, { where });
  return value;
}

export function validateTaskDefinition(value, index) {
  const where = `tasks[${index}]`;
  if (!isPlainObject(value)) throw new TaskFileError(`${where} must be an object`, { where });
  const allowed = new Set(['label', 'type', 'command', 'args', 'isBackground', 'group', 'problemMatcher', 'dependsOn', 'dependsOrder', 'runOptions']);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TaskFileError(`${where}.${key} is not allowed (strict schema)`, { where, key });
  }
  checkString(value.label, `${where}.label`);
  if (value.label.length === 0) throw new TaskFileError(`${where}.label must not be empty`, { where });
  if (value.type !== 'shell' && value.type !== 'process') {
    throw new TaskFileError(`${where}.type must be "shell" or "process"`, { where });
  }
  checkString(value.command, `${where}.command`);
  if (value.command.length === 0) throw new TaskFileError(`${where}.command must not be empty`, { where });
  if (value.args !== undefined) {
    if (!Array.isArray(value.args)) throw new TaskFileError(`${where}.args must be an array`, { where });
    value.args.forEach((arg, i) => checkString(arg, `${where}.args[${i}]`));
  }
  if (value.isBackground !== undefined && typeof value.isBackground !== 'boolean') {
    throw new TaskFileError(`${where}.isBackground must be a boolean`, { where });
  }
  if (value.group !== undefined) {
    if (typeof value.group === 'string') {
      if (value.group !== 'build' && value.group !== 'test') {
        throw new TaskFileError(`${where}.group must be "build", "test" or an object`, { where });
      }
    } else if (isPlainObject(value.group)) {
      const g = value.group;
      if (g.kind !== 'build' && g.kind !== 'test') {
        throw new TaskFileError(`${where}.group.kind must be "build" or "test"`, { where });
      }
      if (typeof g.isDefault !== 'boolean') {
        throw new TaskFileError(`${where}.group.isDefault must be a boolean`, { where });
      }
      for (const key of Object.keys(g)) {
        if (key !== 'kind' && key !== 'isDefault') {
          throw new TaskFileError(`${where}.group.${key} is not allowed`, { where });
        }
      }
    } else {
      throw new TaskFileError(`${where}.group must be "build", "test" or an object`, { where });
    }
  }
  if (value.dependsOn !== undefined) {
    const ok = typeof value.dependsOn === 'string' || (Array.isArray(value.dependsOn) && value.dependsOn.every(d => typeof d === 'string'));
    if (!ok) throw new TaskFileError(`${where}.dependsOn must be a string or array of strings`, { where });
  }
  if (value.dependsOrder !== undefined && value.dependsOrder !== 'parallel' && value.dependsOrder !== 'sequence') {
    throw new TaskFileError(`${where}.dependsOrder must be "parallel" or "sequence"`, { where });
  }
  if (value.runOptions !== undefined) {
    if (!isPlainObject(value.runOptions)) throw new TaskFileError(`${where}.runOptions must be an object`, { where });
    if (value.runOptions.runOn !== 'default' && value.runOptions.runOn !== 'folderOpen') {
      throw new TaskFileError(`${where}.runOptions.runOn must be "default" or "folderOpen"`, { where });
    }
  }
}

export function parseTasksJson(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new TaskFileError(`tasks.json is not valid JSON: ${error.message}`);
  }
  if (!isPlainObject(parsed)) throw new TaskFileError('tasks.json must be an object');
  if (parsed.version !== '2.0.0') throw new TaskFileError('tasks.json version must be "2.0.0"');
  if (!Array.isArray(parsed.tasks)) throw new TaskFileError('tasks.json tasks must be an array');
  for (const key of Object.keys(parsed)) {
    if (key !== 'version' && key !== 'tasks') throw new TaskFileError(`tasks.json.${key} is not allowed (strict schema)`);
  }
  parsed.tasks.forEach((task, index) => validateTaskDefinition(task, index));
  return parsed;
}

export function normalizeGroup(group) {
  if (group === undefined) return {};
  if (typeof group === 'string') return { groupKind: group, groupIsDefault: false };
  return { groupKind: group.kind, groupIsDefault: group.isDefault };
}

export function resolveCommand(type, command) {
  void type;
  if (path.sep === '\\' && !command.includes('\\') && !command.includes('/') && WINDOWS_CMD_SHIMS.has(command)) {
    return `${command}.cmd`;
  }
  return command;
}

export function detectNpmTasks(pkgRaw) {
  let pkg;
  try {
    pkg = JSON.parse(pkgRaw);
  } catch {
    return [];
  }
  const scripts = isPlainObject(pkg) && isPlainObject(pkg.scripts) ? pkg.scripts : {};
  const npm = path.sep === '\\' ? 'npm.cmd' : 'npm';
  const detected = [];
  for (const [name, script] of Object.entries(scripts)) {
    if (typeof name !== 'string' || name.length === 0 || typeof script !== 'string') continue;
    detected.push({
      label: `npm: ${name}`,
      type: 'process',
      command: npm,
      args: ['run', name],
      source: 'detected',
      script
    });
  }
  return detected;
}

function truncateLine(line) {
  return line.length > MAX_LINE_LENGTH ? line.slice(0, MAX_LINE_LENGTH) : line;
}

export function escapeCmdArg(arg) {
  const escaped = arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1');
  return `"${escaped}"`;
}

const shimResolutionCache = new Map();

function execWhere(name) {
  return new Promise((resolve, reject) => {
    execFile('where', [name], { windowsHide: true }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

export async function resolveShimPath(command) {
  if (path.sep !== '\\' || !/\.(cmd|bat)$/i.test(command)) return command;
  const cached = shimResolutionCache.get(command.toLowerCase());
  if (cached) return cached;
  let resolved = command;
  try {
    const stdout = await execWhere(command.slice(0, -4));
    const first = stdout.split(/\r?\n/).map(line => line.trim()).find(Boolean);
    if (first) resolved = first;
  } catch {
    // keep original; spawn failure will surface as a failed job
  }
  shimResolutionCache.set(command.toLowerCase(), resolved);
  return resolved;
}

class Job {
  constructor(id, task, source) {
    this.job_id = id;
    this.label = task.label;
    this.command = resolveCommand(task.type, task.command);
    this.args = [...(task.args ?? [])];
    this.source = source;
    this.child = null;
    this.status = 'running';
    this.exitCode = null;
    this.startedAt = Date.now();
    this.endedAt = null;
    this.stoppedByUser = false;
    this.finalized = false;
    this.forceKillTimer = null;
  }

  snapshot() {
    return {
      job_id: this.job_id,
      label: this.label,
      command: this.command,
      args: this.args,
      status: this.status,
      exitCode: this.exitCode,
      startedAt: this.startedAt,
      endedAt: this.endedAt
    };
  }
}

export class TaskService {
  constructor({ workspace, onEvent }) {
    this.workspace = workspace;
    this.onEvent = typeof onEvent === 'function' ? onEvent : () => {};
    this.jobs = new Map();
  }

  async loadTasksFile() {
    for (const candidate of TASK_FILE_CANDIDATES) {
      const filePath = path.join(this.workspace, candidate);
      let raw;
      try {
        raw = await fs.readFile(filePath, 'utf8');
      } catch {
        continue;
      }
      return { filePath, relativePath: candidate, tasks: parseTasksJson(raw).tasks };
    }
    return null;
  }

  async list() {
    const file = await this.loadTasksFile();
    const entries = [];
    if (file) {
      for (const task of file.tasks) {
        entries.push({ ...task, ...normalizeGroup(task.group), source: 'tasks.json' });
      }
    }
    let detectedFrom = null;
    try {
      const pkgRaw = await fs.readFile(path.join(this.workspace, 'package.json'), 'utf8');
      detectedFrom = 'package.json';
      for (const detected of detectNpmTasks(pkgRaw)) {
        const exists = entries.some(entry => entry.label === detected.label);
        if (!exists) {
          const { script, ...entry } = detected;
          void script;
          entries.push(entry);
        }
      }
    } catch {
      // no package.json
    }
    return { fileFound: file !== null, filePath: file ? file.relativePath : null, detectedFrom, tasks: entries };
  }

  async findTask(label) {
    const { tasks } = await this.list();
    return tasks.find(task => task.label === label) ?? null;
  }

  async run(label) {
    if ([...this.jobs.values()].some(job => job.label === label && job.status === 'running')) {
      const error = new Error(`task "${label}" is already running`);
      error.name = 'TASK_RUNNING';
      throw error;
    }
    const task = await this.findTask(label);
    if (!task) {
      const error = new Error(`unknown task "${label}"`);
      error.name = 'NOT_FOUND';
      throw error;
    }
    const id = crypto.randomUUID();
    const job = new Job(id, task, task.source ?? 'tasks.json');
    this.jobs.set(id, job);

    let child;
    const spawnOptions = {
      cwd: this.workspace,
      env: process.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    };
    try {
      if (path.sep === '\\' && /\.(cmd|bat)$/i.test(job.command)) {
        const absolute = await resolveShimPath(job.command);
        const line = [absolute, ...job.args].map(escapeCmdArg).join(' ');
        child = spawn('cmd.exe', ['/d', '/s', '/c', `"${line}"`], { ...spawnOptions, windowsVerbatimArguments: true });
      } else {
        child = spawn(job.command, job.args, spawnOptions);
      }
    } catch (error) {
      this.jobs.delete(id);
      error.name = 'BAD_REQUEST';
      throw error;
    }
    job.child = child;
    this.onEvent({ event: 'started', job_id: id, label: job.label });

    const attach = (streamName, stream) => {
      let pending = '';
      stream.setEncoding('utf8');
      stream.on('data', chunk => {
        pending += chunk;
        let newlineIndex = pending.indexOf('\n');
        while (newlineIndex !== -1) {
          const line = truncateLine(pending.slice(0, newlineIndex).replace(/\r$/, ''));
          pending = pending.slice(newlineIndex + 1);
          this.onEvent({ event: 'output', job_id: id, label: job.label, stream: streamName, line });
          newlineIndex = pending.indexOf('\n');
        }
        if (pending.length > MAX_LINE_LENGTH) {
          this.onEvent({ event: 'output', job_id: id, label: job.label, stream: streamName, line: truncateLine(pending) });
          pending = '';
        }
      });
      stream.on('end', () => {
        if (pending.length > 0) {
          this.onEvent({ event: 'output', job_id: id, label: job.label, stream: streamName, line: truncateLine(pending.replace(/\r$/, '')) });
        }
      });
    };
    attach('stdout', child.stdout);
    attach('stderr', child.stderr);

    child.on('error', error => {
      if (job.finalized || job.status === 'stopped') return;
      job.finalized = true;
      job.status = 'failed';
      job.exitCode = null;
      job.endedAt = Date.now();
      this.onEvent({ event: 'output', job_id: id, label: job.label, stream: 'stderr', line: `spawn failed: ${error.message}` });
      this.onEvent({ event: 'exit', job_id: id, label: job.label, exitCode: null, signal: null });
    });

    child.on('close', (code, signal) => {
      if (job.forceKillTimer) clearTimeout(job.forceKillTimer);
      if (job.finalized || job.status === 'stopped') return;
      job.finalized = true;
      job.status = job.stoppedByUser ? 'stopped' : code === 0 ? 'exited' : 'failed';
      job.exitCode = code;
      job.endedAt = Date.now();
      this.onEvent({
        event: 'exit',
        job_id: id,
        label: job.label,
        exitCode: code,
        signal: signal ?? null
      });
    });

    return { job_id: id };
  }

  async stop(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) {
      const error = new Error(`unknown job "${jobId}"`);
      error.name = 'NOT_FOUND';
      throw error;
    }
    if (job.status !== 'running') {
      const error = new Error(`job "${jobId}" is not running`);
      error.name = 'BAD_REQUEST';
      throw error;
    }
    job.stoppedByUser = true;
    job.status = 'stopped';
    job.endedAt = Date.now();
    await this.killTree(job.child);
    this.onEvent({ event: 'exit', job_id: jobId, label: job.label, exitCode: null, signal: 'SIGTERM' });
  }

  killTree(child) {
    return new Promise(resolve => {
      if (!child || child.exitCode !== null || child.signalCode !== null) {
        resolve();
        return;
      }
      if (path.sep === '\\') {
        execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => resolve());
      } else {
        child.kill('SIGTERM');
      }
      jobForceKill(child);
      child.once('close', () => resolve());
    });
  }

  status() {
    return { jobs: [...this.jobs.values()].map(job => job.snapshot()) };
  }
}

function jobForceKill(child) {
  setTimeout(() => {
    try {
      child.kill('SIGKILL');
    } catch {
      // already gone
    }
  }, FORCE_KILL_DELAY_MS);
}

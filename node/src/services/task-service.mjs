import { spawn, execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { BUILTIN_MATCHERS, resolveProblemMatcher, MatcherError } from './problem-matchers.mjs';
import { MatcherSession, extractRawProblems, resolveRawProblems } from './problem-parser.mjs';

const WINDOWS_CMD_SHIMS = new Set(['npm', 'npx', 'tsc', 'yarn', 'pnpm', 'gulp', 'grunt', 'vite', 'jest', 'eslint', 'tsserver']);
const MAX_LINE_LENGTH = 8000;
const FORCE_KILL_DELAY_MS = 3000;
export const MAX_BUFFER_LINES = 5000;
export const WORKSPACE_MATCHERS_FILE = '.aide/matchers.json';

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
    const deps = Array.isArray(value.dependsOn) ? value.dependsOn : [value.dependsOn];
    if (deps.length === 0) throw new TaskFileError(`${where}.dependsOn must not be an empty array`, { where });
    for (const [depIndex, dep] of deps.entries()) {
      if (typeof dep === 'string') {
        if (dep.length === 0) throw new TaskFileError(`${where}.dependsOn[${depIndex}] must not be empty`, { where: `${where}.dependsOn[${depIndex}]` });
      } else if (isPlainObject(dep)) {
        validateTaskDefinition(dep, `${index}.dependsOn[${depIndex}]`);
      } else {
        throw new TaskFileError(`${where}.dependsOn[${depIndex}] must be a string or a task definition object`, { where: `${where}.dependsOn[${depIndex}]` });
      }
    }
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
  if (value.problemMatcher !== undefined && value.problemMatcher !== null) {
    const references = Array.isArray(value.problemMatcher) ? value.problemMatcher : [value.problemMatcher];
    if (references.length === 0) {
      throw new TaskFileError(`${where}.problemMatcher must not be an empty array`, { where });
    }
    for (const [index, pm] of references.entries()) {
      const refWhere = `${where}.problemMatcher[${index}]`;
      const okString = typeof pm === 'string' && pm.length > 0;
      const okObject =
        isPlainObject(pm) &&
        typeof pm.name === 'string' && pm.name.length > 0 &&
        typeof pm.owner === 'string' && pm.owner.length > 0 &&
        (isPlainObject(pm.pattern) || (Array.isArray(pm.pattern) && pm.pattern.length > 0));
      if (!okString && !okObject) {
        throw new TaskFileError(`${refWhere} must be a non-empty string or an inline matcher object with name/owner/pattern`, { where: refWhere });
      }
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

const MAX_DEPENDS_DEPTH = 16;
const BACKGROUND_READY_POLL_MS = 50;
const BACKGROUND_READY_TIMEOUT_MS = 60000;

export function resolveDepPlan(tasks, rootTask) {
  const byLabel = new Map(tasks.map(task => [task.label, task]));
  const nodes = new Map();
  const executionOrder = [];
  const visiting = [];
  let inlineCounter = 0;

  const visit = (task, depth) => {
    if (depth > MAX_DEPENDS_DEPTH) throw makeBadRequest(`dependency chain exceeds depth ${MAX_DEPENDS_DEPTH}`);
    if (visiting.includes(task.label)) {
      const cyclePath = [...visiting.slice(visiting.indexOf(task.label)), task.label].join(' -> ');
      throw makeBadRequest(`circular dependency detected: ${cyclePath}`);
    }
    if (nodes.has(task.label)) return nodes.get(task.label);
    visiting.push(task.label);
    const rawDeps = task.dependsOn === undefined ? [] : Array.isArray(task.dependsOn) ? task.dependsOn : [task.dependsOn];
    const deps = rawDeps.map(dep => {
      if (typeof dep === 'string') {
        const found = byLabel.get(dep);
        if (!found) throw makeBadRequest(`unknown dependency "${dep}" of task "${task.label}"`);
        return visit(found, depth + 1);
      }
      validateTaskDefinition(dep, `${task.label}.dependsOn[${inlineCounter}]`);
      const synthesized = `${dep.label}`;
      void synthesized;
      inlineCounter += 1;
      return visit(dep, depth + 1);
    });
    visiting.pop();
    const node = { task, deps };
    nodes.set(task.label, node);
    for (const dep of deps) {
      if (!executionOrder.includes(dep)) executionOrder.push(dep);
    }
    executionOrder.push(node);
    return node;
  };
  visit(rootTask, 0);
  return { root: nodes.get(rootTask.label), executionOrder };
}

function makeBadRequest(message) {
  const error = new Error(message);
  error.name = 'BAD_REQUEST';
  return error;
}

class Job {
  constructor(id, task, source, matchers, options = {}) {
    this.job_id = id;
    this.label = task.label;
    this.command = task.command === '(compound)' ? '(compound)' : resolveCommand(task.type, task.command);
    this.args = [...(task.args ?? [])];
    this.source = source;
    this.matchers = matchers;
    this.sessions = matchers.map(matcher => new MatcherSession(matcher));
    this.rawProblems = matchers.map(() => []);
    this.rawKeys = matchers.map(() => new Set());
    this.bufferLines = [];
    this.child = null;
    this.status = 'running';
    this.exitCode = null;
    this.startedAt = Date.now();
    this.endedAt = null;
    this.stoppedByUser = false;
    this.finalized = false;
    this.forceKillTimer = null;
    this.isCompound = options.isCompound === true;
    this.parentJobId = options.parentJobId ?? null;
    this.namePath = options.namePath ?? null;
    this.failedDependency = null;
    this.doneResolve = null;
    this.done = new Promise(resolve => { this.doneResolve = resolve; });
  }

  collectLine(line) {
    if (this.sessions.length === 0) return;
    this.bufferLines.push(line);
    if (this.bufferLines.length > MAX_BUFFER_LINES) this.bufferLines.shift();
    this.sessions.forEach((session, index) => {
      for (const problem of session.push(line)) {
        const key = `${problem.file}|${problem.line}|${problem.column}|${problem.message}`;
        if (!this.rawKeys[index].has(key)) {
          this.rawKeys[index].add(key);
          this.rawProblems[index].push(problem);
        }
      }
    });
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
      endedAt: this.endedAt,
      parent_job_id: this.parentJobId,
      name_path: this.namePath,
      failed_dependency: this.failedDependency
    };
  }

  finish(status, exitCode) {
    if (this.finalized) return;
    this.finalized = true;
    this.status = status;
    this.exitCode = exitCode;
    this.endedAt = Date.now();
    this.doneResolve();
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

  async loadWorkspaceMatchers() {
    try {
      const raw = await fs.readFile(path.join(this.workspace, WORKSPACE_MATCHERS_FILE), 'utf8');
      const parsed = JSON.parse(raw);
      return isPlainObject(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  async listMatchers() {
    const extra = await this.loadWorkspaceMatchers();
    const merged = { ...BUILTIN_MATCHERS };
    for (const [key, value] of Object.entries(extra)) {
      if (isPlainObject(value)) merged[key] = { name: typeof value.name === 'string' && value.name ? value.name : key, owner: value.owner ?? key, ...value };
    }
    return { matchers: Object.values(merged).map(matcher => ({ name: matcher.name, owner: matcher.owner })) };
  }

  async findTask(label) {
    const { tasks } = await this.list();
    return tasks.find(task => task.label === label) ?? null;
  }

  async resolveJobMatcher(task) {
    if (task.problemMatcher === undefined || task.problemMatcher === null) return [];
    const extra = await this.loadWorkspaceMatchers();
    const references = Array.isArray(task.problemMatcher) ? task.problemMatcher : [task.problemMatcher];
    try {
      return references.map(reference => resolveProblemMatcher(reference, extra));
    } catch (error) {
      if (error instanceof MatcherError) {
        const wrapped = new Error(error.message);
        wrapped.name = 'BAD_REQUEST';
        throw wrapped;
      }
      throw error;
    }
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
    if (task.dependsOn !== undefined) return this.runCompound(task);
    return this.runSingle(task);
  }

  async runSingle(task) {
    const id = crypto.randomUUID();
    const matchers = await this.resolveJobMatcher(task);
    const job = new Job(id, task, task.source ?? 'tasks.json', matchers);
    this.jobs.set(id, job);
    try {
      await this.spawnLeafJob(job);
    } catch (error) {
      this.jobs.delete(id);
      throw error;
    }
    return { job_id: id };
  }

  async runCompound(rootTask) {
    const file = await this.loadTasksFile();
    if (!file) {
      const error = new Error(`compound task "${rootTask.label}" requires a tasks.json file`);
      error.name = 'BAD_REQUEST';
      throw error;
    }
    let plan;
    try {
      plan = resolveDepPlan(file.tasks, rootTask);
    } catch (error) {
      if (error instanceof TaskFileError) throw makeBadRequest(error.message);
      throw error;
    }
    const id = crypto.randomUUID();
    const coordinator = new Job(id, { ...rootTask, command: '(compound)', args: [] }, 'tasks.json', [], { isCompound: true });
    this.jobs.set(id, coordinator);
    this.onEvent({ event: 'started', job_id: id, label: coordinator.label, parent_job_id: null, name_path: rootTask.label });
    void this.executePlan(plan, coordinator, rootTask.label).catch(() => {});
    return { job_id: id };
  }

  async executePlan(plan, coordinator, rootLabel) {
    let ok = false;
    try {
      ok = await this.executeNode(plan.root, coordinator, [rootLabel]);
    } catch {
      ok = false;
    } finally {
      if (!coordinator.finalized) {
        coordinator.finish(ok ? 'exited' : 'failed', ok ? 0 : null);
        this.onEvent({
          event: 'exit',
          job_id: coordinator.job_id,
          label: coordinator.label,
          exitCode: coordinator.exitCode,
          signal: null,
          parent_job_id: null,
          name_path: rootLabel,
          ...(coordinator.failedDependency ? { failed_dependency: coordinator.failedDependency } : {})
        });
      }
    }
  }

  async executeNode(node, coordinator, pathLabels) {
    const order = node.task.dependsOrder === 'parallel' ? 'parallel' : 'sequence';
    if (node.deps.length > 0) {
      if (order === 'sequence') {
        for (const dep of node.deps) {
          const ok = await this.executeNode(dep, coordinator, [...pathLabels, dep.task.label]);
          if (!ok) {
            if (coordinator.failedDependency === null) coordinator.failedDependency = dep.task.label;
            await this.killRunningDescendants(coordinator.job_id);
            return false;
          }
        }
      } else {
        let cleanup = null;
        const results = await Promise.all(
          node.deps.map(dep =>
            this.executeNode(dep, coordinator, [...pathLabels, dep.task.label]).then(ok => {
              if (!ok) {
                if (coordinator.failedDependency === null) coordinator.failedDependency = dep.task.label;
                cleanup = this.killRunningDescendants(coordinator.job_id);
              }
              return ok;
            })
          )
        );
        await (cleanup ?? Promise.resolve());
        if (!results.every(Boolean)) return false;
      }
    }
    return this.executeLeaf(node.task, coordinator, pathLabels.join(' > '));
  }

  async executeLeaf(task, coordinator, namePath) {
    const id = crypto.randomUUID();
    const matchers = await this.resolveJobMatcher(task);
    const job = new Job(id, task, task.source ?? 'tasks.json', matchers, { parentJobId: coordinator.job_id, namePath });
    this.jobs.set(id, job);
    try {
      await this.spawnLeafJob(job);
    } catch (error) {
      this.jobs.delete(id);
      this.onEvent({
        event: 'output',
        job_id: id,
        label: task.label,
        stream: 'stderr',
        line: `spawn failed: ${error.message}`
      });
      if (coordinator.failedDependency === null) coordinator.failedDependency = task.label;
      return false;
    }

    const wantsBackgroundReadiness = task.isBackground === true && job.sessions.some(session => session.background !== null);
    if (wantsBackgroundReadiness) {
      const ready = await this.waitBackgroundReady(job);
      if (ready === true) return true;
      if (ready === 'timeout') {
        await this.terminateAsStopped(job);
        if (coordinator.failedDependency === null) coordinator.failedDependency = task.label;
        return false;
      }
      return job.exitCode === 0;
    }
    if (task.isBackground === true) {
      this.onEvent({
        event: 'output',
        job_id: id,
        label: task.label,
        stream: 'stderr',
        line: '[aide] background dependency has no background problemMatcher; treating exit as readiness'
      });
    }
    await job.done;
    return job.exitCode === 0 && (job.status === 'exited');
  }

  async waitBackgroundReady(job) {
    const deadline = Date.now() + BACKGROUND_READY_TIMEOUT_MS;
    return await new Promise(resolve => {
      const timer = setInterval(() => {
        if (job.sessions.some(session => session.isBackgroundReady())) {
          clearInterval(timer);
          resolve(true);
          return;
        }
        if (job.finalized || Date.now() > deadline) {
          clearInterval(timer);
          resolve(job.finalized ? false : 'timeout');
        }
      }, BACKGROUND_READY_POLL_MS);
    });
  }

  isDescendantOf(job, ancestorId) {
    let current = job;
    const seen = new Set();
    while (current.parentJobId !== null) {
      if (current.parentJobId === ancestorId) return true;
      if (seen.has(current.parentJobId)) return false;
      seen.add(current.parentJobId);
      const next = this.jobs.get(current.parentJobId);
      if (!next) return false;
      current = next;
    }
    return false;
  }

  async killRunningDescendants(ancestorId) {
    for (const job of [...this.jobs.values()]) {
      if (job.status === 'running' && this.isDescendantOf(job, ancestorId)) {
        await this.terminateAsStopped(job);
      }
    }
  }

  async terminateAsStopped(job) {
    if (job.finalized || job.status !== 'running') return;
    job.stoppedByUser = true;
    job.finish('stopped', null);
    await this.killTree(job.child);
    this.onEvent({
      event: 'exit',
      job_id: job.job_id,
      label: job.label,
      exitCode: null,
      signal: 'SIGTERM',
      parent_job_id: job.parentJobId,
      name_path: job.namePath
    });
  }

  async spawnLeafJob(job) {
    const id = job.job_id;
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
      error.name = 'BAD_REQUEST';
      throw error;
    }
    job.child = child;
    this.onEvent({ event: 'started', job_id: id, label: job.label, parent_job_id: job.parentJobId, name_path: job.namePath });

    const attach = (streamName, stream) => {
      let pending = '';
      stream.setEncoding('utf8');
      stream.on('data', chunk => {
        pending += chunk;
        let newlineIndex = pending.indexOf('\n');
        while (newlineIndex !== -1) {
          const line = truncateLine(pending.slice(0, newlineIndex).replace(/\r$/, ''));
          pending = pending.slice(newlineIndex + 1);
          job.collectLine(line);
          this.onEvent({ event: 'output', job_id: id, label: job.label, stream: streamName, line });
          newlineIndex = pending.indexOf('\n');
        }
        if (pending.length > MAX_LINE_LENGTH) {
          const line = truncateLine(pending);
          job.collectLine(line);
          this.onEvent({ event: 'output', job_id: id, label: job.label, stream: streamName, line });
          pending = '';
        }
      });
      stream.on('end', () => {
        if (pending.length > 0) {
          const line = truncateLine(pending.replace(/\r$/, ''));
          job.collectLine(line);
          this.onEvent({ event: 'output', job_id: id, label: job.label, stream: streamName, line });
        }
      });
    };
    attach('stdout', child.stdout);
    attach('stderr', child.stderr);

    child.on('error', error => {
      if (job.finalized) return;
      child.stdout?.destroy();
      child.stderr?.destroy();
      job.finish('failed', null);
      this.emitProblems(job);
      this.onEvent({ event: 'output', job_id: id, label: job.label, stream: 'stderr', line: `spawn failed: ${error.message}` });
      this.onEvent({
        event: 'exit',
        job_id: id,
        label: job.label,
        exitCode: null,
        signal: null,
        parent_job_id: job.parentJobId,
        name_path: job.namePath
      });
    });

    child.on('close', (code, signal) => {
      if (job.forceKillTimer) clearTimeout(job.forceKillTimer);
      child.stdout?.destroy();
      child.stderr?.destroy();
      if (job.finalized) return;
      const status = job.stoppedByUser ? 'stopped' : code === 0 ? 'exited' : 'failed';
      job.finish(status, code);
      this.emitProblems(job);
      this.onEvent({
        event: 'exit',
        job_id: id,
        label: job.label,
        exitCode: code,
        signal: signal ?? null,
        parent_job_id: job.parentJobId,
        name_path: job.namePath
      });
    });
  }

  emitProblems(job) {
    if (job.matchers.length === 0) return;
    const fullText = job.bufferLines.join('\n');
    job.matchers.forEach((matcher, index) => {
      for (const problem of extractRawProblems(matcher, fullText)) {
        const key = `${problem.file}|${problem.line}|${problem.column}|${problem.message}`;
        if (!job.rawKeys[index].has(key)) {
          job.rawKeys[index].add(key);
          job.rawProblems[index].push(problem);
        }
      }
    });
    const merged = [];
    const seen = new Set();
    job.matchers.forEach((matcher, index) => {
      const { problems } = resolveRawProblems(matcher, job.rawProblems[index], {
        workspaceRoot: this.workspace,
        cwd: this.workspace
      });
      for (const problem of problems) {
        const key = `${problem.file}|${problem.line}|${problem.column}|${problem.message}`;
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(problem);
        }
      }
    });
    this.onEvent({ event: 'problems', job_id: job.job_id, label: job.label, problems: merged });
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
    await this.terminateAsStopped(job);
    await this.killRunningDescendants(jobId);
  }

  killTree(child) {
    return new Promise(resolve => {
      const finish = () => {
        try { child?.stdout?.destroy(); } catch { /* already gone */ }
        try { child?.stderr?.destroy(); } catch { /* already gone */ }
        resolve();
      };
      if (!child || child.exitCode !== null || child.signalCode !== null) {
        finish();
        return;
      }
      if (path.sep === '\\') {
        execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
      } else {
        child.kill('SIGTERM');
      }
      jobForceKill(child);
      child.once('close', finish);
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

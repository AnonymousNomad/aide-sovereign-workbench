import { spawn } from 'node:child_process';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { buildToastScript } from './os-toast.mjs';

const HOOK_EVENTS = new Set(['task.started', 'task.completed', 'task.failed', 'diagnostics.new']);
const NETWORK_TOKENS = ['http://', 'https://', 'curl', 'wget', 'invoke-webrequest', 'iwr ', 'nc ', 'telnet'];
const MAX_NOTIFICATIONS = 200;
const COALESCE_MS = 2000;
const HOOK_OUTPUT_CAP = 4096;
const DEFAULT_HOOK_TIMEOUT = 10000;

export class HookValidationError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'HOOK_VALIDATION';
    this.detail = detail;
  }
}

export function normalizeHooksFile(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HookValidationError('hooks file must be an object');
  }
  if (!('hooks' in value)) {
    throw new HookValidationError('hooks file requires a hooks array');
  }
  if (!Array.isArray(value.hooks)) {
    throw new HookValidationError('hooks must be an array');
  }
  if (value.hooks.length > 32) {
    throw new HookValidationError('at most 32 hooks are allowed');
  }
  return { hooks: value.hooks.map(normalizeHook) };
}

function normalizeHook(value, index) {
  const where = `hooks[${index}]`;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HookValidationError(`${where} must be an object`);
  }
  for (const key of Object.keys(value)) {
    if (!['event', 'command', 'show', 'timeout_ms', 'network_consent'].includes(key)) {
      throw new HookValidationError(`${where} has unknown field "${key}"`);
    }
  }
  if (!HOOK_EVENTS.has(value.event)) {
    throw new HookValidationError(`${where}.event "${String(value.event)}" is not a known hook event`);
  }
  if (!Array.isArray(value.command) || value.command.length < 1 || value.command.length > 16) {
    throw new HookValidationError(`${where}.command must be a non-empty array of at most 16 strings`);
  }
  const command = value.command.map((part, partIndex) => {
    if (typeof part !== 'string' || part.length < 1) {
      throw new HookValidationError(`${where}.command[${partIndex}] must be a non-empty string`);
    }
    return part;
  });
  const joined = command.join(' ').toLowerCase();
  const networkSuspicious = NETWORK_TOKENS.some(token => joined.includes(token));
  if (networkSuspicious && value.network_consent !== true) {
    throw new HookValidationError(
      `${where}.command looks like a network command; set "network_consent": true after reviewing it`,
      { code: 'CONSENT_REQUIRED' }
    );
  }
  if (value.show !== undefined && typeof value.show !== 'boolean') {
    throw new HookValidationError(`${where}.show must be a boolean`);
  }
  if (value.network_consent !== undefined && typeof value.network_consent !== 'boolean') {
    throw new HookValidationError(`${where}.network_consent must be a boolean`);
  }
  if (value.timeout_ms !== undefined) {
    if (!Number.isInteger(value.timeout_ms) || value.timeout_ms < 100 || value.timeout_ms > 120000) {
      throw new HookValidationError(`${where}.timeout_ms must be an integer between 100 and 120000`);
    }
  }
  return {
    event: value.event,
    command,
    ...(value.show === undefined ? {} : { show: value.show }),
    ...(value.timeout_ms === undefined ? {} : { timeout_ms: value.timeout_ms }),
    ...(value.network_consent === undefined ? {} : { network_consent: value.network_consent })
  };
}

function isNetworkSuspicious(command) {
  return NETWORK_TOKENS.some(token => command.join(' ').toLowerCase().includes(token));
}

export class NotificationService {
  constructor({ workspace, onEvent, clock } = {}) {
    this.workspace = workspace;
    this.onEvent = typeof onEvent === 'function' ? onEvent : () => {};
    this.clock = clock ?? (() => Date.now());
    this.notifications = [];
    this.nextId = 1;
    this.hooks = [];
    this.osEnabled = false;
  }

  list({ unreadOnly = false } = {}) {
    const notifications = unreadOnly ? this.notifications.filter(item => !item.read) : this.notifications;
    return {
      notifications,
      unread: this.notifications.filter(item => !item.read).length
    };
  }

  record({ severity, source, title, body, job_id }) {
    const now = this.clock();
    const last = this.notifications[this.notifications.length - 1];
    if (
      last &&
      last.source === source &&
      last.title === title &&
      (last.body ?? '') === (body ?? '') &&
      now - last.created_at <= COALESCE_MS
    ) {
      return last;
    }
    const notification = {
      id: `n${this.nextId}`,
      severity,
      source,
      title,
      ...(body === undefined ? {} : { body }),
      ...(job_id === undefined ? {} : { job_id: String(job_id) }),
      created_at: now,
      read: false
    };
    this.nextId += 1;
    this.notifications.push(notification);
    if (this.notifications.length > MAX_NOTIFICATIONS) {
      this.notifications.splice(0, this.notifications.length - MAX_NOTIFICATIONS);
    }
    this.onEvent(notification);
    return notification;
  }

  markRead(id) {
    const found = this.notifications.find(item => item.id === id);
    if (!found) return null;
    found.read = true;
    return found;
  }

  markAllRead() {
    let count = 0;
    for (const item of this.notifications) {
      if (!item.read) {
        item.read = true;
        count += 1;
      }
    }
    return count;
  }

  async loadHooks() {
    const raw = await fs.readFile(path.join(this.workspace, '.aide', 'hooks.json'), 'utf8').catch(() => null);
    if (raw === null) {
      this.hooks = [];
      return this.hooks;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new HookValidationError(`.aide/hooks.json is not valid JSON: ${error.message}`);
    }
    this.hooks = normalizeHooksFile(parsed).hooks;
    return this.hooks;
  }

  setHooks(hooksValue) {
    this.hooks = normalizeHooksFile(hooksValue).hooks;
    return this.hooks;
  }

  listHooks() {
    return { hooks: this.hooks };
  }

  ingestTaskEvent(evt) {
    if (!evt || typeof evt !== 'object') return;
    const label = evt.label ?? evt.job_id ?? 'task';
    if (evt.event === 'started') {
      void this.runHooks('task.started', { label, job_id: evt.job_id });
      return;
    }
    if (evt.event === 'exit') {
      const exitInfo = evt.exitCode === null && evt.signal ? `signal ${evt.signal}` : `exit code ${evt.exitCode}`;
      if (evt.exitCode === 0) {
        this.record({
          severity: 'success',
          source: 'task',
          title: `Task "${label}" passed`,
          body: exitInfo,
          job_id: evt.job_id
        });
        void this.runHooks('task.completed', { label, job_id: evt.job_id, exit_code: evt.exitCode });
      } else if (evt.exitCode === null && evt.signal) {
        this.record({
          severity: 'warn',
          source: 'task',
          title: `Task "${label}" stopped`,
          body: exitInfo,
          job_id: evt.job_id
        });
      } else {
        this.record({
          severity: 'error',
          source: 'task',
          title: `Task "${label}" failed`,
          body: exitInfo,
          job_id: evt.job_id
        });
        void this.runHooks('task.failed', { label, job_id: evt.job_id, exit_code: evt.exitCode });
      }
      return;
    }
    if (evt.event === 'problems') {
      const count = Array.isArray(evt.problems) ? evt.problems.length : 0;
      if (count > 0) {
        void this.runHooks('diagnostics.new', { label, job_id: evt.job_id, count });
      }
    }
  }

  async runHooks(eventName, context = {}) {
    const matching = this.hooks.filter(hook => hook.event === eventName);
    const results = [];
    for (let index = 0; index < matching.length; index += 1) {
      const hook = matching[index];
      if (isNetworkSuspicious(hook.command) && hook.network_consent !== true) {
        results.push({ hook_index: index, ok: false, rejected: 'CONSENT_REQUIRED', output: '' });
        continue;
      }
      const result = await this.runHookCommand(hook);
      results.push({ hook_index: index, ...result });
      if (hook.show) {
        this.record({
          severity: result.ok ? 'info' : 'warn',
          source: 'hook',
          title: result.timed_out
            ? `Hook timed out (${eventName})`
            : result.ok
              ? `Hook ran (${eventName})`
              : `Hook failed (${eventName})`,
          body: result.output ? result.output.slice(0, 2000) : undefined
        });
      }
    }
    return results;
  }

  runHookCommand(hook) {
    const timeoutMs = hook.timeout_ms ?? DEFAULT_HOOK_TIMEOUT;
    return new Promise(resolve => {
      let child;
      try {
        child = spawn(hook.command[0], hook.command.slice(1), {
          cwd: this.workspace,
          env: { PATH: process.env.PATH, HOME: process.env.HOME },
          stdio: ['ignore', 'pipe', 'pipe']
        });
      } catch (error) {
        resolve({ ok: false, timed_out: false, output: error.message.slice(0, HOOK_OUTPUT_CAP) });
        return;
      }
      let output = '';
      let settled = false;
      const collect = chunk => {
        if (output.length < HOOK_OUTPUT_CAP) output += chunk.toString('utf8');
        if (output.length > HOOK_OUTPUT_CAP) output = output.slice(0, HOOK_OUTPUT_CAP);
      };
      child.stdout?.on('data', collect);
      child.stderr?.on('data', collect);
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          if (process.platform === 'win32' && child.pid) {
            spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
          } else {
            child.kill('SIGKILL');
          }
        } catch {}
        resolve({ ok: false, timed_out: true, output: output.slice(0, HOOK_OUTPUT_CAP) });
      }, timeoutMs);
      child.on('error', error => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, timed_out: false, output: error.message.slice(0, HOOK_OUTPUT_CAP) });
      });
      child.on('close', code => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: code === 0, timed_out: false, output: output.slice(0, HOOK_OUTPUT_CAP) });
      });
    });
  }

  setOsEnabled(value) {
    this.osEnabled = value === true;
  }

  async maybeShowOsToast({ title, body }) {
    if (!this.osEnabled) return { shown: false, reason: 'disabled' };
    try {
      const { spawn: spawnChild } = await import('node:child_process');
      const script = buildToastScript({ title, body: body ?? '' });
      const child = spawnChild('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        stdio: 'ignore',
        windowsHide: true
      });
      const done = await new Promise(resolve => {
        const t = setTimeout(() => resolve(false), 5000);
        child.on('close', () => {
          clearTimeout(t);
          resolve(true);
        });
        child.on('error', () => {
          clearTimeout(t);
          resolve(false);
        });
      });
      return { shown: done, reason: done ? 'ok' : 'spawn-failed' };
    } catch {
      return { shown: false, reason: 'toast-error' };
    }
  }
}

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { encodeJsonRpc, JsonRpcDecoder } from './jsonrpc.ts';
import type { DapAdapterEntryT, DapAdapterStateT, DapBreakpointEntryT, DapStackFrameT, DapScopeEntryT, DapVariableEntryT } from '../../../common/contracts/dap.ts';

export interface DapAdapterConfig {
  id: string;
  name: string;
  command: string;
  args?: string[];
  languages: string[];
}

interface PendingRequest {
  resolve: (message: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface DapManagerOptions {
  workspace: string;
  adapters: DapAdapterConfig[];
  requestTimeoutMs?: number;
  logger?: { error(msg: string, meta?: Record<string, unknown>): void; warn(msg: string, meta?: Record<string, unknown>): void; info(msg: string, meta?: Record<string, unknown>): void } | undefined;
  spawnChild?: typeof spawn;
  onEvent?: (adapterId: string, event: string, body: unknown) => void;
}

function resolveCommand(command: string): string {
  if (path.isAbsolute(command)) return command;
  if (command.includes('/') || command.includes(path.sep)) return path.resolve(command);
  return command;
}

export class DapManager {
  private readonly workspace: string;
  private readonly requestTimeoutMs: number;
  private readonly logger: DapManagerOptions['logger'];
  private readonly spawnChild: typeof spawn;
  private readonly onEvent: NonNullable<DapManagerOptions['onEvent']>;

  private readonly states = new Map<string, DapAdapterStateT>();
  private readonly capabilities = new Map<string, Record<string, boolean>>();
  private readonly children = new Map<string, ChildProcess>();
  private readonly decoders = new Map<string, JsonRpcDecoder>();
  private readonly pending = new Map<string, PendingRequest>();
  private readonly nextId: () => number;
  private readonly adapters: DapAdapterConfig[];

  constructor(options: DapManagerOptions) {
    this.adapters = options.adapters;
    this.workspace = options.workspace;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 15000;
    this.logger = options.logger;
    this.spawnChild = options.spawnChild ?? spawn;
    this.onEvent = options.onEvent ?? (() => {});
    for (const adapter of options.adapters) {
      this.states.set(adapter.id, existsSync(resolveCommand(adapter.command)) ? 'available' : 'not_found');
    }
    let id = 0;
    this.nextId = () => ++id;
  }

  private adapter(id: string): DapAdapterConfig | undefined {
    return this.adapters.find(adapter => adapter.id === id);
  }

  status(): DapAdapterEntryT[] {
    return this.adapters.map(adapter => ({
      id: adapter.id,
      name: adapter.name,
      languages: adapter.languages,
      status: this.states.get(adapter.id) ?? 'available',
      capabilities: this.capabilities.get(adapter.id) ?? {}
    }));
  }

  adapterStatus(id: string): DapAdapterEntryT | undefined {
    return this.status().find(entry => entry.id === id);
  }

  async start(id: string): Promise<DapAdapterStateT> {
    const current = this.states.get(id);
    if (current === 'running' || current === 'starting') return current;
    const adapter = this.adapter(id);
    if (adapter === undefined) throw new Error(`debug adapter is not allowlisted: ${id}`);
    const command = resolveCommand(adapter.command);
    if (!existsSync(command)) {
      this.states.set(id, 'not_found');
      throw new Error(`debug adapter entry not found: ${command}`);
    }
    this.states.set(id, 'starting');
    this.logger?.info('dap adapter starting', { id, command });
    const child = this.spawnChild(command, adapter.args ?? [], {
      cwd: this.workspace,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    this.children.set(id, child);
    child.stdin?.on('error', () => {});
    const decoder = new JsonRpcDecoder();
    this.decoders.set(id, decoder);
    child.stdout?.on('data', chunk => this.consume(id, chunk));
    child.stderr?.on('data', chunk => this.logger?.warn('dap adapter stderr', { id, line: String(chunk).slice(0, 400) }));
    child.once('exit', (code, signal) => {
      this.logger?.warn('dap adapter exited', { id, code, signal });
      this.children.delete(id);
      this.decoders.delete(id);
      for (const key of [...this.pending.keys()]) {
        if (!key.startsWith(`${id}:`)) continue;
        const entry = this.pending.get(key);
        if (entry) {
          clearTimeout(entry.timer);
          entry.reject(new Error(`debug adapter exited before responding: ${id}`));
        }
        this.pending.delete(key);
      }
      if (this.states.get(id) !== 'stopped') this.states.set(id, 'error');
    });
    child.once('error', error => {
      this.logger?.warn('dap adapter spawn error', { id, message: error.message });
      this.states.set(id, 'error');
    });
    try {
      const response = await this.request(id, 'initialize', {
        adapterID: 'aide',
        clientID: 'aide',
        supportsVariablePaging: false,
        supportsRunInTerminalRequest: false
      });
      const capabilities = (response as { body?: { capabilities?: Record<string, boolean> } }).body?.capabilities ?? {};
      this.capabilities.set(id, capabilities);
      this.states.set(id, 'running');
      return 'running';
    } catch (error) {
      this.states.set(id, 'error');
      throw error;
    }
  }

  private ensureRunning(id: string): ChildProcess {
    const child = this.children.get(id);
    if (!child) throw new Error('debug adapter is not running');
    if (this.states.get(id) === 'error') throw new Error('debug adapter has crashed');
    return child;
  }

  async setBreakpoints(id: string, filePath: string, lines: number[]): Promise<DapBreakpointEntryT[]> {
    this.ensureRunning(id);
    const absolute = this.toWorkspacePath(filePath);
    const response = await this.request(id, 'setBreakpoints', {
      source: { path: absolute },
      breakpoints: lines.map(line => ({ line }))
    });
    const entries = (response as { body?: { breakpoints?: Array<{ line?: number; verified?: boolean; message?: string }> } }).body?.breakpoints ?? [];
    return entries.map(entry => {
      const breakpoint: DapBreakpointEntryT = {
        line: entry.line ?? 0,
        verified: entry.verified === true
      };
      if (entry.message !== undefined) breakpoint.message = entry.message;
      return breakpoint;
    });
  }

  async configure(id: string): Promise<void> {
    this.ensureRunning(id);
    await this.request(id, 'configurationDone', {});
  }

  async launch(id: string, program: string, args: string[], cwd?: string): Promise<void> {
    this.ensureRunning(id);
    const programPath = this.toWorkspacePath(program);
    const cwdPath = cwd === undefined ? this.workspace : this.toWorkspacePath(cwd);
    const adapterType = this.adapter(id)?.languages[0] ?? 'aide';
    await this.request(id, 'launch', {
      request: 'launch',
      type: adapterType,
      program: programPath,
      args,
      cwd: cwdPath,
      console: 'internalConsole'
    });
  }

  async continue(id: string, threadId: number): Promise<void> {
    this.ensureRunning(id);
    await this.request(id, 'continue', { threadId });
  }

  async step(id: string, threadId: number, kind: 'next' | 'stepIn' | 'stepOut'): Promise<void> {
    this.ensureRunning(id);
    await this.request(id, kind, { threadId });
  }

  async stack(id: string, threadId: number): Promise<DapStackFrameT[]> {
    this.ensureRunning(id);
    const response = await this.request(id, 'stackTrace', { threadId, startFrame: 0, levels: 20 });
    const frames = (response as { body?: { stackFrames?: Array<{ id?: number; name?: string; line?: number; source?: { path?: string } }> } }).body?.stackFrames ?? [];
    return frames.map(frame => ({
      id: frame.id ?? 0,
      name: frame.name ?? 'unknown',
      line: frame.line ?? 0,
      path: frame.source?.path
    }));
  }

  async scopes(id: string, frameId: number): Promise<DapScopeEntryT[]> {
    this.ensureRunning(id);
    const response = await this.request(id, 'scopes', { frameId });
    const scopes = (response as { body?: { scopes?: Array<{ name?: string; variablesReference?: number }> } }).body?.scopes ?? [];
    return scopes.map(scope => ({
      name: scope.name ?? 'scope',
      variablesReference: scope.variablesReference ?? 0
    }));
  }

  async variables(id: string, variablesReference: number): Promise<DapVariableEntryT[]> {
    this.ensureRunning(id);
    const response = await this.request(id, 'variables', { variablesReference });
    const variables = (response as { body?: { variables?: Array<{ name?: string; value?: string; variablesReference?: number }> } }).body?.variables ?? [];
    return variables.map(variable => ({
      name: variable.name ?? '',
      value: variable.value ?? '',
      variablesReference: variable.variablesReference
    }));
  }

  async disconnect(id: string): Promise<void> {
    const child = this.children.get(id);
    if (!child) return;
    try {
      await this.request(id, 'disconnect', { terminateDebuggee: true });
    } catch {
      // adapter may already be gone; kill below
    }
    await this.stop(id);
  }

  async stop(id: string): Promise<void> {
    const child = this.children.get(id);
    if (!child) return;
    const waitExit = new Promise<void>(resolve => {
      if (child.exitCode !== null) resolve();
      else child.once('exit', () => resolve());
    });
    if (child.exitCode === null) child.kill('SIGTERM');
    await Promise.race([waitExit, new Promise<void>(resolve => setTimeout(resolve, 2000))]);
    if (child.exitCode === null) child.kill('SIGKILL');
    this.children.delete(id);
    this.decoders.delete(id);
    this.states.set(id, 'stopped');
    this.logger?.info('dap adapter stopped', { id });
  }

  async stopAll(): Promise<void> {
    for (const id of [...this.children.keys()]) await this.disconnect(id);
  }

  request(id: string, command: string, arguments_: unknown, timeoutMs?: number): Promise<unknown> {
    const child = this.children.get(id);
    if (!child) return Promise.reject(new Error('debug adapter is not running'));
    const seq = this.nextId();
    child.stdin?.write(encodeJsonRpc({ seq, type: 'request', command, arguments: arguments_ }));
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(`${id}:${seq}`);
        reject(new Error(`DAP request timed out: ${command}`));
      }, timeoutMs ?? this.requestTimeoutMs);
      this.pending.set(`${id}:${seq}`, { resolve, reject, timer });
    });
  }

  private consume(id: string, chunk: Buffer): void {
    const decoder = this.decoders.get(id);
    if (!decoder) return;
    let messages: unknown[];
    try {
      messages = decoder.push(chunk);
    } catch (error) {
      this.logger?.warn('dap framing error', { id, message: (error as Error).message });
      return;
    }
    for (const message of messages) {
      const record = message as { type?: string; event?: string; body?: unknown; request_seq?: number; success?: boolean; error?: unknown };
      if (record.type === 'event' && record.event !== undefined) {
        this.onEvent(id, record.event, record.body ?? {});
        continue;
      }
      if (record.type === 'response' && record.request_seq !== undefined) {
        const key = `${id}:${record.request_seq}`;
        const entry = this.pending.get(key);
        if (entry) {
          clearTimeout(entry.timer);
          this.pending.delete(key);
          if (record.success === false) entry.reject(new Error(String((record as { message?: string }).message ?? JSON.stringify(record.error ?? 'dap request failed'))));
          else entry.resolve(record);
        }
      }
    }
  }

  private toWorkspacePath(requestPath: string): string {
    const absolute = path.isAbsolute(requestPath) ? requestPath : path.resolve(this.workspace, requestPath);
    const relative = path.relative(this.workspace, absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`path escapes workspace: ${requestPath}`);
    }
    return absolute;
  }
}
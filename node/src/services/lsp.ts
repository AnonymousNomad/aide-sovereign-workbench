import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { encodeJsonRpc, JsonRpcDecoder } from './jsonrpc.ts';
import type {
  LspStatusEntryT,
  LspServerStateT,
  LspPositionT,
  LspCompletionItemT,
  LspDefinitionLocationT
} from '../../../common/contracts/lsp.ts';

export interface LspDiagnostic {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  severity?: number;
  message: string;
}

interface PendingRequest {
  resolve: (message: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface LspManagerOptions {
  command: string;
  args?: string[];
  workspace: string;
  requestTimeoutMs?: number;
  logger?: { error(msg: string, meta?: Record<string, unknown>): void; warn(msg: string, meta?: Record<string, unknown>): void; info(msg: string, meta?: Record<string, unknown>): void } | undefined;
  spawnChild?: typeof spawn;
  onDiagnostics?: (uri: string, diagnostics: LspDiagnostic[]) => void;
  onStatusChange?: (languageId: string, status: LspServerStateT) => void;
}

const LANGUAGES = [
  { languageId: 'typescript', name: 'TypeScript' },
  { languageId: 'javascript', name: 'JavaScript' }
];

function toFileUri(workspace: string): string {
  return `file:///${workspace.replace(/\\/g, '/').replace(/ /g, '%20')}`;
}

function toAbsoluteUri(workspace: string, uri: string): string {
  if (/^file:\/\/\/[a-zA-Z]:/.test(uri)) return uri;
  const rel = decodeURIComponent(uri.replace(/^file:\/\//, '').replace(/^\//, ''));
  return toFileUri(path.resolve(workspace, rel));
}

function normalizeServerUri(uri: string): string {
  return uri.replace(/:/g, '%3A').toLowerCase().replace(/%3a/g, '%3A');
}

export class LspManager {
  private readonly command: string;
  private readonly args: string[];
  private readonly workspace: string;
  private readonly requestTimeoutMs: number;
  private readonly logger: LspManagerOptions['logger'];
  private readonly spawnChild: typeof spawn;
  private readonly onDiagnostics: NonNullable<LspManagerOptions['onDiagnostics']>;
  private readonly onStatusChange: NonNullable<LspManagerOptions['onStatusChange']>;

  private readonly states = new Map<string, LspServerStateT>();
  private readonly children = new Map<string, ChildProcess>();
  private readonly decoders = new Map<string, JsonRpcDecoder>();
  private readonly pending = new Map<string, PendingRequest>();
  private readonly openDocuments = new Map<string, string>();
  private readonly uriMap = new Map<string, string>();
  private readonly ready = new Set<string>();
  private readonly nextId: () => number;

  constructor(options: LspManagerOptions) {
    this.command = options.command;
    this.args = options.args ?? ['--stdio'];
    this.workspace = options.workspace;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 15000;
    this.logger = options.logger;
    this.spawnChild = options.spawnChild ?? spawn;
    this.onDiagnostics = options.onDiagnostics ?? (() => {});
    this.onStatusChange = options.onStatusChange ?? (() => {});
    let id = 0;
    this.nextId = () => ++id;
  }

  private setState(languageId: string, status: LspServerStateT): void {
    this.states.set(languageId, status);
    this.onStatusChange(languageId, status);
  }

  status(): LspStatusEntryT[] {
    const entryAvailable = existsSync(this.command);
    return LANGUAGES.map(language => ({
      languageId: language.languageId,
      name: language.name,
      status: entryAvailable ? (this.states.get(language.languageId) ?? 'available') : 'not_found'
    }));
  }

  async start(languageId: string): Promise<LspServerStateT> {
    const current = this.states.get(languageId);
    if (current === 'running' || current === 'starting') return current;
    if (!LANGUAGES.some(language => language.languageId === languageId)) {
      throw new Error(`language server is not allowlisted: ${languageId}`);
    }
    if (!existsSync(this.command)) {
      this.setState(languageId, 'not_found');
      throw new Error(`language server entry not found: ${this.command}`);
    }
    this.setState(languageId, 'starting');
    this.logger?.info('lsp server starting', { languageId, command: this.command });
    const child = this.spawnChild(process.execPath, [this.command, ...this.args], {
      cwd: this.workspace,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    this.children.set(languageId, child);
    const decoder = new JsonRpcDecoder();
    this.decoders.set(languageId, decoder);
    child.stdout?.on('data', chunk => this.consume(languageId, chunk));
    child.stderr?.on('data', chunk => this.logger?.warn('lsp server stderr', { languageId, line: String(chunk).slice(0, 400) }));
    child.once('exit', (code, signal) => {
      this.logger?.warn('lsp server exited', { languageId, code, signal });
      this.children.delete(languageId);
      this.decoders.delete(languageId);
      this.ready.delete(languageId);
      for (const key of [...this.pending.keys()]) {
        if (key.startsWith(`${languageId}:`)) {
          const entry = this.pending.get(key);
          if (entry) clearTimeout(entry.timer);
          this.pending.delete(key);
        }
      }
      if (this.states.get(languageId) !== 'stopped') this.setState(languageId, 'error');
    });
    child.once('error', error => {
      this.logger?.warn('lsp server spawn error', { languageId, message: error.message });
      this.setState(languageId, 'error');
    });
    try {
      await this.request(languageId, 'initialize', {
        processId: process.pid,
        rootUri: toFileUri(this.workspace),
        capabilities: {
          textDocument: {
            publishDiagnostics: {
              relatedInformation: true,
              codeDescription: true
            }
          }
        }
      });
      this.notify(languageId, 'initialized', {});
      this.ready.add(languageId);
      this.setState(languageId, 'running');
      return 'running';
    } catch (error) {
      this.setState(languageId, 'error');
      throw error;
    }
  }

  async didOpen(uri: string, languageId: string, text: string): Promise<void> {
    if (!this.ready.has(languageId)) await this.start(languageId);
    const absolute = toAbsoluteUri(this.workspace, uri);
    this.openDocuments.set(uri, languageId);
    this.uriMap.set(absolute, uri);
    this.uriMap.set(normalizeServerUri(absolute), uri);
    this.notify(languageId, 'textDocument/didOpen', {
      textDocument: { uri: absolute, languageId, version: 1, text }
    });
  }

  async didChange(uri: string, text: string, version: number): Promise<void> {
    const languageId = this.openDocuments.get(uri);
    if (languageId === undefined || !this.ready.has(languageId)) return;
    this.notify(languageId, 'textDocument/didChange', {
      textDocument: { uri: toAbsoluteUri(this.workspace, uri), version },
      contentChanges: [{ text }]
    });
  }

  async didClose(uri: string): Promise<void> {
    const languageId = this.openDocuments.get(uri);
    this.openDocuments.delete(uri);
    if (languageId === undefined || !this.ready.has(languageId)) return;
    this.notify(languageId, 'textDocument/didClose', { textDocument: { uri: toAbsoluteUri(this.workspace, uri) } });
    for (const [key, value] of this.uriMap) {
      if (value === uri) this.uriMap.delete(key);
    }
  }

  async completion(uri: string, position: LspPositionT): Promise<LspCompletionItemT[]> {
    const languageId = this.requireReady(uri);
    const response = await this.request(languageId, 'textDocument/completion', {
      textDocument: { uri: toAbsoluteUri(this.workspace, uri) },
      position
    });
    const result = (response as { result?: unknown }).result;
    const list = Array.isArray(result)
      ? result
      : (result as { items?: unknown } | null)?.items;
    if (!Array.isArray(list)) return [];
    return list.flatMap(item => {
      const record = item as { label?: string; kind?: number; detail?: string; insertText?: string; sortText?: string };
      if (record.label === undefined) return [];
      const entry: LspCompletionItemT = { label: record.label };
      if (record.kind !== undefined) entry.kind = record.kind;
      if (record.detail !== undefined) entry.detail = record.detail;
      if (record.insertText !== undefined) entry.insertText = record.insertText;
      if (record.sortText !== undefined) entry.sortText = record.sortText;
      return [entry];
    });
  }

  async hover(uri: string, position: LspPositionT): Promise<string> {
    const languageId = this.requireReady(uri);
    const response = await this.request(languageId, 'textDocument/hover', {
      textDocument: { uri: toAbsoluteUri(this.workspace, uri) },
      position
    });
    const result = (response as { result?: unknown }).result;
    if (result === null || result === undefined) return '';
    const flatten = (value: unknown): string => {
      if (typeof value === 'string') return value;
      if (Array.isArray(value)) return value.map(flatten).filter(part => part.length > 0).join('\n');
      if (typeof value === 'object' && value !== null) {
        const record = value as { value?: string; contents?: unknown; language?: string };
        if (typeof record.value === 'string') return record.value;
        if (record.contents !== undefined) return flatten(record.contents);
        return '';
      }
      return '';
    };
    return flatten(result);
  }

  async definition(uri: string, position: LspPositionT): Promise<LspDefinitionLocationT[]> {
    const languageId = this.requireReady(uri);
    const response = await this.request(languageId, 'textDocument/definition', {
      textDocument: { uri: toAbsoluteUri(this.workspace, uri) },
      position
    });
    return this.parseLocations(response);
  }

  private parseLocations(response: unknown): LspDefinitionLocationT[] {
    const result = (response as { result?: unknown }).result;
    if (result === null || result === undefined) return [];
    const locations = Array.isArray(result) ? result : [result];
    return locations.flatMap(location => {
      const record = location as { uri?: string; range?: { start?: { line?: number; character?: number }; end?: { line?: number; character?: number } } };
      if (record.uri === undefined || record.range === undefined) return [];
      const start = record.range.start;
      const end = record.range.end;
      if (start?.line === undefined || start.character === undefined || end?.line === undefined || end.character === undefined) return [];
      const original = this.uriMap.get(record.uri) ?? this.uriMap.get(normalizeServerUri(record.uri)) ?? record.uri;
      return [{
        uri: original,
        range: {
          start: { line: start.line, character: start.character },
          end: { line: end.line, character: end.character }
        }
      }];
    });
  }

  private requireReady(uri: string): string {
    const languageId = this.openDocuments.get(uri);
    if (languageId === undefined) throw new Error(`document is not open: ${uri}`);
    if (!this.ready.has(languageId)) throw new Error('language server is not ready');
    return languageId;
  }

  async stop(languageId: string): Promise<void> {
    if (!this.children.has(languageId) && !this.ready.has(languageId)) return;
    try {
      await this.request(languageId, 'shutdown', null, 2000);
    } catch {
      // server may already be gone; exit + kill below
    }
    try {
      this.notify(languageId, 'exit', {});
    } catch {
      // ignore
    }
    const child = this.children.get(languageId);
    if (child) {
      await new Promise(resolve => setTimeout(resolve, 500));
      if (child.exitCode === null) child.kill('SIGTERM');
      await Promise.race([
        new Promise<void>(resolve => child.once('exit', () => resolve())),
        new Promise<void>(resolve => setTimeout(resolve, 2000))
      ]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    this.ready.delete(languageId);
    this.setState(languageId, 'stopped');
    this.logger?.info('lsp server stopped', { languageId });
  }

  async stopAll(): Promise<void> {
    for (const languageId of [...this.ready]) await this.stop(languageId);
  }

  request(languageId: string, method: string, params: unknown, timeoutMs?: number): Promise<unknown> {
    const child = this.children.get(languageId);
    if (!child) return Promise.reject(new Error('language server is not running'));
    const id = this.nextId();
    child.stdin?.write(encodeJsonRpc({ jsonrpc: '2.0', id, method, params }));
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(`${languageId}:${id}`);
        reject(new Error(`LSP request timed out: ${method}`));
      }, timeoutMs ?? this.requestTimeoutMs);
      this.pending.set(`${languageId}:${id}`, { resolve, reject, timer });
    });
  }

  notify(languageId: string, method: string, params: unknown): void {
    const child = this.children.get(languageId);
    if (!child) throw new Error('language server is not running');
    child.stdin?.write(encodeJsonRpc({ jsonrpc: '2.0', method, params }));
  }

  private consume(languageId: string, chunk: Buffer): void {
    const decoder = this.decoders.get(languageId);
    if (!decoder) return;
    let messages: unknown[];
    try {
      messages = decoder.push(chunk);
    } catch (error) {
      this.logger?.warn('lsp framing error', { languageId, message: (error as Error).message });
      return;
    }
    for (const message of messages) {
      const record = message as { id?: unknown; method?: string; error?: unknown; result?: unknown; params?: { uri?: string; diagnostics?: LspDiagnostic[] } };
      if (record.method === 'textDocument/publishDiagnostics' && record.params?.uri !== undefined) {
        const original = this.uriMap.get(record.params.uri) ?? this.uriMap.get(normalizeServerUri(record.params.uri)) ?? record.params.uri;
        this.onDiagnostics(original, record.params.diagnostics ?? []);
        continue;
      }
      if (record.id !== undefined) {
        const key = `${languageId}:${record.id}`;
        const entry = this.pending.get(key);
        if (entry) {
          clearTimeout(entry.timer);
          this.pending.delete(key);
          if (record.error !== undefined) entry.reject(new Error(JSON.stringify(record.error)));
          else entry.resolve(record);
        }
      }
    }
  }
}
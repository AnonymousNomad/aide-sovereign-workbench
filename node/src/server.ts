import { type ZodTypeAny } from 'zod';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fail, ok, type ErrorCode } from '../../common/errors.ts';
import { Logger } from './services/logger.ts';
import { ProcessManager } from './services/process-manager.ts';
import { EventHub } from './events.ts';
import { buildRoutes, createLspManager, createDapManager, createModelRuntime } from './openapi.ts';
import { createExecutionAuthority, AuthorityError, type ExecutionAuthority, type ActorHandle, type AuthorityOperation, type ExecutionHandle } from './services/execution-authority.mjs';
import { createAuditTrail } from './services/audit-trail.mjs';
import { httpOperationKind, type OperationInput } from '../../common/security/operation-policy.mjs';
import { routesForAuthority } from './routes/authority.ts';
import { connectAuthorityChannel, type AuthorityPeer } from '../../common/security/authority-channel.mjs';

export class RouteError extends Error {
  readonly code: ErrorCode;
  readonly detail: unknown;

  constructor(code: ErrorCode, message: string, detail?: unknown) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

export interface RouteContext {
  query: Record<string, string>;
  body: unknown;
  actor?: ActorHandle;
  execution?: ExecutionHandle;
  authority?: ExecutionAuthority;
  origin?: string;
  prepareOperation?: (input: { adapter?: 'ts' | 'legacy' | undefined; method: string; path: string; task_id: string; body?: unknown }) => Promise<AuthorityOperation>;
}

export interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  prefix?: boolean;
  raw?: boolean;
  authorityMode?: 'pair' | 'control';
  query?: ZodTypeAny;
  body?: ZodTypeAny;
  response: ZodTypeAny;
  describeOperation?: (ctx: RouteContext, taskId: string) => Promise<OperationInput>;
  handler: (ctx: RouteContext) => Promise<unknown> | unknown;
  stream?: (ctx: RouteContext, res: http.ServerResponse) => Promise<void>;
}

export const MAX_BODY_BYTES = 5 * 1024 * 1024;

export class ArchServer {
  readonly authority: ExecutionAuthority;
  readonly logger: Logger;
  readonly processes: ProcessManager;
  readonly events: EventHub;
  readonly workspace: string;
  readonly logFile: string;
  private readonly routes: Route[] = [];
  private readonly shutdownHooks: Array<() => Promise<void>> = [];
  legacyDescribe?: (input: { method: string; path: string; task_id: string; body?: unknown }) => Promise<OperationInput>;

  constructor(workspace: string, logFile: string) {
    this.workspace = workspace;
    this.logFile = logFile;
    this.logger = new Logger(logFile);
    this.processes = new ProcessManager(this.logger);
    this.events = new EventHub(this.logger);
    const audit = createAuditTrail({ workspace: this.workspace });
    this.authority = createExecutionAuthority({ workspace: this.workspace, record: event => audit.emitAuthority(event) });
  }

  addShutdownHook(hook: () => Promise<void>): this {
    this.shutdownHooks.push(hook);
    return this;
  }

  route(route: Route): this {
    this.routes.push(route);
    return this;
  }

  getRoutes(): Route[] {
    return this.routes;
  }

  async listen(port: number, host = '127.0.0.1'): Promise<http.Server> {
    for (const route of routesForAuthority()) if (!this.match(route.method, route.path)) this.route(route);
    const server = http.createServer((request, response) => {
      void this.handle(request, response);
    });
    server.on('error', error => {
      this.logger.error('server error', { message: error.message });
    });
    this.events.attach(server, (token, origin) => {
      const actor = this.authority.authenticate(token, origin);
      return () => this.authority.assertActor(actor);
    });
    server.once('close', () => { this.events.close(); this.authority.control.close(); });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => resolve());
    });
    this.installShutdown(server);
    return server;
  }

  private async handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const started = Date.now();
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
    const route = this.match(request.method ?? 'GET', url.pathname);
    if (!route) {
      this.logger.warn('route not found', { method: request.method, path: url.pathname });
      this.events.publish('log', {
        level: 'warn',
        message: 'route not found',
        method: request.method,
        path: url.pathname
      });
      return this.send(response, 404, fail('NOT_FOUND', 'route not found'));
    }
    try {
      const origin = typeof request.headers.origin === 'string' ? request.headers.origin : '';
      const publicHealth = route.method === 'GET' && route.path === '/api/health';
      let actor: ActorHandle | undefined;
      if (!publicHealth && route.authorityMode !== 'pair') {
        const authorization = request.headers.authorization;
        if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) throw new RouteError('FORBIDDEN', 'authenticated actor required');
        actor = this.authority.authenticate(authorization.slice(7), origin);
      }
      const query: Record<string, string> = {};
      for (const [key, value] of url.searchParams) query[key] = value;
      const queryResult = route.query ? route.query.safeParse(query) : { success: true as const, data: query };
      if (!queryResult.success) throw new RouteError('BAD_REQUEST', 'invalid query parameters', queryResult.error.issues);
      const body = await this.readBody(request);
      const bodyResult = route.body ? route.body.safeParse(body) : { success: true as const, data: body };
      if (!bodyResult.success) throw new RouteError('BAD_REQUEST', 'invalid request body', bodyResult.error.issues);
      const context: RouteContext = { query: queryResult.data as Record<string, string>, body: bodyResult.data, authority: this.authority, origin,
        ...(actor ? { actor, prepareOperation: (input: { adapter?: 'ts' | 'legacy' | undefined; method: string; path: string; task_id: string; body?: unknown }) => this.prepareOperation(actor, input) } : {}) };
      const invoke = async () => route.stream ? route.stream(context, response) : route.handler(context);
      const dispatch = async () => {
        if (publicHealth || route.authorityMode) return invoke();
        if (!actor) throw new RouteError('FORBIDDEN', 'authenticated actor required');
        const input = await this.operationInput(route, url, context, String(request.headers['x-aide-task'] ?? `http:${actor.id}`));
        let id = request.headers['x-aide-operation'];
        if (input.kind.endsWith('.read')) {
          id = (await this.authority.prepare(actor, input)).operation_id;
        } else if (typeof id !== 'string') {
          throw new RouteError('NOT_READY', 'exact operation approval required', { reason: 'APPROVAL_REQUIRED', adapter: 'ts' });
        }
        return this.authority.execute(actor, String(id), input, async (_operation, execution) => {
          context.execution = execution;
          return invoke();
        });
      };
      if (route.stream !== undefined) {
        await dispatch();
        this.logger.info('stream ok', { method: request.method, path: url.pathname, ms: Date.now() - started });
        return;
      }
      const data = await dispatch();
      const responseResult = route.response.safeParse(data);
      if (!responseResult.success) {
        this.logger.error('handler produced a response that violates the contract', { route: route.path, issues: responseResult.error.issues });
        throw new RouteError('INTERNAL', 'response violates the contract');
      }
      if (route.raw) {
        this.logger.info('request ok', { method: request.method, path: url.pathname, ms: Date.now() - started });
        this.events.publish('log', { level: 'info', message: 'request ok', method: request.method, path: url.pathname, ms: Date.now() - started });
        return this.send(response, 200, responseResult.data);
      }
      this.logger.info('request ok', { method: request.method, path: url.pathname, ms: Date.now() - started });
      this.events.publish('log', { level: 'info', message: 'request ok', method: request.method, path: url.pathname, ms: Date.now() - started });
      return this.send(response, 200, ok(responseResult.data));
    } catch (error) {
      const code: ErrorCode = error instanceof RouteError ? error.code : error instanceof AuthorityError ? error.code as ErrorCode : 'INTERNAL';
      const message = error instanceof Error ? error.message : 'local daemon error';
      const detail = error instanceof RouteError || error instanceof AuthorityError ? error.detail : undefined;
      if (code === 'INTERNAL') {
        this.logger.error('request failed', { method: request.method, path: url.pathname, message, stack: (error as Error).stack });
        this.events.publish('log', { level: 'error', message: 'request failed', method: request.method, path: url.pathname, code });
      } else {
        this.logger.warn('request failed', { method: request.method, path: url.pathname, code, message });
        this.events.publish('log', { level: 'warn', message: 'request failed', method: request.method, path: url.pathname, code });
      }
      return this.send(response, this.httpStatus(code), fail(code, message, detail));
    }
  }

  private match(method: string, pathname: string): Route | undefined {
    return this.routes.find(route => route.method === method && (route.prefix ? pathname.startsWith(route.path) : pathname === route.path));
  }

  private async operationInput(route: Route, url: URL, context: RouteContext, taskId: string): Promise<OperationInput> {
    if (route.describeOperation) {
      try {
        return await route.describeOperation(context, taskId);
      } catch (error) {
        // Route-owned descriptors throw typed domain errors (name-tagged
        // ErrorCode) during description; keep their canonical status mapping
        // instead of collapsing client errors into INTERNAL.
        const name = (error as { name?: string } | null)?.name;
        if (name === 'NOT_FOUND' || name === 'BAD_REQUEST' || name === 'CONFLICT' || name === 'NOT_READY' || name === 'FORBIDDEN') {
          throw new RouteError(name, String((error as Error).message));
        }
        throw error;
      }
    }
    const kind = httpOperationKind(route.method, route.path);
    if (!kind) throw new RouteError('FORBIDDEN', 'capability has no authority policy');
    return { workspace: this.workspace, taskId, kind, args: JSON.parse(JSON.stringify({ method: route.method, path: url.pathname, query: context.query, body: context.body })) as unknown };
  }

  private async prepareOperation(actor: ActorHandle, input: { adapter?: 'ts' | 'legacy' | undefined; method: string; path: string; task_id: string; body?: unknown }): Promise<AuthorityOperation> {
    if (input.adapter === 'legacy') {
      if (!this.legacyDescribe) throw new RouteError('NOT_READY', 'legacy authority adapter unavailable');
      return this.authority.prepare(actor, await this.legacyDescribe(input));
    }
    if (!input.path.startsWith('/') || input.path.startsWith('//') || input.path.includes('#')) throw new RouteError('BAD_REQUEST', 'local API path required');
    const url = new URL(input.path, 'http://127.0.0.1');
    const route = this.match(input.method, url.pathname);
    if (!route || route.authorityMode) throw new RouteError('FORBIDDEN', 'operation target unavailable');
    const query = Object.fromEntries(url.searchParams);
    const queryResult = route.query ? route.query.safeParse(query) : { success: true as const, data: query };
    const bodyResult = route.body ? route.body.safeParse(input.body ?? {}) : { success: true as const, data: input.body ?? {} };
    if (!queryResult.success || !bodyResult.success) throw new RouteError('BAD_REQUEST', 'invalid operation parameters');
    return this.authority.prepare(actor, await this.operationInput(route, url, { query: queryResult.data as Record<string, string>, body: bodyResult.data }, input.task_id));
  }

  private async readBody(request: http.IncomingMessage): Promise<unknown> {
    let data = '';
    for await (const chunk of request) {
      data += chunk;
      if (Buffer.byteLength(data) > MAX_BODY_BYTES) throw new RouteError('PAYLOAD_TOO_LARGE', 'request body exceeds limit');
    }
    return data ? JSON.parse(data) : {};
  }

  private httpStatus(code: ErrorCode): number {
    switch (code) {
      case 'BAD_REQUEST':
      case 'PAYLOAD_TOO_LARGE':
        return 400;
      case 'FORBIDDEN':
        return 403;
      case 'NOT_FOUND':
        return 404;
      case 'CONFLICT':
      case 'NOT_READY':
        return 409;
      case 'TIMEOUT':
      case 'CHILD_FAILED':
        return 504;
      default:
        return 500;
    }
  }

  private send(response: http.ServerResponse, status: number, body: unknown): void {
    const payload = JSON.stringify(body);
    response.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(payload)
    });
    response.end(payload);
  }

  private installShutdown(server: http.Server): void {
    let shuttingDown = false;
    const shutdown = (signal: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      this.logger.info('shutdown started', { signal });
      server.close(async () => {
        await this.runShutdownHooks();
        await this.processes.shutdownAll();
        await this.logger.flush();
        process.exit(0);
      });
      setTimeout(async () => {
        await this.runShutdownHooks();
        await this.processes.shutdownAll();
        await this.logger.flush();
        process.exit(1);
      }, 5000).unref();
    };
    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));
  }

  private async runShutdownHooks(): Promise<void> {
    for (const hook of this.shutdownHooks) {
      try {
        await hook();
      } catch (error) {
        this.logger.error('shutdown hook failed', { message: error instanceof Error ? error.message : String(error) });
      }
    }
  }
}

export async function main(): Promise<void> {
  const home = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const workspace = path.resolve(process.env.AIDE_WORKSPACE || home);
  const version = process.env.AIDE_VERSION || 'dev';
  const port = Number(process.env.AIDE_ARCH_PORT || 4778);
  const server = new ArchServer(workspace, path.join(workspace, '.aide', 'logs', 'arch-daemon.log'));
  // Parent-owned IPC is the only bootstrap origin. HTTP cannot call this.
  if (typeof process.send !== 'function') throw new Error('trusted launch supervisor required; use npm start or npm run dev');
  let resolveReady!: (value: unknown) => void;
  const ready = new Promise<unknown>(resolve => { resolveReady = resolve; });
  const authorityChannel = connectAuthorityChannel(process as unknown as AuthorityPeer, async (method, input) => {
    if (method === 'supervisor.ready') return ready;
    if (method === 'supervisor.pairing') return { proof: server.authority.control.createPairing(input?.origin) };
    if (method === 'transport.authenticate') {
      const actor = server.authority.authenticate(input?.token, input?.origin);
      return { actor_id: actor.id, kind: actor.kind };
    }
    if (method === 'legacy.execute') {
      const actor = server.authority.authenticate(input?.token, input?.origin);
      const operation = await server.legacyDescribe!(input.request);
      const id = operation.kind.endsWith('.read') ? (await server.authority.prepare(actor, operation)).operation_id : input.operation_id;
      return server.authority.execute(actor, id, operation, async descriptor => {
        const result = await authorityChannel.call('legacy.invoke', { request_id: input.request_id, descriptor }, 120000) as { status: number; body: unknown };
        if (result.status >= 400) throw new AuthorityError('NOT_READY', 'legacy execution reported failure');
        return result;
      });
    }
    throw new AuthorityError('FORBIDDEN', 'private authority operation unavailable');
  });
  server.legacyDescribe = async input => await authorityChannel.call('legacy.describe', input) as OperationInput;
  server.addShutdownHook(async () => authorityChannel.close());
  process.once('disconnect', () => { server.authority.control.close(); authorityChannel.close(); });
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const manager = createLspManager(repoRoot, workspace, { events: server.events, logger: server.logger });
  server.addShutdownHook(() => manager.stopAll());
  const dapManager = await createDapManager(repoRoot, workspace, { events: server.events, logger: server.logger });
  server.addShutdownHook(() => dapManager.stopAll());
  const modelRuntime = await createModelRuntime(repoRoot, workspace, { events: server.events, logger: server.logger });
  server.addShutdownHook(() => modelRuntime.stopAll());
  const routes = await buildRoutes(workspace, version, { authority: server.authority, events: server.events, logger: server.logger, lspManager: manager, dapManager, modelRuntime, watchIndex: true });
  for (const route of routes) server.route(route);
  const listener = await server.listen(port);
  resolveReady(listener.address());
  server.logger.info('arch daemon listening', { port, workspace });

  // Closed-loop on by default (aid-closed-loop-on-by-default skill). The
  // selfimprove runner is a SCRIPT, not a library: spawn it detached so it
  // never blocks the daemon, and unref so the loop lives independently.
  // Run once at boot (catches state accumulated while down) + every 6h.
  // Disable for testing with AIDE_CLOSED_LOOP=false.
  if (process.env.AIDE_CLOSED_LOOP !== 'false') {
    const CLOSED_LOOP_MS = 6 * 60 * 60 * 1000;
    const kickClosedLoop = (since: string): void => {
      try {
        const child = spawn(process.execPath, [path.join(repoRoot, 'scripts', 'selfimprove.mjs'), `--since=${since}`], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true
        });
        child.unref();
        server.logger.info('closed-loop runner spawned', { since });
      } catch (error) {
        server.logger.error('closed-loop spawn failed', { message: error instanceof Error ? error.message : String(error) });
      }
    };
    kickClosedLoop('24h');
    const interval = setInterval(() => kickClosedLoop('6h'), CLOSED_LOOP_MS);
    interval.unref();
  } else {
    server.logger.info('closed-loop runner disabled (AIDE_CLOSED_LOOP=false)');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}

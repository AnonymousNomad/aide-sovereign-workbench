import { type ZodTypeAny } from 'zod';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fail, ok, type ErrorCode } from '../../common/errors.ts';
import { Logger } from './services/logger.ts';
import { ProcessManager } from './services/process-manager.ts';
import { EventHub } from './events.ts';
import { buildRoutes, createLspManager, createDapManager, createModelRuntime } from './openapi.ts';

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
}

export interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  prefix?: boolean;
  raw?: boolean;
  query?: ZodTypeAny;
  body?: ZodTypeAny;
  response: ZodTypeAny;
  handler: (ctx: RouteContext) => Promise<unknown> | unknown;
  stream?: (ctx: RouteContext, res: http.ServerResponse) => Promise<void>;
}

export const MAX_BODY_BYTES = 5 * 1024 * 1024;

export class ArchServer {
  readonly logger: Logger;
  readonly processes: ProcessManager;
  readonly events: EventHub;
  readonly workspace: string;
  readonly logFile: string;
  private readonly routes: Route[] = [];
  private readonly shutdownHooks: Array<() => Promise<void>> = [];

  constructor(workspace: string, logFile: string) {
    this.workspace = workspace;
    this.logFile = logFile;
    this.logger = new Logger(logFile);
    this.processes = new ProcessManager(this.logger);
    this.events = new EventHub(this.logger);
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
    const server = http.createServer((request, response) => {
      void this.handle(request, response);
    });
    server.on('error', error => {
      this.logger.error('server error', { message: error.message });
    });
    this.events.attach(server);
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
      const query: Record<string, string> = {};
      for (const [key, value] of url.searchParams) query[key] = value;
      const queryResult = route.query ? route.query.safeParse(query) : { success: true as const, data: query };
      if (!queryResult.success) throw new RouteError('BAD_REQUEST', 'invalid query parameters', queryResult.error.issues);
      const body = await this.readBody(request);
      const bodyResult = route.body ? route.body.safeParse(body) : { success: true as const, data: body };
      if (!bodyResult.success) throw new RouteError('BAD_REQUEST', 'invalid request body', bodyResult.error.issues);
      if (route.stream !== undefined) {
        await route.stream({ query: queryResult.data as Record<string, string>, body: bodyResult.data }, response);
        this.logger.info('stream ok', { method: request.method, path: url.pathname, ms: Date.now() - started });
        return;
      }
      const data = await route.handler({ query: queryResult.data as Record<string, string>, body: bodyResult.data });
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
      const code = error instanceof RouteError ? error.code : 'INTERNAL';
      const message = error instanceof Error ? error.message : 'local daemon error';
      const detail = error instanceof RouteError ? error.detail : undefined;
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
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const manager = createLspManager(repoRoot, workspace, { events: server.events, logger: server.logger });
  server.addShutdownHook(() => manager.stopAll());
  const dapManager = await createDapManager(repoRoot, workspace, { events: server.events, logger: server.logger });
  server.addShutdownHook(() => dapManager.stopAll());
  const modelRuntime = await createModelRuntime(repoRoot, workspace, { events: server.events, logger: server.logger });
  server.addShutdownHook(() => modelRuntime.stopAll());
  const routes = await buildRoutes(workspace, version, { events: server.events, logger: server.logger, lspManager: manager, dapManager, modelRuntime });
  for (const route of routes) server.route(route);
  await server.listen(port);
  server.logger.info('arch daemon listening', { port, workspace });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
import { type ZodType } from 'zod';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fail, ok, type ErrorCode } from '../../common/errors.ts';
import { Logger } from './services/logger.ts';
import { ProcessManager } from './services/process-manager.ts';
import { HealthResponse, type HealthResponseT } from '../../common/contracts/health.ts';
import { WorkspaceListResponse } from '../../common/contracts/workspace.ts';
import { WorkspaceService } from './services/workspace.ts';
import { routeForFileRead, routeForFileWrite, routeForSearch, routeForSearchReplace } from './routes/fs.ts';

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
  query?: ZodType;
  body?: ZodType;
  response: ZodType;
  handler: (ctx: RouteContext) => Promise<unknown> | unknown;
}

export const MAX_BODY_BYTES = 5 * 1024 * 1024;

export class ArchServer {
  readonly logger: Logger;
  readonly processes: ProcessManager;
  readonly workspace: string;
  readonly logFile: string;
  private readonly routes: Route[] = [];

  constructor(workspace: string, logFile: string) {
    this.workspace = workspace;
    this.logFile = logFile;
    this.logger = new Logger(logFile);
    this.processes = new ProcessManager(this.logger);
  }

  route(route: Route): this {
    this.routes.push(route);
    return this;
  }

  async listen(port: number, host = '127.0.0.1'): Promise<http.Server> {
    const server = http.createServer((request, response) => {
      void this.handle(request, response);
    });
    server.on('error', error => {
      this.logger.error('server error', { message: error.message });
    });
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
      const data = await route.handler({ query: queryResult.data as Record<string, string>, body: bodyResult.data });
      const responseResult = route.response.safeParse(data);
      if (!responseResult.success) {
        this.logger.error('handler produced a response that violates the contract', { route: route.path, issues: responseResult.error.issues });
        throw new RouteError('INTERNAL', 'response violates the contract');
      }
      this.logger.info('request ok', { method: request.method, path: url.pathname, ms: Date.now() - started });
      return this.send(response, 200, ok(responseResult.data));
    } catch (error) {
      const code = error instanceof RouteError ? error.code : 'INTERNAL';
      const message = error instanceof Error ? error.message : 'local daemon error';
      const detail = error instanceof RouteError ? error.detail : undefined;
      if (code === 'INTERNAL') this.logger.error('request failed', { method: request.method, path: url.pathname, message, stack: (error as Error).stack });
      else this.logger.warn('request failed', { method: request.method, path: url.pathname, code, message });
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
        await this.processes.shutdownAll();
        await this.logger.flush();
        process.exit(0);
      });
      setTimeout(async () => {
        await this.processes.shutdownAll();
        await this.logger.flush();
        process.exit(1);
      }, 5000).unref();
    };
    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));
  }
}

export function makeHealthRoute(workspace: string, version: string): Route {
  return {
    method: 'GET',
    path: '/api/health',
    response: HealthResponse,
    handler: (): HealthResponseT => ({
      version,
      uptimeMs: Math.round(process.uptime() * 1000),
      workspace: path.resolve(workspace),
      freeMemoryMB: Math.round(os.freemem() / 1048576)
    })
  };
}

export async function main(): Promise<void> {
  const home = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const workspace = path.resolve(process.env.AIDE_WORKSPACE || home);
  const version = process.env.AIDE_VERSION || 'dev';
  const port = Number(process.env.AIDE_ARCH_PORT || 4778);
  const server = new ArchServer(workspace, path.join(workspace, '.aide', 'logs', 'arch-daemon.log'));
  const fsService = new WorkspaceService(workspace);
  server
    .route(makeHealthRoute(workspace, version))
    .route(routeForWorkspaceList(workspace))
    .route(routeForFileRead(fsService))
    .route(routeForFileWrite(fsService))
    .route(routeForSearch(fsService))
    .route(routeForSearchReplace(fsService));
  await server.listen(port);
  server.logger.info('arch daemon listening', { port, workspace });
}

function routeForWorkspaceList(workspace: string): Route {
  return {
    method: 'GET',
    path: '/api/workspace',
    response: WorkspaceListResponse,
    handler: async () => {
      const entries = await fs.readdir(workspace, { withFileTypes: true });
      return {
        workspace,
        entries: entries
          .filter(entry => !entry.name.startsWith('.'))
          .slice(0, 200)
          .map(entry => ({ name: entry.name, kind: entry.isDirectory() ? 'directory' : 'file' }))
      };
    }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
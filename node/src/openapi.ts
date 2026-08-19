import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z, type ZodTypeAny } from 'zod';
import { HealthResponse } from '../../common/contracts/health.ts';
import { WorkspaceListResponse } from '../../common/contracts/workspace.ts';
import { routeForFileRead, routeForFileWrite, routeForSearch, routeForSearchReplace } from './routes/fs.ts';
import { routeForSessionGet, routeForSessionPut } from './routes/session.ts';
import { SessionStore } from './services/session-store.ts';
import { WorkspaceService } from './services/workspace.ts';
import type { Route } from './server.ts';

type SchemaObject = Record<string, unknown>;

export function generateOpenApi(routes: Route[], info: { title: string; version: string }): unknown {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of routes) {
    if (route.raw) continue;
    const method = route.method.toLowerCase();
    const pathItem: Record<string, unknown> = (paths[route.path] ??= {});
    const operation: Record<string, unknown> = {
      responses: {
        '200': {
          description: 'success',
          content: {
            'application/json': {
              schema: z.toJSONSchema(route.response, { target: 'openApi3' }) as SchemaObject
            }
          }
        }
      }
    };
    if (route.query !== undefined) {
      const shape = ((route.query as { shape?: Record<string, ZodTypeAny> }).shape ?? {}) as Record<string, ZodTypeAny>;
      operation.parameters = Object.keys(shape)
        .sort()
        .map(name => ({
          name,
          in: 'query',
          required: shape[name]!.isOptional() === false,
          schema: z.toJSONSchema(shape[name]!, { target: 'openApi3' }) as SchemaObject
        }));
    }
    if (route.body !== undefined) {
      operation.requestBody = {
        required: true,
        content: {
          'application/json': {
            schema: z.toJSONSchema(route.body, { target: 'openApi3' }) as SchemaObject
          }
        }
      };
    }
    pathItem[method] = operation;
  }
  const sortedPaths = Object.fromEntries(Object.keys(paths).sort().map(key => [key, paths[key]]));
  return {
    openapi: '3.0.3',
    info,
    paths: sortedPaths
  };
}

export async function buildRoutes(workspace: string, version: string): Promise<Route[]> {
  const fsService = new WorkspaceService(workspace);
  const core: Route[] = [
    makeHealthRoute(workspace, version),
    makeWorkspaceListRoute(workspace),
    routeForFileRead(fsService),
    routeForFileWrite(fsService),
    routeForSearch(fsService),
    routeForSearchReplace(fsService),
    routeForSessionGet(new SessionStore(workspace)),
    routeForSessionPut(new SessionStore(workspace))
  ];
  const doc = generateOpenApi(core, { title: 'AIDE Arch Daemon API', version });
  return [...core, makeOpenApiRoute(doc)];
}

function makeHealthRoute(workspace: string, version: string): Route {
  return {
    method: 'GET',
    path: '/api/health',
    response: HealthResponse,
    handler: () => ({
      version,
      uptimeMs: Math.round(process.uptime() * 1000),
      workspace: path.resolve(workspace),
      freeMemoryMB: Math.round(os.freemem() / 1048576)
    })
  };
}

function makeWorkspaceListRoute(workspace: string): Route {
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

function makeOpenApiRoute(openapi: unknown): Route {
  return {
    method: 'GET',
    path: '/api/openapi.json',
    raw: true,
    response: z.any(),
    handler: () => openapi
  };
}
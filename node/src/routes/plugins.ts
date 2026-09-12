import path from 'node:path';
import { RouteError, type Route } from '../server.ts';
import type { OperationInput } from '../../../common/security/operation-policy.mjs';
import { type ErrorCode } from '../../../common/errors.ts';
import {
  PluginExecuteRequest,
  PluginExecuteResponse,
  PluginPresetsResponse,
  PluginScaffoldRequest,
  PluginTrustRequest,
  PluginsListResponse,
  type PluginExecuteRequestT,
  type PluginExecuteResponseT,
  type PluginPresetsResponseT,
  type PluginPublicT,
  type PluginScaffoldRequestT,
  type PluginTrustRequestT,
  type PluginsListResponseT
} from '../../../common/contracts/plugins.ts';
import type { PluginManager } from '../../../plugins/manager.mjs';

// Exact operation descriptors. Plugin execution is an execution-risk operation
// bound to the plugin id and the exact payload; trust/scaffold are bounded
// state writes. The plugin state file anchors the workspace.
function operationFor(manager: PluginManager, kind: string, taskId: string, body: unknown): OperationInput {
  const statePath = (manager as unknown as { statePath?: unknown }).statePath;
  if (typeof statePath !== 'string') throw new RouteError('FORBIDDEN', 'workspace anchor unavailable');
  const aideDir = path.dirname(statePath);
  if (path.basename(aideDir) !== '.aide') throw new RouteError('FORBIDDEN', 'workspace anchor unavailable');
  return { workspace: path.dirname(aideDir), taskId, kind, args: { body } };
}

function errorCodeForPlugin(message: string): ErrorCode {
  if (/trust is required before execution/.test(message)) return 'FORBIDDEN';
  if (/escaped its directory/.test(message)) return 'FORBIDDEN';
  if (/Permission Model/.test(message) || /requires Node.js/.test(message)) return 'NOT_READY';
  if (/exited with /.test(message)) return 'CHILD_FAILED';
  if (/no entrypoint/.test(message) || /returned an error|invalid JSON|timed out/.test(message)) return 'BAD_REQUEST';
  return 'NOT_FOUND';
}

export function routeForPluginsList(manager: PluginManager): Route {
  return {
    method: 'GET',
    path: '/api/plugins',
    response: PluginsListResponse,
    handler: (): PluginsListResponseT => ({
      api_version: '1',
      plugins: manager.list() as unknown as PluginPublicT[]
    })
  };
}

export function routeForPluginPresets(manager: PluginManager): Route {
  return {
    method: 'GET',
    path: '/api/plugins/presets',
    response: PluginPresetsResponse,
    handler: (): PluginPresetsResponseT => ({
      api_version: '1',
      presets: manager.presets() as unknown as PluginPresetsResponseT['presets']
    })
  };
}

export function routeForPluginTrust(manager: PluginManager): Route {
  return {
    method: 'POST',
    path: '/api/plugins/trust',
    body: PluginTrustRequest,
    response: PluginsListResponse,
    describeOperation: async (ctx, taskId) => operationFor(manager, 'capability.write', taskId, ctx.body),
    handler: async ({ body }): Promise<PluginsListResponseT> => {
      const input = body as unknown as PluginTrustRequestT;
      try {
        return { api_version: '1', plugins: (await manager.setTrust(input.id, input.trusted)) as unknown as PluginPublicT[] };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'plugin is unavailable';
        if (/plugin is unavailable/.test(message)) throw new RouteError('NOT_FOUND', message);
        throw new RouteError('INTERNAL', message);
      }
    }
  };
}

export function routeForPluginExecute(manager: PluginManager): Route {
  return {
    method: 'POST',
    path: '/api/plugins/execute',
    body: PluginExecuteRequest,
    response: PluginExecuteResponse,
    describeOperation: async (ctx, taskId) => {
      const input = ctx.body as PluginExecuteRequestT;
      return operationFor(manager, 'capability.execute', taskId, { id: input.id, payload: input.payload ?? {} });
    },
    handler: async ({ body }): Promise<PluginExecuteResponseT> => {
      const input = body as unknown as PluginExecuteRequestT;
      try {
        return { result: await manager.execute(input.id, input.payload ?? {}) };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'plugin execution failed';
        throw new RouteError(errorCodeForPlugin(message), message);
      }
    }
  };
}

export function routeForPluginScaffold(manager: PluginManager): Route {
  return {
    method: 'POST',
    path: '/api/plugins/scaffold',
    body: PluginScaffoldRequest,
    response: PluginsListResponse,
    describeOperation: async (ctx, taskId) => {
      const input = ctx.body as PluginScaffoldRequestT;
      return operationFor(manager, 'capability.write', taskId, { id: input.id });
    },
    handler: async ({ body }): Promise<PluginsListResponseT> => {
      const input = body as unknown as PluginScaffoldRequestT;
      try {
        return { api_version: '1', plugins: (await manager.scaffold(input.id)) as unknown as PluginPublicT[] };
      } catch (error) {
        throw new RouteError('NOT_FOUND', error instanceof Error ? error.message : 'plugin preset is not available');
      }
    }
  };
}

export function routesForPlugins(manager: PluginManager): Route[] {
  return [
    routeForPluginsList(manager),
    routeForPluginPresets(manager),
    routeForPluginTrust(manager),
    routeForPluginExecute(manager),
    routeForPluginScaffold(manager)
  ];
}
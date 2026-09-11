import { RouteError, type Route } from '../server.ts';
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
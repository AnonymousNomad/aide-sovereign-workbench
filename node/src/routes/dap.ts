import type { Route } from '../server.ts';
import { RouteError } from '../server.ts';
import type { DapManager } from '../services/dap.ts';
import {
  DapStatusResponse,
  DapAdapterRequest,
  DapStartResponse,
  DapLaunchRequest,
  DapLaunchResponse,
  DapBreakpointsRequest,
  DapBreakpointsResponse,
  DapConfigureResponse,
  DapThreadRequest,
  DapContinueResponse,
  DapStepRequest,
  DapStepResponse,
  DapStackRequest,
  DapStackResponse,
  DapScopesRequest,
  DapScopesResponse,
  DapVariablesRequest,
  DapVariablesResponse,
  DapDisconnectResponse
} from '../../../common/contracts/dap.ts';

function toRouteError(error: unknown): RouteError {
  return new RouteError('CHILD_FAILED', error instanceof Error ? error.message : 'debug adapter operation failed');
}

export function routeForDapStatus(manager: DapManager): Route {
  return {
    method: 'GET',
    path: '/api/dap/status',
    response: DapStatusResponse,
    handler: () => ({ adapters: manager.status() })
  };
}

export function routeForDapStart(manager: DapManager): Route {
  return {
    method: 'POST',
    path: '/api/dap/start',
    body: DapAdapterRequest,
    response: DapStartResponse,
    handler: async ({ body }) => {
      const request = body as { adapterId: string };
      let status: string;
      try {
        status = await manager.start(request.adapterId);
      } catch (error) {
        throw toRouteError(error);
      }
      return { adapterId: request.adapterId, status: status as 'starting' | 'running' };
    }
  };
}

export function routeForDapStop(manager: DapManager): Route {
  return {
    method: 'POST',
    path: '/api/dap/stop',
    body: DapAdapterRequest,
    response: DapStartResponse,
    handler: async ({ body }) => {
      const request = body as { adapterId: string };
      await manager.stop(request.adapterId);
      return { adapterId: request.adapterId, status: 'stopped' as const };
    }
  };
}

export function routeForDapLaunch(manager: DapManager): Route {
  return {
    method: 'POST',
    path: '/api/dap/launch',
    body: DapLaunchRequest,
    response: DapLaunchResponse,
    handler: async ({ body }) => {
      const request = body as { adapterId: string; program: string; args?: string[]; cwd?: string };
      try {
        await manager.launch(request.adapterId, request.program, request.args ?? [], request.cwd);
      } catch (error) {
        throw toRouteError(error);
      }
      return { launched: true };
    }
  };
}

export function routeForDapBreakpoints(manager: DapManager): Route {
  return {
    method: 'POST',
    path: '/api/dap/breakpoints',
    body: DapBreakpointsRequest,
    response: DapBreakpointsResponse,
    handler: async ({ body }) => {
      const request = body as { adapterId: string; path: string; lines: number[] };
      try {
        const breakpoints = await manager.setBreakpoints(request.adapterId, request.path, request.lines);
        return { breakpoints };
      } catch (error) {
        throw toRouteError(error);
      }
    }
  };
}

export function routeForDapConfigure(manager: DapManager): Route {
  return {
    method: 'POST',
    path: '/api/dap/configure',
    body: DapAdapterRequest,
    response: DapConfigureResponse,
    handler: async ({ body }) => {
      const request = body as { adapterId: string };
      try {
        await manager.configure(request.adapterId);
      } catch (error) {
        throw toRouteError(error);
      }
      return { configured: true };
    }
  };
}

export function routeForDapContinue(manager: DapManager): Route {
  return {
    method: 'POST',
    path: '/api/dap/continue',
    body: DapThreadRequest,
    response: DapContinueResponse,
    handler: async ({ body }) => {
      const request = body as { adapterId: string; threadId: number };
      try {
        await manager.continue(request.adapterId, request.threadId);
      } catch (error) {
        throw toRouteError(error);
      }
      return { continuing: true };
    }
  };
}

export function routeForDapStep(manager: DapManager): Route {
  return {
    method: 'POST',
    path: '/api/dap/step',
    body: DapStepRequest,
    response: DapStepResponse,
    handler: async ({ body }) => {
      const request = body as { adapterId: string; threadId: number; kind: 'next' | 'stepIn' | 'stepOut' };
      try {
        await manager.step(request.adapterId, request.threadId, request.kind);
      } catch (error) {
        throw toRouteError(error);
      }
      return { stepping: true };
    }
  };
}

export function routeForDapStack(manager: DapManager): Route {
  return {
    method: 'POST',
    path: '/api/dap/stack',
    body: DapStackRequest,
    response: DapStackResponse,
    handler: async ({ body }) => {
      const request = body as { adapterId: string; threadId: number };
      try {
        const frames = await manager.stack(request.adapterId, request.threadId);
        return { frames };
      } catch (error) {
        throw toRouteError(error);
      }
    }
  };
}

export function routeForDapScopes(manager: DapManager): Route {
  return {
    method: 'POST',
    path: '/api/dap/scopes',
    body: DapScopesRequest,
    response: DapScopesResponse,
    handler: async ({ body }) => {
      const request = body as { adapterId: string; frameId: number };
      try {
        const scopes = await manager.scopes(request.adapterId, request.frameId);
        return { scopes };
      } catch (error) {
        throw toRouteError(error);
      }
    }
  };
}

export function routeForDapVariables(manager: DapManager): Route {
  return {
    method: 'POST',
    path: '/api/dap/variables',
    body: DapVariablesRequest,
    response: DapVariablesResponse,
    handler: async ({ body }) => {
      const request = body as { adapterId: string; variablesReference: number };
      try {
        const variables = await manager.variables(request.adapterId, request.variablesReference);
        return { variables };
      } catch (error) {
        throw toRouteError(error);
      }
    }
  };
}

export function routeForDapDisconnect(manager: DapManager): Route {
  return {
    method: 'POST',
    path: '/api/dap/disconnect',
    body: DapAdapterRequest,
    response: DapDisconnectResponse,
    handler: async ({ body }) => {
      const request = body as { adapterId: string };
      try {
        await manager.disconnect(request.adapterId);
      } catch (error) {
        throw toRouteError(error);
      }
      return { disconnected: true };
    }
  };
}
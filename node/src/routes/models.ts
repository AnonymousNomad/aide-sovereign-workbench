import type { Route } from '../server.ts';
import { RouteError } from '../server.ts';
import { ModelRuntimeError, type ModelRuntime } from '../services/model-runtime.ts';
import {
  ModelStatusResponse,
  ModelIdRequest,
  ModelStartResponse,
  ModelStopResponse,
  ModelIngestRequest,
  ModelIngestResponse,
  ModelReadyQuery,
  ModelReadyResponse,
  ModelRegisterRequest,
  ModelRegisterResponse,
  ModelProfileRequest,
  ModelProfileResponse
} from '../../../common/contracts/models.ts';

export function routeForModelStatus(manager: ModelRuntime): Route {
  return {
    method: 'GET',
    path: '/api/models/status',
    response: ModelStatusResponse,
    handler: async () => {
      try {
        const status = await manager.status();
        return { runtime: status.runtime, models: status.models };
      } catch (error) {
        throw new RouteError('INTERNAL', error instanceof Error ? error.message : 'model status failed');
      }
    }
  };
}

function toRouteError(error: unknown): RouteError {
  if (error instanceof ModelRuntimeError) return new RouteError(error.code, error.message);
  return new RouteError('CHILD_FAILED', error instanceof Error ? error.message : 'model operation failed');
}

export function routeForModelStart(manager: ModelRuntime): Route {
  return {
    method: 'POST',
    path: '/api/models/start',
    body: ModelIdRequest,
    response: ModelStartResponse,
    handler: async ({ body }) => {
      const request = body as { id: string };
      try {
        const result = await manager.start(request.id);
        return { id: result.id, status: result.status as 'running' | 'starting', endpoint: result.endpoint };
      } catch (error) {
        throw toRouteError(error);
      }
    }
  };
}

export function routeForModelStop(manager: ModelRuntime): Route {
  return {
    method: 'POST',
    path: '/api/models/stop',
    body: ModelIdRequest,
    response: ModelStopResponse,
    handler: async ({ body }) => {
      const request = body as { id: string };
      const result = await manager.stop(request.id);
      return { id: result.id, status: result.status as 'stopped' };
    }
  };
}

export function routeForModelIngest(manager: ModelRuntime): Route {
  return {
    method: 'POST',
    path: '/api/models/ingest',
    body: ModelIngestRequest,
    response: ModelIngestResponse,
    handler: async ({ body }) => {
      const request = body as { path: string };
      try {
        return await manager.ingest(request.path);
      } catch (error) {
        throw toRouteError(error);
      }
    }
  };
}

export function routeForModelReady(manager: ModelRuntime): Route {
  return {
    method: 'GET',
    path: '/api/model/ready',
    query: ModelReadyQuery,
    response: ModelReadyResponse,
    handler: async ({ query }) => {
      try {
        const request = query as { id: string };
        return await manager.isReady(request.id);
      } catch (error) {
        throw toRouteError(error);
      }
    }
  };
}

export function routeForModelRegister(manager: ModelRuntime): Route {
  return {
    method: 'POST',
    path: '/api/models/register',
    body: ModelRegisterRequest,
    response: ModelRegisterResponse,
    handler: async ({ body }) => {
      const request = body as Parameters<ModelRuntime['register']>[0];
      try {
        return await manager.register(request);
      } catch (error) {
        throw toRouteError(error);
      }
    }
  };
}

export function routeForModelProfile(manager: ModelRuntime): Route {
  return {
    method: 'POST',
    path: '/api/models/profile',
    body: ModelProfileRequest,
    response: ModelProfileResponse,
    handler: async ({ body }) => {
      const { id, preset, samplers, runtime } = body as { id: string; preset?: string; samplers?: Record<string, number>; runtime?: Record<string, number | string | boolean> };
      try {
        const patch: { preset?: string; samplers?: Record<string, number>; runtime?: Record<string, number | string | boolean> } = {};
        if (preset !== undefined) patch.preset = preset;
        if (samplers !== undefined) patch.samplers = samplers;
        if (runtime !== undefined) patch.runtime = runtime;
        return await manager.saveProfile(id, patch);
      } catch (error) {
        throw toRouteError(error);
      }
    }
  };
}
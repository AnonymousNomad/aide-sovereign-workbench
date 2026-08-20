import type { Route } from '../server.ts';
import { RouteError } from '../server.ts';
import { ModelRuntimeError, type ModelRuntime } from '../services/model-runtime.ts';
import {
  ModelStatusResponse,
  ModelIdRequest,
  ModelStartResponse,
  ModelStopResponse,
  ModelIngestRequest,
  ModelIngestResponse
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
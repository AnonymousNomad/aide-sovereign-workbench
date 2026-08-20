import type { Route } from '../server.ts';
import { RouteError } from '../server.ts';
import { RouterError, type ModelRouter } from '../services/model-router.ts';
import { fitHistory } from '../services/history-fit.ts';
import {
  RoutesResponse,
  RouteRequest,
  RouteResponse,
  FitRequest,
  FitResponse
} from '../../../common/contracts/routing.ts';

export function routeForRoutes(router: ModelRouter): Route {
  return {
    method: 'GET',
    path: '/api/models/routes',
    response: RoutesResponse,
    handler: async () => {
      try {
        const routes = await router.routes();
        return { routes };
      } catch (error) {
        throw new RouteError('INTERNAL', error instanceof Error ? error.message : 'route list failed');
      }
    }
  };
}

function toRouteError(error: unknown): RouteError {
  if (error instanceof RouterError) return new RouteError(error.code, error.message);
  return new RouteError('CHILD_FAILED', error instanceof Error ? error.message : 'route selection failed');
}

export function routeForRoute(router: ModelRouter): Route {
  return {
    method: 'POST',
    path: '/api/models/route',
    body: RouteRequest,
    response: RouteResponse,
    handler: async ({ body }) => {
      const request = body as { role: string };
      try {
        return await router.routeForRole(request.role);
      } catch (error) {
        throw toRouteError(error);
      }
    }
  };
}

export function routeForFit(): Route {
  return {
    method: 'POST',
    path: '/api/models/fit',
    body: FitRequest,
    response: FitResponse,
    handler: async ({ body }) => {
      const request = body as { messages: Array<{ role: string; content: string }>; contextLength: number; maxTokens?: number };
      const fit = fitHistory(request.messages, request.contextLength, request.maxTokens !== undefined ? { maxTokens: request.maxTokens } : {});
      return {
        messages: fit.messages,
        dropped: fit.dropped,
        truncatedSystem: fit.truncatedSystem,
        estimatedTokens: fit.estimatedTokens,
        overflow: fit.overflow
      };
    }
  };
}
import { type Route, type RouteContext, RouteError } from '../server.ts';
import {
  ByokStatusResponse,
  ProviderSetRequest,
  IdRequest,
  KeyPutRequest,
  KeyPutResponse,
  RoutingPutRequest,
  ConsentPutRequest,
  ByokTestRequest,
  ByokTestResponse
} from '../../../common/contracts/byok.ts';

type ByokService = {
  status(): unknown;
  setProvider(provider: unknown): unknown;
  deleteProvider(id: string): unknown;
  putKey(providerId: string, apiKey: string): { stored: true };
  deleteKey(providerId: string): unknown;
  getRouting(): unknown;
  setRouting(routing: unknown): unknown;
  setConsent(enabled: boolean): boolean;
  testProvider(providerId: string): Promise<{ ok: boolean; detail: string }>;
};

function wrap(handler: (ctx: RouteContext) => Promise<unknown> | unknown): (ctx: RouteContext) => Promise<unknown> {
  return async (ctx: RouteContext) => {
    try {
      return await handler(ctx);
    } catch (error) {
      if (error instanceof RouteError) throw error;
      const code = (error as { code?: string })?.code;
      const message = String((error as Error)?.message ?? error).slice(0, 300);
      if (code === 'NOT_FOUND') throw new RouteError('NOT_FOUND', message);
      if (code === 'FORBIDDEN') throw new RouteError('FORBIDDEN', message);
      if (code === 'NOT_SUPPORTED' || code === 'NOT_READY') throw new RouteError(code === 'NOT_READY' ? 'NOT_READY' : 'CHILD_FAILED', message);
      throw new RouteError('CHILD_FAILED', message);
    }
  };
}

export function routesForByok(service: ByokService): Route[] {
  return [
    { method: 'GET', path: '/api/byok/status', response: ByokStatusResponse, handler: wrap(async () => service.status()) },
    { method: 'PUT', path: '/api/byok/providers/set', body: ProviderSetRequest, response: ByokStatusResponse.pick({ providers: true }), handler: wrap(async ({ body }) => {
      const request = body as { provider: Record<string, unknown> };
      const entry = service.setProvider(request.provider);
      return { providers: [entry] };
    }) },
    { method: 'DELETE', path: '/api/byok/providers/delete', body: IdRequest, response: ByokStatusResponse.pick({ providers: true }), handler: wrap(async ({ body }) => {
      const request = body as { id: string };
      service.deleteProvider(request.id);
      const status = service.status() as { providers: unknown[] };
      return { providers: status.providers };
    }) },
    { method: 'PUT', path: '/api/byok/key', body: KeyPutRequest, response: KeyPutResponse, handler: wrap(async ({ body }) => {
      const request = body as { provider_id: string; api_key: string };
      return service.putKey(request.provider_id, request.api_key);
    }) },
    { method: 'DELETE', path: '/api/byok/key/delete', body: IdRequest, response: ByokStatusResponse.pick({ providers: true }), handler: wrap(async ({ body }) => {
      const request = body as { id: string };
      service.deleteKey(request.id);
      const status = service.status() as { providers: unknown[] };
      return { providers: status.providers };
    }) },
    { method: 'PUT', path: '/api/byok/routing', body: RoutingPutRequest, response: ByokStatusResponse.pick({ routing: true }), handler: wrap(async ({ body }) => {
      const request = body as { routing: unknown };
      service.setRouting(request.routing);
      return { routing: service.getRouting() };
    }) },
    { method: 'PUT', path: '/api/byok/consent', body: ConsentPutRequest, response: ByokStatusResponse.pick({ consent_enabled: true }), handler: wrap(async ({ body }) => {
      const request = body as { enabled: boolean };
      return { consent_enabled: service.setConsent(request.enabled) };
    }) },
    { method: 'POST', path: '/api/byok/test', body: ByokTestRequest, response: ByokTestResponse, handler: wrap(async ({ body }) => {
      const request = body as { provider_id: string };
      return await service.testProvider(request.provider_id);
    }) }
  ];
}

import { type Route, type RouteContext, RouteError } from '../server.ts';
import {
  IndexReindexRequest,
  IndexReindexResponse,
  IndexStatus,
  HybridSearchQuery,
  HybridSearchResponse
} from '../../../common/contracts/index.ts';

type IndexService = {
  reindex(force?: boolean): Promise<{ session_id: string }>;
  getStatus(): unknown;
  hybridSearch(query: string, limit?: number): Promise<unknown>;
};

function toRouteError(error: unknown): RouteError {
  if (error instanceof RouteError) return error;
  const code = (error as { code?: string })?.code;
  const message = String((error as Error)?.message ?? error).slice(0, 500);
  if (code === 'BUSY') return new RouteError('CONFLICT', message);
  if (code === 'CAP_EXCEEDED' || code === 'DIM_MISMATCH') return new RouteError('PAYLOAD_TOO_LARGE', message);
  return new RouteError('CHILD_FAILED', message);
}

function wrap(handler: (ctx: RouteContext) => Promise<unknown> | unknown): (ctx: RouteContext) => Promise<unknown> {
  return async (ctx: RouteContext) => {
    try {
      return await handler(ctx);
    } catch (error) {
      throw toRouteError(error);
    }
  };
}

export function routesForIndex(service: IndexService): Route[] {
  return [
    { method: 'POST', path: '/api/index/reindex', body: IndexReindexRequest, response: IndexReindexResponse, handler: wrap(async ({ body }) => {
      const request = body as { force?: boolean };
      return service.reindex(request.force === true);
    }) },
    { method: 'GET', path: '/api/index/status', response: IndexStatus, handler: wrap(async () => service.getStatus()) },
    { method: 'GET', path: '/api/index/search', query: HybridSearchQuery, response: HybridSearchResponse, handler: wrap(async ({ query }: RouteContext) => {
      const q = query as unknown as { query: string; limit?: number };
      return service.hybridSearch(q.query, q.limit ?? 10);
    }) }
  ];
}

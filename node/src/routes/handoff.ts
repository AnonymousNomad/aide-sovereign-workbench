import { type Route, type RouteContext, RouteError } from '../server.ts';
import {
  HandoffExportRequest,
  HandoffExportResponse,
  HandoffBundleListResponse,
  HandoffBundleGetQuery,
  HandoffBundle,
  HandoffImportRequest,
  HandoffImportResponse
} from '../../../common/contracts/handoff.ts';

type HandoffService = {
  exportBundle(request?: unknown): Promise<{ bundle_id: string; tier: string; message_count: number; file_path: string; created_at: string }>;
  listBundles(): { bundles: unknown[] };
  getBundle(id: string): unknown;
  importBundle(bundle: unknown): { context_id: string; message_count: number; adopted_at: string };
};

function toRouteError(error: unknown): RouteError {
  if (error instanceof RouteError) return error;
  const code = (error as { code?: string })?.code;
  const message = String((error as Error)?.message ?? error).slice(0, 500);
  if (code === 'VALIDATION') return new RouteError('BAD_REQUEST', message);
  if (code === 'NOT_FOUND') return new RouteError('NOT_FOUND', message);
  if (code === 'SECRET_DETECTED') return new RouteError('FORBIDDEN', message);
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

export function routesForHandoff(service: HandoffService): Route[] {
  return [
    { method: 'POST', path: '/api/handoff/export', body: HandoffExportRequest, response: HandoffExportResponse, handler: wrap(async ({ body }) => service.exportBundle(body)) },
    { method: 'GET', path: '/api/handoff/bundles', response: HandoffBundleListResponse, handler: wrap(async () => service.listBundles()) },
    { method: 'GET', path: '/api/handoff/bundles/get', query: HandoffBundleGetQuery, response: HandoffBundle.passthrough(), handler: wrap(async ({ query }: RouteContext) => {
      const q = query as unknown as { id: string };
      return service.getBundle(q.id);
    }) },
    { method: 'POST', path: '/api/handoff/import', body: HandoffImportRequest, response: HandoffImportResponse, handler: wrap(async ({ body }) => {
      const request = body as { bundle: unknown };
      return service.importBundle(request.bundle);
    }) }
  ];
}

import { type Route, type RouteContext, RouteError } from '../server.ts';
import {
  HubSearchQuery,
  HubSearchResponse,
  HubDownloadRequest,
  HubDownloadStartedResponse,
  HubCancelRequest,
  HubCancelResponse,
  HubDownloadsListResponse,
  ModelImportRequest,
  ModelImportResponse
} from '../../../common/contracts/modelhub.ts';

type HubService = {
  search(q: string, sort?: string, limit?: number): Promise<unknown>;
  startDownload(args: { repo_id: string; filename: string; quant_label?: string | null; urlTemplate?: string }): Promise<unknown>;
  beginDownload(args: { repo_id: string; filename: string; quant_label?: string | null }): { job_id: string };
  cancel(jobId: string): Promise<{ cancelled: boolean }>;
  listDownloads(): unknown;
  importFromPath(sourcePath: string): Promise<{ manifest: unknown }>;
};

function mapHubError(error: unknown): RouteError {
  if (error instanceof RouteError) return error;
  const code = (error as { code?: string })?.code;
  const message = String((error as Error)?.message ?? error).slice(0, 500);
  if (code === 'VALIDATION' || code === 'IMPORT_INVALID') return new RouteError('BAD_REQUEST', message);
  if (code === 'DOWNLOAD_CONFLICT') return new RouteError('CONFLICT', message);
  if (code === 'UPSTREAM') return new RouteError('BAD_RESPONSE', message);
  return new RouteError('INTERNAL', message);
}

function wrap(handler: (ctx: RouteContext) => Promise<unknown> | unknown): (ctx: RouteContext) => Promise<unknown> {
  return async (ctx: RouteContext) => {
    try {
      return await handler(ctx);
    } catch (error) {
      throw mapHubError(error);
    }
  };
}

export function routesForModelHub(service: HubService): Route[] {
  return [
    { method: 'GET', path: '/api/modelhub/search', query: HubSearchQuery, response: HubSearchResponse, handler: wrap(async ({ query }) => {
      const parsed = HubSearchQuery.parse(query);
      return service.search(parsed.q, parsed.sort ?? 'downloads', parsed.limit ?? 20);
    }) },
    { method: 'POST', path: '/api/modelhub/download', body: HubDownloadRequest, response: HubDownloadStartedResponse, handler: wrap(async ({ body }) => {
      const request = body as { repo_id: string; filename: string; quant_label?: string | null };
      return service.beginDownload(request);
    }) },
    { method: 'POST', path: '/api/modelhub/downloads/cancel', body: HubCancelRequest, response: HubCancelResponse, handler: wrap(async ({ body }) => {
      return service.cancel((body as { job_id: string }).job_id);
    }) },
    { method: 'GET', path: '/api/modelhub/downloads', response: HubDownloadsListResponse, handler: wrap(async () => {
      return { jobs: service.listDownloads() };
    }) },
    { method: 'POST', path: '/api/models/import', body: ModelImportRequest, response: ModelImportResponse, handler: wrap(async ({ body }) => {
      return service.importFromPath((body as { path: string }).path);
    }) }
  ];
}

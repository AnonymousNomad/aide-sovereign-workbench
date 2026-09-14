import { type Route, type RouteContext, RouteError } from '../server.ts';
import type { OperationInput } from '../../../common/security/operation-policy.mjs';
import {
  HubSearchQuery,
  HubSearchResponse,
  HubFilesQuery,
  HubFilesResponse,
  HubDownloadRequest,
  HubDownloadStartedResponse,
  HubCancelRequest,
  HubCancelResponse,
  HubDownloadsListResponse,
  ModelImportRequest,
  ModelImportResponse
} from '../../../common/contracts/modelhub.ts';

type HubService = {
  workspace: string;
  search(q: string, sort?: string, limit?: number): Promise<unknown>;
  listRepoFiles(repoId: string): Promise<unknown>;
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
    { method: 'GET', path: '/api/modelhub/search', query: HubSearchQuery, response: HubSearchResponse,
      // A read-class external search (mirrors the accepted /api/modelhub/files
      // disposition): the approved operation binds the exact validated query.
      // The HF endpoint, gguf filter, direction, user-agent, defaults, egress
      // journal and response mapping are server-owned. Omitted optionals stay
      // null in the authority identity so an omitted value never collapses
      // into an explicit default.
      describeOperation: async ({ query }, taskId): Promise<OperationInput> => {
        const parsed = HubSearchQuery.parse(query);
        return {
          workspace: service.workspace,
          taskId,
          kind: 'capability.read',
          args: { body: { q: parsed.q, sort: parsed.sort ?? null, limit: parsed.limit ?? null } }
        };
      },
      handler: wrap(async ({ query }) => {
        const parsed = HubSearchQuery.parse(query);
        return service.search(parsed.q, parsed.sort ?? 'downloads', parsed.limit ?? 20);
      }) },
    { method: 'GET', path: '/api/modelhub/files', query: HubFilesQuery, response: HubFilesResponse, handler: wrap(async ({ query }) => {
      const parsed = HubFilesQuery.parse(query);
      return service.listRepoFiles(parsed.repo_id);
    }) },
    { method: 'POST', path: '/api/modelhub/download', body: HubDownloadRequest, response: HubDownloadStartedResponse,
      // The approved operation binds the exact repository identity, artifact
      // filename, and quant label. Hostname, scheme, destination root, .part
      // suffix, manifest path, event channel, and the server-generated job UUID
      // are deterministic server-derived effects; the service containment layer
      // independently proves every mutation target stays inside the models root.
      describeOperation: async ({ body }, taskId): Promise<OperationInput> => {
        const { repo_id, filename, quant_label } = body as { repo_id: string; filename: string; quant_label?: string | null };
        return { workspace: service.workspace, taskId, kind: 'capability.external', args: { body: { repo_id, filename, quant_label: quant_label ?? null } } };
      },
      handler: wrap(async ({ body }) => {
        const request = body as { repo_id: string; filename: string; quant_label?: string | null };
        return service.beginDownload(request);
      })
    },
    { method: 'POST', path: '/api/modelhub/downloads/cancel', body: HubCancelRequest, response: HubCancelResponse,
      // Terminates the service-owned download job identified by its
      // server-generated UUID; no PID, URL, path, or process handle is
      // caller-supplied.
      describeOperation: async ({ body }, taskId): Promise<OperationInput> => ({
        workspace: service.workspace, taskId, kind: 'capability.execute', args: { body: { job_id: (body as { job_id: string }).job_id } }
      }),
      handler: wrap(async ({ body }) => {
        return service.cancel((body as { job_id: string }).job_id);
      })
    },
    { method: 'GET', path: '/api/modelhub/downloads', response: HubDownloadsListResponse, handler: wrap(async () => {
      return { jobs: service.listDownloads() };
    }) },
    { method: 'POST', path: '/api/models/import', body: ModelImportRequest, response: ModelImportResponse, handler: wrap(async ({ body }) => {
      return service.importFromPath((body as { path: string }).path);
    }) }
  ];
}

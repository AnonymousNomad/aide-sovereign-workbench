import { type Route, type RouteContext, RouteError } from '../server.ts';
import type { OperationInput } from '../../../common/security/operation-policy.mjs';
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
  workspace: string;
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
    { method: 'POST', path: '/api/handoff/export', body: HandoffExportRequest, response: HandoffExportResponse,
      // The approved operation binds the complete normalized export request:
      // tier, confirmation flags, code intent, session identity, and cutoff.
      // The bundle content itself is captured server-side from the
      // workspace-scoped in-memory transcript at execution time.
      describeOperation: async ({ body }, taskId): Promise<OperationInput> => {
        const request = body as {
          tier?: 'brief' | 'transcript' | 'full';
          confirmed?: boolean;
          confirmed_secret_scan?: boolean;
          include_code?: boolean;
          session_id?: string;
          up_to_message_index?: number;
        };
        return {
          workspace: service.workspace,
          taskId,
          kind: 'capability.write',
          args: {
            body: {
              tier: request.tier ?? 'brief',
              confirmed: request.confirmed ?? false,
              confirmed_secret_scan: request.confirmed_secret_scan ?? false,
              include_code: request.include_code ?? false,
              session_id: request.session_id ?? null,
              up_to_message_index: request.up_to_message_index ?? null
            }
          }
        };
      },
      handler: wrap(async ({ body }) => service.exportBundle(body))
    },
    { method: 'GET', path: '/api/handoff/bundles', response: HandoffBundleListResponse, handler: wrap(async () => service.listBundles()) },
    { method: 'GET', path: '/api/handoff/bundles/get', query: HandoffBundleGetQuery, response: HandoffBundle.passthrough(), handler: wrap(async ({ query }: RouteContext) => {
      const q = query as unknown as { id: string };
      return service.getBundle(q.id);
    }) },
    { method: 'POST', path: '/api/handoff/import', body: HandoffImportRequest, response: HandoffImportResponse,
      // The complete normalized bundle is the operation; the authority digest
      // covers the full content (bounded by the 5 MB body cap).
      describeOperation: async ({ body }, taskId): Promise<OperationInput> => ({
        workspace: service.workspace, taskId, kind: 'capability.write', args: { body: { bundle: (body as { bundle: unknown }).bundle } }
      }),
      handler: wrap(async ({ body }) => {
        const request = body as { bundle: unknown };
        return service.importBundle(request.bundle);
      })
    }
  ];
}

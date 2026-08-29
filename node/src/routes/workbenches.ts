import { type Route, type RouteContext, RouteError } from '../server.ts';
import {
  WorkbenchListResponse,
  WorkbenchDetailResponse,
  WorkbenchDetailRequest,
  WorkbenchInstallRequest,
  WorkbenchTrustRequest,
  WorkbenchUninstallRequest,
  WorkbenchUninstallResponse,
  type WorkbenchListResponseT,
  type WorkbenchDetailResponseT,
  type WorkbenchUninstallResponseT
} from '../../../common/contracts/workbench.ts';
import { WorkbenchManager, WorkbenchValidationError, WorkbenchTrustError } from '../../../workbenches/manager.mjs';

function mapWorkbenchError(error: unknown): RouteError {
  if (error instanceof RouteError) return error;
  if (error instanceof WorkbenchTrustError) {
    // Opt-in online doctrine: trusting an offline:false server without
    // egress consent is FORBIDDEN, never silently downgraded.
    return new RouteError('FORBIDDEN', error.message, error.detail);
  }
  if (error instanceof WorkbenchValidationError) {
    return new RouteError('BAD_REQUEST', error.message, { issues: error.issues ?? [] });
  }
  return new RouteError('INTERNAL', String((error as Error)?.message ?? error).slice(0, 500));
}

function wrap(handler: (ctx: RouteContext) => Promise<unknown> | unknown): (ctx: RouteContext) => Promise<unknown> {
  return async (ctx: RouteContext) => {
    try {
      return await handler(ctx);
    } catch (error) {
      throw mapWorkbenchError(error);
    }
  };
}

export function routesForWorkbenches(manager: WorkbenchManager): Route[] {
  return [
    { method: 'GET', path: '/api/workbenches', response: WorkbenchListResponse, handler: wrap(async () => manager.list() as unknown as WorkbenchListResponseT) },
    { method: 'POST', path: '/api/workbenches/detail', body: WorkbenchDetailRequest, response: WorkbenchDetailResponse, handler: wrap(async ({ body }) => manager.get((body as { id: string }).id) as unknown as WorkbenchDetailResponseT) },
    { method: 'POST', path: '/api/workbenches/install', body: WorkbenchInstallRequest, response: WorkbenchDetailResponse, handler: wrap(async ({ body }) => manager.install((body as { id: string }).id) as unknown as WorkbenchDetailResponseT) },
    { method: 'POST', path: '/api/workbenches/trust', body: WorkbenchTrustRequest, response: WorkbenchDetailResponse, handler: wrap(async ({ body }) => {
        const request = body as { id: string; server: string; trusted: boolean };
        return manager.setTrust(request.id, request.server, request.trusted) as unknown as WorkbenchDetailResponseT;
      }) },
    { method: 'POST', path: '/api/workbenches/uninstall', body: WorkbenchUninstallRequest, response: WorkbenchUninstallResponse, handler: wrap(async ({ body }) => manager.uninstall((body as { id: string }).id) as unknown as WorkbenchUninstallResponseT) }
  ];
}
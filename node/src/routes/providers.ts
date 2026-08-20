import type { Route } from '../server.ts';
import { RouteError } from '../server.ts';
import { ProviderError, type ProviderService } from '../services/providers.ts';
import type { ChatStore } from '../services/chat-store.ts';
import { importChatExport } from '../services/importers/index.ts';
import {
  ProviderListResponse,
  ProviderConnectRequest,
  ProviderConnectResponse,
  ProviderDisconnectRequest,
  ProviderDisconnectResponse,
  ProviderImportRequest,
  ProviderImportResponse
} from '../../../common/contracts/providers.ts';

function toRouteError(error: unknown): RouteError {
  if (error instanceof ProviderError) return new RouteError(error.code, error.message);
  return new RouteError('CHILD_FAILED', error instanceof Error ? error.message : 'provider operation failed');
}

export function routeForProvidersList(service: ProviderService): Route {
  return {
    method: 'GET',
    path: '/api/providers',
    response: ProviderListResponse,
    handler: async () => ({ providers: await service.list() })
  };
}

export function routeForProviderConnect(service: ProviderService): Route {
  return {
    method: 'POST',
    path: '/api/providers/connect',
    body: ProviderConnectRequest,
    response: ProviderConnectResponse,
    handler: async ({ body }) => {
      try {
        return await service.connect(body as Parameters<ProviderService['connect']>[0]);
      } catch (error) {
        throw toRouteError(error);
      }
    }
  };
}

export function routeForProviderDisconnect(service: ProviderService): Route {
  return {
    method: 'POST',
    path: '/api/providers/disconnect',
    body: ProviderDisconnectRequest,
    response: ProviderDisconnectResponse,
    handler: async ({ body }) => {
      try {
        const request = body as { providerId: string };
        await service.disconnect(request.providerId);
        return { ok: true };
      } catch (error) {
        throw toRouteError(error);
      }
    }
  };
}

export function routeForProviderImport(store: ChatStore): Route {
  return {
    method: 'POST',
    path: '/api/providers/import',
    body: ProviderImportRequest,
    response: ProviderImportResponse,
    handler: async ({ body }) => {
      try {
        const request = body as { format: 'chatgpt' | 'claude'; payload: string };
        const outcome = await importChatExport(store, request.format, request.payload);
        return { imported: outcome.imported, skipped: outcome.skipped, warnings: outcome.warnings };
      } catch (error) {
        throw toRouteError(error);
      }
    }
  };
}
import type { Route } from '../server.ts';
import { RouteError } from '../server.ts';
import type { OperationInput } from '../../../common/security/operation-policy.mjs';
import { createHash } from 'node:crypto';
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

export function routeForProviderImport(store: ChatStore, workspace: string): Route {
  return {
    method: 'POST',
    path: '/api/providers/import',
    body: ProviderImportRequest,
    response: ProviderImportResponse,
    // Local chat-export import: the approved operation binds the exact import
    // identity without retaining the raw export. payloadDigest is sha256 over
    // the UTF-8 bytes of the exact validated string; payloadLength is the
    // exact UTF-16 code-unit length. The raw payload stays handler data only.
    // The digest is input-binding only: not permission, validation, or proof.
    describeOperation: async ({ body }, taskId): Promise<OperationInput> => {
      const request = body as { format: 'chatgpt' | 'claude'; payload: string };
      return {
        workspace,
        taskId,
        kind: 'capability.write',
        args: {
          body: {
            format: request.format,
            payloadDigest: createHash('sha256').update(request.payload, 'utf8').digest('hex'),
            payloadLength: request.payload.length
          }
        }
      };
    },
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
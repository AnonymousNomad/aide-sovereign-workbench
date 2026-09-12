import path from 'node:path';
import { RouteError, type Route } from '../server.ts';
import type { OperationInput } from '../../../common/security/operation-policy.mjs';
import {
  DatasetAppendRequest,
  DatasetAppendResponse,
  DatasetCreateRequest,
  DatasetDeleteRequest,
  DatasetDeleteResponse,
  DatasetListResponse,
  DatasetMeta,
  DatasetReadQuery,
  DatasetReadResponse,
  type DatasetAppendRequestT,
  type DatasetAppendResponseT,
  type DatasetCreateRequestT,
  type DatasetDeleteRequestT,
  type DatasetDeleteResponseT,
  type DatasetListResponseT,
  type DatasetReadQueryT,
  type DatasetReadResponseT
} from '../../../common/contracts/dataset.ts';
import type { DatasetStore } from '../../../daemon/dataset-store.mjs';

// Dataset writes are bounded store mutations. Names are normalized before
// approval with the exact rule the store applies, so the approved operation is
// the operation executed. Dataset ids are index keys only (server-generated,
// never used as a caller-controlled path); append targets resolve through the
// in-memory index, so an unknown or traversal-shaped id can only be NOT_FOUND.
function workspaceOf(store: DatasetStore): string {
  const rootDir = (store as unknown as { rootDir?: unknown }).rootDir;
  if (typeof rootDir !== 'string') throw new RouteError('FORBIDDEN', 'workspace anchor unavailable');
  const aideDir = path.dirname(rootDir);
  if (path.basename(aideDir) !== '.aide') throw new RouteError('FORBIDDEN', 'workspace anchor unavailable');
  return path.dirname(aideDir);
}

export function normalizeDatasetName(value: unknown): string {
  const clean = String(value ?? '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{2,63}$/.test(clean)) {
    throw new RouteError('BAD_REQUEST', 'dataset name must be 3-64 chars: letters, digits, space, _ or -');
  }
  return clean;
}

export function routeForDatasetList(store: DatasetStore): Route {
  return {
    method: 'GET',
    path: '/api/training/datasets',
    response: DatasetListResponse,
    handler: (): DatasetListResponseT => ({ datasets: store.list() })
  };
}

export function routeForDatasetCreate(store: DatasetStore): Route {
  return {
    method: 'POST',
    path: '/api/training/datasets',
    body: DatasetCreateRequest,
    response: DatasetMeta,
    describeOperation: async ({ body }, taskId): Promise<OperationInput> => {
      const clean = normalizeDatasetName((body as { name?: unknown }).name);
      return { workspace: workspaceOf(store), taskId, kind: 'capability.write', args: { body: { name: clean } } };
    },
    handler: async ({ body }) => {
      const input = body as unknown as DatasetCreateRequestT;
      const clean = normalizeDatasetName(input.name);
      try {
        return await store.create(clean);
      } catch (error) {
        throw new RouteError('CONFLICT', String((error as Error).message));
      }
    }
  };
}

export function routeForDatasetAppend(store: DatasetStore): Route {
  return {
    method: 'POST',
    path: '/api/training/datasets/append',
    body: DatasetAppendRequest,
    response: DatasetAppendResponse,
    describeOperation: async ({ body }, taskId): Promise<OperationInput> => {
      const input = body as unknown as DatasetAppendRequestT;
      return { workspace: workspaceOf(store), taskId, kind: 'capability.write', args: { body: { id: input.id, samples: input.samples } } };
    },
    handler: async ({ body }): Promise<DatasetAppendResponseT> => {
      const input = body as unknown as DatasetAppendRequestT;
      const result = await store.append(input.id, input.samples);
      if (result.error === 'NOT_FOUND') throw new RouteError('NOT_FOUND', `dataset not found: ${input.id}`);
      if (result.error) throw new RouteError('BAD_REQUEST', result.message ?? 'invalid append request');
      return {
        accepted: result.accepted ?? 0,
        rejected_dupes: result.rejected_dupes ?? 0,
        rejected_invalid: result.rejected_invalid ?? 0,
        errors: result.errors ?? []
      };
    }
  };
}

export function routeForDatasetRead(store: DatasetStore): Route {
  return {
    method: 'GET',
    path: '/api/training/datasets/read',
    query: DatasetReadQuery,
    response: DatasetReadResponse,
    handler: async ({ query }): Promise<DatasetReadResponseT> => {
      const input = query as unknown as DatasetReadQueryT;
      const result = await store.read(input.id, {
        ...(input.offset !== undefined ? { offset: input.offset } : {}),
        ...(input.limit !== undefined ? { limit: input.limit } : {})
      });
      if (result.error === 'NOT_FOUND') throw new RouteError('NOT_FOUND', `dataset not found: ${input.id}`);
      return { total: result.total ?? 0, offset: result.offset ?? 0, samples: result.samples ?? [] };
    }
  };
}

export function routeForDatasetDelete(store: DatasetStore): Route {
  return {
    method: 'POST',
    path: '/api/training/datasets/delete',
    body: DatasetDeleteRequest,
    response: DatasetDeleteResponse,
    handler: async ({ body }): Promise<DatasetDeleteResponseT> => {
      const input = body as unknown as DatasetDeleteRequestT;
      return { deleted: await store.delete(input.id) };
    }
  };
}

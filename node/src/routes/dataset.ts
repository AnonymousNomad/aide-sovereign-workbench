import { RouteError, type Route } from '../server.ts';
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
    handler: async ({ body }) => {
      const input = body as unknown as DatasetCreateRequestT;
      try {
        return await store.create(input.name);
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

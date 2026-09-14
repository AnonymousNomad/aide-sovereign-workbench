import path from 'node:path';
import { RouteError, type Route } from '../server.ts';
import type { OperationInput } from '../../../common/security/operation-policy.mjs';
import {
  CommunityItemAddRequest,
  CommunityItemOperationRequest,
  CommunityItemResponse,
  CommunityItemUpdateRequest,
  CommunityRoot,
  type CommunityItemAddRequestT,
  type CommunityItemOperationRequestT,
  type CommunityItemResponseT,
  type CommunityItemUpdateRequestT,
  type CommunityRootT
} from '../../../common/contracts/community.ts';
import type { CommunityStore } from '../../../community/store.mjs';

// Item mutations bind the exact collection, target index and content. The
// store file anchors the workspace and the descriptor fails closed otherwise.
function operationFor(store: CommunityStore, taskId: string, body: unknown): OperationInput {
  const file = (store as unknown as { file?: unknown }).file;
  if (typeof file !== 'string') throw new RouteError('FORBIDDEN', 'workspace anchor unavailable');
  const aideDir = path.dirname(file);
  if (path.basename(aideDir) !== '.aide') throw new RouteError('FORBIDDEN', 'workspace anchor unavailable');
  return { workspace: path.dirname(aideDir), taskId, kind: 'capability.write', args: { body } };
}

export function routeForCommunityList(store: CommunityStore): Route {
  return {
    method: 'GET',
    path: '/api/community',
    response: CommunityRoot,
    handler: (): CommunityRootT => store.list() as unknown as CommunityRootT
  };
}

export function routeForCommunityAdd(store: CommunityStore): Route {
  return {
    method: 'POST',
    path: '/api/community/items',
    body: CommunityItemAddRequest,
    response: CommunityItemResponse,
    describeOperation: async (ctx, taskId) => operationFor(store, taskId, ctx.body),
    handler: async ({ body }): Promise<CommunityItemResponseT> => {
      const input = body as unknown as CommunityItemAddRequestT;
      try {
        return { item: (await store.add(input.type, input.item)) as unknown as CommunityItemResponseT['item'] };
      } catch (error) {
        throw new RouteError('BAD_REQUEST', error instanceof Error ? error.message : 'invalid community item');
      }
    }
  };
}

export function routeForCommunityUpdate(store: CommunityStore): Route {
  return {
    method: 'PUT',
    path: '/api/community/items',
    body: CommunityItemUpdateRequest,
    response: CommunityItemResponse,
    describeOperation: async (ctx, taskId) => operationFor(store, taskId, ctx.body),
    handler: async ({ body }): Promise<CommunityItemResponseT> => {
      const input = body as unknown as CommunityItemUpdateRequestT;
      try {
        return { item: (await store.update(input.type, input.index, input.item)) as unknown as CommunityItemResponseT['item'] };
      } catch (error) {
        throw new RouteError('BAD_REQUEST', error instanceof Error ? error.message : 'community item is not addressable');
      }
    }
  };
}

export function routeForCommunityRemove(store: CommunityStore): Route {
  return {
    method: 'DELETE',
    path: '/api/community/items',
    body: CommunityItemOperationRequest,
    response: CommunityItemResponse,
    describeOperation: async (ctx, taskId) => operationFor(store, taskId, ctx.body),
    handler: async ({ body }): Promise<CommunityItemResponseT> => {
      const input = body as unknown as CommunityItemOperationRequestT;
      try {
        return { item: (await store.remove(input.type, input.index)) as unknown as CommunityItemResponseT['item'] };
      } catch (error) {
        throw new RouteError('BAD_REQUEST', error instanceof Error ? error.message : 'community item is not addressable');
      }
    }
  };
}

export function routesForCommunity(store: CommunityStore): Route[] {
  return [
    routeForCommunityList(store),
    routeForCommunityAdd(store),
    routeForCommunityUpdate(store),
    routeForCommunityRemove(store)
  ];
}
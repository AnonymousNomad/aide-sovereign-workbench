import path from 'node:path';
import { RouteError, type Route } from '../server.ts';
import type { OperationInput } from '../../../common/security/operation-policy.mjs';
import {
  ReplayAddRequest,
  ReplayAddResponse,
  ReplaysResponse,
  type ReplayAddRequestT,
  type ReplayAddResponseT,
  type ReplaysResponseT
} from '../../../common/contracts/replays.ts';
import type { ReplayStore } from '../../../daemon/replay-store.mjs';

// Replay records are metadata-only local writes; the descriptor binds the
// exact record content. The store file anchors the workspace.
function operationFor(store: ReplayStore, taskId: string, body: unknown): OperationInput {
  const file = (store as unknown as { file?: unknown }).file;
  if (typeof file !== 'string') throw new RouteError('FORBIDDEN', 'workspace anchor unavailable');
  const aideDir = path.dirname(file);
  if (path.basename(aideDir) !== '.aide') throw new RouteError('FORBIDDEN', 'workspace anchor unavailable');
  return { workspace: path.dirname(aideDir), taskId, kind: 'capability.write', args: { body } };
}

export function routeForReplaysList(store: ReplayStore): Route {
  return {
    method: 'GET',
    path: '/api/replays',
    response: ReplaysResponse,
    handler: (): ReplaysResponseT => store.list() as unknown as ReplaysResponseT
  };
}

export function routeForReplaysAdd(store: ReplayStore): Route {
  return {
    method: 'POST',
    path: '/api/replays',
    body: ReplayAddRequest,
    response: ReplayAddResponse,
    describeOperation: async (ctx, taskId) => operationFor(store, taskId, ctx.body),
    handler: async ({ body }): Promise<ReplayAddResponseT> => {
      const input = body as unknown as ReplayAddRequestT;
      return { replay: (await store.add(input)) as unknown as ReplayAddResponseT['replay'] };
    }
  };
}

export function routesForReplays(store: ReplayStore): Route[] {
  return [routeForReplaysList(store), routeForReplaysAdd(store)];
}

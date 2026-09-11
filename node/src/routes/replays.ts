import { type Route } from '../server.ts';
import {
  ReplayAddRequest,
  ReplayAddResponse,
  ReplaysResponse,
  type ReplayAddRequestT,
  type ReplayAddResponseT,
  type ReplaysResponseT
} from '../../../common/contracts/replays.ts';
import type { ReplayStore } from '../../../daemon/replay-store.mjs';

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
    handler: async ({ body }): Promise<ReplayAddResponseT> => {
      const input = body as unknown as ReplayAddRequestT;
      return { replay: (await store.add(input)) as unknown as ReplayAddResponseT['replay'] };
    }
  };
}

export function routesForReplays(store: ReplayStore): Route[] {
  return [routeForReplaysList(store), routeForReplaysAdd(store)];
}

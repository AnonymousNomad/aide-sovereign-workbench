import { type Route } from '../server.ts';
import { MemoryDigestsQuery, MemoryDigestsResponse } from '../../../common/contracts/memory.ts';
import { createRequire } from 'node:module';

// X1.a memory spine routes — digest reads over the deterministic event log.
// Spine is plain ESM shared with the legacy daemon (single source law).
const require = createRequire(import.meta.url);
const spine = require('../../../harness/memory-spine.mjs');

export type MemoryService = {
  listDigests(query: { from?: string; to?: string }): Promise<{ digests: unknown[]; refreshed: string[] }>;
};

export function createMemoryService(workspace: string): MemoryService {
  return {
    async listDigests(query) {
      // Refresh-on-read keeps digests honest without a background scheduler
      // (X1.c adds idle-triggered consolidation later; this stays correct
      // standalone). Refresh is bounded to the requested window.
      const refreshed = await spine.refreshDayDigests(workspace, { from: query.from, to: query.to });
      const names = await spine.listDayDigests(workspace, { from: query.from, to: query.to });
      const digests: unknown[] = [];
      for (const date of names) {
        const digest = await spine.readDayDigest(workspace, date);
        if (digest) digests.push(digest);
      }
      return { digests, refreshed };
    }
  };
}

export function routesForMemory(service: MemoryService): Route[] {
  return [
    {
      method: 'GET',
      path: '/api/memory/digests',
      query: MemoryDigestsQuery,
      response: MemoryDigestsResponse,
      handler: async ({ query }) => service.listDigests(query as { from?: string; to?: string })
    }
  ];
}

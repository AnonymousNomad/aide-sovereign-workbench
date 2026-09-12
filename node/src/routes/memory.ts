import { RouteError, type Route } from '../server.ts';
import type { OperationInput } from '../../../common/security/operation-policy.mjs';
import { MemoryDigestResponse, MemoryDigestsQuery, MemoryDigestsResponse } from '../../../common/contracts/memory.ts';
import { createRequire } from 'node:module';

// X1.a memory spine routes — digest reads over the deterministic event log.
// Spine is plain ESM shared with the legacy daemon (single source law).
const require = createRequire(import.meta.url);
const spine = require('../../../harness/memory-spine.mjs');
const helixJoin = require('../../../harness/helix-join.mjs');
const helixRetention = require('../../../harness/helix-retention.mjs');

export type MemoryService = {
  workspace: string;
  listDigests(query: { from?: string; to?: string }): Promise<{ digests: unknown[]; refreshed: string[] }>;
  digest(): Promise<{ refreshed: string[] }>;
};

// The digests route refreshes day digests and drives the Helix cascade, so it
// is a durable operation and must be authorized as one. The range is
// normalized here and bound into the operation exactly as the handler will
// apply it; absent bounds mean "all recorded dates" (explicit null).
export function normalizeDigestRange(query: unknown): { from: string | null; to: string | null } {
  const q = (query ?? {}) as { from?: string; to?: string };
  return { from: q.from ?? null, to: q.to ?? null };
}

function assertDigestRange(range: { from: string | null; to: string | null }): void {
  if (range.from !== null && range.to !== null && range.to < range.from) {
    throw new RouteError('BAD_REQUEST', 'digest range is inverted');
  }
}

const CASCADE_TIMEOUT_MS = 1500;

// Best-effort, bounded helix cascade (X1 spine -> X2 join -> X3 retention).
// Runs after the spine refresh so the pattern store and the monthly/yearly
// rollups are redriven from the freshest digests. One failing stage never
// blocks the digest response (R2: armor/fail-closed component isolation).
async function runHelixCascade(workspace: string): Promise<void> {
  const steps: Array<() => Promise<unknown>> = [
    async () => { await helixJoin.refresh(workspace); },
    async () => { await helixRetention.rollup(workspace); }
  ];
  for (const step of steps) {
    try {
      await Promise.race([step(), new Promise((_, reject) => setTimeout(() => reject(new Error('helix cascade step timeout')), CASCADE_TIMEOUT_MS))]);
    } catch (err) {
      const logger = (globalThis as { __aide_log?: (msg: string) => void }).__aide_log;
      if (typeof logger === 'function') logger(`[memory] helix cascade skipped: ${(err as Error).message}`);
    }
  }
}

export function createMemoryService(workspace: string): MemoryService {
  return {
    workspace,
    async listDigests(query) {
      // Refresh-on-read keeps digests honest without a background scheduler
      // (X1.c adds idle-triggered consolidation later; this stays correct
      // standalone). Refresh is bounded to the requested window, then the
      // X2 join + X3 retention cascade is redriven best-effort.
      const refreshed = await spine.refreshDayDigests(workspace, { from: query.from, to: query.to });
      void runHelixCascade(workspace);
      const names = await spine.listDayDigests(workspace, { from: query.from, to: query.to });
      const digests: unknown[] = [];
      for (const date of names) {
        const digest = await spine.readDayDigest(workspace, date);
        if (digest) digests.push(digest);
      }
      return { digests, refreshed };
    },
    async digest() {
      // Session-completion consolidate (Mission 1, item 4): refresh from
      // the bus + ships stream, then redrive the X2 join + X3 retention
      // cascade. Bounded, best-effort, fire-and-forget friendly.
      void runHelixCascade(workspace);
      const refreshed = await spine.refreshDayDigests(workspace);
      return { refreshed };
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
      describeOperation: async ({ query }, taskId): Promise<OperationInput> => {
        const range = normalizeDigestRange(query);
        assertDigestRange(range);
        return { workspace: service.workspace, taskId, kind: 'capability.write', args: { body: range } };
      },
      handler: async ({ query }) => {
        const range = normalizeDigestRange(query);
        assertDigestRange(range);
        return service.listDigests({
          ...(range.from !== null ? { from: range.from } : {}),
          ...(range.to !== null ? { to: range.to } : {})
        });
      }
    },
    {
      method: 'POST',
      path: '/api/memory/digest',
      response: MemoryDigestResponse,
      handler: async () => service.digest()
    }
  ];
}

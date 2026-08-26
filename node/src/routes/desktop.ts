import { type Route } from '../server.ts';
import { RouteError } from '../server.ts';
import {
  DesktopActionRequest,
  DesktopActionResult,
  DesktopStatusResponse,
  DesktopGrants,
  PanicResult,
  DesktopPendingSubmit,
  DesktopPendingEntry,
  DesktopVerdictResult
} from '../../../common/contracts/desktop.ts';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const z = require('zod') as typeof import('zod');
const { createDesktopControl } = require('../services/desktop-control.mjs');

type ErrorCode = 'BAD_REQUEST' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'PAYLOAD_TOO_LARGE' | 'INTERNAL' | 'NOT_READY' | 'TIMEOUT' | 'CHILD_FAILED' | 'BAD_RESPONSE' | 'NOT_A_REPO' | 'COMMIT_FAILED';

export type DesktopService = {
  status(): Promise<Record<string, unknown>>;
  setGrants(manifest: unknown): Promise<unknown>;
  act(request: unknown): Promise<unknown>;
  panic(): Promise<unknown>;
  submitPending(input: unknown): unknown;
  waitForVerdict(id: string, timeoutMs?: number): Promise<{ verdict: string }>;
  resolvePending(id: string, decision: string): unknown;
  listPending(): Array<Record<string, unknown>>;
};

export function createDesktopService(workspace: string): DesktopService {
  return createDesktopControl({ workspace });
}

function toRouteError(error: unknown): RouteError {
  if (error && typeof error === 'object' && 'code' in error) {
    const e = error as { code: string; message: string };
    const map: Record<string, ErrorCode> = {
      DISABLED: 'NOT_READY',
      PANIC: 'FORBIDDEN',
      EXPIRED: 'FORBIDDEN',
      NOT_ALLOWLISTED: 'FORBIDDEN',
      PATH_NOT_GRANTED: 'FORBIDDEN',
      NO_APPROVAL: 'FORBIDDEN',
      NOT_FOUND: 'NOT_FOUND',
      WINDOW_NOT_FOUND: 'NOT_FOUND'
    };
    return new RouteError(map[e.code] ?? 'CHILD_FAILED', e.message);
  }
  return new RouteError('CHILD_FAILED', error instanceof Error ? error.message : 'desktop action failed');
}

export function routesForDesktop(service: DesktopService): Route[] {
  return [
    {
      method: 'GET',
      path: '/api/desktop/status',
      response: DesktopStatusResponse,
      handler: async () => service.status()
    },
    {
      method: 'POST',
      path: '/api/desktop/grants',
      body: (() => {
        const { z } = require('zod') as typeof import('zod');
        return z.object({
          enabled: z.boolean(),
          grants: DesktopGrants,
          ttl_minutes: z.number().int().positive().max(720)
        }).strict();
      })(),
      response: DesktopStatusResponse,
      handler: async ({ body }) => {
        const input = body as { enabled: boolean; grants: { apps: string[]; roots: string[]; window_titles: string[] }; ttl_minutes: number };
        // Grants are ONLY settable by the operator wizard — this route requires
        // the same local-machine trust as every other daemon write, and the
        // manifest records approved_by:'operator-wizard'. Respond with the
        // STATUS shape (contract) rather than the stored manifest.
        await service.setGrants({
          version: 1,
          enabled: input.enabled,
          grants: input.grants,
          session_started_at: new Date().toISOString(),
          ttl_minutes: input.ttl_minutes,
          approved_by: 'operator-wizard'
        });
        return await service.status();
      }
    },
    {
      method: 'POST',
      path: '/api/desktop/action',
      body: DesktopActionRequest,
      response: DesktopActionResult,
      handler: async ({ body }) => {
        try {
          return await service.act(body);
        } catch (error) {
          throw toRouteError(error);
        }
      }
    },
    {
      method: 'POST',
      path: '/api/desktop/panic',
      response: PanicResult,
      handler: async () => service.panic()
    },
    {
      // Executor seam (T2 contract): desktop-agent submits a pending action,
      // then long-polls the verdict endpoint (<=55s server hold).
      method: 'POST',
      path: '/api/desktop/pending',
      body: DesktopPendingSubmit,
      response: DesktopPendingEntry,
      handler: async ({ body }) => {
        const input = body as { action_raw: string; class: string; session_id?: string };
        try { return service.submitPending(input); }
        catch (error) { throw toRouteError(error); }
      }
    },
    {
      method: 'GET',
      path: '/api/desktop/pending',
      response: z.object({ approvals: z.array(DesktopPendingEntry) }).strict(),
      handler: async () => ({ approvals: service.listPending() })
    },
    {
      // Long-poll: server holds up to 55s awaiting the cockpit decision.
      method: 'GET',
      path: '/api/desktop/pending/verdict',
      query: z.object({ id: z.string().min(1) }).strict(),
      response: DesktopVerdictResult,
      handler: async ({ query }) => {
        try { return await service.waitForVerdict(String(query.id), 55_000); }
        catch (error) { throw toRouteError(error); }
      }
    },
    {
      method: 'POST',
      path: '/api/desktop/pending/resolve',
      body: z.object({ approval_id: z.string().min(1), decision: z.enum(['approve', 'reject']) }).strict(),
      response: z.object({ ok: z.boolean(), approval_id: z.string(), verdict: z.string() }).strict(),
      handler: async ({ body }) => {
        const input = body as { approval_id: string; decision: string };
        try { return service.resolvePending(input.approval_id, input.decision); }
        catch (error) { throw toRouteError(error); }
      }
    }
  ];
}

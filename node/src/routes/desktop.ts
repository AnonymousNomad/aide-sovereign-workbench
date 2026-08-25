import { type Route } from '../server.ts';
import { RouteError } from '../server.ts';
import {
  DesktopActionRequest,
  DesktopActionResult,
  DesktopStatusResponse,
  DesktopGrants,
  PanicResult
} from '../../../common/contracts/desktop.ts';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createDesktopControl } = require('../services/desktop-control.mjs');

type ErrorCode = 'BAD_REQUEST' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'PAYLOAD_TOO_LARGE' | 'INTERNAL' | 'NOT_READY' | 'TIMEOUT' | 'CHILD_FAILED' | 'BAD_RESPONSE' | 'NOT_A_REPO' | 'COMMIT_FAILED';

export type DesktopService = {
  status(): Promise<Record<string, unknown>>;
  setGrants(manifest: unknown): Promise<unknown>;
  act(request: unknown): Promise<unknown>;
  panic(): Promise<unknown>;
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
    }
  ];
}

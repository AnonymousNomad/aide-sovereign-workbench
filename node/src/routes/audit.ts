import { type Route, type RouteContext, RouteError } from '../server.ts';
import {
  AuditReadQuery,
  AuditReadResponse,
  AuditSessionResponse,
  AuditBundleResponse
} from '../../../common/contracts/audit.ts';
import { z } from 'zod';

type AuditService = {
  readEvents: (filter: { type?: string; sessionId?: string; bundleId?: string; since?: string; limit?: number }) => Promise<Array<Record<string, unknown>>>;
  sessionTrajectory: (sessionId: string, options?: { limit?: number }) => Promise<{ session_id: string; event_count: number; by_type: Record<string, Array<Record<string, unknown>>>; first_at: string | null; last_at: string | null }>;
  bundleTrajectory: (bundleId: string, options?: { limit?: number }) => Promise<{ bundle_id: string; event_count: number; events: Array<Record<string, unknown>> }>;
  knownTypes: () => string[];
};

const SessionQuery = z.object({
  id: z.string().min(1).max(128),
  limit: z.coerce.number().int().gte(1).lte(2000).default(500)
}).strict();

const BundleQuery = z.object({
  id: z.string().min(1).max(128),
  limit: z.coerce.number().int().gte(1).lte(2000).default(500)
}).strict();

// Per the route-slice SOP: a null service is a deliberate NOT_READY
// response so tests can verify the boundary.
export function routesForAudit(service: AuditService | null): Route[] {
  return [
    {
      method: 'GET',
      path: '/api/audit/events',
      query: AuditReadQuery,
      response: AuditReadResponse,
      handler: async ({ query }: RouteContext) => {
        if (!service) {
          throw new RouteError('NOT_READY', 'audit service is not wired on this instance');
        }
        const q = query as { type?: string; session_id?: string; bundle_id?: string; since?: string; limit?: number };
        // exactOptionalPropertyTypes requires we NOT pass undefined
        // explicitly; build the filter object with only the keys that
        // are present.
        const filter: Parameters<typeof service.readEvents>[0] = {};
        if (q.type) filter.type = q.type;
        if (q.session_id) filter.sessionId = q.session_id;
        if (q.bundle_id) filter.bundleId = q.bundle_id;
        if (q.since) filter.since = q.since;
        if (q.limit !== undefined) filter.limit = q.limit;
        const events = await service.readEvents(filter);
        return { events, count: events.length, known_types: service.knownTypes() };
      }
    },
    {
      method: 'GET',
      path: '/api/audit/session',
      query: SessionQuery,
      response: AuditSessionResponse,
      handler: async ({ query }: RouteContext) => {
        if (!service) {
          throw new RouteError('NOT_READY', 'audit service is not wired on this instance');
        }
        const q = SessionQuery.parse(query);
        return await service.sessionTrajectory(q.id, { limit: q.limit });
      }
    },
    {
      method: 'GET',
      path: '/api/audit/bundle',
      query: BundleQuery,
      response: AuditBundleResponse,
      handler: async ({ query }: RouteContext) => {
        if (!service) {
          throw new RouteError('NOT_READY', 'audit service is not wired on this instance');
        }
        const q = BundleQuery.parse(query);
        return await service.bundleTrajectory(q.id, { limit: q.limit });
      }
    }
  ];
}

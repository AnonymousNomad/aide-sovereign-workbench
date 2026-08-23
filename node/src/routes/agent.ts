import { type Route, type RouteContext, RouteError } from '../server.ts';
import {
  AgentStartRequest,
  AgentStartResponse,
  AgentDecisionRequest,
  AgentDecisionResponse,
  AgentStatusQuery,
  AgentStatusResponse,
  AgentSessionsListResponse
} from '../../../common/contracts/agent.ts';
import { RouterError } from '../services/model-router.ts';

type AgentLoopService = {
  start(task: string, mode?: 'plan' | 'act'): { session_id: string };
  decide(sessionId: string, approvalId: string, decision: 'approve' | 'reject' | 'abort'): { ok: boolean };
  status(sessionId: string): unknown;
  list(): unknown[];
};

function toRouteError(error: unknown): RouteError {
  if (error instanceof RouteError) return error;
  if (error instanceof RouterError) return new RouteError('NOT_READY', error.message);
  const code = (error as { code?: string })?.code;
  const message = String((error as Error)?.message ?? error).slice(0, 500);
  if (code === 'SESSION_NOT_FOUND') return new RouteError('NOT_FOUND', message);
  if (code === 'VALIDATION' || code === 'NOT_AWAITING') return new RouteError('BAD_REQUEST', message);
  if (error instanceof Error && error.name === 'NOT_READY') return new RouteError('NOT_READY', message);
  return new RouteError('CHILD_FAILED', message);
}

function wrap(handler: (ctx: RouteContext) => Promise<unknown> | unknown): (ctx: RouteContext) => Promise<unknown> {
  return async (ctx: RouteContext) => {
    try {
      return await handler(ctx);
    } catch (error) {
      throw toRouteError(error);
    }
  };
}

export function routesForAgent(service: AgentLoopService): Route[] {
  return [
    { method: 'POST', path: '/api/agent/start', body: AgentStartRequest, response: AgentStartResponse, handler: wrap(async ({ body }) => {
      const request = body as { task: string; mode?: 'plan' | 'act' };
      return service.start(request.task, request.mode ?? 'act');
    }) },
    { method: 'POST', path: '/api/agent/decision', body: AgentDecisionRequest, response: AgentDecisionResponse, handler: wrap(async ({ body }) => {
      const request = body as { session_id: string; approval_id: string; decision: 'approve' | 'reject' | 'abort' };
      return service.decide(request.session_id, request.approval_id, request.decision);
    }) },
    { method: 'GET', path: '/api/agent/sessions', response: AgentSessionsListResponse, handler: wrap(async () => {
      return { sessions: service.list() };
    }) },
    { method: 'GET', path: '/api/agent/status', query: AgentStatusQuery, response: AgentStatusResponse, handler: wrap(async ({ query }: RouteContext) => {
      return service.status((query as { id: string }).id);
    }) }
  ];
}

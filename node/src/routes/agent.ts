import { type Route, type RouteContext, RouteError } from '../server.ts';
import {
  AgentStartRequest,
  AgentStartResponse,
  AgentDecisionRequest,
  AgentDecisionResponse,
  AgentStatusQuery,
  AgentStatusResponse,
  AgentSessionsListResponse,
  AgentToolInvokeRequest,
  AgentToolObservation
} from '../../../common/contracts/agent.ts';
import { RouterError } from '../services/model-router.ts';

type AgentLoopService = {
  start(task: string, mode?: 'plan' | 'act', chatFnOverride?: ((messages: Array<{ role: string; content: string }>) => Promise<string>) | null): { session_id: string };
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

export function routesForAgent(service: AgentLoopService, options: { resolveProviderChatFn?: (role: 'plan' | 'act') => ((messages: Array<{ role: string; content: string }>) => Promise<string>) | null, dispatchTool?: (name: string, args: Record<string, string>, opts: { sandbox?: string }) => Promise<{ ok: boolean; output: string; terminal?: boolean }> } = {}): Route[] {
  return [
    { method: 'POST', path: '/api/agent/start', body: AgentStartRequest, response: AgentStartResponse, handler: wrap(async ({ body }) => {
      const request = body as { task: string; mode?: 'plan' | 'act'; chat_source?: 'local' | 'provider' };
      let chatFnOverride: ((messages: Array<{ role: string; content: string }>) => Promise<string>) | undefined;
      if (request.chat_source === 'provider') {
        if (!options.resolveProviderChatFn) throw new RouteError('NOT_READY', 'no provider resolver wired');
        const role = request.mode === 'plan' ? 'plan' as const : 'act' as const;
        let resolved: ((messages: Array<{ role: string; content: string }>) => Promise<string>) | null;
        try {
          resolved = options.resolveProviderChatFn(role);
        } catch (error) {
          const code = (error as { code?: string })?.code;
          if (code === 'FORBIDDEN') throw new RouteError('FORBIDDEN', String((error as Error).message).slice(0, 200));
          throw new RouteError('CHILD_FAILED', String((error as Error)?.message ?? error).slice(0, 200));
        }
        if (!resolved) throw new RouteError('NOT_READY', `no provider chat available for role ${role}`);
        chatFnOverride = resolved;
      }
      return service.start(request.task, request.mode ?? 'act', chatFnOverride);
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
    }) },
    { method: 'POST', path: '/api/agent/tool', body: AgentToolInvokeRequest, response: AgentToolObservation, handler: wrap(async ({ body }) => {
      if (!options.dispatchTool) throw new RouteError('NOT_READY', 'tool dispatch is not wired on this instance');
      const request = body as { name: string; arguments?: Record<string, string>; sandbox?: string; approved?: boolean };
      const opts = request.sandbox !== undefined ? { sandbox: request.sandbox } : {};
      return options.dispatchTool(request.name, request.arguments ?? {}, opts);
    }) }
  ];
}

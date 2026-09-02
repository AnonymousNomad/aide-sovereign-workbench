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
  AgentToolObservation,
  AgentSubagentSpawnRequest,
  AgentSubagentSpawnResponse,
  AgentSubagentListResponse,
  AgentSubagentStatus,
  AgentSubagentStatusQuery,
  type AgentSubagentSpawnRequestT,
  type AgentSubagentStatusT
} from '../../../common/contracts/agent.ts';
import { RouterError } from '../services/model-router.ts';

type AgentLoopService = {
  start(task: string, mode?: 'plan' | 'act', chatFnOverride?: ((messages: Array<{ role: string; content: string }>) => Promise<string>) | null, opts?: { architectEditor?: boolean }): { session_id: string };
  decide(sessionId: string, approvalId: string, decision: 'approve' | 'reject' | 'abort'): { ok: boolean };
  status(sessionId: string): unknown;
  list(): unknown[];
};

// Subagent dispatch service (aide-subagent-dispatch skill, PR A wiring).
// PR A defines the route surface; PR B fills in the runtime that calls
// agent-loop.mjs. Until then, spawn() returns NOT_READY so the route
// contract is live and discoverable.
type AgentSubagentService = {
  spawn(request: AgentSubagentSpawnRequestT): Promise<{ child_session_id: string; status: 'spawned' | 'running' }>;
  list(parentSessionId?: string): AgentSubagentStatusT[];
  status(childSessionId: string): AgentSubagentStatusT | null;
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

export function routesForAgent(service: AgentLoopService, options: {
  resolveProviderChatFn?: (role: 'plan' | 'act') => ((messages: Array<{ role: string; content: string }>) => Promise<string>) | null;
  dispatchTool?: (name: string, args: Record<string, string>, opts: { sandbox?: string }) => Promise<{ ok: boolean; output: string; terminal?: boolean }>;
  // Expert advisory: when set, the route layer consults this micro-expert
  // (e.g. task-router) BEFORE the main model call and prepends the result
  // to the system prompt. Per aide-micro-expert-collective + the
  // Veritas hierarchy unchanged rule: ADVISORY only, never blocks.
  // (aide-subagent-dispatch PR A wires this for the expert inference; PR B
  // is the agent-loop runtime.)
  consultExpert?: (task: string) => Promise<{ expert: string; phase: string; confidence: number } | null>;
} = {}): Route[] {
  return [
    { method: 'POST', path: '/api/agent/start', body: AgentStartRequest, response: AgentStartResponse, handler: wrap(async ({ body }) => {
      const request = body as { task: string; mode?: 'plan' | 'act'; chat_source?: 'local' | 'provider'; architectEditor?: boolean; expertAdvisory?: boolean };
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
      // Expert advisory (aide-micro-expert-collective skill, audit Week 1
      // item #7): when expertAdvisory:true AND the chat_source is 'local'
      // (we have a local chat to wrap), consult the task-router micro-expert
      // BEFORE the main call and prepend the result to the system prompt.
      // Non-blocking: 200ms timeout; failures are silent. The main model
      // sees the advisory as a system-prompt block; if the expert is
      // missing/slow, the main call proceeds unchanged.
      if (request.expertAdvisory && options.consultExpert && chatFnOverride) {
        const inner = chatFnOverride;
        chatFnOverride = async (messages) => {
          let advisory: { expert: string; phase: string; confidence: number } | null = null;
          try {
            const ac = new AbortController();
            const timer = setTimeout(() => ac.abort(), 200);
            // extract user task: take the last user message content as the input
            const lastUser = [...messages].reverse().find(m => m.role === 'user');
            const taskForExpert = lastUser?.content ?? '';
            advisory = await Promise.race([
              options.consultExpert!(taskForExpert),
              new Promise<null>((resolve) => { ac.signal.addEventListener('abort', () => resolve(null)); })
            ]);
            clearTimeout(timer);
          } catch { /* silent: never block on the expert */ }
          if (advisory && advisory.expert) {
            const block = `[EXPERT ADVISORY]\nroute: ${advisory.phase}\nexpert: ${advisory.expert}\nconfidence: ${advisory.confidence.toFixed(3)}\n[END ADVISORY]\n\n`;
            // prepend the advisory to the existing system message in place
            // (preserves the original message order). The findIndex + guard
            // handles the noUncheckedIndexedAccess narrowing cleanly.
            const sysIdx = messages.findIndex(m => m.role === 'system');
            if (sysIdx >= 0) {
              const sysMsg = messages[sysIdx];
              if (sysMsg) {
                return inner([
                  ...messages.slice(0, sysIdx),
                  { ...sysMsg, content: block + sysMsg.content },
                  ...messages.slice(sysIdx + 1)
                ]);
              }
            }
            return inner([{ role: 'system', content: block }, ...messages]);
          }
          return inner(messages);
        };
      }
      return service.start(request.task, request.mode ?? 'act', chatFnOverride, { architectEditor: request.architectEditor === true });
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

// Subagent dispatch routes (aide-subagent-dispatch skill, PR A wiring).
// The contract surface is live: spawn / list / status. The runtime that
// fulfills spawn() lands in PR B (modifies agent-loop.mjs to dispatch
// subagent_spawn via the new tool type). Until PR B is wired, all three
// routes return NOT_READY with a clear "subagent dispatch not wired on
// this instance" message. The contracts ARE the wire-in (per the skill's
// design): the route surface is discoverable, type-checked, and tested
// before the runtime exists.
//
// Threat matrix covered by the tests/arch/agent-subagent.test.ts:
//  1. spawn() with valid body returns NOT_READY (PR A); PR B swaps to child_id
//  2. spawn() with invalid body returns 400 BAD_REQUEST
//  3. list() with no parent_session_id returns []
//  4. list() with parent_session_id returns parent's children (PR B)
//  5. status() with unknown child_session_id returns 404 NOT_FOUND
//  6. status() with known child returns the AgentSubagentStatus (PR B)
export function routesForAgentSubagent(subagentService: AgentSubagentService | null): Route[] {
  return [
    { method: 'POST', path: '/api/agent/subagent', body: AgentSubagentSpawnRequest, response: AgentSubagentSpawnResponse, handler: wrap(async ({ body }) => {
      if (!subagentService) {
        throw new RouteError('NOT_READY', 'subagent dispatch not wired on this instance (PR A: contracts live, runtime in PR B of aide-subagent-dispatch)');
      }
      const request = body as AgentSubagentSpawnRequestT;
      return subagentService.spawn(request);
    }) },
    { method: 'GET', path: '/api/agent/subagent', response: AgentSubagentListResponse, handler: wrap(async ({ query }: RouteContext) => {
      if (!subagentService) {
        return { subagents: [] };
      }
      const parentSessionId = (query as { parent_session_id?: string }).parent_session_id;
      return { subagents: subagentService.list(parentSessionId) };
    }) },
    { method: 'GET', path: '/api/agent/subagent/status', query: AgentSubagentStatusQuery, response: AgentSubagentStatus, handler: wrap(async ({ query }: RouteContext) => {
      const childId = (query as { child_session_id: string }).child_session_id;
      if (!subagentService) {
        throw new RouteError('NOT_READY', 'subagent dispatch not wired on this instance');
      }
      const status = subagentService.status(childId);
      if (!status) throw new RouteError('NOT_FOUND', `unknown child session: ${childId}`);
      return status;
    }) }
  ];
}

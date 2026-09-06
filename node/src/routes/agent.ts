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
  AgentBundlePreviewRequest,
  AgentBundlePreviewResponse,
  AgentBundleRunRequest,
  AgentBundleRunResponse,
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

// C6 agent-bundles adapter (report-source.md release gates for the
// /api/agent/bundles/* family). The preview composes a bundle card and
// persists it under the review key. The run endpoint validates that the
// operator previewed the bundle before any tool can run. The service
// is fail-closed: a null service is a deliberate NOT_READY response so
// tests can verify the boundary.
type ChassisBundlesService = {
  preview(task: string, mode?: 'plan' | 'act'): Promise<unknown>;
  getReviewedBundle(bundleId: string): Promise<unknown | null>;
  listReviewedBundles(): Promise<Array<{ bundle_id: string; reviewed_at?: string; goal?: string; mode?: string; primary_skill?: string }>>;
};

// Subagent dispatch service (aide-subagent-dispatch runtime). The production
// build supplies a child AgentLoop service with an isolated scratch root and
// narrowed policy; a null service remains a deliberate fail-closed seam for
// route-contract tests and alternate deployments.
type AgentSubagentService = {
  spawn(request: AgentSubagentSpawnRequestT): Promise<{ child_session_id: string; parent_session_id: string; role: string; status: 'spawned' | 'running' | 'done' | 'aborted' | 'error' }>;
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
  // C6 agent-bundles service. The preview composes a bundle and persists
  // it; the run endpoint validates the bundle_id against the persisted
  // reviews before starting a session. A null service keeps the routes
  // not-ready (fail-closed) so the operator is told to wire the chassis
  // before driving the cockpit canary.
  chassisBundles?: ChassisBundlesService;
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
    }) },
    // C6 agent-bundles: preview composes the bundle + scaffold without
    // starting a session. Returns the bundle card (same shape as
    // GET /api/orchestrator/bundle-card) so the operator can review
    // why-this-skill, what-enters-context, and the helix state BEFORE
    // any tool runs. The review is persisted to .aide/bundle-reviews.json
    // so the operator can run the same bundle via POST /api/agent/bundles/run.
    { method: 'POST', path: '/api/agent/bundles/preview', body: AgentBundlePreviewRequest, response: AgentBundlePreviewResponse, handler: wrap(async ({ body }) => {
      if (!options.chassisBundles) throw new RouteError('NOT_READY', 'chassis bundles service is not wired on this instance');
      const request = body as { task: string; mode?: 'plan' | 'act' };
      return options.chassisBundles.preview(request.task, request.mode);
    }) },
    // C6 agent-bundles: run starts a session pinned to a previewed bundle.
    // The bundle_id MUST exist in the persisted review store — the
    // operator MUST preview first. The agent loop re-composes the bundle
    // internally so the session's chassis metadata is byte-identical to
    // the preview card. The agent-mode-off /api/chat route stays the
    // default; this is the agent-mode-on canary per report-source.md.
    { method: 'POST', path: '/api/agent/bundles/run', body: AgentBundleRunRequest, response: AgentBundleRunResponse, handler: wrap(async ({ body }) => {
      if (!options.chassisBundles) throw new RouteError('NOT_READY', 'chassis bundles service is not wired on this instance');
      const request = body as { bundle_id: string; chat_source?: 'local' | 'provider'; architectEditor?: boolean; expertAdvisory?: boolean };
      // Review store check: the operator MUST preview before run. This is
      // the chassis's "operator approves the bundle" gate; it does NOT
      // approve the tool calls (those still go through the per-tool
      // approval flow inside the agent loop).
      const reviewed = await options.chassisBundles.getReviewedBundle(request.bundle_id);
      if (!reviewed) throw new RouteError('FORBIDDEN', 'bundle_id not found in review store; call POST /api/agent/bundles/preview first');
      let chatFnOverride: ((messages: Array<{ role: string; content: string }>) => Promise<string>) | undefined;
      if (request.chat_source === 'provider') {
        if (!options.resolveProviderChatFn) throw new RouteError('NOT_READY', 'no provider resolver wired');
        const role = (reviewed as { mode?: string }).mode === 'plan' ? 'plan' as const : 'act' as const;
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
      if (request.expertAdvisory && options.consultExpert && chatFnOverride) {
        const inner = chatFnOverride;
        chatFnOverride = async (messages) => {
          let advisory: { expert: string; phase: string; confidence: number } | null = null;
          try {
            const ac = new AbortController();
            const timer = setTimeout(() => ac.abort(), 200);
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
      const goal = (reviewed as { goal?: string }).goal || '';
      const mode = (reviewed as { mode?: 'plan' | 'act' }).mode || 'act';
      const session = service.start(goal, mode, chatFnOverride, { architectEditor: request.architectEditor === true });
      return { session_id: session.session_id, bundle_id: request.bundle_id };
    }) }
  ];
}

// Subagent dispatch routes: spawn / list / status. A null service is retained
// as a fail-closed NOT_READY response so tests can verify the boundary.
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

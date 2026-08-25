import type { Route } from '../server.ts';
import { RouteError } from '../server.ts';
import { RouterError, type ModelRouter } from '../services/model-router.ts';
import type { ModelRuntime } from '../services/model-runtime.ts';
import type { ChatStore } from '../services/chat-store.ts';
import type { ChatRequestT, ChatMessageT, ChatStreamRequestT } from '../../../common/contracts/chat.ts';
import {
  ChatRequestCompat,
  ChatResponse,
  ChatStreamRequest,
  ChatStreamDelta,
  ChatStreamDone,
  ChatStreamError,
  ChatHistoryResponse,
  ChatHistorySaveRequest,
  ChatHistorySaveResponse
} from '../../../common/contracts/chat.ts';
import { createRequire } from 'node:module';

// Harness modules are plain ESM .mjs shared with the legacy daemon — single
// discipline source law: TS chat composes the SAME scaffold/gates/cipher
// functions, no reimplementation.
const require = createRequire(import.meta.url);
const { buildScaffold, injectScaffold, composeDriftReminder, estimateTokens, HARNESS_VERSION } = require('../../../harness/scaffold.mjs');
const { scoreCandidate } = require('../../../harness/gates.mjs');
const { createStateBus } = require('../../../harness/cipher-state.mjs');

type Msg = { role: string; content: string };

function toRouteError(error: unknown): RouteError {
  if (error instanceof RouterError) return new RouteError(error.code, error.message);
  if (error instanceof Error && error.name === 'AbortError') return new RouteError('TIMEOUT', 'chat stream aborted');
  return new RouteError('CHILD_FAILED', error instanceof Error ? error.message : 'chat failed');
}

export function routeForChat(router: ModelRouter, runtime: ModelRuntime, workspace: string): Route {
  return {
    method: 'POST',
    path: '/api/chat',
    body: ChatRequestCompat,
    response: ChatResponse,
    handler: async ({ body }) => {
      const request = body as ChatRequestT & { harness?: boolean };
      try {
        // Effective context = what the engine actually serves; scaffold tier
        // sizes from it. Refresh is fire-and-forget (first hit may be null).
        void runtime.refreshServedContext(request.modelId).catch(() => {});
        const effective = runtime.getEffectiveContext(request.modelId);
        const wantHarness = request.harness !== false;
        const t0 = performance.now();

        let messages: Msg[] = request.messages.map(m => ({ role: m.role, content: m.content }));
        if (wantHarness && effective !== null && effective >= 1024) {
          const scaffold = buildScaffold({ contextTokens: effective });
          let learnedLines: string[] = [];
          try { learnedLines = await createStateBus(workspace).getPreferences(3, 10); } catch { /* optional */ }
          const learnedBlock = learnedLines.length ? '\n\n[learned from previous interactions]\n' + learnedLines.join('\n') : '';
          messages = injectScaffold(messages, { system: scaffold.system + learnedBlock }) as Msg[];
          // Drift hook: PART-A reminder when transcript passes half window.
          const approxTokens = estimateTokens(messages);
          let drift = false;
          if (approxTokens > effective * 0.5) {
            messages = [...messages.slice(0, -1), { role: 'system', content: composeDriftReminder() }, ...messages.slice(-1)];
            drift = true;
          }
          const composeMs = Math.round((performance.now() - t0) * 100) / 100;
          const result = await gatedChat(router, request, messages);
          return {
            text: result.text,
            modelId: result.modelId,
            tokens: result.tokens,
            timingMs: result.timingMs,
            answer: result.text,
            gated: result.gated,
            harness: {
              injected: true,
              tier: scaffold.tier,
              bytes: scaffold.bytes,
              version: HARNESS_VERSION,
              served_context_tokens: effective,
              drift_reinjected: drift,
              approx_prompt_tokens: approxTokens,
              compose_ms: composeMs
            }
          };
        }
        // Harness disabled (battery A/B) or served window below scaffold floor.
        const result = await gatedChat(router, request, messages);
        return {
          text: result.text,
          modelId: result.modelId,
          tokens: result.tokens,
          timingMs: result.timingMs,
          answer: result.text,
          gated: result.gated,
          harness: {
            injected: false,
            reason: !wantHarness ? 'disabled by request' : `served context ${effective ?? 'unknown'} below 1024`,
            served_context_tokens: effective
          }
        };
      } catch (error) {
        throw toRouteError(error);
      }
    }
  };
}

// Gated Best-of-N (harness v2.2 semantics, ported from legacy manager.chat):
// N temperature-jittered samples scored by mechanical gates; first clean
// candidate wins (early stopping); otherwise lowest-penalty ships with
// honest meta.
async function gatedChat(
  router: ModelRouter,
  request: ChatRequestT & { harness?: boolean },
  messages: Msg[]
): Promise<{ text: string; modelId: string; tokens?: number; timingMs: number; gated?: { n: number; picked: number; all_passed: boolean; log: Array<{ attempt: number; temperature: number; pass: boolean; penalty: number }> } }> {
  const n = Math.min(Math.max(request.options?.n ?? 1, 1), 4);
  const baseTemp = request.options?.temperature ?? 0.2;
  if (n <= 1) {
    const only = await router.chat(request.modelId, messages as ChatMessageT[], {
      maxTokens: request.options?.maxTokens,
      temperature: baseTemp,
      timeoutMs: request.options?.timeoutMs
    });
    return only;
  }
  let best: { text: string; modelId: string; tokens?: number; timingMs: number } | null = null;
  let bestPenalty = Number.POSITIVE_INFINITY;
  const log: Array<{ attempt: number; temperature: number; pass: boolean; penalty: number }> = [];
  for (let attempt = 0; attempt < n; attempt++) {
    const temperature = attempt === 0 ? baseTemp : Math.min(baseTemp + attempt * 0.25, 1.2);
    const candidate = await router.chat(request.modelId, messages as ChatMessageT[], {
      maxTokens: request.options?.maxTokens,
      temperature,
      timeoutMs: request.options?.timeoutMs
    });
    const verdict = scoreCandidate(candidate.text) as { pass: boolean; penalty: number };
    log.push({ attempt, temperature, pass: verdict.pass, penalty: verdict.penalty });
    if (!best || verdict.penalty < bestPenalty) { best = candidate; bestPenalty = verdict.penalty; }
    if (verdict.pass) break;
  }
  return {
    ...best!,
    gated: { n: log.length, picked: log.findIndex(g => g.pass), all_passed: log.every(g => g.pass), log }
  };
}

export function routeForChatStream(router: ModelRouter): Route {
  return {
    method: 'POST',
    path: '/api/chat/stream',
    body: ChatStreamRequest,
    response: ChatStreamDone,
    handler: () => ({ done: true as const, modelId: '', usedApprox: 0, dropped: 0, truncatedSystem: false }),
    stream: async ({ body }, res) => {
      const request = body as ChatStreamRequestT;
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive'
      });
      const controller = new AbortController();
      let aborted = false;
      res.on('close', () => {
        aborted = true;
        controller.abort();
      });
      const write = (payload: unknown): void => {
        if (aborted) return;
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      };
      try {
        const result = await router.chatStream(request.modelId, request.messages, delta => {
          const parsed = ChatStreamDelta.safeParse({ delta });
          if (parsed.success) write(parsed.data);
        }, controller.signal);
        const done = ChatStreamDone.safeParse({
          done: true,
          modelId: result.modelId,
          usedApprox: result.usedApprox,
          dropped: result.dropped,
          truncatedSystem: result.truncatedSystem
        });
        if (done.success) write(done.data);
      } catch (error) {
        if (!aborted) {
          const parsed = ChatStreamError.safeParse({ error: error instanceof Error ? error.message : 'stream failed' });
          if (parsed.success) write(parsed.data);
        }
      } finally {
        if (!aborted) res.end();
      }
    }
  };
}

export function routeForChatHistory(store: ChatStore): Route {
  return {
    method: 'GET',
    path: '/api/chat/history',
    response: ChatHistoryResponse,
    handler: async () => ({ conversations: store.list() })
  };
}

export function routeForChatHistorySave(store: ChatStore): Route {
  return {
    method: 'POST',
    path: '/api/chat/history',
    body: ChatHistorySaveRequest,
    response: ChatHistorySaveResponse,
    handler: async ({ body }) => {
      const request = body as { id?: string; modelId: string; title: string; messages: { role: string; content: string }[] };
      const saved = await store.save(request);
      return { id: saved.id, updatedAt: saved.updatedAt };
    }
  };
}
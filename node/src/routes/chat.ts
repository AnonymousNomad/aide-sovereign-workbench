import type { Route } from '../server.ts';
import { RouteError } from '../server.ts';
import { RouterError, type ModelRouter } from '../services/model-router.ts';
import type { ChatStore } from '../services/chat-store.ts';
import type { ChatRequestT, ChatStreamRequestT } from '../../../common/contracts/chat.ts';
import {
  ChatRequest,
  ChatResponse,
  ChatStreamRequest,
  ChatStreamDelta,
  ChatStreamDone,
  ChatStreamError,
  ChatHistoryResponse,
  ChatHistorySaveRequest,
  ChatHistorySaveResponse
} from '../../../common/contracts/chat.ts';

function toRouteError(error: unknown): RouteError {
  if (error instanceof RouterError) return new RouteError(error.code, error.message);
  if (error instanceof Error && error.name === 'AbortError') return new RouteError('TIMEOUT', 'chat stream aborted');
  return new RouteError('CHILD_FAILED', error instanceof Error ? error.message : 'chat failed');
}

export function routeForChat(router: ModelRouter): Route {
  return {
    method: 'POST',
    path: '/api/chat',
    body: ChatRequest,
    response: ChatResponse,
    handler: async ({ body }) => {
      const request = body as ChatRequestT;
      try {
        const result = await router.chat(request.modelId, request.messages, request.options ?? {});
        return { text: result.text, modelId: result.modelId, tokens: result.tokens, timingMs: result.timingMs };
      } catch (error) {
        throw toRouteError(error);
      }
    }
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
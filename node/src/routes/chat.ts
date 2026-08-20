import type { Route } from '../server.ts';
import { RouteError } from '../server.ts';
import { ModelRuntimeError, type ModelRuntime } from '../services/model-runtime.ts';
import type { ChatStore } from '../services/chat-store.ts';
import {
  ChatRequest,
  ChatResponse,
  ChatStreamQuery,
  ChatStreamDelta,
  ChatStreamDone,
  ChatStreamError,
  ChatHistoryResponse,
  ChatHistorySaveRequest,
  ChatHistorySaveResponse
} from '../../../common/contracts/chat.ts';

function toRouteError(error: unknown): RouteError {
  if (error instanceof ModelRuntimeError) return new RouteError(error.code, error.message);
  if (error instanceof Error && error.name === 'AbortError') return new RouteError('TIMEOUT', 'chat stream aborted');
  return new RouteError('CHILD_FAILED', error instanceof Error ? error.message : 'chat failed');
}

export function routeForChat(manager: ModelRuntime): Route {
  return {
    method: 'POST',
    path: '/api/chat',
    body: ChatRequest,
    response: ChatResponse,
    handler: async ({ body }) => {
      const request = body as { modelId: string; messages: { role: string; content: string }[]; options?: { maxTokens?: number; temperature?: number } };
      try {
        return await manager.chat(request.modelId, request.messages, request.options ?? {});
      } catch (error) {
        throw toRouteError(error);
      }
    }
  };
}

export function routeForChatStream(manager: ModelRuntime): Route {  return {
    method: 'GET',
    path: '/api/chat/stream',
    query: ChatStreamQuery,
    response: ChatStreamDone,
    handler: () => ({ done: true as const, modelId: '' }),
    stream: async ({ query }, res) => {
      const request = query as unknown as { modelId: string; prompt: string };
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
        await manager.chatStream(request.modelId, request.prompt, delta => {
          const parsed = ChatStreamDelta.safeParse({ delta });
          if (parsed.success) write(parsed.data);
        }, controller.signal);
        write({ done: true, modelId: request.modelId });
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
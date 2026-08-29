import { type Route } from '../server.ts';
import { RouteError } from '../server.ts';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createTelegramBridge } = require('../services/telegram.mjs');

export type TelegramService = {
  status(): Promise<unknown>;
  connect(input: unknown): Promise<unknown>;
  authorizeChat(chatId: number): Promise<unknown>;
  disconnect(): Promise<unknown>;
  startPolling(): Promise<unknown>;
};

const z = require('zod') as typeof import('zod');

const ConnectBody = z.object({ token: z.string().min(10).regex(/^\d+:[A-Za-z0-9_-]+$/) }).strict();
const AuthorizeBody = z.object({ chat_id: z.number().int() }).strict();

function fail(error: unknown): RouteError {
  return new RouteError('CHILD_FAILED', error instanceof Error ? error.message : 'telegram bridge failure');
}

// Loose runtime envelope for status/connect results (shape asserted in battery).
const StatusEnvelope = z.object({
  connected: z.boolean(),
  bot_username: z.string().nullable(),
  chat_ids: z.array(z.number()),
  seen_chats: z.array(z.object({ chat_id: z.number(), first_name: z.string(), last_seen: z.string() }).passthrough()),
  running: z.boolean(),
  last_poll_at: z.string().nullable(),
  poll_cycles: z.number(),
  ignored_unknown_chats: z.number()
});

export function createTelegramBridgeService(workspace: string, onCommand?: (input: { chatId: number; text: string }) => Promise<string | null> | string | null): TelegramService {
  return createTelegramBridge({ workspace, onCommand }) as unknown as TelegramService;
}

export function routesForTelegram(service: TelegramService): Route[] {
  return [
    {
      method: 'GET',
      path: '/api/telegram/status',
      response: StatusEnvelope,
      handler: async () => service.status()
    },
    {
      method: 'POST',
      path: '/api/telegram/connect',
      body: ConnectBody,
      response: StatusEnvelope,
      handler: async ({ body }) => {
        try {
          await service.connect(body as { token: string });
          return await service.status();
        } catch (error) { throw fail(error); }
      }
    },
    {
      method: 'POST',
      path: '/api/telegram/authorize',
      body: AuthorizeBody,
      response: StatusEnvelope,
      handler: async ({ body }) => {
        try {
          await service.authorizeChat((body as { chat_id: number }).chat_id);
          // Make sure polling is on after a chat is authorized (handles the
          // case where the arch was restarted with a saved config but the
          // polling loop never started).
          await (service as { startPolling?: () => Promise<unknown> }).startPolling?.();
          return await service.status();
        } catch (error) { throw fail(error); }
      }
    },
    {
      method: 'POST',
      path: '/api/telegram/disconnect',
      response: StatusEnvelope,
      handler: async () => {
        try {
          await service.disconnect();
          return await service.status();
        } catch (error) { throw fail(error); }
      }
    },
    {
      method: 'POST',
      path: '/api/telegram/start',
      response: StatusEnvelope,
      handler: async () => {
        try {
          await (service as { startPolling?: () => Promise<unknown> }).startPolling!();
          return await service.status();
        } catch (error) { throw fail(error); }
      }
    }
  ];
}

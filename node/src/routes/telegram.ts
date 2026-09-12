import { type Route } from '../server.ts';
import { RouteError } from '../server.ts';
import { createRequire } from 'node:module';
import { AuthorityError, type ExecutionAuthority, type ExecutionHandle, type TelegramMessageHandle } from '../services/execution-authority.mjs';
import type { ErrorCode } from '../../../common/errors.ts';

const require = createRequire(import.meta.url);
const { createTelegramBridge } = require('../services/telegram.mjs');

export type TelegramService = {
  status(): Promise<unknown>;
  connect(input: unknown, execution?: ExecutionHandle): Promise<unknown>;
  authorizeChat(input: { chat_id: number; user_id?: number }, execution?: ExecutionHandle): Promise<unknown>;
  disconnect(execution?: ExecutionHandle): Promise<unknown>;
  startPolling(execution?: ExecutionHandle): Promise<unknown>;
};

const z = require('zod') as typeof import('zod');

const ConnectBody = z.object({ token: z.string().min(10).regex(/^\d+:[A-Za-z0-9_-]+$/) }).strict();
// Chat-only legacy calls retain transport allowlisting, not execution grants.
const AuthorizeBody = z.object({ chat_id: z.number().int().safe(), user_id: z.number().int().positive().safe().optional() }).strict();

function fail(error: unknown): RouteError {
  if (error instanceof RouteError) return error;
  if (error instanceof AuthorityError) return new RouteError(error.code as ErrorCode, error.message, error.detail);
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

export function createTelegramBridgeService(workspace: string, onCommand?: (input: { authorityMessage: TelegramMessageHandle }) => Promise<string | null> | string | null, authority?: ExecutionAuthority): TelegramService {
  return createTelegramBridge({ workspace, onCommand, authority }) as TelegramService;
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
      handler: async ({ body, execution }) => {
        try {
          await service.connect(body as { token: string }, execution);
          return await service.status();
        } catch (error) { throw fail(error); }
      }
    },
    {
      method: 'POST',
      path: '/api/telegram/authorize',
      body: AuthorizeBody,
      response: StatusEnvelope,
      handler: async ({ body, execution }) => {
        try {
          await service.authorizeChat(body as { chat_id: number; user_id?: number }, execution);
          // Starting network polling is a separate exact operation, not an
          // implicit side effect of a chat/identity grant.
          return await service.status();
        } catch (error) { throw fail(error); }
      }
    },
    {
      method: 'POST',
      path: '/api/telegram/disconnect',
      response: StatusEnvelope,
      handler: async ({ execution }) => {
        try {
          await service.disconnect(execution);
          return await service.status();
        } catch (error) { throw fail(error); }
      }
    },
    {
      method: 'POST',
      path: '/api/telegram/start',
      response: StatusEnvelope,
      handler: async ({ execution }) => {
        try {
          await service.startPolling(execution);
          return await service.status();
        } catch (error) { throw fail(error); }
      }
    }
  ];
}

import { type Route, type RouteContext, RouteError } from '../server.ts';
import {
  NotificationListResponse,
  NotificationReadRequest,
  NotificationReadAllRequest,
  HookListResponse,
  HooksPutRequest
} from '../../../common/contracts/notifications.ts';
import { NotificationService, HookValidationError } from '../../../node/src/services/notification-service.mjs';

function mapNotificationError(error: unknown): RouteError {
  if (error instanceof RouteError) return error;
  if (error instanceof HookValidationError) {
    const detail = (error as { detail?: { code?: string } }).detail;
    if (detail?.code === 'CONSENT_REQUIRED') {
      return new RouteError('FORBIDDEN', error.message, detail);
    }
    return new RouteError('BAD_REQUEST', error.message);
  }
  return new RouteError('INTERNAL', String((error as Error)?.message ?? error).slice(0, 500));
}

function wrap(handler: (ctx: RouteContext) => Promise<unknown> | unknown): (ctx: RouteContext) => Promise<unknown> {
  return async (ctx: RouteContext) => {
    try {
      return await handler(ctx);
    } catch (error) {
      throw mapNotificationError(error);
    }
  };
}

export function routesForNotifications(service: NotificationService): Route[] {
  return [
    { method: 'GET', path: '/api/notifications', response: NotificationListResponse, handler: wrap(async () => service.list()) },
    { method: 'GET', path: '/api/notifications/unread', response: NotificationListResponse, handler: wrap(async () => service.list({ unreadOnly: true })) },
    { method: 'POST', path: '/api/notifications/read', body: NotificationReadRequest, response: NotificationListResponse, handler: wrap(async ({ body }) => {
      const found = service.markRead((body as { id: string }).id);
      if (!found) throw new RouteError('NOT_FOUND', `notification ${(body as { id: string }).id} not found`);
      return service.list();
    }) },
    { method: 'POST', path: '/api/notifications/read-all', body: NotificationReadAllRequest, response: NotificationListResponse, handler: wrap(async () => {
      service.markAllRead();
      return service.list();
    }) },
    { method: 'GET', path: '/api/hooks', response: HookListResponse, handler: wrap(async () => service.listHooks()) },
    { method: 'PUT', path: '/api/hooks', body: HooksPutRequest, response: HookListResponse, handler: wrap(async ({ body }) => {
      service.setHooks(body);
      await fsWriteHooks(service.workspace, body);
      return service.listHooks();
    }) }
  ];
}

async function fsWriteHooks(workspace: string, value: unknown): Promise<void> {
  const { promises: fs } = await import('node:fs');
  const path = await import('node:path');
  const dir = path.join(workspace, '.aide');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'hooks.json'), JSON.stringify(value, null, 2), 'utf8');
}

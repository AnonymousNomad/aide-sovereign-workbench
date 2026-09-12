import { type Route, type RouteContext, RouteError } from '../server.ts';
import type { OperationInput } from '../../../common/security/operation-policy.mjs';
import {
  NotificationListResponse,
  NotificationReadRequest,
  NotificationReadAllRequest,
  HookListResponse,
  HooksPutRequest
} from '../../../common/contracts/notifications.ts';
import { NotificationService, HookValidationError, normalizeHooksFile } from '../../../node/src/services/notification-service.mjs';

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
  // Mutating notification/hook routes carry exact operation descriptors that
  // bind the normalized target/configuration; method+path enrollment alone is
  // never sufficient for these operations. Read-only routes are enrolled
  // centrally in common/security/operation-policy.mjs.
  const describeMutation = (body: unknown) => (taskId: string): OperationInput => ({
    workspace: service.workspace,
    taskId,
    kind: 'capability.write',
    args: { body }
  });
  const describeHooksWrite = ({ body }: RouteContext, taskId: string): OperationInput => {
    let normalized: unknown;
    try {
      normalized = normalizeHooksFile(body);
    } catch (error) {
      throw mapNotificationError(error);
    }
    return { workspace: service.workspace, taskId, kind: 'capability.write', args: { body: normalized } };
  };
  return [
    { method: 'GET', path: '/api/notifications', response: NotificationListResponse, handler: wrap(async () => service.list()) },
    { method: 'GET', path: '/api/notifications/unread', response: NotificationListResponse, handler: wrap(async () => service.list({ unreadOnly: true })) },
    { method: 'POST', path: '/api/notifications/read', body: NotificationReadRequest, response: NotificationListResponse, describeOperation: async (ctx, taskId) => describeMutation(ctx.body)(taskId), handler: wrap(async ({ body }) => {
      const found = service.markRead((body as { id: string }).id);
      if (!found) throw new RouteError('NOT_FOUND', `notification ${(body as { id: string }).id} not found`);
      return service.list();
    }) },
    { method: 'POST', path: '/api/notifications/read-all', body: NotificationReadAllRequest, response: NotificationListResponse, describeOperation: async (ctx, taskId) => describeMutation(ctx.body)(taskId), handler: wrap(async () => {
      service.markAllRead();
      return service.list();
    }) },
    { method: 'GET', path: '/api/hooks', response: HookListResponse, handler: wrap(async () => service.listHooks()) },
    { method: 'PUT', path: '/api/hooks', body: HooksPutRequest, response: HookListResponse, describeOperation: async (ctx, taskId) => describeHooksWrite(ctx, taskId), handler: wrap(async ({ body }) => {
      const normalized = normalizeHooksFile(body);
      service.setHooks(normalized);
      await fsWriteHooks(service.workspace, normalized);
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

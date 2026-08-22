import { z } from 'zod';

export const HookEvent = z.enum(['task.started', 'task.completed', 'task.failed', 'diagnostics.new']);
export type HookEventT = z.infer<typeof HookEvent>;

export const HookConfig = z
  .object({
    event: HookEvent,
    command: z.array(z.string().min(1)).min(1).max(16),
    show: z.boolean().optional(),
    timeout_ms: z.number().int().min(100).max(120000).optional(),
    network_consent: z.boolean().optional()
  })
  .strict();
export type HookConfigT = z.infer<typeof HookConfig>;

export const HooksFile = z
  .object({
    hooks: z.array(HookConfig).max(32)
  })
  .strict();
export type HooksFileT = z.infer<typeof HooksFile>;

export const Notification = z
  .object({
    id: z.string().min(1),
    severity: z.enum(['info', 'warn', 'error', 'success']),
    source: z.enum(['task', 'hook', 'daemon', 'user']),
    title: z.string().min(1),
    body: z.string().optional(),
    job_id: z.string().optional(),
    created_at: z.number(),
    read: z.boolean()
  })
  .strict();
export type NotificationT = z.infer<typeof Notification>;

export const NotificationListResponse = z
  .object({
    notifications: z.array(Notification),
    unread: z.number().int().nonnegative()
  })
  .strict();
export type NotificationListResponseT = z.infer<typeof NotificationListResponse>;

export const NotificationReadRequest = z
  .object({
    id: z.string().min(1)
  })
  .strict();
export type NotificationReadRequestT = z.infer<typeof NotificationReadRequest>;

export const NotificationReadAllRequest = z.object({}).strict();

export const HookListResponse = z
  .object({
    hooks: z.array(HookConfig)
  })
  .strict();
export type HookListResponseT = z.infer<typeof HookListResponse>;

export const HooksPutRequest = HooksFile;

export const NotificationEvent = z
  .object({
    id: z.string().min(1),
    severity: z.enum(['info', 'warn', 'error', 'success']),
    source: z.enum(['task', 'hook', 'daemon', 'user']),
    title: z.string().min(1),
    body: z.string().optional(),
    job_id: z.string().optional(),
    created_at: z.number(),
    read: z.boolean()
  })
  .strict();
export type NotificationEventT = z.infer<typeof NotificationEvent>;

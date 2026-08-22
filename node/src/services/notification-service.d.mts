import { buildToastScript } from './os-toast.mjs';

export type HookRunResult = {
  ok: boolean;
  timed_out: boolean;
  output: string;
  rejected?: string;
  hook_index?: number;
};

export declare class HookValidationError extends Error {
  constructor(message: string, detail?: unknown);
  name: 'HOOK_VALIDATION';
  detail?: unknown;
}

export declare function normalizeHooksFile(value: unknown): { hooks: Array<{
  event: 'task.started' | 'task.completed' | 'task.failed' | 'diagnostics.new';
  command: string[];
  show?: boolean;
  timeout_ms?: number;
  network_consent?: boolean;
}> };

export interface NotificationEntry {
  id: string;
  severity: 'info' | 'warn' | 'error' | 'success';
  source: 'task' | 'hook' | 'daemon' | 'user';
  title: string;
  body?: string;
  job_id?: string;
  created_at: number;
  read: boolean;
}

export interface TaskEventLike {
  event: string;
  job_id?: string;
  label?: string;
  exitCode?: number | null;
  signal?: string | null;
  problems?: unknown[];
  parent_job_id?: string | null;
}

export declare class NotificationService {
  workspace: string;
  constructor(options?: {
    workspace?: string;
    onEvent?: (notification: NotificationEntry) => void;
    clock?: () => number;
  });
  list(options?: { unreadOnly?: boolean }): { notifications: NotificationEntry[]; unread: number };
  record(input: {
    severity: NotificationEntry['severity'];
    source: NotificationEntry['source'];
    title: string;
    body?: string;
    job_id?: string;
  }): NotificationEntry;
  markRead(id: string): NotificationEntry | null;
  markAllRead(): number;
  loadHooks(): Promise<ReturnType<typeof normalizeHooksFile>['hooks']>;
  setHooks(value: unknown): ReturnType<typeof normalizeHooksFile>['hooks'];
  listHooks(): { hooks: ReturnType<typeof normalizeHooksFile>['hooks'] };
  ingestTaskEvent(evt: TaskEventLike): void;
  runHooks(eventName: 'task.started' | 'task.completed' | 'task.failed' | 'diagnostics.new', context?: Record<string, unknown>): Promise<Array<{ hook_index: number; ok: boolean; timed_out: boolean; output: string; rejected?: string }>>;
  runHookCommand(hook: { command: string[]; timeout_ms?: number }): Promise<HookRunResult>;
  setOsEnabled(value: boolean): void;
  maybeShowOsToast(input: { title: string; body?: string }): Promise<{ shown: boolean; reason: string }>;
}

export { buildToastScript };

import type { TaskEventT } from '../../../common/contracts/tasks.ts';
import type { ActorHandle, ExecutionAuthority } from './execution-authority.mjs';
import type { NotificationService } from './notification-service.mjs';

export interface HookExecutorOptions {
  authority?: ExecutionAuthority | undefined;
  notifications?: NotificationService | undefined;
}

export interface TaskEventMeta {
  owner?: ActorHandle;
}

export declare class HookExecutor {
  constructor(options?: HookExecutorOptions);
  close(): void;
  onTaskEvent(evt: TaskEventT, meta?: TaskEventMeta): void;
  /** Read-only observability for continuation cleanup; exposes no authority material. */
  pendingCount(): number;
}

import { type Route, type RouteContext, RouteError } from '../server.ts';
import {
  TaskListResponse,
  TaskRunRequest,
  TaskRunResponse,
  TaskStopRequest,
  TaskStatusResponse,
  MatchersResponse,
  CacheStatsResponse,
  CacheClearRequest,
  CacheClearResponse
} from '../../../common/contracts/tasks.ts';
import { TaskService, TaskFileError } from '../../../node/src/services/task-service.mjs';
import type { TaskEventT } from '../../../common/contracts/tasks.ts';
import { AuthorityError, type ExecutionAuthority } from '../services/execution-authority.mjs';

function mapTaskError(error: unknown): RouteError {
  if (error instanceof AuthorityError) throw error;
  const message = String((error as Error)?.message ?? error);
  if (error instanceof TaskFileError) {
    return new RouteError('BAD_REQUEST', message, error.detail);
  }
  if ((error as Error)?.name === 'TASK_RUNNING') return new RouteError('CONFLICT', message);
  if ((error as Error)?.name === 'NOT_FOUND') return new RouteError('NOT_FOUND', message);
  if ((error as Error)?.name === 'BAD_REQUEST') return new RouteError('BAD_REQUEST', message);
  return new RouteError('INTERNAL', message.slice(0, 500));
}

function wrap(handler: (ctx: RouteContext) => Promise<unknown> | unknown): (ctx: RouteContext) => Promise<unknown> {
  return async (ctx: RouteContext) => {
    try {
      return await handler(ctx);
    } catch (error) {
      throw mapTaskError(error);
    }
  };
}

export function routesForTasks(workspaceRoot: string, options: { onEvent?: (body: TaskEventT) => void; authority?: ExecutionAuthority | undefined } = {}): Route[] {
  const tasks = new TaskService({
    workspace: workspaceRoot,
    authority: options.authority,
    ...(options.onEvent ? { onEvent: options.onEvent } : {})
  });
  return [
    { method: 'GET', path: '/api/tasks', response: TaskListResponse, handler: wrap(async () => tasks.list()) },
    { method: 'GET', path: '/api/tasks/matchers', response: MatchersResponse, handler: wrap(async () => tasks.listMatchers()) },
    { method: 'POST', path: '/api/tasks/run', body: TaskRunRequest, response: TaskRunResponse, describeOperation: async ({ body }, taskId) => tasks.describeRun((body as { label: string }).label, taskId), handler: wrap(async ({ body, execution }) => tasks.run((body as { label: string }).label, execution)) },
    { method: 'POST', path: '/api/tasks/stop', body: TaskStopRequest, response: TaskStatusResponse, handler: wrap(async ({ body, execution }) => { await tasks.stop((body as { job_id: string }).job_id, execution); return tasks.status(); }) },
    { method: 'GET', path: '/api/tasks/status', response: TaskStatusResponse, handler: wrap(async () => tasks.status()) },
    { method: 'GET', path: '/api/tasks/cache/stats', response: CacheStatsResponse, handler: wrap(async () => tasks.cache.stats()) },
    { method: 'POST', path: '/api/tasks/cache/clear', body: CacheClearRequest, response: CacheClearResponse, describeOperation: async (_ctx, taskId) => tasks.cache.describe('clear', {}, taskId), handler: wrap(async ({ execution }) => ({ cleared: tasks.cache.clear(execution) })) }
  ];
}

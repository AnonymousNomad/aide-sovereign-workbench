import { type Route, type RouteContext, RouteError } from '../server.ts';
import {
  TaskListResponse,
  TaskRunRequest,
  TaskRunResponse,
  TaskStopRequest,
  TaskStatusResponse
} from '../../../common/contracts/tasks.ts';
import { TaskService, TaskFileError } from '../../../node/src/services/task-service.mjs';
import type { TaskEventT } from '../../../common/contracts/tasks.ts';

function mapTaskError(error: unknown): RouteError {
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

export function routesForTasks(workspaceRoot: string, options: { onEvent?: (body: TaskEventT) => void } = {}): Route[] {
  const tasks = new TaskService({
    workspace: workspaceRoot,
    ...(options.onEvent ? { onEvent: options.onEvent } : {})
  });
  return [
    { method: 'GET', path: '/api/tasks', response: TaskListResponse, handler: wrap(async () => tasks.list()) },
    { method: 'POST', path: '/api/tasks/run', body: TaskRunRequest, response: TaskRunResponse, handler: wrap(async ({ body }) => tasks.run((body as { label: string }).label)) },
    { method: 'POST', path: '/api/tasks/stop', body: TaskStopRequest, response: TaskStatusResponse, handler: wrap(async ({ body }) => { await tasks.stop((body as { job_id: string }).job_id); return tasks.status(); }) },
    { method: 'GET', path: '/api/tasks/status', response: TaskStatusResponse, handler: wrap(async () => tasks.status()) }
  ];
}

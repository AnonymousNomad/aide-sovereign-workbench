import type { TaskEventT } from '../../../common/contracts/tasks.ts';
import type { ActorHandle, ExecutionAuthority, ExecutionHandle } from './execution-authority.mjs';
import type { OperationInput } from '../../../common/security/operation-policy.mjs';

export interface TaskEventMeta {
  owner?: ActorHandle;
}

export declare const TASK_FILE_CANDIDATES: string[];
export declare const MAX_BUFFER_LINES: number;
export declare const WORKSPACE_MATCHERS_FILE: string;

export declare class TaskFileError extends Error {
  constructor(message: string, detail?: unknown);
  name: 'TASK_FILE';
  detail?: unknown;
}

export declare function validateTaskDefinition(value: unknown, index: number): void;

export interface ParsedTasksFile {
  version: '2.0.0';
  tasks: Array<Record<string, unknown>>;
}

export declare function parseTasksJson(raw: string): ParsedTasksFile;

export declare function normalizeGroup(group: unknown): { groupKind?: string; groupIsDefault?: boolean };

export declare function resolveCommand(type: string, command: string): string;

export declare function escapeCmdArg(arg: string): string;

export interface DetectedTask {
  label: string;
  type: 'process';
  command: string;
  args: string[];
  source: 'detected';
  script: string;
}

export declare function detectNpmTasks(pkgRaw: string): DetectedTask[];

export interface TaskSnapshot {
  job_id: string;
  label: string;
  command: string;
  args: string[];
  status: 'running' | 'exited' | 'failed' | 'stopped';
  exitCode: number | null;
  startedAt: number;
  endedAt: number | null;
}

export interface TaskListResult {
  fileFound: boolean;
  filePath: string | null;
  detectedFrom: string | null;
  tasks: Array<Record<string, unknown>>;
}

export type TaskEventBody = TaskEventT;

export declare class TaskService {
  constructor(options: { workspace: string; onEvent?: (body: TaskEventBody, meta?: TaskEventMeta) => void; cacheDir?: string; authority?: ExecutionAuthority | undefined });
  readonly cache: import('./build-cache.mjs').BuildCache;
  list(): Promise<TaskListResult>;
  loadWorkspaceMatchers(): Promise<Record<string, unknown>>;
  listMatchers(): Promise<{ matchers: Array<{ name: string; owner: string }> }>;
  findTask(label: string): Promise<Record<string, unknown> | null>;
  resolveJobMatcher(task: Record<string, unknown>): Promise<unknown[]>;
  describeRun(label: string, taskId: string): Promise<OperationInput & { args: { body: Record<string, unknown> } }>;
  run(label: string, execution?: ExecutionHandle): Promise<{ job_id: string }>;
  emitProblems(job: unknown): void;
  stop(jobId: string, execution?: ExecutionHandle): Promise<void>;
  status(): { jobs: TaskSnapshot[] };
}

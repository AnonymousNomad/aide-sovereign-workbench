import { z } from 'zod';

export const TaskGroup = z.union([
  z.enum(['build', 'test']),
  z.object({ kind: z.enum(['build', 'test']), isDefault: z.boolean() }).strict()
]);

export const TaskDefinition = z
  .object({
    label: z.string().min(1),
    type: z.enum(['shell', 'process']),
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
    isBackground: z.boolean().optional(),
    group: TaskGroup.optional(),
    problemMatcher: z.unknown().optional(),
    dependsOn: z.union([z.string(), z.array(z.string())]).optional(),
    dependsOrder: z.enum(['parallel', 'sequence']).optional(),
    runOptions: z.object({ runOn: z.enum(['default', 'folderOpen']) }).strict().optional()
  })
  .strict();

export const TasksFile = z
  .object({
    version: z.literal('2.0.0'),
    tasks: z.array(TaskDefinition)
  })
  .strict();

export const TaskEntry = TaskDefinition.extend({
  source: z.enum(['tasks.json', 'detected']),
  groupKind: z.enum(['build', 'test']).optional(),
  groupIsDefault: z.boolean().optional()
}).strict();

export const TaskListResponse = z
  .object({
    fileFound: z.boolean(),
    filePath: z.string().nullable(),
    detectedFrom: z.string().nullable(),
    tasks: z.array(TaskEntry)
  })
  .strict();

export const TaskRunRequest = z.object({ label: z.string().min(1) }).strict();
export const TaskRunResponse = z.object({ job_id: z.string().min(1) }).strict();
export const TaskStopRequest = z.object({ job_id: z.string().min(1) }).strict();

export const TaskJobStatus = z.enum(['running', 'exited', 'failed', 'stopped']);

export const TaskJob = z
  .object({
    job_id: z.string().min(1),
    label: z.string().min(1),
    command: z.string().min(1),
    args: z.array(z.string()),
    status: TaskJobStatus,
    exitCode: z.number().int().nullable(),
    startedAt: z.number(),
    endedAt: z.number().nullable()
  })
  .strict();

export const TaskStatusResponse = z.object({ jobs: z.array(TaskJob) }).strict();

export const TaskStartedEvent = z
  .object({ event: z.literal('started'), job_id: z.string().min(1), label: z.string() })
  .strict();
export const TaskOutputEvent = z
  .object({
    event: z.literal('output'),
    job_id: z.string().min(1),
    label: z.string(),
    stream: z.enum(['stdout', 'stderr']),
    line: z.string()
  })
  .strict();
export const TaskExitEvent = z
  .object({
    event: z.literal('exit'),
    job_id: z.string().min(1),
    label: z.string(),
    exitCode: z.number().int().nullable(),
    signal: z.string().nullable()
  })
  .strict();

export const TaskEvent = z.discriminatedUnion('event', [TaskStartedEvent, TaskOutputEvent, TaskExitEvent]);

export type TaskDefinitionT = z.infer<typeof TaskDefinition>;
export type TasksFileT = z.infer<typeof TasksFile>;
export type TaskEntryT = z.infer<typeof TaskEntry>;
export type TaskListResponseT = z.infer<typeof TaskListResponse>;
export type TaskRunRequestT = z.infer<typeof TaskRunRequest>;
export type TaskRunResponseT = z.infer<typeof TaskRunResponse>;
export type TaskStopRequestT = z.infer<typeof TaskStopRequest>;
export type TaskJobT = z.infer<typeof TaskJob>;
export type TaskStatusResponseT = z.infer<typeof TaskStatusResponse>;
export type TaskEventT = z.infer<typeof TaskEvent>;

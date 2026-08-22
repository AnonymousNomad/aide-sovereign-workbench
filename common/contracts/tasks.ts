import { z } from 'zod';

export const TaskGroup = z.union([
  z.enum(['build', 'test']),
  z.object({ kind: z.enum(['build', 'test']), isDefault: z.boolean() }).strict()
]);

export const ProblemPattern = z
  .object({
    regexp: z.string().min(1),
    file: z.number().int().positive().optional(),
    line: z.number().int().positive().optional(),
    column: z.number().int().positive().optional(),
    severity: z.number().int().positive().optional(),
    code: z.number().int().positive().optional(),
    message: z.number().int().positive().optional(),
    kind: z.enum(['file', 'location']).optional(),
    loop: z.boolean().optional()
  })
  .strict();

export const ProblemMatcher = z
  .object({
    name: z.string().min(1),
    owner: z.string().min(1),
    source: z.string().min(1).optional(),
    applyTo: z.enum(['allDocuments', 'openDocuments']).optional(),
    pattern: z.union([ProblemPattern, z.array(ProblemPattern).min(1)]),
    fileLocation: z
      .union([z.literal('relative'), z.literal('absolute'), z.tuple([z.literal('relative'), z.string().min(1)])])
      .optional(),
    background: z
      .object({
        activeOnStart: z.boolean(),
        beginsPattern: z.string().min(1),
        endsPattern: z.string().min(1)
      })
      .strict()
      .optional()
  })
  .strict();

export const MatcherReference = z.union([z.string().min(1), ProblemMatcher]);

export const TaskDefinition = z
  .object({
    label: z.string().min(1),
    type: z.enum(['shell', 'process']),
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
    isBackground: z.boolean().optional(),
    group: TaskGroup.optional(),
    problemMatcher: z.union([MatcherReference, z.array(MatcherReference).min(1)]).optional(),
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

export const ParsedProblem = z
  .object({
    file: z.string().min(1),
    line: z.number().int().positive(),
    column: z.number().int().nullable(),
    severity: z.enum(['error', 'warning', 'info']),
    message: z.string(),
    code: z.string().nullable()
  })
  .strict();

export const TaskProblemsEvent = z
  .object({
    event: z.literal('problems'),
    job_id: z.string().min(1),
    label: z.string(),
    problems: z.array(ParsedProblem)
  })
  .strict();

export const MatchersResponse = z
  .object({ matchers: z.array(z.object({ name: z.string(), owner: z.string() }).strict()) })
  .strict();

export const ProblemsParseRequest = z
  .object({
    matcher: z.union([MatcherReference, z.array(MatcherReference).min(1)]),
    text: z.string()
  })
  .strict();

export const ProblemsParseResponse = z
  .object({ problems: z.array(ParsedProblem), dropped: z.number().int().nonnegative() })
  .strict();

export const TaskEvent = z.discriminatedUnion('event', [
  TaskStartedEvent,
  TaskOutputEvent,
  TaskExitEvent,
  TaskProblemsEvent
]);

export type ProblemPatternT = z.infer<typeof ProblemPattern>;
export type ProblemMatcherT = z.infer<typeof ProblemMatcher>;
export type ParsedProblemT = z.infer<typeof ParsedProblem>;
export type TaskProblemsEventT = z.infer<typeof TaskProblemsEvent>;
export type MatchersResponseT = z.infer<typeof MatchersResponse>;
export type ProblemsParseRequestT = z.infer<typeof ProblemsParseRequest>;
export type ProblemsParseResponseT = z.infer<typeof ProblemsParseResponse>;
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

import { z } from 'zod';

export const AgentMode = z.enum(['plan', 'act']);

export const AgentSessionState = z.enum(['running', 'awaiting_approval', 'done', 'error', 'aborted']);

export const AgentStartRequest = z.object({
  task: z.string().min(1).max(8000),
  mode: AgentMode.optional(),
  chat_source: z.enum(['local', 'provider']).optional(),
  // Architect/Editor pattern (aide-architect-editor-pattern): opt-in
  // two-call decomposition per session. When true, each turn first
  // runs the architect pass (## Plan, no tool calls) and then the
  // editor pass (tool calls executing the plan). Bounded by
  // MAX_ARCHITECT_CYCLES in the loop; falls through to one-call
  // automatically after the cap.
  architectEditor: z.boolean().optional(),
  // Expert advisory (aide-micro-expert-collective skill, audit Week 1
  // item #7): when true, the route layer consults the task-router
  // micro-expert (1K-10K param distilled specialist) BEFORE the main
  // model call and prepends the result to the system prompt as a
  // non-blocking hint. The main model is never blocked on the expert.
  // Per the existing intent handler pattern: ADVISORY only, never gates.
  expertAdvisory: z.boolean().optional()
}).strict();

export const AgentStartResponse = z.object({
  session_id: z.string().min(1)
}).strict();

export const AgentApproval = z.object({
  approval_id: z.string().min(1),
  session_id: z.string().min(1),
  tool: z.string().min(1),
  args_preview: z.record(z.string(), z.string()),
  risks: z.array(z.string()),
  preview: z.string().nullable(),
  created_at: z.number().int()
}).strict();

export const AgentDecision = z.enum(['approve', 'reject', 'abort']);

export const AgentDecisionRequest = z.object({
  session_id: z.string().min(1),
  approval_id: z.string().min(1),
  decision: AgentDecision
}).strict();

export const AgentDecisionResponse = z.object({
  ok: z.boolean()
}).strict();

export const AgentStatusQuery = z.object({
  id: z.string().min(1)
}).strict();

export const AgentStatusResponse = z.object({
  session_id: z.string().min(1),
  state: AgentSessionState,
  mode: AgentMode,
  iterations: z.number().int().gte(0),
  mistake_count: z.number().int().gte(0),
  error: z.string().nullable(),
  pending_approval: AgentApproval.nullable()
}).strict();

export const AgentSessionsListResponse = z.object({
  sessions: z.array(AgentStatusResponse)
}).strict();

export const AgentToolInvokeRequest = z.object({
  name: z.string().min(1).max(64),
  arguments: z.record(z.string(), z.string()).optional(),
  sandbox: z.string().regex(/^[a-z0-9_-]{1,32}$/).optional(),
  approved: z.boolean().optional()
}).strict();

export const AgentToolObservation = z.object({
  ok: z.boolean(),
  output: z.string().max(20000),
  terminal: z.boolean().optional(),
  sandbox: z.string().nullable().optional()
}).strict();

export const AgentMessageEvent = z.object({
  event: z.literal('message'),
  session_id: z.string().min(1),
  text: z.string()
}).strict();

export const AgentToolCallEvent = z.object({
  event: z.literal('tool_call'),
  session_id: z.string().min(1),
  tool: z.string().min(1),
  args: z.record(z.string(), z.string())
}).strict();

export const AgentToolResultEvent = z.object({
  event: z.literal('tool_result'),
  session_id: z.string().min(1),
  tool: z.string().min(1),
  ok: z.boolean(),
  output: z.string()
}).strict();

export const AgentAwaitingApprovalEvent = z.object({
  event: z.literal('awaiting_approval'),
  session_id: z.string().min(1),
  approval: AgentApproval
}).strict();

export const AgentDoneEvent = z.object({
  event: z.literal('done'),
  session_id: z.string().min(1),
  summary: z.string()
}).strict();

export const AgentErrorEvent = z.object({
  event: z.literal('error'),
  session_id: z.string().min(1),
  error: z.string()
}).strict();

export const AgentAbortedEvent = z.object({
  event: z.literal('aborted'),
  session_id: z.string().min(1)
}).strict();

export const AgentStreamEvent = z.discriminatedUnion('event', [
  AgentMessageEvent,
  AgentToolCallEvent,
  AgentToolResultEvent,
  AgentAwaitingApprovalEvent,
  AgentDoneEvent,
  AgentErrorEvent,
  AgentAbortedEvent
]);

export type AgentModeT = z.infer<typeof AgentMode>;
export type AgentStartRequestT = z.infer<typeof AgentStartRequest>;
export type AgentApprovalT = z.infer<typeof AgentApproval>;
export type AgentStatusResponseT = z.infer<typeof AgentStatusResponse>;
export type AgentStreamEventT = z.infer<typeof AgentStreamEvent>;

// Subagent dispatch contracts (aide-subagent-dispatch skill, PR A).
// A subagent is a child AgentLoopService with a narrowed toolPolicy that
// returns a summary as a tool_result. The parent sees the summary, not the
// child's transcript. Default-deny on every tool except read + search.

export const AgentSubagentRole = z.enum([
  'researcher', 'coder', 'tester', 'reviewer', 'documenter', 'custom'
]);

export const AgentSubagentToolPolicy = z.object({
  allow_read: z.boolean().default(true),
  allow_search: z.boolean().default(true),
  allow_write: z.boolean().default(false),
  allow_edit: z.boolean().default(false),
  allow_run_command: z.boolean().default(false),
  allow_subagent_spawn: z.boolean().default(false),
  allow_desktop: z.boolean().default(false),
  allow_provider: z.boolean().default(false),
  allow_network: z.boolean().default(false),
  max_iterations: z.number().int().gte(1).lte(20).default(8),
  max_mistakes: z.number().int().gte(1).lte(5).default(3),
  workspace_jail: z.string().regex(/^[a-z0-9_\-\/]{1,128}$/).optional()
}).strict();

export const AgentSubagentSpawnRequest = z.object({
  parent_session_id: z.string().min(1),
  task: z.string().min(1).max(8000),
  role: AgentSubagentRole,
  policy: AgentSubagentToolPolicy.optional(),
  model: z.string().min(1).max(128).optional(),
  scratch_dir: z.string().regex(/^[a-z0-9_\-\/]{1,128}$/).optional()
}).strict();

export const AgentSubagentSpawnResponse = z.object({
  child_session_id: z.string().min(1),
  parent_session_id: z.string().min(1),
  role: z.string(),
  status: z.enum(['spawned', 'running', 'done', 'aborted', 'error'])
}).strict();

export const AgentSubagentStatus = z.object({
  child_session_id: z.string().min(1),
  parent_session_id: z.string().min(1),
  role: z.string(),
  status: z.enum(['running', 'done', 'aborted', 'error']),
  iterations: z.number().int().gte(0),
  mistake_count: z.number().int().gte(0),
  files_changed: z.array(z.string()),
  result_summary: z.string(),
  evidence: z.array(z.object({
    kind: z.string(),
    ref: z.string(),
    ok: z.boolean()
  })),
  started_at: z.number().int(),
  ended_at: z.number().int().nullable()
}).strict();

export const AgentSubagentListResponse = z.object({
  subagents: z.array(AgentSubagentStatus)
}).strict();

export type AgentSubagentRoleT = z.infer<typeof AgentSubagentRole>;
export type AgentSubagentToolPolicyT = z.infer<typeof AgentSubagentToolPolicy>;
export type AgentSubagentSpawnRequestT = z.infer<typeof AgentSubagentSpawnRequest>;
export type AgentSubagentSpawnResponseT = z.infer<typeof AgentSubagentSpawnResponse>;
export type AgentSubagentStatusT = z.infer<typeof AgentSubagentStatus>;
export type AgentSubagentListResponseT = z.infer<typeof AgentSubagentListResponse>;

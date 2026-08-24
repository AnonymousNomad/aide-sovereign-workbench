import { z } from 'zod';

export const AgentMode = z.enum(['plan', 'act']);

export const AgentSessionState = z.enum(['running', 'awaiting_approval', 'done', 'error', 'aborted']);

export const AgentStartRequest = z.object({
  task: z.string().min(1).max(8000),
  mode: AgentMode.optional(),
  chat_source: z.enum(['local', 'provider']).optional()
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

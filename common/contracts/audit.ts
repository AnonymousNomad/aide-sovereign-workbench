import { z } from 'zod';

// C6 release gate 4 (audit envelope): the read endpoint surfaces the
// cipher-state.jsonl bus with type/session_id/bundle_id/since/limit
// filters. The chassis v1 surface is whitelisted in
// node/src/services/audit-trail.mjs; the read endpoint validates
// incoming filter params against the strict zod schemas here.

export const AuditEventType = z.enum([
  'chat',
  'agent.start',
  'agent.message',
  'agent.tool.call',
  'agent.tool.result',
  'agent.approval',
  'agent.verification',
  'agent.context',
  'resident',
  'agent.bundle.preview',
  'agent.bundle.run',
  'subagent.spawn',
  'subagent.done',
  'subagent.error',
  'desktop',
  'approval',
  'rejection',
  'abort'
]);

export const AuditReadQuery = z.object({
  type: AuditEventType.optional(),
  session_id: z.string().min(1).max(128).optional(),
  bundle_id: z.string().min(1).max(128).optional(),
  since: z.string().datetime().optional(),
  limit: z.coerce.number().int().gte(1).lte(2000).default(200)
}).strict();

export const AuditEvent = z.object({
  type: z.string(),
  at: z.string().optional(),
  ts: z.string().optional(),
  session_id: z.string().optional(),
  parent_session_id: z.string().optional(),
  bundle_id: z.string().optional(),
  tool: z.string().optional(),
  decision: z.string().optional(),
  task: z.string().optional(),
  modelId: z.string().optional(),
  source: z.string().optional(),
  mode: z.string().optional(),
  chat_source: z.string().optional(),
  iteration: z.number().optional(),
  args_preview: z.string().optional(),
  output_preview: z.string().optional(),
  ok: z.boolean().optional(),
  primary_skill: z.string().optional(),
  role: z.string().optional(),
  child_session_id: z.string().optional(),
  status: z.string().optional(),
  files_changed: z.number().optional(),
  error: z.string().nullable().optional(),
  action: z.string().optional(),
  target: z.string().optional(),
  pattern: z.string().optional(),
  summary: z.string().optional()
}).passthrough();

export const AuditReadResponse = z.object({
  events: z.array(AuditEvent),
  count: z.number().int().gte(0),
  known_types: z.array(z.string())
}).strict();

export const AuditSessionResponse = z.object({
  session_id: z.string().min(1),
  event_count: z.number().int().gte(0),
  by_type: z.record(z.string(), z.array(AuditEvent)),
  first_at: z.string().nullable(),
  last_at: z.string().nullable()
}).strict();

export const AuditBundleResponse = z.object({
  bundle_id: z.string().min(1),
  event_count: z.number().int().gte(0),
  events: z.array(AuditEvent)
}).strict();

export type AuditEventT = z.infer<typeof AuditEvent>;
export type AuditReadQueryT = z.infer<typeof AuditReadQuery>;
export type AuditReadResponseT = z.infer<typeof AuditReadResponse>;
export type AuditSessionResponseT = z.infer<typeof AuditSessionResponse>;
export type AuditBundleResponseT = z.infer<typeof AuditBundleResponse>;

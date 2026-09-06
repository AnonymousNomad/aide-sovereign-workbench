import { z } from 'zod';

export const OrchestratorBundleCardQuery = z.object({
  task: z.string().min(1).max(8000),
  mode: z.enum(['plan', 'act']).optional()
}).strict();

const RoutingEvidence = z.object({
  stage: z.string(),
  signal: z.string(),
  score: z.number(),
  threshold: z.number(),
  decision: z.string(),
  timestamp: z.string()
}).passthrough();

const HelixCard = z.object({
  enabled: z.boolean(),
  skipped: z.boolean(),
  skipped_reason: z.string().nullable(),
  threshold: z.number(),
  min_trajectories: z.number().int().gte(0),
  matches: z.number().int().gte(0),
  bootstrap_visible: z.boolean()
}).strict();

const SkillCard = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  category: z.string().min(1),
  shim_used: z.boolean(),
  legacy: z.boolean()
}).strict();

export const OrchestratorBundleCardResponse = z.object({
  bundle_id: z.string().min(1),
  goal: z.string().min(1),
  mode: z.enum(['plan', 'act']),
  primary_skill: SkillCard,
  sop_names: z.array(z.string()),
  tool_set: z.array(z.string()),
  prompt_budget: z.object({ lines: z.number().int().gte(0), bytes: z.number().int().gte(0) }).strict(),
  helix: HelixCard,
  rationale: z.string(),
  routing_log: z.array(RoutingEvidence),
  scaffold: z.object({
    system: z.string(),
    bytes: z.number().int().gte(0),
    lines: z.number().int().gte(0),
    dropped: z.array(z.string())
  }).strict()
}).strict();

export type OrchestratorBundleCardQueryT = z.infer<typeof OrchestratorBundleCardQuery>;
export type OrchestratorBundleCardResponseT = z.infer<typeof OrchestratorBundleCardResponse>;

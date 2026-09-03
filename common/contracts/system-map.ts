// common/contracts/system-map.ts (cline/T4, 2026-09-03)
//
// PR A of aide-system-map. The 8-card dashboard snapshot.
// READ-ONLY doctrine: the snapshot NEVER contains key material.

import { z } from 'zod';

export const SubsystemId = z.enum([
  'inhouse_model',
  'workbenches',
  'skills',
  'agent_loop',
  'micro_experts',
  'helix_memory',
  'veritas_selfheal',
  'byok_desktop'
]);

export const SubsystemStatus = z.object({
  id: SubsystemId,
  state: z.enum(["live", "offline", "degraded", "not_wired"]),
  detail: z.string().max(500),
  last_updated: z.number().int(),
  doctrine: z.string().max(64)
}).strict();

export const SystemMapSnapshot = z.object({
  generated_at: z.number().int(),
  subsystems: z.array(SubsystemStatus).max(8)
}).strict();

export const SystemMapResponse = z.object({
  snapshot: SystemMapSnapshot
}).strict();

export type SubsystemIdT = z.infer<typeof SubsystemId>;
export type SubsystemStatusT = z.infer<typeof SubsystemStatus>;
export type SystemMapSnapshotT = z.infer<typeof SystemMapSnapshot>;
export type SystemMapResponseT = z.infer<typeof SystemMapResponse>;

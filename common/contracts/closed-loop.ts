import { z } from 'zod';

// Closed-loop status surface (aid-closed-loop-on-by-default wiring).
// The runner (`scripts/selfimprove.mjs`) is spawned by the arch daemon on
// startup and every 6h (gated by AIDE_CLOSED_LOOP !== 'false'). This read
// endpoint lets the cockpit show whether the loop is enabled, when it last
// ran, and how much failure signal it has emitted for the fine-tune lane.

export const ClosedLoopStatusResponse = z.object({
  enabled: z.boolean(),
  last_run_logged_at: z.string().nullable(),
  signal_file_count: z.number().int().gte(0),
  bus_event_count: z.number().int().gte(0)
}).strict();

export type ClosedLoopStatusT = z.infer<typeof ClosedLoopStatusResponse>;
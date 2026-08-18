import { z } from 'zod';

export const HealthResponse = z
  .object({
    version: z.string(),
    uptimeMs: z.number(),
    workspace: z.string(),
    freeMemoryMB: z.number()
  })
  .strict();

export type HealthResponseT = z.infer<typeof HealthResponse>;
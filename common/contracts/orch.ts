import { z } from 'zod';

export const OrchEngine = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  backend: z.string().nullable(),
  quant: z.string().nullable(),
  contextTokensDeclared: z.number().int().positive().nullable(),
  tokPerSecMeasured: z.number().nullable(),
  benchSource: z.enum(['measured', 'estimated']).nullable().optional()
}).strict();

export const OrchHardware = z.object({
  ramFreeMb: z.number(),
  ramTotalMb: z.number().nullable(),
  vramTotalMb: z.number().nullable(),
  vramFreeMb: z.number().nullable(),
  gpuName: z.string().nullable(),
  source: z.string()
}).strict();

export const OrchActivity = z.object({
  egressEventsTotal: z.number().int().gte(0),
  egressLast24h: z.number().int().gte(0),
  shipsCount: z.number().int().gte(0),
  lastShipAt: z.string().nullable(),
  reworkCount: z.number().int().gte(0)
}).strict();

export const OrchContextResponse = z.object({
  generatedAt: z.string(),
  hardware: OrchHardware,
  engines: z.array(OrchEngine),
  activity: OrchActivity
}).strict();

export type OrchEngineT = z.infer<typeof OrchEngine>;
export type OrchHardwareT = z.infer<typeof OrchHardware>;
export type OrchActivityT = z.infer<typeof OrchActivity>;
export type OrchContextResponseT = z.infer<typeof OrchContextResponse>;

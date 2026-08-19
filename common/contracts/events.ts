import { z } from 'zod';

export const LogEvent = z
  .object({
    level: z.enum(['info', 'warn', 'error']),
    message: z.string(),
    method: z.string().optional(),
    path: z.string().optional(),
    ms: z.number().optional(),
    code: z.string().optional()
  })
  .strict();

export const ModelStatusEvent = z
  .object({
    id: z.string(),
    status: z.enum(['stopped', 'loading', 'ready', 'error']),
    detail: z.string().optional()
  })
  .strict();

export const Marker = z
  .object({
    severity: z.number().int().min(1).max(8),
    message: z.string(),
    startLineNumber: z.number(),
    startColumn: z.number(),
    endLineNumber: z.number(),
    endColumn: z.number()
  })
  .strict();

export const DiagnosticsEvent = z
  .object({
    uri: z.string().min(1),
    markers: z.array(Marker)
  })
  .strict();

export const TrainingProgressEvent = z
  .object({
    job: z.string().min(1),
    step: z.number().int().nonnegative(),
    loss: z.number().optional(),
    status: z.string(),
    epoch: z.number().int().nonnegative().optional()
  })
  .strict();

export const EventEnvelope = z
  .object({
    channel: z.string().min(1),
    ts: z.number(),
    data: z.unknown()
  })
  .strict();
import { z } from 'zod';

export const ReplayRecord = z
  .object({
    id: z.string().min(1),
    task_class: z.string(),
    model: z.string(),
    status: z.string(),
    checks: z.record(z.string(), z.unknown()),
    created_at: z.string()
  })
  .strict();

export type ReplayRecordT = z.infer<typeof ReplayRecord>;

export const ReplaysResponse = z
  .object({
    schema_version: z.literal('1.0'),
    privacy: z.literal('metadata-only'),
    replays: z.array(ReplayRecord)
  })
  .strict();

export type ReplaysResponseT = z.infer<typeof ReplaysResponse>;

export const ReplayAddRequest = z
  .object({
    task_class: z.string().max(256).optional(),
    model: z.string().max(256).optional(),
    status: z.string().max(256).optional(),
    checks: z.record(z.string(), z.unknown()).optional()
  })
  .strict();

export type ReplayAddRequestT = z.infer<typeof ReplayAddRequest>;

export const ReplayAddResponse = z
  .object({
    replay: ReplayRecord
  })
  .strict();

export type ReplayAddResponseT = z.infer<typeof ReplayAddResponse>;
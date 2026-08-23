import { z } from 'zod';

export const TrainingPresetInfo = z
  .object({
    key: z.string().min(1),
    label: z.string().min(1),
    r: z.number().int().min(1),
    lora_alpha: z.number().int().min(1),
    learning_rate: z.number(),
    epochs: z.number().int().min(1),
    per_device_batch: z.number().int().min(1),
    gradient_accumulation: z.number().int().min(1),
    max_seq_len: z.number().int().min(64),
    fp16: z.boolean(),
    bf16: z.boolean()
  })
  .strict();

export type TrainingPresetInfoT = z.infer<typeof TrainingPresetInfo>;

export const TrainingPresetsResponse = z.object({ presets: z.array(TrainingPresetInfo) }).strict();

export type TrainingPresetsResponseT = z.infer<typeof TrainingPresetsResponse>;

export const TrainingStartRequest = z
  .object({
    dataset_id: z.string().min(1).max(128),
    preset: z.enum(['0.5b', '1.5b']).optional(),
    approved: z.literal(true)
  })
  .strict();

export type TrainingStartRequestT = z.infer<typeof TrainingStartRequest>;

export const TrainingStopRequest = z.object({}).strict();

export type TrainingStopRequestT = z.infer<typeof TrainingStopRequest>;

export const TrainingStopResponse = z
  .object({ stopped: z.boolean(), reason: z.string().optional() })
  .strict();

export type TrainingStopResponseT = z.infer<typeof TrainingStopResponse>;

const lossPoint = z.object({ at: z.number(), loss: z.number() }).strict();

export const TrainingStatusResponse = z
  .object({
    state: z.enum(['idle', 'preparing', 'training', 'done', 'error']),
    id: z.string().min(1).optional(),
    preset: z.string().min(1).optional(),
    dataset_id: z.string().min(1).optional(),
    sample_count: z.number().int().min(0).optional(),
    started_at: z.string().nullable().optional(),
    ended_at: z.string().nullable().optional(),
    exit_code: z.number().int().nullable().optional(),
    loss_last: z.number().nullable().optional(),
    loss_history: z.array(lossPoint).max(500).optional(),
    oom: z.boolean().optional(),
    oom_advice: z.array(z.string()).optional(),
    error: z.string().nullable().optional(),
    output_dir: z.string().optional()
  })
  .strict();

export type TrainingStatusResponseT = z.infer<typeof TrainingStatusResponse>;

export const TrainingCheckpointsQuery = z.object({ job_id: z.string().min(1).max(64).optional() }).strict();

export type TrainingCheckpointsQueryT = z.infer<typeof TrainingCheckpointsQuery>;

export const TrainingCheckpointsResponse = z
  .object({
    checkpoints: z.array(z.object({ name: z.string(), best_eval_loss: z.number().nullable() }).strict()).max(3)
  })
  .strict();

export type TrainingCheckpointsResponseT = z.infer<typeof TrainingCheckpointsResponse>;

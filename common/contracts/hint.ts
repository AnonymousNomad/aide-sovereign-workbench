import { z } from 'zod';

export const HintQuery = z
  .object({
    course: z.string().min(1).max(128),
    lesson: z.string().min(1).max(128),
    after: z.coerce.number().int().min(0).max(99).optional()
  })
  .strict();

export type HintQueryT = z.infer<typeof HintQuery>;

export const HintResponse = z
  .object({
    level: z.number().int().min(1).max(3),
    text: z.string().min(1).max(600),
    remaining: z.number().int().min(0)
  })
  .strict();

export const HintExhaustedResponse = z
  .object({
    exhausted: z.literal(true),
    revealed: z.number().int().min(0)
  })
  .strict();

export const HintResult = z.union([HintResponse, HintExhaustedResponse]);

export type HintResultT = z.infer<typeof HintResult>;

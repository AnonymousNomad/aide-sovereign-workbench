import { z } from 'zod';

export const PatchApplyRequest = z
  .object({
    patch: z.string(),
    approved: z.boolean()
  })
  .strict();

export const PatchApplyResponse = z
  .object({
    applied: z.boolean(),
    bytes: z.number()
  })
  .strict();

export type PatchApplyResponseT = z.infer<typeof PatchApplyResponse>;
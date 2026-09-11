import { z } from 'zod';

export const TerminalRunRequest = z
  .object({
    program: z.string().min(1),
    args: z.array(z.string()),
    approved: z.boolean()
  })
  .strict();

export const TerminalRunResponse = z
  .object({
    code: z.number(),
    stdout: z.string(),
    stderr: z.string()
  })
  .strict();

export type TerminalRunResponseT = z.infer<typeof TerminalRunResponse>;
import { z } from 'zod';

export const FileReadQuery = z
  .object({
    path: z.string().min(1)
  })
  .strict();

export const FileReadResponse = z
  .object({
    path: z.string(),
    content: z.string().nullable(),
    too_large: z.boolean(),
    size: z.number()
  })
  .strict();

export type FileReadResponseT = z.infer<typeof FileReadResponse>;

export const FileWriteRequest = z
  .object({
    path: z.string().min(1),
    content: z.string(),
    approved: z.boolean()
  })
  .strict();

export const FileWriteResponse = z
  .object({
    path: z.string(),
    bytes: z.number()
  })
  .strict();

export type FileWriteResponseT = z.infer<typeof FileWriteResponse>;
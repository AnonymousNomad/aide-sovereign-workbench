import { z } from 'zod';

export const FileEntry = z.object({ path: z.string().min(1), score: z.number() }).strict();

export type FileEntryT = z.infer<typeof FileEntry>;

export const QuickOpenQuery = z
  .object({
    q: z.string().min(1).max(128),
    limit: z.coerce.number().int().min(1).max(200).optional()
  })
  .strict();

export type QuickOpenQueryT = z.infer<typeof QuickOpenQuery>;

export const QuickOpenResponse = z
  .object({
    files: z.array(FileEntry),
    cache_age_ms: z.number().nonnegative()
  })
  .strict();

export type QuickOpenResponseT = z.infer<typeof QuickOpenResponse>;

export const RgSearchRequest = z
  .object({
    query: z.string().min(1).max(256),
    isRegex: z.boolean().optional(),
    caseSensitive: z.boolean().optional(),
    maxResults: z.number().int().min(1).max(10000).optional(),
    fileGlob: z.string().max(128).optional()
  })
  .strict();

export type RgSearchRequestT = z.infer<typeof RgSearchRequest>;

export const RgSubmatch = z.object({ text: z.string(), start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }).strict();

export type RgSubmatchT = z.infer<typeof RgSubmatch>;

export const RgMatch = z
  .object({
    path: z.string().min(1),
    line_number: z.number().int().positive(),
    line_text: z.string(),
    submatches: z.array(RgSubmatch)
  })
  .strict();

export type RgMatchT = z.infer<typeof RgMatch>;

export const RgSearchResponse = z
  .object({
    matches: z.array(RgMatch),
    truncated: z.boolean(),
    elapsed_ms: z.number().nonnegative()
  })
  .strict();

export type RgSearchResponseT = z.infer<typeof RgSearchResponse>;

export const RgFileListResponse = z
  .object({
    files: z.array(z.string()),
    truncated: z.boolean()
  })
  .strict();

export type RgFileListResponseT = z.infer<typeof RgFileListResponse>;

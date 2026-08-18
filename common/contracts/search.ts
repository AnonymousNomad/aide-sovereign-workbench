import { z } from 'zod';

export const SEARCH_DEFAULT_EXCLUDES = ['node_modules', 'target', '.git', 'dist', 'build'] as const;
export const SEARCH_MAX_QUERY = 200;
export const SEARCH_MAX_FILE_BYTES = 512 * 1024;
export const SEARCH_MAX_RESULTS = 400;
export const SEARCH_MAX_OCCURRENCES = 20000;
export const SEARCH_HIT_TEXT_SLICE = 300;

const Flag = z.enum(['0', '1']).optional();

export const SearchQuery = z
  .object({
    q: z.string().min(1).max(SEARCH_MAX_QUERY),
    regex: Flag,
    icase: Flag,
    word: Flag,
    mask: z.string().optional(),
    include: z.string().optional()
  })
  .strict();

export const SearchHit = z
  .object({
    line: z.number(),
    text: z.string()
  })
  .strict();

export const SearchFileResult = z
  .object({
    path: z.string(),
    hits: z.array(SearchHit)
  })
  .strict();

export const SearchResponse = z
  .object({
    query: z.string(),
    total: z.number(),
    regex: z.boolean(),
    caseInsensitive: z.boolean(),
    wholeWord: z.boolean(),
    fileMask: z.string(),
    results: z.array(SearchFileResult)
  })
  .strict();

export type SearchResponseT = z.infer<typeof SearchResponse>;

export const SearchReplaceRequest = z
  .object({
    query: z.string().min(1).max(SEARCH_MAX_QUERY),
    replacement: z.string(),
    approved: z.boolean(),
    regex: z.boolean().optional(),
    icase: z.boolean().optional(),
    word: z.boolean().optional(),
    mask: z.string().optional(),
    include: z.string().optional()
  })
  .strict();

export const SearchReplaceResponse = z
  .object({
    files_changed: z.number(),
    occurrences: z.number()
  })
  .strict();

export type SearchReplaceResponseT = z.infer<typeof SearchReplaceResponse>;
import { z } from 'zod';

export const IndexStatus = z.object({
  state: z.enum(['idle', 'scanning', 'embedding', 'ready', 'error']),
  files_total: z.number().int().nonnegative(),
  files_done: z.number().int().nonnegative(),
  chunks: z.number().int().nonnegative(),
  branch: z.string().nullable(),
  last_error: z.string().nullable(),
  updated_at: z.string(),
});
export type IndexStatusT = z.infer<typeof IndexStatus>;

export const IndexReindexRequest = z.strictObject({
  force: z.boolean().optional(),
});
export type IndexReindexRequestT = z.infer<typeof IndexReindexRequest>;

export const IndexReindexResponse = z.object({
  session_id: z.string(),
});
export type IndexReindexResponseT = z.infer<typeof IndexReindexResponse>;

export const HybridSearchQuery = z.strictObject({
  query: z.string().min(1),
  limit: z.coerce.number().int().positive().max(50).optional(),
});
export type HybridSearchQueryT = z.infer<typeof HybridSearchQuery>;

export const HybridResult = z.object({
  path: z.string(),
  line: z.number().int().nonnegative(),
  header: z.string(),
  rrf_score: z.number(),
  sparse_rank: z.number().int().nullable(),
  dense_rank: z.number().int().nullable(),
});
export type HybridResultT = z.infer<typeof HybridResult>;

export const HybridSearchResponse = z.object({
  results: z.array(HybridResult),
  degraded: z.boolean(),
});
export type HybridSearchResponseT = z.infer<typeof HybridSearchResponse>;

export const IndexStreamEvent = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('progress'),
    session_id: z.string(),
    files_done: z.number().int().nonnegative(),
    files_total: z.number().int().nonnegative(),
  }),
  z.strictObject({
    type: z.literal('ready'),
    session_id: z.string(),
    chunks: z.number().int().nonnegative(),
  }),
  z.strictObject({
    type: z.literal('error'),
    session_id: z.string(),
    message: z.string(),
  }),
]);
export type IndexStreamEventT = z.infer<typeof IndexStreamEvent>;

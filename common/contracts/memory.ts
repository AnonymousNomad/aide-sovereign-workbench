import { z } from 'zod';

export const DayDigest = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    ships: z.number().int().nonnegative(),
    files_touched: z.number().int().nonnegative(),
    approvals: z.number().int().nonnegative(),
    rejections: z.number().int().nonnegative(),
    aborts: z.number().int().nonnegative(),
    ship_intents: z.number().int().nonnegative(),
    tools_used: z.record(z.string(), z.number().int().nonnegative()),
    highlights: z.array(z.string().max(220)).max(10)
  })
  .strict();

export const MemoryDigestsQuery = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
  })
  .strict();

export const MemoryDigestsResponse = z
  .object({
    digests: z.array(DayDigest),
    refreshed: z.array(z.string()),
    retention: z.object({
      as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      day_digests: z.number().int().nonnegative(),
      monthly_summaries: z.array(z.string().regex(/^\d{4}-\d{2}$/)),
      yearly_summaries: z.array(z.string().regex(/^\d{4}$/)),
      warm_day_count: z.number().int().nonnegative(),
      monthly_summary_count: z.number().int().nonnegative(),
      yearly_summary_count: z.number().int().nonnegative()
    }).strict()
  })
  .strict();

export type DayDigestT = z.infer<typeof DayDigest>;

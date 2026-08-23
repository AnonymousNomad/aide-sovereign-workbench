import { z } from 'zod';

export const DatasetMeta = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    count: z.number().int().min(0),
    bytes: z.number().int().min(0),
    dup_skipped: z.number().int().min(0),
    created_at: z.string().min(1),
    updated_at: z.string().min(1)
  })
  .strict();

export type DatasetMetaT = z.infer<typeof DatasetMeta>;

export const DatasetListResponse = z.object({ datasets: z.array(DatasetMeta) }).strict();

export type DatasetListResponseT = z.infer<typeof DatasetListResponse>;

export const DatasetCreateRequest = z.object({ name: z.string().min(3).max(64) }).strict();

export type DatasetCreateRequestT = z.infer<typeof DatasetCreateRequest>;

export const DatasetSample = z.union([
  z.object({ text: z.string() }).strict(),
  z.object({ input: z.string(), output: z.string() }).strict()
]);

export const DatasetAppendRequest = z
  .object({
    id: z.string().min(1).max(128),
    samples: z.array(DatasetSample).min(1).max(1000)
  })
  .strict();

export type DatasetAppendRequestT = z.infer<typeof DatasetAppendRequest>;

export const DatasetAppendResponse = z
  .object({
    accepted: z.number().int().min(0),
    rejected_dupes: z.number().int().min(0),
    rejected_invalid: z.number().int().min(0),
    errors: z.array(z.string()).max(10)
  })
  .strict();

export type DatasetAppendResponseT = z.infer<typeof DatasetAppendResponse>;

export const DatasetReadQuery = z
  .object({
    id: z.string().min(1).max(128),
    offset: z.coerce.number().int().min(0).optional(),
    limit: z.coerce.number().int().min(1).max(500).optional()
  })
  .strict();

export type DatasetReadQueryT = z.infer<typeof DatasetReadQuery>;

export const DatasetReadResponse = z
  .object({
    total: z.number().int().min(0),
    offset: z.number().int().min(0),
    samples: z.array(z.record(z.string(), z.unknown()))
  })
  .strict();

export type DatasetReadResponseT = z.infer<typeof DatasetReadResponse>;

export const DatasetDeleteRequest = z.object({ id: z.string().min(1).max(128) }).strict();

export type DatasetDeleteRequestT = z.infer<typeof DatasetDeleteRequest>;

export const DatasetDeleteResponse = z.object({ deleted: z.boolean() }).strict();

export type DatasetDeleteResponseT = z.infer<typeof DatasetDeleteResponse>;

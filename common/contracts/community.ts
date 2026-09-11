import { z } from 'zod';

export const CommunityType = z.enum(['projects', 'issues', 'discussions', 'marketplace']);

export const CommunityItem = z
  .object({
    title: z.string(),
    detail: z.string(),
    status: z.string(),
    created_at: z.string(),
    updated_at: z.string().optional()
  })
  .strict();

export type CommunityItemT = z.infer<typeof CommunityItem>;

export const CommunityRoot = z
  .object({
    schema_version: z.string(),
    sync: z.string(),
    projects: z.array(CommunityItem),
    issues: z.array(CommunityItem),
    discussions: z.array(CommunityItem),
    marketplace: z.array(CommunityItem)
  })
  .strict();

export type CommunityRootT = z.infer<typeof CommunityRoot>;

export const CommunityItemAddRequest = z
  .object({
    type: CommunityType,
    item: z
      .object({
        title: z.string().max(160),
        detail: z.string().max(2000).optional(),
        status: z.string().max(128).optional()
      })
      .strict()
  })
  .strict();

export type CommunityItemAddRequestT = z.infer<typeof CommunityItemAddRequest>;

export const CommunityItemOperationRequest = z
  .object({
    type: CommunityType,
    index: z.number().int().min(0)
  })
  .strict();

export type CommunityItemOperationRequestT = z.infer<typeof CommunityItemOperationRequest>;

export const CommunityItemUpdateRequest = CommunityItemOperationRequest.extend({
  item: z
    .object({
      title: z.string().max(160).optional(),
      detail: z.string().max(2000).optional()
    })
    .strict()
}).strict();

export type CommunityItemUpdateRequestT = z.infer<typeof CommunityItemUpdateRequest>;

export const CommunityItemResponse = z
  .object({
    item: CommunityItem
  })
  .strict();

export type CommunityItemResponseT = z.infer<typeof CommunityItemResponse>;
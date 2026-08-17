import { z } from 'zod';

export const WorkspaceEntry = z
  .object({
    name: z.string(),
    kind: z.enum(['file', 'directory'])
  })
  .strict();

export const WorkspaceListResponse = z
  .object({
    workspace: z.string(),
    entries: z.array(WorkspaceEntry)
  })
  .strict();

export type WorkspaceListResponseT = z.infer<typeof WorkspaceListResponse>;
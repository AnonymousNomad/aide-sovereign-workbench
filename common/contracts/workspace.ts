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

export const WorkspaceTreeNode: z.ZodType<WorkspaceTreeNodeT> = z.lazy(() =>
  z
    .object({
      name: z.string(),
      path: z.string(),
      kind: z.enum(['file', 'directory']),
      children: z.array(WorkspaceTreeNode).optional()
    })
    .strict()
);

export const WorkspaceTreeResponse = z
  .object({
    workspace: z.string(),
    tree: z.array(WorkspaceTreeNode)
  })
  .strict();

export type WorkspaceListResponseT = z.infer<typeof WorkspaceListResponse>;
export type WorkspaceTreeNodeT = {
  name: string;
  path: string;
  kind: 'file' | 'directory';
  children?: WorkspaceTreeNodeT[] | undefined;
};
export type WorkspaceTreeResponseT = z.infer<typeof WorkspaceTreeResponse>;
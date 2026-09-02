import { z } from 'zod';

// Workbench bundle contracts. A "workbench" is a curated, installable bundle:
// plugins + skills + MCP servers + recommended local models, composed around
// one workflow. Doctrine (fail-closed): bundles are validated against real
// registries before install, MCP servers install DISABLED, and online
// (offline: false) servers additionally require egress consent.

export const WorkbenchMcpServer = z
  .object({
    name: z.string().min(1).max(64),
    transport: z.enum(['stdio', 'http']),
    command: z.string().max(200).optional(),
    args: z.array(z.string().max(500)).max(32).optional(),
    url: z.string().max(500).optional(),
    offline: z.boolean(),
    trusted: z.boolean()
  })
  .strict();

export const WorkbenchSummary = z
  .object({
    id: z.string().min(1).max(64),
    name: z.string().min(1).max(80),
    version: z.string().min(1).max(16),
    description: z.string().max(500),
    installed: z.boolean(),
    enabled: z.boolean(),
    plugins_count: z.number().int().min(0).max(64),
    skills_count: z.number().int().min(0).max(64),
    mcp_count: z.number().int().min(0).max(32),
    online_mcp_count: z.number().int().min(0).max(32),
    validated: z.boolean(),
    issues: z.array(z.string().max(300)).max(50)
  })
  .strict();

export const WorkbenchListResponse = z
  .object({
    workbenches: z.array(WorkbenchSummary).max(100)
  })
  .strict();

export const WorkbenchDetailResponse = z
  .object({
    workbench: z
      .object({
        id: z.string().min(1).max(64),
        name: z.string().min(1).max(80),
        version: z.string().min(1).max(16),
        description: z.string().max(500),
        offline_by_default: z.boolean(),
        installed: z.boolean(),
        enabled: z.boolean(),
        plugins: z.array(z.object({ id: z.string().min(1).max(64), enabled: z.boolean() }).strict()).max(64),
        skills: z.array(z.object({ id: z.string().min(1).max(64), enabled: z.boolean() }).strict()).max(64),
        mcp_servers: z.array(WorkbenchMcpServer).max(32),
        recommended_models: z
          .array(z.object({ role: z.string().min(1).max(32), model: z.string().min(1).max(80) }).strict())
          .max(16),
        setup: z.array(z.string().max(400)).max(20),
        validated: z.boolean(),
        issues: z.array(z.string().max(300)).max(50)
      })
      .strict()
  })
  .strict();

export const WorkbenchInstallRequest = z
  .object({
    id: z.string().min(1).max(64)
  })
  .strict();

export const WorkbenchTrustRequest = z
  .object({
    id: z.string().min(1).max(64),
    server: z.string().min(1).max(64),
    trusted: z.boolean()
  })
  .strict();

export const WorkbenchUninstallRequest = z
  .object({
    id: z.string().min(1).max(64)
  })
  .strict();

export const WorkbenchDetailRequest = z
  .object({
    id: z.string().min(1).max(64)
  })
  .strict();

export const WorkbenchUninstallResponse = z
  .object({
    removed: z.string().min(1).max(64)
  })
  .strict();

// Worktree-isolation contracts (PR A of aide-worktree-isolation). Shadow git
// worktree per session: agent writes to the worktree, user approves the merge.
export const WorktreeInfo = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,64}$/),
    branch: z.string().regex(/^aide-shadow\/[a-z0-9-]{1,64}$/),
    base_ref: z.string().min(1).max(200),
    path: z.string().min(1).max(1000),
    created_at: z.number().int().gte(0),
    diff_stats: z
      .object({
        files_changed: z.number().int().gte(0),
        insertions: z.number().int().gte(0),
        deletions: z.number().int().gte(0)
      })
      .strict()
      .optional()
  })
  .strict();

export const WorktreeCreateRequest = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,64}$/),
    base_ref: z.string().min(1).max(200).optional()
  })
  .strict();

export const WorktreeCreateResponse = z
  .object({
    worktree: WorktreeInfo
  })
  .strict();

export const WorktreeListResponse = z
  .object({
    worktrees: z.array(WorktreeInfo).max(100)
  })
  .strict();

export const WorktreeMergeRequest = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,64}$/),
    strategy: z.enum(['merge', 'squash', 'rebase']).default('squash'),
    commit_message: z.string().min(1).max(2000).default('Merge shadow worktree via AIDE')
  })
  .strict();

export const WorktreeMergeResponse = z
  .object({
    id: z.string(),
    strategy: z.enum(['merge', 'squash', 'rebase']),
    commit_sha: z.string().min(1).max(64),
    message: z.string().max(2000)
  })
  .strict();

export const WorktreeDiscardRequest = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,64}$/)
  })
  .strict();

export const WorktreeDiscardResponse = z
  .object({
    id: z.string(),
    state: z.literal('discarded')
  })
  .strict();


export type WorkbenchListResponseT = z.infer<typeof WorkbenchListResponse>;
export type WorkbenchDetailResponseT = z.infer<typeof WorkbenchDetailResponse>;
export type WorkbenchUninstallResponseT = z.infer<typeof WorkbenchUninstallResponse>;
export type WorktreeInfoT = z.infer<typeof WorktreeInfo>;
export type WorktreeCreateRequestT = z.infer<typeof WorktreeCreateRequest>;
export type WorktreeCreateResponseT = z.infer<typeof WorktreeCreateResponse>;
export type WorktreeListResponseT = z.infer<typeof WorktreeListResponse>;
export type WorktreeMergeRequestT = z.infer<typeof WorktreeMergeRequest>;
export type WorktreeMergeResponseT = z.infer<typeof WorktreeMergeResponse>;
export type WorktreeDiscardRequestT = z.infer<typeof WorktreeDiscardRequest>;
export type WorktreeDiscardResponseT = z.infer<typeof WorktreeDiscardResponse>;

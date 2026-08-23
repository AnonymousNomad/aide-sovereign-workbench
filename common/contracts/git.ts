import { z } from 'zod';

export const GitChange = z
  .object({
    path: z.string().min(1),
    orig_path: z.string().min(1).optional(),
    x: z.string().length(1),
    y: z.string().length(1),
    staged: z.boolean(),
    untracked: z.boolean(),
    conflict: z.boolean()
  })
  .strict();

export type GitChangeT = z.infer<typeof GitChange>;

export const GitStatusResponse = z
  .object({
    git_repo: z.boolean(),
    branch: z.string().nullable(),
    oid: z.string().nullable(),
    upstream: z.string().nullable(),
    ahead: z.number().int(),
    behind: z.number().int(),
    detached: z.boolean(),
    changes: z.array(GitChange)
  })
  .strict();

export const GitDiffRequest = z
  .object({
    path: z.string().min(1).optional(),
    cached: z.boolean().optional()
  })
  .strict();

export const GitDiffResponse = z
  .object({
    text: z.string(),
    truncated: z.boolean()
  })
  .strict();

export const GitPathsRequest = z
  .object({
    paths: z.array(z.string().min(1)).min(1).max(500)
  })
  .strict();

export const GitCommitRequest = z
  .object({
    message: z.string().min(1).max(8192)
  })
  .strict();

export const GitCommitResponse = z
  .object({
    oid: z.string()
  })
  .strict();

export const GitBranchesResponse = z
  .object({
    branches: z.array(z.object({ name: z.string(), current: z.boolean() }).strict())
  })
  .strict();

export const GitLogRequest = z
  .object({
    limit: z.number().int().min(1).max(200).optional()
  })
  .strict();

export const GitFileLogRequest = z
  .object({
    path: z.string().min(1),
    limit: z.number().int().min(1).max(200).optional()
  })
  .strict();

export const GitCommitSummary = z
  .object({
    oid: z.string(),
    short: z.string(),
    author: z.string(),
    date: z.string(),
    subject: z.string()
  })
  .strict();

export const GitLogResponse = z
  .object({
    commits: z.array(GitCommitSummary)
  })
  .strict();

export const GitHunksRequest = z
  .object({
    path: z.string().min(1)
  })
  .strict();

export const GitHunk = z
  .object({
    index: z.number().int().min(1),
    header: z.string(),
    lines: z.array(z.string())
  })
  .strict();

export const GitHunksResponse = z
  .object({
    hunks: z.array(GitHunk),
    truncated: z.boolean()
  })
  .strict();

export const GitStageHunksRequest = z
  .object({
    path: z.string().min(1),
    indexes: z.array(z.number().int().min(1)).min(1)
  })
  .strict();

export const GitStageHunksResponse = z
  .object({
    staged_indexes: z.array(z.number().int())
  })
  .strict();

export const GitBlameRequest = z
  .object({
    path: z.string().min(1)
  })
  .strict();

export const GitBlameLine = z
  .object({
    commit: z.string(),
    line_number: z.number().int().min(1),
    author: z.string().optional(),
    text: z.string()
  })
  .strict();

export const GitBlameResponse = z
  .object({
    lines: z.array(GitBlameLine),
    truncated: z.boolean()
  })
  .strict();

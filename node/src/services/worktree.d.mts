// node/src/services/worktree.d.mts (aide-typescript-strict-pass SKILL, 2026-09-02)
//
// Type companion for worktree.mjs. The .mjs service is a real implementation
// (uses execFile('git', ...)); this file declares its shape to TypeScript so
// .ts importers (e.g. node/src/routes/workbenches.ts) can use the service
// without falling back to `any` or to `// @ts-ignore`.
//
// Pattern: mirror the export surface 1:1. `declare` for classes/interfaces,
// plain `export function` for free functions. No behavior, no business logic.
// Per the established repo convention (see agent-loop.d.mts, git-service.d.mts,
// modelhub.d.mts), the companion is a sibling of the .mjs.
import type { WorktreeInfoT } from '../../common/contracts/workbench.ts';

export type WorktreeStrategy = 'merge' | 'squash' | 'rebase';

export type WorktreeErrorCode =
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'BRANCH_HOLD'
  | 'CONFLICT'
  | 'GIT_FAILED';

export declare class WorktreeError extends Error {
  code: WorktreeErrorCode;
  constructor(code: WorktreeErrorCode, message: string);
}

export declare interface WorktreeService {
  create(args: { id: string; baseRef?: string }): Promise<WorktreeInfoT>;
  list(): Promise<WorktreeInfoT[]>;
  merge(args: { id: string; strategy?: WorktreeStrategy; commit_message?: string }): Promise<{
    id: string;
    strategy: WorktreeStrategy;
    commit_sha: string;
    message: string;
  }>;
  discard(args: { id: string }): Promise<{ id: string; state: 'discarded' }>;
}

export declare function createWorktreeService(options: { workspace: string }): WorktreeService;

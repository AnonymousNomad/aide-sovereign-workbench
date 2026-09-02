import { type Route, type RouteContext, RouteError } from '../server.ts';
import {
  WorkbenchListResponse,
  WorkbenchDetailResponse,
  WorkbenchDetailRequest,
  WorkbenchInstallRequest,
  WorkbenchTrustRequest,
  WorkbenchUninstallRequest,
  WorkbenchUninstallResponse,
  WorktreeCreateRequest,
  WorktreeCreateResponse,
  WorktreeListResponse,
  WorktreeMergeRequest,
  WorktreeMergeResponse,
  WorktreeDiscardRequest,
  WorktreeDiscardResponse,
  type WorkbenchListResponseT,
  type WorkbenchDetailResponseT,
  type WorkbenchUninstallResponseT,
  type WorktreeCreateResponseT,
  type WorktreeListResponseT,
  type WorktreeMergeResponseT,
  type WorktreeDiscardResponseT
} from '../../../common/contracts/workbench.ts';
import { WorkbenchManager, WorkbenchValidationError, WorkbenchTrustError } from '../../../workbenches/manager.mjs';
import { createWorktreeService, WorktreeError } from '../services/worktree.mjs';

function mapWorkbenchError(error: unknown): RouteError {
  if (error instanceof RouteError) return error;
  if (error instanceof WorktreeError) return new RouteError(mapWorktreeCode(error.code), error.message);
  if (error instanceof WorkbenchTrustError) {
    // Opt-in online doctrine: trusting an offline:false server without
    // egress consent is FORBIDDEN, never silently downgraded.
    return new RouteError('FORBIDDEN', error.message, error.detail);
  }
  if (error instanceof WorkbenchValidationError) {
    return new RouteError('BAD_REQUEST', error.message, { issues: error.issues ?? [] });
  }
  return new RouteError('INTERNAL', String((error as Error)?.message ?? error).slice(0, 500));
}

function mapWorktreeCode(code: string): 'BAD_REQUEST' | 'NOT_FOUND' | 'CONFLICT' | 'INTERNAL' {
  switch (code) {
    case 'VALIDATION': return 'BAD_REQUEST';
    case 'NOT_FOUND': return 'NOT_FOUND';
    case 'ALREADY_EXISTS':
    case 'BRANCH_HOLD':
    case 'CONFLICT': return 'CONFLICT';
    default: return 'INTERNAL';
  }
}

function wrap(handler: (ctx: RouteContext) => Promise<unknown> | unknown): (ctx: RouteContext) => Promise<unknown> {
  return async (ctx: RouteContext) => {
    try {
      return await handler(ctx);
    } catch (error) {
      throw mapWorkbenchError(error);
    }
  };
}

export function routesForWorkbenches(manager: WorkbenchManager): Route[] {
  return [
    { method: 'GET', path: '/api/workbenches', response: WorkbenchListResponse, handler: wrap(async () => manager.list() as unknown as WorkbenchListResponseT) },
    { method: 'POST', path: '/api/workbenches/detail', body: WorkbenchDetailRequest, response: WorkbenchDetailResponse, handler: wrap(async ({ body }) => manager.get((body as { id: string }).id) as unknown as WorkbenchDetailResponseT) },
    { method: 'POST', path: '/api/workbenches/install', body: WorkbenchInstallRequest, response: WorkbenchDetailResponse, handler: wrap(async ({ body }) => manager.install((body as { id: string }).id) as unknown as WorkbenchDetailResponseT) },
    { method: 'POST', path: '/api/workbenches/trust', body: WorkbenchTrustRequest, response: WorkbenchDetailResponse, handler: wrap(async ({ body }) => {
        const request = body as { id: string; server: string; trusted: boolean };
        return manager.setTrust(request.id, request.server, request.trusted) as unknown as WorkbenchDetailResponseT;
      }) },
    { method: 'POST', path: '/api/workbenches/uninstall', body: WorkbenchUninstallRequest, response: WorkbenchUninstallResponse, handler: wrap(async ({ body }) => manager.uninstall((body as { id: string }).id) as unknown as WorkbenchUninstallResponseT) }
  ];
}

// PR A of aide-worktree-isolation: 3 shadow-worktree routes. Service is pure
// (no I/O outside workspace/.aide/worktrees); merge/discard are user-triggered,
// agent sees the result (pitfall 4 — never auto-merge).
export function routesForWorktree(workspace: string): Route[] {
  const svc = createWorktreeService({ workspace });
  return [
    { method: 'POST', path: '/api/workbench/worktree/create', body: WorktreeCreateRequest, response: WorktreeCreateResponse, handler: wrap(async ({ body }) => {
        const r = body as { id: string; base_ref?: string };
        const wt = await svc.create({ id: r.id, ...(r.base_ref ? { baseRef: r.base_ref } : {}) });
        return { worktree: { id: wt.id, branch: wt.branch, base_ref: wt.base_ref, path: wt.path, created_at: wt.created_at, diff_stats: undefined } } as unknown as WorktreeCreateResponseT;
      })
    },
    { method: 'GET', path: '/api/workbench/worktree/list', response: WorktreeListResponse, handler: wrap(async () => {
        const wts = await svc.list();
        return { worktrees: wts.map((w) => ({ id: w.id, branch: w.branch, base_ref: w.base_ref, path: w.path, created_at: w.created_at, diff_stats: w.diff_stats })) } as unknown as WorktreeListResponseT;
      })
    },
    { method: 'POST', path: '/api/workbench/worktree/merge', body: WorktreeMergeRequest, response: WorktreeMergeResponse, handler: wrap(async ({ body }) => {
        const r = body as { id: string; strategy?: 'merge' | 'squash' | 'rebase'; commit_message?: string };
        const m = await svc.merge({ id: r.id, strategy: r.strategy ?? 'squash', commit_message: r.commit_message ?? '' });
        return { id: m.id, strategy: m.strategy, commit_sha: m.commit_sha, message: m.message } as unknown as WorktreeMergeResponseT;
      })
    },
    { method: 'POST', path: '/api/workbench/worktree/discard', body: WorktreeDiscardRequest, response: WorktreeDiscardResponse, handler: wrap(async ({ body }) => {
        const r = body as { id: string };
        const d = await svc.discard({ id: r.id });
        return { id: d.id, state: 'discarded' as const } as unknown as WorktreeDiscardResponseT;
      })
    }
  ];
}
import { type Route, type RouteContext, RouteError } from '../server.ts';
import {
  GitStatusResponse,
  GitDiffRequest,
  GitDiffResponse,
  GitPathsRequest,
  GitCommitRequest,
  GitCommitResponse,
  GitBranchesResponse,
  GitLogRequest,
  GitFileLogRequest,
  GitLogResponse,
  GitHunksRequest,
  GitHunksResponse,
  GitStageHunksRequest,
  GitStageHunksResponse,
  GitBlameRequest,
  GitBlameResponse
} from '../../../common/contracts/git.ts';
import { GitService } from '../../../node/src/services/git-service.mjs';

function mapGitError(error: unknown): RouteError {
  const message = String((error as Error)?.message ?? error);
  if ((error as Error)?.name === 'PATH_ESCAPE') return new RouteError('BAD_REQUEST', message);
  if ((error as Error)?.name === 'EMPTY_MESSAGE') return new RouteError('BAD_REQUEST', 'commit message must not be empty');
  if ((error as Error)?.name === 'BAD_REQUEST') return new RouteError('BAD_REQUEST', message);
  if (/not a git repository|not a work tree/i.test(message)) return new RouteError('NOT_A_REPO', 'workspace is not a git repository');
  if (/did not match any files|no such path|pathspec/i.test(message)) return new RouteError('BAD_REQUEST', message);
  if (/has no commits yet|does not have any commits yet/i.test(message)) return new RouteError('BAD_REQUEST', 'file has no commits to blame');
  if (/refs\/heads|lock/i.test(message) && /commit/i.test(message)) return new RouteError('COMMIT_FAILED', message);
  if ((error as { killed?: boolean })?.killed === true || /timed out/i.test(message)) return new RouteError('TIMEOUT', 'git operation timed out');
  return new RouteError('INTERNAL', message.slice(0, 500));
}

function wrap(handler: (ctx: RouteContext) => Promise<unknown> | unknown): (ctx: RouteContext) => Promise<unknown> {
  return async (ctx: RouteContext) => {
    try {
      return await handler(ctx);
    } catch (error) {
      throw mapGitError(error);
    }
  };
}

export function routesForGit(workspaceRoot: string): Route[] {
  const git = new GitService({ workspace: workspaceRoot });
  return [
    { method: 'GET', path: '/api/git/status', response: GitStatusResponse, handler: wrap(async () => git.status()) },
    { method: 'POST', path: '/api/git/diff', body: GitDiffRequest, response: GitDiffResponse, handler: wrap(async ({ body }) => git.diff((body as { path?: string }).path, (body as { cached?: boolean }).cached === true)) },
    { method: 'POST', path: '/api/git/stage', body: GitPathsRequest, response: GitCommitResponse, handler: wrap(async ({ body }) => { await git.stage((body as { paths: string[] }).paths); const head = await git.run(['rev-parse', 'HEAD']).catch(() => null); return { oid: head ? head.stdout.trim() : '' }; }) },
    { method: 'POST', path: '/api/git/unstage', body: GitPathsRequest, response: GitCommitResponse, handler: wrap(async ({ body }) => { await git.unstage((body as { paths: string[] }).paths); const head = await git.run(['rev-parse', 'HEAD']).catch(() => null); return { oid: head ? head.stdout.trim() : '' }; }) },
    { method: 'POST', path: '/api/git/commit', body: GitCommitRequest, response: GitCommitResponse, handler: wrap(async ({ body }) => git.commit((body as { message: string }).message)) },
    { method: 'GET', path: '/api/git/branches', response: GitBranchesResponse, handler: wrap(async () => git.branches()) },
    { method: 'POST', path: '/api/git/log', body: GitLogRequest, response: GitLogResponse, handler: wrap(async ({ body }) => git.log((body as { limit?: number }).limit)) },
    { method: 'POST', path: '/api/git/file-log', body: GitFileLogRequest, response: GitLogResponse, handler: wrap(async ({ body }) => git.fileLog((body as { path: string }).path, (body as { limit?: number }).limit)) },
    { method: 'POST', path: '/api/git/hunks/list', body: GitHunksRequest, response: GitHunksResponse, handler: wrap(async ({ body }) => git.hunks((body as { path: string }).path)) },
    { method: 'POST', path: '/api/git/hunks/stage', body: GitStageHunksRequest, response: GitStageHunksResponse, handler: wrap(async ({ body }) => git.stageHunks((body as { path: string; indexes: number[] }).path, (body as { indexes: number[] }).indexes)) },
    { method: 'POST', path: '/api/git/hunks/unstage', body: GitStageHunksRequest, response: GitStageHunksResponse, handler: wrap(async ({ body }) => git.unstageHunks((body as { path: string; indexes: number[] }).path, (body as { indexes: number[] }).indexes)) },
    { method: 'POST', path: '/api/git/blame', body: GitBlameRequest, response: GitBlameResponse, handler: wrap(async ({ body }) => git.blame((body as { path: string }).path)) }
  ];
}

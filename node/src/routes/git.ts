import { type Route, type RouteContext, RouteError } from '../server.ts';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
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
  GitBlameResponse,
  GitCheckoutRequest,
  GitCheckoutResponse,
  GitPushRequest,
  GitPushResponse
} from '../../../common/contracts/git.ts';
import { GitService } from '../../../node/src/services/git-service.mjs';

function mapGitError(error: unknown): RouteError {
  const message = String((error as Error)?.message ?? error);
  if ((error as Error)?.name === 'PATH_ESCAPE') return new RouteError('BAD_REQUEST', message);
  if ((error as Error)?.name === 'EMPTY_MESSAGE') return new RouteError('BAD_REQUEST', 'commit message must not be empty');
  if ((error as Error)?.name === 'DIRTY_TREE') return new RouteError('BAD_REQUEST', 'working tree has uncommitted changes — commit or ship before switching branches');
  if ((error as Error)?.name === 'BAD_REQUEST') return new RouteError('BAD_REQUEST', message);
  if (/not a git repository|not a work tree/i.test(message)) return new RouteError('NOT_A_REPO', 'workspace is not a git repository');
  if (/did not match any files|no such path|pathspec/i.test(message)) return new RouteError('BAD_REQUEST', message);
  if (/no changes added to commit|nothing to commit/i.test(message)) return new RouteError('BAD_REQUEST', 'no changes to commit');
  if (/has no commits yet|does not have any commits yet/i.test(message)) return new RouteError('BAD_REQUEST', 'file has no commits to blame');
  if (/refs\/heads|lock/i.test(message) && /commit/i.test(message)) return new RouteError('COMMIT_FAILED', message);
  if ((error as { killed?: boolean })?.killed === true || /timed out/i.test(message)) return new RouteError('TIMEOUT', 'git operation timed out');
  return new RouteError('INTERNAL', message.slice(0, 500));
}

async function recordShip(workspaceRoot: string, message: string, intent: string | undefined) {
  try {
    await mkdir(path.join(workspaceRoot, '.aide', 'metrics'), { recursive: true });
    await appendFile(
      path.join(workspaceRoot, '.aide', 'metrics', 'ships.log'),
      JSON.stringify({ at: new Date().toISOString(), intent: String(intent || '').slice(0, 200), message: message.slice(0, 200) }) + '\n',
      'utf8'
    );
  } catch {
    // telemetry is best-effort — never blocks the commit
  }
}

async function recordEgress(workspaceRoot: string, remote: string, branch: string) {
  try {
    await mkdir(path.join(workspaceRoot, '.aide', 'logs'), { recursive: true });
    await appendFile(
      path.join(workspaceRoot, '.aide', 'logs', 'egress.log'),
      JSON.stringify({ action: 'git.push', remote, branch, at: new Date().toISOString() }) + '\n',
      'utf8'
    );
  } catch {
    // egress audit is best-effort — never blocks the push
  }
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
    { method: 'POST', path: '/api/git/commit', body: GitCommitRequest, response: GitCommitResponse, handler: wrap(async ({ body }) => {
        const { message, intent } = body as { message: string; intent?: string };
        const result = await git.commit(message);
        await recordShip(workspaceRoot, message, intent);
        return result;
      }) },
    { method: 'GET', path: '/api/git/branches', response: GitBranchesResponse, handler: wrap(async () => git.branches()) },
    { method: 'POST', path: '/api/git/checkout', body: GitCheckoutRequest, response: GitCheckoutResponse, handler: wrap(async ({ body }) => {
        await git.checkout((body as { branch: string }).branch);
        const branch = await git.currentBranch();
        return { branch: branch ?? 'HEAD' };
      }) },
    { method: 'POST', path: '/api/git/push', body: GitPushRequest, response: GitPushResponse, handler: wrap(async ({ body }) => {
        const remote = (body as { remote?: string }).remote ?? 'origin';
        const current = await git.currentBranch();
        const branch = (body as { branch?: string }).branch ?? current;
        if (!branch) throw new RouteError('BAD_REQUEST', 'no branch to push');
        const out = await git.push(remote, branch);
        await recordEgress(workspaceRoot, remote, branch);
        return { pushed: true, output: String(out.stdout).slice(0, 400) };
      }) },
    { method: 'POST', path: '/api/git/log', body: GitLogRequest, response: GitLogResponse, handler: wrap(async ({ body }) => git.log((body as { limit?: number }).limit)) },
    { method: 'POST', path: '/api/git/file-log', body: GitFileLogRequest, response: GitLogResponse, handler: wrap(async ({ body }) => git.fileLog((body as { path: string }).path, (body as { limit?: number }).limit)) },
    { method: 'POST', path: '/api/git/hunks/list', body: GitHunksRequest, response: GitHunksResponse, handler: wrap(async ({ body }) => git.hunks((body as { path: string }).path)) },
    { method: 'POST', path: '/api/git/hunks/stage', body: GitStageHunksRequest, response: GitStageHunksResponse, handler: wrap(async ({ body }) => git.stageHunks((body as { path: string; indexes: number[] }).path, (body as { indexes: number[] }).indexes)) },
    { method: 'POST', path: '/api/git/hunks/unstage', body: GitStageHunksRequest, response: GitStageHunksResponse, handler: wrap(async ({ body }) => git.unstageHunks((body as { path: string; indexes: number[] }).path, (body as { indexes: number[] }).indexes)) },
    { method: 'POST', path: '/api/git/blame', body: GitBlameRequest, response: GitBlameResponse, handler: wrap(async ({ body }) => git.blame((body as { path: string }).path)) }
  ];
}

// node/src/services/worktree.mjs (cline/T4, 2026-09-01, R8-rebuild)
// PR A of aide-worktree-isolation: shadow-worktree service.
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
const WORKTREES_DIR = '.aide/worktrees';
const BRANCH_PREFIX = 'aide-shadow/';
export class WorktreeError extends Error {
  constructor(code, message) { super(message); this.name = 'WorktreeError'; this.code = code; }
}
function runGit(args, { cwd, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, env: { ...process.env, ...env }, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const code = (err && err.code) || (err && err.signal) || 1;
        return reject(new WorktreeError('GIT_FAILED', `git ${args.join(' ')} exited ${code}: ${String(stderr).trim() || err.message}`));
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}
function validateId(id) {
  if (typeof id !== 'string' || !/^[a-z0-9-]{1,64}$/.test(id)) throw new WorktreeError('VALIDATION', `invalid worktree id: ${id}`);
}
function shortSha(sha) { return String(sha).trim().split(/\s+/)[0].slice(0, 12); }
async function pathExists(p) { try { await fs.stat(p); return true; } catch { return false; } }
function parseNumstatTotals(text) {
  let files = 0, additions = 0, deletions = 0;
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const [a, d] = parts; files += 1;
    if (a !== '-') additions += parseInt(a, 10) || 0;
    if (d !== '-') deletions += parseInt(d, 10) || 0;
  }
  return { files_changed: files, additions, deletions };
}
export function createWorktreeService({ workspace }) {
  if (!workspace) throw new WorktreeError('VALIDATION', 'workspace is required');
  async function create({ id, baseRef } = {}) {
    validateId(id);
    const wtPath = path.join(workspace, WORKTREES_DIR, id);
    const branch = `${BRANCH_PREFIX}${id}`;
    if (await pathExists(wtPath)) throw new WorktreeError('ALREADY_EXISTS', `worktree ${id} already exists at ${wtPath}`);
    await fs.mkdir(path.dirname(wtPath), { recursive: true });
    let stashed = false;
    const statusBefore = await runGit(['status', '--porcelain'], { cwd: workspace });
    if (statusBefore.stdout.trim().length > 0) {
      await runGit(['stash', 'push', '-m', `worktree-create-${id}`], { cwd: workspace });
      stashed = true;
    }
    try {
      const base = baseRef ? String(baseRef) : 'HEAD';
      const { stdout: revOut } = await runGit(['rev-parse', '--verify', base], { cwd: workspace });
      const baseSha = shortSha(revOut);
      await runGit(['worktree', 'add', '-b', branch, wtPath, base], { cwd: workspace });
      const { stdout: headOut } = await runGit(['rev-parse', 'HEAD'], { cwd: workspace });
      // Persist the base sha in the worktree's git config so list() can diff against it
      try { await runGit(['-C', wtPath, 'config', 'aide.baseSha', baseSha], {}); } catch { /* non-fatal */ }
      return { id, branch, base_ref: base, base_sha: baseSha, path: wtPath, created_at: Date.now(), head_sha: shortSha(headOut), diff_stats: { files_changed: 0, additions: 0, deletions: 0 } };
    } finally {
      if (stashed) { try { await runGit(['stash', 'pop'], { cwd: workspace }); } catch { /* non-fatal */ } }
    }
  }
  async function list() {
    let entries;
    try { entries = await fs.readdir(path.join(workspace, WORKTREES_DIR)); } catch { return []; }
    const out = [];
    for (const id of entries) {
      const wtPath = path.join(workspace, WORKTREES_DIR, id);
      let headSha = '';
      let branch = `${BRANCH_PREFIX}${id}`;
      let baseRef = 'HEAD';
      let baseSha = '';
      let createdAt = 0;
      try { const r = await runGit(['-C', wtPath, 'rev-parse', 'HEAD'], {}); headSha = shortSha(r.stdout); } catch { /* skip */ }
      try { const r = await runGit(['-C', wtPath, 'rev-parse', '--abbrev-ref', 'HEAD'], {}); const b = r.stdout.trim(); if (b) branch = b; } catch { /* detached */ }
      try { const r = await runGit(['-C', wtPath, 'config', '--get', 'branch.' + branch + '.merge'], {}); const m = r.stdout.trim(); if (m) baseRef = m.replace(/^refs\/heads\//, ''); } catch { /* no parent */ }
      try { const r = await runGit(['-C', wtPath, 'config', '--get', 'aide.baseSha'], {}); const m = r.stdout.trim(); if (m) baseSha = m; } catch { /* no aide.baseSha -> fall back to merge-base */ }
      if (!baseSha) { try { const r = await runGit(['-C', wtPath, 'merge-base', branch, 'refs/heads/' + baseRef], {}); baseSha = shortSha(r.stdout); } catch { /* no common */ } }
      try { const st = await fs.stat(wtPath); createdAt = Math.floor(st.mtimeMs || 0); } catch { /* skip */ }
      let diffStats = { files_changed: 0, additions: 0, deletions: 0 };
      try { const target = baseSha || 'HEAD'; const r = await runGit(['-C', wtPath, 'diff', '--numstat', target + '..HEAD'], {}); diffStats = parseNumstatTotals(r.stdout); } catch { /* zeros */ }
      out.push({ id, branch, base_ref: baseRef, base_sha: baseSha, path: wtPath, created_at: createdAt, head_sha: headSha, diff_stats: diffStats });
    }
    return out;
  }
  async function merge({ id, strategy = 'squash', commit_message = '' } = {}) {
    validateId(id);
    if (!['merge', 'squash', 'rebase'].includes(strategy)) throw new WorktreeError('VALIDATION', `invalid strategy: ${strategy}`);
    const wtPath = path.join(workspace, WORKTREES_DIR, id);
    const branch = `${BRANCH_PREFIX}${id}`;
    if (!(await pathExists(wtPath))) throw new WorktreeError('NOT_FOUND', `worktree ${id} not found`);
    const { stdout: headOut } = await runGit(['-C', wtPath, 'rev-parse', 'HEAD'], {});
    const headSha = shortSha(headOut);
    let commitSha = headSha;
    let message = '';
    if (strategy === 'squash') {
      const msg = String(commit_message || '').trim() || `Merge worktree ${id}`;
      await runGit(['merge', '--squash', branch], { cwd: workspace });
      const { stdout: commitOut } = await runGit(['commit', '-m', msg], { cwd: workspace });
      const m = String(commitOut).match(/\[[\w-]+\s+\(([^)]+)\)\s+([0-9a-f]+)\]/);
      if (m) { commitSha = m[2].slice(0, 12); message = m[1]; }
      else { const r = await runGit(['rev-parse', '--short', 'HEAD'], { cwd: workspace }); commitSha = shortSha(r.stdout); message = msg; }
    } else if (strategy === 'merge') {
      const msg = String(commit_message || '').trim() || `Merge worktree ${id}`;
      const { stdout: mergeOut } = await runGit(['merge', '--no-ff', '-m', msg, branch], { cwd: workspace });
      const m = String(mergeOut).match(/Merge made by.*?([0-9a-f]+)/);
      if (m) commitSha = m[1].slice(0, 12);
      message = msg;
    } else {
      await runGit(['rebase', branch], { cwd: workspace });
      const r = await runGit(['rev-parse', '--short', 'HEAD'], { cwd: workspace });
      commitSha = shortSha(r.stdout);
      message = String(commit_message || '').trim() || `Rebase worktree ${id}`;
    }
    try { await runGit(['worktree', 'remove', '--force', wtPath], { cwd: workspace }); } catch { /* fine */ }
    try { await runGit(['branch', '-D', branch], { cwd: workspace }); } catch { /* fine */ }
    return { id, strategy, commit_sha: commitSha, message };
  }
  async function discard({ id } = {}) {
    validateId(id);
    const wtPath = path.join(workspace, WORKTREES_DIR, id);
    const branch = `${BRANCH_PREFIX}${id}`;
    if (!(await pathExists(wtPath))) throw new WorktreeError('NOT_FOUND', `worktree ${id} not found`);
    await runGit(['worktree', 'remove', '--force', wtPath], { cwd: workspace });
    try { await runGit(['branch', '-D', branch], { cwd: workspace }); }
    catch (e) { throw new WorktreeError('BRANCH_HOLD', `worktree removed but branch ${branch} held (unmerged commits?): ${e.message}`); }
    return { id, state: 'discarded' };
  }
  return { create, list, merge, discard };
}

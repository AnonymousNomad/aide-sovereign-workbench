// tests/arch/worktree-isolation.test.ts (cline/T4, 2026-09-01)
// PR A of aide-worktree-isolation: shadow-worktree service + routes.
// ONE aggregated test() (matches the runner-proven pattern). Uses a real
// tmp git repo to exercise the service end-to-end (create -> edit on
// shadow branch -> merge -> squash commit lands in workspace). Validates
// the 4 routes are surfaced with zod-strict bodies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createWorktreeService, WorktreeError } = require('../../node/src/services/worktree.mjs');
const { routesForWorktree } = require('../../node/src/routes/workbenches.ts');

async function git(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, env: { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@x' } }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`git ${args.join(' ')} -> ${stderr || err.message}`));
      resolve(String(stdout));
    });
  });
}

test('worktree isolation: service + routes create / list / merge / discard', async () => {
  // Fresh tmp git repo so we never touch the real workspace
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-wt-'));
  await git(['init', '-q', '-b', 'main'], dir);
  await git(['config', 'user.email', 't@x'], dir);
  await git(['config', 'user.name', 'T'], dir);
  await fs.writeFile(path.join(dir, 'README.md'), '# seed\n');
  await git(['add', '.'], dir);
  await git(['commit', '-q', '-m', 'init'], dir);
  const baseHead = (await git(['rev-parse', 'HEAD'], dir)).trim();
  // Negative case: invalid id is rejected
  await assert.rejects(() => createWorktreeService({ workspace: dir }).create({ id: 'BAD ID!' }), /invalid worktree id/);
  // Create worktree
  const svc = createWorktreeService({ workspace: dir });
  const wt = await svc.create({ id: 'session-7' });
  assert.equal(wt.id, 'session-7');
  assert.equal(wt.branch, 'aide-shadow/session-7');
  assert.equal(wt.base_ref, 'HEAD');
  assert.equal(wt.base_sha, baseHead.slice(0, 12));
  // Edit on the shadow branch (NOT the workspace)
  await fs.writeFile(path.join(wt.path, 'feature.txt'), 'agent wrote this\n');
  await git(['add', '.'], wt.path);
  await git(['commit', '-q', '-m', 'add feature'], wt.path);
  // Workspace is untouched
  const wsBefore = await fs.readFile(path.join(dir, 'README.md'), 'utf8');
  assert.equal(wsBefore, '# seed\n');
  // List shows it
  const listed = await svc.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, 'session-7');
  assert.equal(listed[0].diff_stats && listed[0].diff_stats.files_changed, 1);
  // Squash-merge into workspace
  const merged = await svc.merge({ id: 'session-7', strategy: 'squash', commit_message: 'apply session-7' });
  assert.equal(merged.strategy, 'squash');
  assert.ok(merged.commit_sha.length >= 7);
  const wsAfter = await fs.readFile(path.join(dir, 'feature.txt'), 'utf8');
  assert.equal(wsAfter.replace(/\r\n/g, '\n'), 'agent wrote this\n');
  // Discard a NEW worktree (the merged one still has a path entry)
  const wt2 = await svc.create({ id: 'session-9' });
  await fs.writeFile(path.join(wt2.path, 'thrown.txt'), 'x');
  await git(['add', '.'], wt2.path);
  await git(['commit', '-q', '-m', 'throwaway'], wt2.path);
  const discarded = await svc.discard({ id: 'session-9' });
  assert.equal(discarded.state, 'discarded');
  // After discard the worktree path is gone and the workspace is unchanged
  await assert.rejects(() => fs.access(wt2.path), /ENOENT/);
  await assert.rejects(() => fs.access(path.join(dir, 'thrown.txt')), /ENOENT/);
  // Routes surface: 4 zod-strict routes exist with the right shapes
  const routes = routesForWorktree(dir);
  const paths = routes.map((r: any) => `${r.method} ${r.path}`);
  for (const p of ['POST /api/workbench/worktree/create', 'GET /api/workbench/worktree/list', 'POST /api/workbench/worktree/merge', 'POST /api/workbench/worktree/discard']) {
    assert.ok(paths.includes(p), `missing ${p} in: ${paths.join(', ')}`);
  }
  const createRoute = routes.find((r: any) => r.path === '/api/workbench/worktree/create');
  // zod-strict bodies reject extra keys
  assert.throws(() => createRoute.body.parse({ id: 'ok', base_ref: 'HEAD', extra: 1 }));
  // Error mapping: WorktreeError.NOT_FOUND -> RouteError NOT_FOUND
  try { await svc.merge({ id: 'does-not-exist' }); throw new Error('should have thrown'); }
  catch (e) {
    assert.ok(e instanceof WorktreeError, 'expected WorktreeError');
    // e narrowed to WorktreeError by the instanceof above; cast is needed
    // because require()-imported classes are values, not types — typeof
    // gets the class-as-type identity.
    assert.equal((e as InstanceType<typeof WorktreeError>).code, 'NOT_FOUND');
  }
});

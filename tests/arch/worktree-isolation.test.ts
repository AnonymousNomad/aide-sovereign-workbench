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
import { ArchServer } from '../../node/src/server.ts';
import { routesForAuthority } from '../../node/src/routes/authority.ts';
import { pairFixture } from './authority-fixture.ts';

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

  // HTTP authority: every worktree mutation requires an approved exact
  // capability.execute operation bound to the effective caller inputs.
  const server = new ArchServer(dir, path.join(dir, 'worktree-authority.log'));
  try {
    for (const route of routesForAuthority()) server.route(route);
    for (const route of routesForWorktree(dir)) server.route(route);
    const httpServer = await server.listen(0);
    const address = httpServer.address();
    assert.ok(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}`;
    const owner = await pairFixture(server, base);
    const worktreePath = (id: string) => path.join(dir, '.aide', 'worktrees', id);
    const postAnon = (routePath: string, body: unknown) => fetch(`${base}${routePath}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000)
    });

    const createBody = { id: 'http-a' };
    assert.equal((await postAnon('/api/workbench/worktree/create', createBody)).status, 403, 'anonymous actor rejected');
    const noApproval = await owner.request('/api/workbench/worktree/create', { method: 'POST', body: JSON.stringify(createBody) });
    assert.equal(noApproval.status, 409, 'paired actor without approval fails');
    await assert.rejects(() => fs.access(worktreePath('http-a')), /ENOENT/, 'no worktree without approval');

    const createHeaders = await owner.approve('POST', '/api/workbench/worktree/create', createBody, 'task:worktree-create');
    const changed = await owner.request('/api/workbench/worktree/create', { method: 'POST', headers: createHeaders, body: JSON.stringify({ id: 'http-b' }) });
    assert.equal(changed.status, 409, 'changed worktree id cannot reuse approval');
    await assert.rejects(() => fs.access(worktreePath('http-b')), /ENOENT/);

    const applied = await owner.request('/api/workbench/worktree/create', { method: 'POST', headers: createHeaders, body: JSON.stringify(createBody) });
    const appliedText = await applied.text();
    assert.equal(applied.status, 200, appliedText);
    const appliedBody = JSON.parse(appliedText) as { data: { worktree: { branch: string } } };
    assert.equal(appliedBody.data.worktree.branch, 'aide-shadow/http-a');
    await fs.access(worktreePath('http-a'));

    const createReplay = await owner.request('/api/workbench/worktree/create', { method: 'POST', headers: createHeaders, body: JSON.stringify(createBody) });
    assert.equal(createReplay.status, 409, 'consumed create approval cannot replay');

    // Merge carries its own exact approval and lands a squash commit.
    await fs.writeFile(path.join(worktreePath('http-a'), 'http.txt'), 'x\n');
    await git(['add', '.'], worktreePath('http-a'));
    await git(['commit', '-q', '-m', 'http edit'], worktreePath('http-a'));
    const mergeBody = { id: 'http-a', strategy: 'squash', commit_message: 'apply http-a' };
    assert.equal((await postAnon('/api/workbench/worktree/merge', mergeBody)).status, 403);
    const mergeNoApproval = await owner.request('/api/workbench/worktree/merge', { method: 'POST', body: JSON.stringify(mergeBody) });
    assert.equal(mergeNoApproval.status, 409);
    const mergeHeaders = await owner.approve('POST', '/api/workbench/worktree/merge', mergeBody, 'task:worktree-merge');
    const merged = await owner.request('/api/workbench/worktree/merge', { method: 'POST', headers: mergeHeaders, body: JSON.stringify(mergeBody) });
    const mergedText = await merged.text();
    assert.equal(merged.status, 200, mergedText);
    const mergedBody = JSON.parse(mergedText) as { data: { commit_sha: string } };
    assert.ok(mergedBody.data.commit_sha.length >= 7);

    // Discard carries its own exact approval.
    await svc.create({ id: 'http-d' });
    const discardBody = { id: 'http-d' };
    assert.equal((await postAnon('/api/workbench/worktree/discard', discardBody)).status, 403);
    const discardNoApproval = await owner.request('/api/workbench/worktree/discard', { method: 'POST', body: JSON.stringify(discardBody) });
    assert.equal(discardNoApproval.status, 409);
    const discardHeaders = await owner.approve('POST', '/api/workbench/worktree/discard', discardBody, 'task:worktree-discard');
    const discardedHttp = await owner.request('/api/workbench/worktree/discard', { method: 'POST', headers: discardHeaders, body: JSON.stringify(discardBody) });
    const discardedText = await discardedHttp.text();
    assert.equal(discardedHttp.status, 200, discardedText);
    assert.equal((JSON.parse(discardedText) as { data: { state: string } }).data.state, 'discarded');
    await assert.rejects(() => fs.access(worktreePath('http-d')), /ENOENT/);

    httpServer.closeAllConnections();
    await new Promise<void>(resolve => httpServer.close(() => resolve()));
  } finally {
    server.authority.control.close();
    server.events.close();
  }
});

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ArchServer } from '../../node/src/server.ts';

const run = promisify(execFile);

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-p4-git-'));
let server: ArchServer;
let httpServer: http.Server;
let base: string;

async function git(args: string, cwd = workspace) {
  await run('git', args.split(' '), { cwd });
}

before(async () => {
  await git('init -b main');
  await git('config user.email aide@test.local');
  await git('config user.name AIDE Test');
  await fs.writeFile(path.join(workspace, '.gitignore'), '.aide/\narch-test.log\n');
  const alphaBase = Array.from({ length: 16 }, (_, i) => `line ${String(i + 1).padStart(2, '0')}`).join('\n') + '\n';
  await fs.writeFile(path.join(workspace, 'alpha.txt'), alphaBase);
  await fs.writeFile(path.join(workspace, 'beta.txt'), 'beta v1\n');
  await git('add .');
  await git('commit -m base');

  const alphaEdited = alphaBase.split('\n');
  alphaEdited[1] = 'L02 CHANGED';
  alphaEdited[14] = 'L15 CHANGED';
  await fs.writeFile(path.join(workspace, 'alpha.txt'), alphaEdited.join('\n'));
  await fs.writeFile(path.join(workspace, 'gamma.txt'), 'brand new file\n');

  server = new ArchServer(workspace, path.join(workspace, 'arch-test.log'));
  const { buildRoutes } = await import('../../node/src/openapi.ts');
  const routes = await buildRoutes(workspace, 'test', { events: server.events });
  for (const route of routes) server.route(route);
  httpServer = await server.listen(0);
  const address = httpServer.address();
  assert.ok(address && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>(resolve => httpServer.close(() => resolve()));
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await fs.rm(workspace, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!['EBUSY', 'ENOTEMPTY', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
});

type Envelope<T> = { ok: boolean; data?: T; error?: { code: string; message: string } };

async function post<T>(pathName: string, payload: unknown): Promise<{ status: number; body: Envelope<T> }> {
  const response = await fetch(`${base}${pathName}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  return { status: response.status, body: (await response.json()) as Envelope<T> };
}

async function get<T>(pathName: string): Promise<{ status: number; body: Envelope<T> }> {
  const response = await fetch(`${base}${pathName}`);
  return { status: response.status, body: (await response.json()) as Envelope<T> };
}

test('status parses branch, staged/unstaged split and untracked entries', async () => {
  const { status, body } = await get<{ branch: string | null; changes: Array<{ path: string; x: string; y: string; untracked: boolean; staged: boolean }> }>('/api/git/status');
  assert.equal(status, 200);
  const data = body.data!;
  assert.equal(data.branch, 'main');
  const alpha = data.changes.find(change => change.path === 'alpha.txt');
  assert.ok(alpha, 'alpha.txt listed');
  assert.equal(alpha.x, '.');
  assert.equal(alpha.y, 'M');
  assert.equal(alpha.staged, false);
  const gamma = data.changes.find(change => change.path === 'gamma.txt');
  assert.equal(gamma?.untracked, true);
});

test('stage and commit round trip updates log', async () => {
  const staged = await post<{ oid?: string }>('/api/git/stage', { paths: ['gamma.txt'] });
  assert.equal(staged.status, 200);
  const diffCached = await post<{ text: string; truncated: boolean }>('/api/git/diff', { path: 'gamma.txt', cached: true });
  assert.match(diffCached.body.data!.text, /\+brand new file/);

  const committed = await post<{ oid: string }>('/api/git/commit', { message: 'add gamma' });
  assert.equal(committed.status, 200);
  assert.match(committed.body.data!.oid, /^[0-9a-f]{7,40}$/);

  const log = await post<{ commits: Array<{ subject: string }> }>('/api/git/log', { limit: 10 });
  assert.deepEqual(log.body.data!.commits.map(commit => commit.subject).slice(0, 2), ['add gamma', 'base']);
});

test('hunk listing and selective staging stage exactly one hunk', async () => {
  const hunks = await post<{ hunks: Array<{ index: number; header: string; lines: string[] }> }>('/api/git/hunks/list', { path: 'alpha.txt' });
  assert.equal(hunks.status, 200);
  const list = hunks.body.data!.hunks;
  assert.ok(list.length >= 2, `expected >=2 hunks in alpha.txt diff, got ${list.length}`);

  const stageFirst = await post<{ staged_indexes: number[] }>('/api/git/hunks/stage', { path: 'alpha.txt', indexes: [list[0]!.index] });
  assert.equal(stageFirst.status, 200);

  const diffCached = await post<{ text: string }>('/api/git/diff', { path: 'alpha.txt', cached: true });
  assert.match(diffCached.body.data!.text, /L02 CHANGED/, 'first hunk staged');
  assert.ok(!diffCached.body.data!.text.includes('L15 CHANGED'), 'second hunk NOT staged');

  const worktreeStillDirty = await post<{ text: string }>('/api/git/diff', { path: 'alpha.txt', cached: false });
  assert.ok(worktreeStillDirty.body.data!.text.includes('L15 CHANGED'), 'worktree keeps the unstaged hunk');

  const unstaged = await post<{ staged_indexes: number[] }>('/api/git/hunks/unstage', { path: 'alpha.txt', indexes: [1] });
  assert.equal(unstaged.status, 200);
  const afterUnstage = await post<{ text: string }>('/api/git/diff', { path: 'alpha.txt', cached: true });
  assert.ok(!afterUnstage.body.data!.text.includes('L02 CHANGED'), 'unstage reversed the hunk');
});

test('blame reports the latest committing short oid for a modified line', async () => {
  const beforeBlame = await post('/api/git/hunks/stage', { path: 'alpha.txt', indexes: [1] });
  assert.equal(beforeBlame.status, 200);
  const committed = await post<{ oid: string }>('/api/git/commit', { message: 'partial alpha' });
  assert.equal(committed.status, 200);

  const blame = await post<{ lines: Array<{ line_number: number; commit: string; text: string }> }>('/api/git/blame', { path: 'alpha.txt' });
  assert.equal(blame.status, 200);
  const lineTwo = blame.body.data!.lines.find(line => line.text === 'L02 CHANGED');
  assert.ok(lineTwo, 'modified line present in blame');
  assert.match(lineTwo.commit, /^[0-9a-f]{40}$/);
});

test('file timeline lists commits touching one path', async () => {
  const timeline = await post<{ commits: Array<{ subject: string }> }>('/api/git/file-log', { path: 'alpha.txt', limit: 10 });
  assert.equal(timeline.status, 200);
  const subjects = timeline.body.data!.commits.map(commit => commit.subject);
  assert.deepEqual(subjects, ['partial alpha', 'base']);
});

test('path escape and empty message are rejected with typed codes', async () => {
  const escape = await post('/api/git/stage', { paths: ['../outside.txt'] });
  assert.equal(escape.status, 400);
  assert.equal(escape.body.error?.code, 'BAD_REQUEST');

  const emptyMessage = await post<{ message: string }>('/api/git/commit', { message: '   ' });
  assert.equal(emptyMessage.status, 400);
});

test('commit records intent telemetry to ships.log', async () => {
  const staged = await post<{ oid?: string }>('/api/git/stage', { paths: ['alpha.txt'] });
  assert.equal(staged.status, 200);
  const committed = await post<{ oid: string }>('/api/git/commit', { message: 'telemetry alpha', intent: 'test intent' });
  assert.equal(committed.status, 200);
  assert.match(committed.body.data!.oid, /^[0-9a-f]{7,40}$/);
  const ships = await fs.readFile(path.join(workspace, '.aide', 'metrics', 'ships.log'), 'utf8');
  const last = ships.trim().split('\n').at(-1)!;
  const record = JSON.parse(last);
  assert.equal(record.message, 'telemetry alpha');
  assert.equal(record.intent, 'test intent');
});

test('commit with no staged changes maps to BAD_REQUEST', async () => {
  const empty = await post('/api/git/commit', { message: 'nothing staged here' });
  assert.equal(empty.status, 400);
  assert.equal(empty.body.error?.code, 'BAD_REQUEST');
  assert.match(empty.body.error?.message ?? '', /no changes to commit/);
});

test('checkout switches branches and refuses a dirty tree', async () => {
  await git('branch feature/switch');
  const switched = await post<{ branch: string }>('/api/git/checkout', { branch: 'feature/switch' });
  assert.equal(switched.status, 200);
  assert.equal(switched.body.data?.branch, 'feature/switch');
  const after = await get<{ branch: string | null }>('/api/git/status');
  assert.equal(after.body.data?.branch, 'feature/switch');

  await fs.appendFile(path.join(workspace, 'beta.txt'), 'dirty line\n');
  const refused = await post('/api/git/checkout', { branch: 'main' });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.error?.code, 'BAD_REQUEST');
  assert.match(refused.body.error?.message ?? '', /uncommitted changes/);

  await git('checkout -- beta.txt');
  const back = await post<{ branch: string }>('/api/git/checkout', { branch: 'main' });
  assert.equal(back.status, 200);
  assert.equal(back.body.data?.branch, 'main');
});

test('push uploads the current branch to an explicit local remote and records egress', async () => {
  const bare = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-p4-bare-'));
  try {
    await run('git', ['init', '--bare', '-q', bare], { cwd: os.tmpdir() });
    await run('git', ['-C', workspace, 'remote', 'add', 'origin', bare]);
    const pushed = await post<{ pushed: boolean; output: string }>('/api/git/push', {});
    assert.equal(pushed.status, 200);
    assert.equal(pushed.body.data?.pushed, true);
    assert.equal(typeof pushed.body.data?.output, 'string');
    const remoteLog = await run('git', ['--git-dir', bare, 'log', '-1', '--format=%s', 'main']);
    assert.equal(remoteLog.stdout.trim(), 'telemetry alpha');
    const egress = await fs.readFile(path.join(workspace, '.aide', 'logs', 'egress.log'), 'utf8');
    assert.match(egress, /git\.push/);
    assert.match(egress, /origin/);
  } finally {
    await fs.rm(bare, { recursive: true, force: true }).catch(() => {});
  }
});

test('not-a-repo workspace maps to NOT_A_REPO code', async () => {
  const plainDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-p4-norepo-'));
  try {
    const plainServer = new ArchServer(plainDir, path.join(plainDir, 'arch-test.log'));
    const { buildRoutes } = await import('../../node/src/openapi.ts');
    const routes = await buildRoutes(plainDir, 'test', { events: plainServer.events });
    for (const route of routes) plainServer.route(route);
    const plainHttp = await plainServer.listen(0);
    const address = plainHttp.address();
    assert.ok(address && typeof address === 'object');
    const response = await fetch(`http://127.0.0.1:${address.port}/api/git/status`);
    const body = (await response.json()) as Envelope<unknown>;
    assert.equal(body.error?.code, 'NOT_A_REPO');
    await new Promise<void>(resolve => plainHttp.close(() => resolve()));
  } finally {
    await fs.rm(plainDir, { recursive: true, force: true }).catch(() => {});
  }
});

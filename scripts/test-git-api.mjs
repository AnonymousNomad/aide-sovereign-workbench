import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { launchSupervisedStack } from '../tests/helpers/supervised-stack.mjs';

const run = promisify(execFile);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function removeTree(target) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try { await rm(target, { recursive: true, force: true }); return; }
    catch (error) {
      if (!['EBUSY', 'ENOTEMPTY', 'EPERM'].includes(error.code)) throw error;
      await sleep(500);
    }
  }
}

const workspace = await mkdtemp(path.join(tmpdir(), 'aide-git-'));
await run('git', ['init', '-q'], { cwd: workspace });
await run('git', ['config', 'user.name', 'AIDE Test'], { cwd: workspace });
await run('git', ['config', 'user.email', 'aide@test.invalid'], { cwd: workspace });
await writeFile(path.join(workspace, 'README.md'), 'base\n');
await run('git', ['add', '.'], { cwd: workspace });
await run('git', ['commit', '-qm', 'base'], { cwd: workspace });
await writeFile(path.join(workspace, 'README.md'), 'changed\n');

// The canonical Git surface is the TS route family reached through the
// supervised facade: unapproved mutations fail closed with the authority
// envelope and only an explicitly approved exact operation executes.
const stack = await launchSupervisedStack({ workspace });
try {
  const unapproved = await stack.json('facade', 'POST', '/api/git/stage', { body: { paths: ['README.md'] } });
  assert.equal(unapproved.status, 409, 'unapproved stage must fail closed');
  const stillDirty = await run('git', ['diff', '--name-only'], { cwd: workspace });
  assert.equal(stillDirty.stdout.trim(), 'README.md', 'unapproved stage must not touch the index');

  const staged = await stack.approveJson({ adapter: 'ts', method: 'POST', path: '/api/git/stage', body: { paths: ['README.md'] } });
  assert.equal(staged.status, 200, JSON.stringify(staged.body).slice(0, 200));

  const committed = await stack.approveJson({ adapter: 'ts', method: 'POST', path: '/api/git/commit', body: { message: 'test change' } });
  assert.equal(committed.status, 200, JSON.stringify(committed.body).slice(0, 200));

  const log = await run('git', ['log', '-1', '--format=%s'], { cwd: workspace });
  assert.equal(log.stdout.trim(), 'test change');
  console.log('git api test passed');
} finally {
  await stack.close();
  await removeTree(workspace);
}

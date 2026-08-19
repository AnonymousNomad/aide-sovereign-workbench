import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProcessManager } from '../../node/src/services/process-manager.ts';
import { checkProcessAlive } from '../../daemon/process-check.mjs';

const tmp = async () => fs.mkdtemp(path.join(os.tmpdir(), 'aide-pm-'));

test('stop() terminates a spawned child', async () => {
  const pm = new ProcessManager();
  const dir = await tmp();
  const pidFile = path.join(dir, 'pid.txt');
  const child = pm.spawn('a', 'test', process.execPath, ['-e', `require('fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000);`, pidFile]);
  assert.ok(child.pid);
  await waitForFile(pidFile);
  const pid = Number((await fs.readFile(pidFile, 'utf8')).trim());
  assert.ok(pid > 0);
  const aliveBefore = await checkProcessAlive(pid);
  assert.equal(aliveBefore.alive, true);
  const exited = await pm.stop('a');
  assert.equal(exited, true);
  const aliveAfter = await checkProcessAlive(pid);
  assert.equal(aliveAfter.alive, false);
  await fs.rm(dir, { recursive: true, force: true });
});

test('shutdownAll() tree-kills children', async () => {
  const pm = new ProcessManager();
  const dir = await tmp();
  const pidFile = path.join(dir, 'pid.txt');
  const child = pm.spawn('b', 'test', process.execPath, ['-e', `require('fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000);`, pidFile]);
  await waitForFile(pidFile);
  const pid = Number((await fs.readFile(pidFile, 'utf8')).trim());
  assert.equal((await checkProcessAlive(pid)).alive, true);
  await pm.shutdownAll(100);
  assert.equal((await checkProcessAlive(pid)).alive, false);
  assert.equal(pm.active.length, 0);
  await fs.rm(dir, { recursive: true, force: true });
  void child;
});

test('execFile captures exit code and output', async () => {
  const pm = new ProcessManager();
  const ok = await pm.execFile(process.execPath, ['-e', 'console.log("hi")']);
  assert.equal(ok.code, 0);
  assert.equal(ok.stdout.trim(), 'hi');
  const bad = await pm.execFile(process.execPath, ['-e', 'process.exit(3)']);
  assert.equal(bad.code, 3);
});

async function waitForFile(file: string): Promise<void> {
  for (let i = 0; i < 250; i++) {
    try {
      await fs.access(file);
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  throw new Error(`file never appeared: ${file}`);
}
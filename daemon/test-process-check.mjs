import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { checkProcessAlive } from './process-check.mjs';

const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { stdio: 'ignore' });
try {
  assert.equal((await checkProcessAlive(child.pid)).alive, true, 'a live child must be found');
  child.kill();
  await new Promise(resolve => child.once('close', resolve));
  assert.equal((await checkProcessAlive(child.pid)).alive, false, 'an exited child must not be found');
  console.log(`process check passed (${process.platform})`);
} finally {
  child.kill();
}

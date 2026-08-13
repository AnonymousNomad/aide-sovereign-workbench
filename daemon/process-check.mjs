import { spawn } from 'node:child_process';

function hasWindowsPid(output, pid) {
  return output.split(/\r?\n/).some(line => {
    const fields = line.trim().replace(/^"|"$/g, '').split('","');
    return fields[1] === String(pid);
  });
}

export function checkProcessAlive(pid, { platform = process.platform, spawnProcess = spawn } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return Promise.reject(new Error('pid must be a positive integer'));
  const windows = platform === 'win32';
  const command = windows ? 'tasklist' : 'ps';
  const args = windows ? ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'] : ['-p', String(pid), '-o', 'pid='];
  return new Promise((resolve, reject) => {
    let output = '';
    let errorOutput = '';
    let child;
    try { child = spawnProcess(command, args, { stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (error) { reject(error); return; }
    child.stdout?.on('data', chunk => { output += String(chunk); });
    child.stderr?.on('data', chunk => { errorOutput += String(chunk); });
    child.once('error', reject);
    child.once('close', code => resolve({ alive: windows ? hasWindowsPid(output, pid) : output.trim().split(/\s+/).includes(String(pid)), code, output, errorOutput }));
  });
}

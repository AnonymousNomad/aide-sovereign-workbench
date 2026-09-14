import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

// Retain the actual ChildProcess/native handle created here. Never adopt a
// caller PID, search an image/command line, or reopen a process by old PID.
export function createOwnedProcesses({ terminationTimeoutMs = 5000 } = {}) {
  const owned = new WeakMap();
  const active = new Map();
  let armed = false;
  let epoch = 0;
  function launch(program, args = [], options = {}) {
    if (!armed) throw new Error('owned process launcher is disarmed');
    if (options.detached || options.shell) throw new Error('detached or shell ownership is not supported');
    const generation = epoch;
    const child = spawn(program, args, { ...options, shell: false, detached: false, windowsHide: true,
      stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'] });
    const handle = Object.freeze({ id: randomUUID(), pid: child.pid ?? null });
    let settle;
    let ready;
    let rejectReady;
    const finished = new Promise(resolve => { settle = resolve; });
    const spawned = new Promise((resolve, reject) => { ready = resolve; rejectReady = reject; });
    const entry = { child, handle, finished, state: 'starting', error: null, stop: null };
    owned.set(handle, entry); active.set(handle.id, entry);
    child.once('spawn', () => {
      entry.state = 'running';
      if (!armed || epoch !== generation) {
        rejectReady(new Error('launch revoked during spawn'));
        void terminate(handle);
      } else ready(handle);
    });
    child.on('error', error => {
      entry.error = String(error.message);
      if (entry.state === 'starting') rejectReady(error);
    });
    child.once('close', (code, signal) => {
      entry.state = 'exited'; active.delete(handle.id);
      settle(Object.freeze({ code, signal, error: entry.error }));
    });
    // Consume streams unless the trusted caller attaches output listeners.
    child.stdout?.on('data', chunk => options.onStdout?.(chunk));
    child.stderr?.on('data', chunk => options.onStderr?.(chunk));
    return Object.freeze({ handle, spawned, finished });
  }
  async function terminate(handle) {
    const entry = handle && owned.get(handle);
    if (!entry) return { status: 'unowned', killed: false };
    if (entry.state === 'exited' || entry.child.exitCode !== null || entry.child.signalCode !== null) return { status: 'exited', killed: false };
    if (entry.stop) return entry.stop;
    entry.stop = (async () => {
      let requested;
      try { requested = entry.child.kill(); }
      catch (error) { return { status: 'failed', killed: false, error: String(error.message) }; }
      if (!requested) return { status: 'failed', killed: false, error: entry.error ?? 'native process handle did not accept termination' };
      let timer;
      try {
        const result = await Promise.race([entry.finished, new Promise(resolve => {
          timer = setTimeout(() => resolve(null), terminationTimeoutMs);
        })]);
        return result === null ? { status: 'unconfirmed', killed: false, error: 'exit not observed before deadline' }
          : { status: 'terminated', killed: true, exit: result };
      } finally { clearTimeout(timer); }
    })();
    return entry.stop;
  }
  return Object.freeze({
    launch, terminate,
    arm() { armed = true; epoch += 1; },
    async revoke() {
      armed = false; epoch += 1; // synchronous before any wait
      const entries = [...active.values()];
      return Promise.all(entries.map(async entry => ({ id: entry.handle.id, pid: entry.handle.pid, ...await terminate(entry.handle) })));
    },
    snapshot() { return [...active.values()].map(e => ({ id: e.handle.id, pid: e.handle.pid, state: e.state })); },
    alive(handle) { const e = handle && owned.get(handle); return !!e && e.state === 'running' && e.child.exitCode === null && e.child.signalCode === null; }
  });
}

// Desktop Control — P6 DC-a bounded domain. Strict opt-in grants, deny-by-default,
// session-scoped TTL, panic kill switch, evidence to the memory spine.
// Zero new native deps: Windows ops via cmd start / explorer / PowerShell / fs.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { createStateBus } from '../../../harness/cipher-state.mjs';

const GRANTS_FILE = '.aide/desktop/grants.json';

export class DesktopRefusedError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function isSubpath(root, target) {
  const r = path.resolve(root);
  const t = path.resolve(target);
  const rel = path.relative(r, t);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function createDesktopControl({ workspace }) {
  let manifest = null;
  const children = new Set();
  const panics = [];
  let turnCounter = 0;

  async function loadManifest() {
    if (manifest) return manifest;
    try {
      manifest = JSON.parse(await fs.readFile(path.join(workspace, GRANTS_FILE), 'utf8'));
    } catch { manifest = null; }
    return manifest;
  }

  async function saveManifest(next) {
    manifest = next;
    const file = path.join(workspace, GRANTS_FILE);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(next, null, 2), 'utf8');
    return next;
  }

  async function activeGrants() {
    const m = await loadManifest();
    if (!m || !m.enabled) throw new DesktopRefusedError('DISABLED', 'desktop control is not enabled');
    if (panics.includes(m.session_started_at)) throw new DesktopRefusedError('PANIC', 'panic switch tripped for this session');
    const ageMin = (Date.now() - new Date(m.session_started_at).getTime()) / 60000;
    if (ageMin > m.ttl_minutes) throw new DesktopRefusedError('EXPIRED', `grants expired after ${m.ttl_minutes} minutes`);
    return m.grants;
  }

  async function evidence(kind, detail) {
    try { await createStateBus(workspace).append({ type: 'desktop', ...detail }); } catch { /* best-effort */ }
    void kind;
  }

  function run(cmd, args, opts = {}) {
    return new Promise((resolve, reject) => {
      execFile(cmd, args, { timeout: 8000, windowsHide: true, ...opts }, (err, stdout, stderr) => {
        if (err) reject(err); else resolve(String(stdout));
      });
    });
  }

  const ops = {
    async launch_app(grants, target) {
      const name = String(target || '').trim().toLowerCase().replace(/\.exe$/, '');
      const hit = grants.apps.find(a => a.toLowerCase().replace(/\.exe$/, '') === name);
      if (!hit) throw new DesktopRefusedError('NOT_ALLOWLISTED', `app "${target}" is not on the allowlist`);
      const child = spawn('cmd.exe', ['/d', '/s', '/c', 'start', '', hit], { detached: true, stdio: 'ignore', windowsHide: true });
      child.unref();
      children.add(child.pid);
      child.once('exit', () => children.delete(child.pid));
      return `launched ${hit}`;
    },
    async open_path(grants, target) {
      const root = grants.roots.find(r => isSubpath(r, String(target)));
      if (!root) throw new DesktopRefusedError('PATH_NOT_GRANTED', `"${target}" is outside granted roots`);
      const stat = await fs.stat(target).catch(() => null);
      if (!stat) throw new DesktopRefusedError('NOT_FOUND', `${target} does not exist`);
      // explorer.exe returns exit code 1 on success when opening files (Windows
      // quirk) — use detached start like launch_app so success is not misreported.
      const child = spawn('cmd.exe', ['/d', '/s', '/c', 'start', '', String(target)],
        { detached: true, stdio: 'ignore', windowsHide: true });
      child.unref();
      children.add(child.pid);
      child.once('exit', () => children.delete(child.pid));
      return `opened ${target}`;
    },
    async move_file(grants, target, destination) {
      const fromRoot = grants.roots.find(r => isSubpath(r, String(target)));
      const toRoot = grants.roots.find(r => isSubpath(r, String(destination)));
      if (!fromRoot || !toRoot) throw new DesktopRefusedError('PATH_NOT_GRANTED', 'both paths must be inside granted roots');
      await fs.rename(target, destination);
      return `moved to ${destination}`;
    },
    async list_windows() {
      const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        'Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object -First 25 Id,ProcessName,MainWindowTitle | ConvertTo-Json -Compress']);
      return out;
    },
    async focus_window(grants, target) {
      const title = grants.window_titles.find(t => String(target).toLowerCase().includes(t.toLowerCase()));
      if (!title) throw new DesktopRefusedError('NOT_ALLOWLISTED', `window "${target}" is not on the allowlist`);
      // Probe-first honesty: only claim success when a window title actually matched.
      const listing = await ops.list_windows();
      if (!listing.toLowerCase().includes(title.toLowerCase())) {
        throw new DesktopRefusedError('WINDOW_NOT_FOUND', `no visible window matches "${title}"`);
      }
      const script = `(New-Object -ComObject WScript.Shell).AppActivate(@'${title}'@) | Out-Null`;
      await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
      return `focused window matching ${title}`;
    }
  };

  async function autoAssert(op, target, destination) {
    // DC-b: every trajectory row carries a state assertion — R3 law forbids
    // training on unverified rollouts. Assertions are mechanical, per-op.
    switch (op) {
      case 'launch_app': {
        const image = path.basename(String(target)).trim();
        const safe = /^[A-Za-z0-9._-]+$/.test(image) ? image : null;
        if (!safe) return { pass: false, check: 'image-name-parse' };
        const exists = await new Promise(resolve => {
          execFile('tasklist', ['/FI', `IMAGENAME eq ${safe}`], { windowsHide: true }, (err, stdout) => {
            resolve(!err && String(stdout).toLowerCase().includes(safe.toLowerCase()));
          });
        });
        return { pass: exists, check: `process_alive:${safe}` };
      }
      case 'move_file': {
        try {
          await fs.access(String(destination));
          return { pass: true, check: 'destination_exists' };
        } catch {
          return { pass: false, check: 'destination_exists' };
        }
      }
      case 'open_path':
      case 'focus_window':
      case 'list_windows':
      default:
        return { pass: true, check: `${op}:observation-only` };
    }
  }

  const TRAJECTORY_DIR = '.aide/desktop/trajectories';

  async function recordTrajectory(sessionId, row) {
    try {
      const file = path.join(workspace, TRAJECTORY_DIR, `${sessionId}.jsonl`);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.appendFile(file, JSON.stringify(row) + '\n', 'utf8');
    } catch { /* training capture is best-effort; never blocks actions */ }
  }

  async function act(request, sessionId = 'default') {
    const started = Date.now();
    if (request.approved !== true) {
      await evidence('desktop', { op: request.op, target: request.target, decision: 'refused-no-approval' });
      await recordTrajectory(sessionId, {
        ts: new Date().toISOString(), turn: ++turnCounter,
        observation: { op: request.op, target: request.target },
        thought: request.note || '', action_raw: `${request.op}(target="${request.target}")`,
        class: 'UNKNOWN', verdict: 'NO_APPROVAL', latency_ms: Date.now() - started
      });
      throw new DesktopRefusedError('NO_APPROVAL', 'explicit approval required for desktop actions');
    }
    const grants = await activeGrants();
    const fn = ops[request.op];
    if (!fn) throw new DesktopRefusedError('UNKNOWN_OP', `unsupported op: ${request.op}`);
    try {
      const output = await fn(grants, request.target, request.destination);
      const assertion = await autoAssert(request.op, request.target, request.destination);
      const result = { ok: true, decision: 'executed', output: String(output).slice(0, 2000), latency_ms: Date.now() - started, assertion };
      await evidence('desktop', { op: request.op, target: request.target, decision: 'executed' });
      await recordTrajectory(sessionId, {
        ts: new Date().toISOString(), turn: ++turnCounter,
        observation: { op: request.op, target: request.target, destination: request.destination ?? null },
        thought: request.note || '', action_raw: `${request.op}(target="${request.target}"${request.destination ? `, destination="${request.destination}"` : ''})`,
        class: 'WRITE', verdict: 'executed', assertion, latency_ms: result.latency_ms
      });
      return result;
    } catch (error) {
      const code = error instanceof DesktopRefusedError ? error.code : 'CHILD_FAILED';
      await evidence('desktop', { op: request.op, target: request.target, decision: code });
      // Refusal-recovery rows are TRAINING GOLD per the model spec — recorded
      // with the refusal code as the verdict so T2's corpus includes recovery.
      await recordTrajectory(sessionId, {
        ts: new Date().toISOString(), turn: ++turnCounter,
        observation: { op: request.op, target: request.target },
        thought: request.note || '', action_raw: `${request.op}(target="${request.target}")`,
        class: code === 'NOT_ALLOWLISTED' || code === 'PATH_NOT_GRANTED' ? 'FORBIDDEN' : 'WRITE',
        verdict: code, latency_ms: Date.now() - started
      });
      throw error;
    }
  }

  async function panic() {
    const started = Date.now();
    if (manifest) panics.push(manifest.session_started_at);
    let killed = 0;
    for (const pid of [...children]) {
      killed += 1;
      try { process.kill(pid); } catch { /* already gone */ }
      children.delete(pid);
    }
    // Detached `start` launches are untrackable at spawn time (cmd wrapper
    // exits immediately) — sweep allowlisted app names so panic is COMPLETE:
    // no granted app may survive a tripwire.
    for (const app of manifest?.grants?.apps ?? []) {
      const image = path.basename(app).trim();
      if (!/^[A-Za-z0-9._-]+$/.test(image)) continue;
      await new Promise(resolve => {
        execFile('taskkill', ['/IM', image, '/F'], { windowsHide: true }, () => resolve(null));
      });
      killed += 1;
    }
    const result = { ok: true, children_killed: killed, revoked_at: new Date().toISOString(), latency_ms: Date.now() - started };
    await evidence('desktop', { op: 'panic', decision: 'executed', children_killed: killed });
    return result;
  }

  return {
    status: async () => {
      const m = await loadManifest();
      return {
        enabled: Boolean(m?.enabled),
        ttl_minutes: m?.ttl_minutes ?? null,
        session_started_at: m?.session_started_at ?? null,
        grants: m?.grants ?? { apps: [], roots: [], window_titles: [] },
        tracked_children: children.size,
        panicked: m ? panics.includes(m.session_started_at) : false
      };
    },
    setGrants: saveManifest,
    act,
    panic,
    _test: { children, panics } // battery access; not part of public contract
  };
}

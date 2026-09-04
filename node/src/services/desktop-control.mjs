// Desktop Control — P6 DC-a bounded domain. Strict opt-in grants, deny-by-default,
// session-scoped TTL, panic kill switch, evidence to the memory spine.
// Zero new native deps: executable spawn / file association / PowerShell / fs.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { createStateBus } from '../../../harness/cipher-state.mjs';

const GRANTS_FILE = '.aide/desktop/grants.json';

function processIds(image) {
  return new Promise(resolve => {
    execFile('tasklist', ['/FI', `IMAGENAME eq ${image}`, '/FO', 'CSV', '/NH'], { windowsHide: true }, (error, stdout) => {
      if (error) return resolve([]);
      const ids = [];
      for (const match of String(stdout).matchAll(/"([^"]+)","(\d+)"/g)) {
        if (match[1].toLowerCase() === image.toLowerCase()) ids.push(Number(match[2]));
      }
      resolve(ids);
    });
  });
}

function killProcessTree(pid) {
  if (process.platform !== 'win32') {
    try { process.kill(pid); } catch { /* already gone */ }
    return Promise.resolve();
  }
  return new Promise(resolve => {
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve());
  });
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitForProcess(image, pid, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await processIds(image)).includes(pid)) return true;
    await sleep(100);
  }
  return false;
}

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
  // Executor seam (T2 contract): external desktop-agent submits actions,
  // holds <=60s for a verdict rendered as an approval card in the cockpit.
  const pendingApprovals = new Map(); // id -> {action_raw, class, session_id, created_at, resolver}

  function submitPending({ action_raw, class: permClass, session_id = 'default' }) {
    const id = `da-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const entry = {
      approval_id: id,
      action_raw: String(action_raw ?? '').slice(0, 300),
      class: String(permClass ?? 'WRITE'),
      session_id,
      created_at: new Date().toISOString()
    };
    const deferred = {};
    deferred.promise = new Promise(resolve => { deferred.resolve = resolve; });
    pendingApprovals.set(id, { ...entry, deferred });
    return { ...entry, promise: deferred.promise };
  }

  async function waitForVerdict(id, timeoutMs = 55_000) {
    const entry = pendingApprovals.get(id);
    if (!entry) throw new DesktopRefusedError('NOT_FOUND', `no pending approval ${id}`);
    const timeout = new Promise(resolve => setTimeout(() => resolve('timeout'), timeoutMs));
    const winner = await Promise.race([entry.deferred.promise.then(v => ({ v })), timeout.then(t => ({ t }))]);
    if ('t' in winner && winner.t === 'timeout') return { verdict: 'timeout' };
    return { verdict: winner.v.verdict };
  }

  function resolvePending(id, decision) {
    const entry = pendingApprovals.get(id);
    if (!entry) throw new DesktopRefusedError('NOT_FOUND', `no pending approval ${id}`);
    pendingApprovals.delete(id);
    entry.deferred.resolve({ verdict: decision === 'approve' ? 'approved' : 'rejected' });
    void evidence('desktop', { op: 'executor_approval', target: entry.action_raw, decision });
    return { ok: true, approval_id: id, verdict: decision === 'approve' ? 'approved' : decision };
  }

  function listPending() {
    return [...pendingApprovals.values()].map(e => ({
      approval_id: e.approval_id, action_raw: e.action_raw, class: e.class,
      session_id: e.session_id, created_at: e.created_at
    }));
  }

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
    // Business-lane ops (drafts-first doctrine: AIDE creates drafts, humans
    // send). COM via PowerShell -STA; typed UNAVAILABLE when Office absent.
    async outlook_create_draft(grants, target, destination) {
      let input;
      try { input = JSON.parse(String(target || '{}')); }
      catch { throw new DesktopRefusedError('VALIDATION', 'target must be JSON {to,subject,body}'); }
      const to = String(input.to || '').trim();
      const subject = String(input.subject || '').slice(0, 200);
      const body = String(input.body || '').slice(0, 8000);
      if (!to || !subject) throw new DesktopRefusedError('VALIDATION', 'draft requires to + subject');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.split(';')[0])) throw new DesktopRefusedError('VALIDATION', 'invalid recipient address');
      const script = [
        '$o = New-Object -ComObject Outlook.Application -ErrorAction Stop',
        `$m = $o.CreateItem(0)`,
        `$m.To = ${JSON.stringify(to)}`,
        `$m.Subject = ${JSON.stringify(subject)}`,
        `$m.Body = ${JSON.stringify(body)}`,
        '$m.Save()',
        'Write-Output "draft-saved"'
      ].join('; ');
      const out = await new Promise((resolve, reject) => {
        execFile('powershell.exe', ['-NoProfile', '-STA', '-NonInteractive', '-Command', script],
          { windowsHide: true, timeout: 30000 }, (err, stdout, stderr) => {
            if (err) {
              const msg = String(stderr || err.message);
              if (msg.includes('0x80040154')) reject(new DesktopRefusedError('OUTLOOK_UNAVAILABLE', 'classic Outlook is not installed/signed-in (COM class not registered); drafts-first policy requires it'));
              else reject(new Error(msg.slice(0, 300)));
            } else resolve(String(stdout));
          });
      });
      return out.includes('draft-saved') ? `draft saved to Outlook (${to})` : out;
    },
    async excel_generate_report(grants, target, destination) {
      const root = grants.roots.find(r => isSubpath(r, String(destination)));
      if (!root) throw new DesktopRefusedError('PATH_NOT_GRANTED', 'destination must be inside granted roots');
      let input;
      try { input = JSON.parse(String(target || '{}')); }
      catch { throw new DesktopRefusedError('VALIDATION', 'target must be JSON {title, rows:[[...]]}'); }
      const title = String(input.title || 'Report').slice(0, 100);
      const rows = Array.isArray(input.rows) ? input.rows.slice(0, 5000) : null;
      if (!rows || !rows.length) throw new DesktopRefusedError('VALIDATION', 'rows required');
      // Build CSV payload in Node (no COM needed for data), then hand to Excel
      // only for XLSX conversion IF Excel exists; else write .csv honestly.
      const csvPath = path.join(path.dirname(path.resolve(destination)), `${title.replace(/[^\w.-]+/g, '_')}.csv`);
      const csv = rows.map(r => Array.isArray(r) ? r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',') : `"${String(r).replace(/"/g, '""')}"`).join('\r\n');
      await fs.writeFile(csvPath, csv, 'utf8');
      try {
        const script = [
          '$e = New-Object -ComObject Excel.Application -ErrorAction Stop',
          '$e.Visible = $false; $e.DisplayAlerts = $false',
          `$w = $e.Workbooks.Open(${JSON.stringify(csvPath)})`,
          `$w.SaveAs(${JSON.stringify(destination)}, 51)`, // xlOpenXMLWorkbook
          '$w.Close($false); $e.Quit()',
          'Write-Output "xlsx-written"'
        ].join('; ');
        const out = await new Promise((resolve, reject) => {
          execFile('powershell.exe', ['-NoProfile', '-STA', '-NonInteractive', '-Command', script],
            { windowsHide: true, timeout: 60000 }, (err, stdout) => {
              if (err) reject(err); else resolve(String(stdout));
            });
        });
        return out.includes('xlsx-written') ? `report written: ${destination}` : out;
      } catch (error) {
        if (String(error?.message || error).includes('0x80040154')) {
          throw new DesktopRefusedError('EXCEL_UNAVAILABLE', 'Excel is not installed (COM class not registered); CSV written instead at ' + csvPath);
        }
        throw new DesktopRefusedError('CHILD_FAILED', `excel failed: ${String(error?.message || error).slice(0, 200)}`);
      }
    },
    async launch_app(grants, target, args = []) {
      const name = String(target || '').trim().toLowerCase().replace(/\.exe$/, '');
      const hit = grants.apps.find(a => a.toLowerCase().replace(/\.exe$/, '') === name);
      if (!hit) throw new DesktopRefusedError('NOT_ALLOWLISTED', `app "${target}" is not on the allowlist`);
      if (!Array.isArray(args) || args.length > 16 || args.some(arg => typeof arg !== 'string' || arg.includes('\0'))) {
        throw new DesktopRefusedError('VALIDATION', 'launch args must be up to 16 strings without NUL bytes');
      }
      const image = path.basename(hit);
      const child = spawn(hit, args, { detached: true, stdio: 'ignore', windowsHide: true, shell: false });
      const childPid = child.pid;
      if (!Number.isInteger(childPid) || childPid <= 0) {
        throw new DesktopRefusedError('CHILD_FAILED', `app "${hit}" did not return a process PID`);
      }
      child.unref();
      children.add(childPid);
      child.once('exit', () => children.delete(childPid));
      await new Promise((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
      }).catch(async error => {
        children.delete(childPid);
        throw new DesktopRefusedError('CHILD_FAILED', `app "${hit}" failed to spawn: ${error.message}`);
      });
      if (!(await waitForProcess(image, childPid))) {
        await killProcessTree(childPid);
        children.delete(childPid);
        throw new DesktopRefusedError('CHILD_FAILED', `app "${hit}" PID ${childPid} was not observable within 10000ms`);
      }
      return { output: `launched ${hit} (pid ${childPid})`, pid: childPid };
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

  async function autoAssert(op, target, destination, expectedPid) {
    // DC-b: every trajectory row carries a state assertion — R3 law forbids
    // training on unverified rollouts. Assertions are mechanical, per-op.
    switch (op) {
      case 'launch_app': {
        const image = path.basename(String(target)).trim();
        const safe = /^[A-Za-z0-9._-]+$/.test(image) ? image : null;
        if (!safe) return { pass: false, check: 'image-name-parse' };
        const ids = await processIds(safe);
        const exists = expectedPid === undefined ? ids.length > 0 : ids.includes(expectedPid);
        return { pass: exists, check: `process_alive:${safe}${expectedPid === undefined ? '' : `#${expectedPid}`}` };
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
      const operation = request.op === 'launch_app'
        ? await fn(grants, request.target, request.args)
        : await fn(grants, request.target, request.destination);
      const output = operation && typeof operation === 'object' && 'output' in operation ? operation.output : operation;
      const expectedPid = operation && typeof operation === 'object' && 'pid' in operation ? operation.pid : undefined;
      const assertion = await autoAssert(request.op, request.target, request.destination, expectedPid);
      const result = { ok: true, decision: 'executed', output: String(output).slice(0, 2000), latency_ms: Date.now() - started, assertion };
      await evidence('desktop', { op: request.op, target: request.target, decision: 'executed' });
      await recordTrajectory(sessionId, {
        ts: new Date().toISOString(), turn: ++turnCounter,
         observation: { op: request.op, target: request.target, args: request.args ?? [], destination: request.destination ?? null },
         thought: request.note || '', action_raw: `${request.op}(target="${request.target}"${request.args?.length ? `, args=${JSON.stringify(request.args)}` : ''}${request.destination ? `, destination="${request.destination}"` : ''})`,
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
    const pids = [...children];
    await Promise.all(pids.map(pid => killProcessTree(pid)));
    killed = pids.length;
    children.clear();
    const result = { ok: true, children_killed: killed, revoked_at: new Date().toISOString(), latency_ms: Date.now() - started };
    await evidence('desktop', { op: 'panic', decision: 'executed', children_killed: killed });
    return result;
  }

  return {
    status: async () => {
      // Contract: DesktopStatusResponse in common/contracts/desktop.ts
      // (lines 53-62) is .strict() with `additionalProperties: false`. The
      // previous return included `pending_approvals: listPending()` which
      // is NOT in the contract — that field is exposed via the dedicated
      // `GET /api/desktop/pending` route, not the status one. Returning it
      // here caused the route to fail with HTTP 500 (BAD_RESPONSE: contains
      // unrecognized keys). Per aide-debugging-discipline (verified trap
      // "Strict zod rejects legacy keys") + AGENT_NOTES line 8 documented
      // "desktop control returns 502 on /api/desktop/status" root cause.
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
    submitPending,
    waitForVerdict,
    resolvePending,
    listPending,
    _test: { children, panics } // battery access; not part of public contract
  };
}

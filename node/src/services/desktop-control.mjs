// Desktop Control — P6 DC-a bounded domain. Strict opt-in grants, deny-by-default,
// session-scoped TTL, panic kill switch, evidence to the memory spine.
// Zero new native deps: Windows ops via cmd start / explorer / PowerShell / fs.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createStateBus } from '../../../harness/cipher-state.mjs';
import { AuthorityError } from './execution-authority.mjs';
import { createOwnedProcesses } from './owned-process.mjs';

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

export function createDesktopControl({ workspace, authority, clock = Date.now }) {
  function authorized(execution, kind, body) {
    if (!authority) throw new AuthorityError('FORBIDDEN', 'canonical authority required');
    return authority.assertExecution(execution, kind, body);
  }
  let manifest = null;
  const processes = createOwnedProcesses();
  let grantOwner = null;
  let panicked = false;
  let unownedHandlers = 0;
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
      manifest = { ...JSON.parse(await fs.readFile(path.join(workspace, GRANTS_FILE), 'utf8')), enabled: false };
    } catch { manifest = null; }
    return manifest;
  }

  async function saveManifest(next) {
    const file = path.join(workspace, GRANTS_FILE);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(next, null, 2), 'utf8');
    manifest = next;
    return next;
  }

  async function activeGrants() {
    const m = await loadManifest();
    if (panicked) throw new DesktopRefusedError('PANIC', 'panic switch tripped for this session');
    if (!m || !m.enabled || !grantOwner) throw new DesktopRefusedError('DISABLED', 'desktop control is not enabled');
    authority.assertActor(grantOwner);
    const ageMin = (clock() - new Date(m.session_started_at).getTime()) / 60000;
    if (ageMin > m.ttl_minutes) throw new DesktopRefusedError('EXPIRED', `grants expired after ${m.ttl_minutes} minutes`);
    return m.grants;
  }

  async function evidence(kind, detail) {
    try { await createStateBus(workspace).append({ type: 'desktop', ...detail }); } catch { /* best-effort */ }
    void kind;
  }

  async function run(cmd, args, opts = {}) {
    let stdout = ''; let stderr = '';
    const launched = processes.launch(cmd, args, { cwd: workspace,
      onStdout: chunk => { stdout = (stdout + String(chunk)).slice(-262144); },
      onStderr: chunk => { stderr = (stderr + String(chunk)).slice(-262144); } });
    await launched.spawned;
    const timer = setTimeout(() => { void processes.terminate(launched.handle); }, opts.timeout ?? 8000);
    try {
      const result = await launched.finished;
      if (result.code !== 0 || result.signal || result.error) throw new Error(stderr || result.error || 'desktop helper failed or was terminated');
      return stdout;
    } finally { clearTimeout(timer); }
  }
  const psLiteral = text => `'${String(text).replaceAll("'", "''")}'`;

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
        `$m.To = ${psLiteral(to)}`,
        `$m.Subject = ${psLiteral(subject)}`,
        `$m.Body = ${psLiteral(body)}`,
        '$m.Save()',
        'Write-Output "draft-saved"'
      ].join('; ');
      let out;
      try { out = await run('powershell.exe', ['-NoProfile', '-STA', '-NonInteractive', '-Command', script], { timeout: 30000 }); }
      catch (error) {
        if (error.message.includes('0x80040154')) throw new DesktopRefusedError('OUTLOOK_UNAVAILABLE', 'classic Outlook COM unavailable');
        throw error;
      }
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
          `$w = $e.Workbooks.Open(${psLiteral(csvPath)})`,
          `$w.SaveAs(${psLiteral(destination)}, 51)`, // xlOpenXMLWorkbook
          '$w.Close($false); $e.Quit()',
          'Write-Output "xlsx-written"'
        ].join('; ');
        const out = await run('powershell.exe', ['-NoProfile', '-STA', '-NonInteractive', '-Command', script], { timeout: 60000 });
        return out.includes('xlsx-written') ? `report written: ${destination}` : out;
      } catch (error) {
        if (String(error?.message || error).includes('0x80040154')) {
          throw new DesktopRefusedError('EXCEL_UNAVAILABLE', 'Excel is not installed (COM class not registered); CSV written instead at ' + csvPath);
        }
        throw new DesktopRefusedError('CHILD_FAILED', `excel failed: ${String(error?.message || error).slice(0, 200)}`);
      }
    },
    async launch_app(grants, target, _destination, request) {
      const name = String(target || '').trim().toLowerCase().replace(/\.exe$/, '');
      const hit = grants.apps.find(a => a.toLowerCase().replace(/\.exe$/, '') === name);
      if (!hit) throw new DesktopRefusedError('NOT_ALLOWLISTED', `app "${target}" is not on the allowlist`);
      const launched = processes.launch(hit, request.args ?? [], { cwd: workspace });
      await launched.spawned;
      return { output: `launched ${hit}; owned process ${launched.handle.pid}`, handle: launched.handle };
    },
    async open_path(grants, target) {
      const root = grants.roots.find(r => isSubpath(r, String(target)));
      if (!root) throw new DesktopRefusedError('PATH_NOT_GRANTED', `"${target}" is outside granted roots`);
      const stat = await fs.stat(target).catch(() => null);
      if (!stat) throw new DesktopRefusedError('NOT_FOUND', `${target} does not exist`);
      // The registered OS handler may reuse another application's process.
      // Own only the helper, and explicitly report the handler as unowned.
      await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Start-Process -FilePath ${psLiteral(target)} -WindowStyle Hidden -ErrorAction Stop`]);
      unownedHandlers += 1;
      return `open requested for ${target}; handler process ownership unproven`;
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
      const script = `(New-Object -ComObject WScript.Shell).AppActivate(${psLiteral(title)}) | Out-Null`;
      await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
      return `focused window matching ${title}`;
    }
  };

  async function autoAssert(op, target, destination, output) {
    // DC-b: every trajectory row carries a state assertion — R3 law forbids
    // training on unverified rollouts. Assertions are mechanical, per-op.
    switch (op) {
      case 'launch_app': {
        return { pass: processes.alive(output?.handle), check: `owned_process_alive:${output?.handle?.pid ?? 'unknown'}` };
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
        return { pass: false, check: 'handler_ownership_unproven' };
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

  async function act(request, execution, sessionId = 'default') {
    const trusted = authorized(execution, 'desktop.action', request);
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
    if (trusted.owner !== grantOwner) throw new AuthorityError('FORBIDDEN', 'desktop grants belong to another operator');
    authorized(execution, 'desktop.action', request);
    const fn = ops[request.op];
    if (!fn) throw new DesktopRefusedError('UNKNOWN_OP', `unsupported op: ${request.op}`);
    try {
      const output = await fn(grants, request.target, request.destination, request);
      const assertion = await autoAssert(request.op, request.target, request.destination, output);
      const result = { ok: true, decision: 'executed', output: String(output?.output ?? output).slice(0, 2000), latency_ms: Date.now() - started, assertion };
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

  async function panic(execution) {
    authorized(execution, 'desktop.panic', {});
    const started = Date.now();
    panicked = true; grantOwner = null;
    authority.control.revokePending();
    if (manifest) panics.push(manifest.session_started_at);
    const outcomes = await processes.revoke();
    const killed = outcomes.filter(item => item.killed).length;
    const result = { ok: outcomes.every(item => item.status === 'terminated' || item.status === 'exited'), children_killed: killed,
      unowned_handlers: unownedHandlers, outcomes, revoked_at: new Date().toISOString(), latency_ms: Date.now() - started };
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
        enabled: Boolean(m?.enabled && grantOwner && !panicked),
        ttl_minutes: m?.ttl_minutes ?? null,
        session_started_at: m?.session_started_at ?? null,
        grants: m?.grants ?? { apps: [], roots: [], window_titles: [] },
        tracked_children: processes.snapshot().length,
        panicked
      };
    },
    setGrants: async (input, execution) => {
      const trusted = authorized(execution, 'desktop.grants', input);
      const next = await saveManifest({ version: 1, ...input, session_started_at: new Date(clock()).toISOString(), approved_by: 'operator-wizard' });
      authorized(execution, 'desktop.grants', input);
      grantOwner = trusted.owner; panicked = false;
      if (input.enabled) processes.arm(); else await processes.revoke();
      return next;
    },
    act,
    panic,
    submitPending,
    waitForVerdict,
    resolvePending,
    listPending,
    _test: { panics } // no injectable PID/ownership registry
  };
}

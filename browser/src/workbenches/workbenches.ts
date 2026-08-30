// workbenches.ts (cline/T4, 2026-08-29)
//
// The Workbenches view: list all workflow bundles, show their
// status, and provide 1-click install/trust/enable. This is the
// UI surface for the "user just has to approve load bundle" verb
// from the user. The data comes from GET /api/workbenches; the
// actions go through POST /api/workbenches/{install,trust,uninstall}.

interface BundleSummary {
  id: string;
  name: string;
  version: string;
  description: string;
  installed: boolean;
  enabled: boolean;
  validated: boolean;
  plugins_count?: number;
  skills_count?: number;
  mcp_count?: number;
  online_mcp_count?: number;
  issues?: string[];
  mcp_servers?: Array<{ name: string; offline: boolean; trusted: boolean }>;
}

interface BundleListResponse {
  ok: boolean;
  data: { workbenches: BundleSummary[] };
}

interface BundleDetailResponse {
  ok: boolean;
  data: { workbench: BundleSummary };
}

async function api<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}`);
  return (await res.json()) as T;
}

export function createWorkbenchesPanel(root: HTMLElement, opts: { onToast: (code: string, message: string) => void }): WorkbenchesPanel {
  root.innerHTML = '';
  const header = el('div', { class: 'workbenches-header' }, [
    el('h2', {}, ['BUNDLES']),
    el('button', { class: 'workbench-refresh', type: 'button', title: 'Refresh' }, ['\u21bb'])
  ]);
  const list = el('div', { class: 'workbench-list' });
  root.appendChild(header);
  root.appendChild(list);
  const refreshBtn = header.querySelector('button.workbench-refresh') as HTMLButtonElement;
  refreshBtn.addEventListener('click', () => { void refresh(); });

  async function refresh(): Promise<void> {
    list.innerHTML = '<div class="workbench-loading">Loading bundles…</div>';
    let res: BundleListResponse;
    try {
      res = await api<BundleListResponse>('GET', '/api/workbenches');
    } catch (e) {
      list.innerHTML = '';
      list.appendChild(el('div', { class: 'workbench-error' }, [`Failed to load bundles: ${(e as Error).message}`]));
      opts.onToast('INTERNAL', 'failed to load bundles');
      return;
    }
    list.innerHTML = '';
    if (res.data.workbenches.length === 0) {
      list.appendChild(el('div', { class: 'workbench-empty' }, ['No bundles available.']));
      return;
    }
    for (const wb of res.data.workbenches) list.appendChild(renderBundle(wb));
  }

  function renderBundle(wb: BundleSummary): HTMLElement {
    const card = el('div', { class: 'workbench-card' + (wb.enabled ? ' enabled' : '') + (wb.installed ? ' installed' : ' not-installed') });
    const titleRow = el('div', { class: 'workbench-card-title' }, [
      el('span', { class: 'workbench-card-id' }, [wb.id]),
      el('span', { class: 'workbench-card-version' }, ['v' + wb.version])
    ]);
    const statusRow = el('div', { class: 'workbench-card-status' }, [
      el('span', { class: 'badge ' + (wb.installed ? 'badge-ok' : 'badge-pending') }, [wb.installed ? 'INSTALLED' : 'NOT INSTALLED']),
      el('span', { class: 'badge ' + (wb.enabled ? 'badge-ok' : 'badge-pending') }, [wb.enabled ? 'ENABLED' : 'DISABLED']),
      el('span', { class: 'badge ' + (wb.validated ? 'badge-ok' : 'badge-warn') }, [wb.validated ? 'VALIDATED' : 'ISSUES'])
    ]);
    const desc = el('div', { class: 'workbench-card-desc' }, [wb.description.slice(0, 200) + (wb.description.length > 200 ? '\u2026' : '')]);
    const counts = el('div', { class: 'workbench-card-counts' }, []);
    if (wb.plugins_count !== undefined) counts.appendChild(el('span', {}, [`${wb.plugins_count} plugins`]));
    if (wb.skills_count !== undefined) counts.appendChild(el('span', {}, [`${wb.skills_count} skills`]));
    if (wb.mcp_count !== undefined) counts.appendChild(el('span', {}, [`${wb.mcp_count} MCP${wb.online_mcp_count ? ` (${wb.online_mcp_count} online)` : ''}`]));
    const actions = el('div', { class: 'workbench-card-actions' });
    if (!wb.installed) {
      const installBtn = el('button', { type: 'button', class: 'workbench-btn-primary' }, ['INSTALL']);
      installBtn.addEventListener('click', () => { void install(wb.id, installBtn); });
      actions.appendChild(installBtn);
    } else {
      if (wb.mcp_servers) {
        for (const s of wb.mcp_servers) {
          if (s.offline && !s.trusted) {
            const t = el('button', { type: 'button', class: 'workbench-btn-secondary' }, [`Trust ${s.name}`]);
            t.addEventListener('click', () => { void trust(wb.id, s.name); });
            actions.appendChild(t);
          }
        }
      }
      const uninstallBtn = el('button', { type: 'button', class: 'workbench-btn-danger' }, ['Uninstall']);
      uninstallBtn.addEventListener('click', () => { void uninstall(wb.id); });
      actions.appendChild(uninstallBtn);
    }
    if (wb.issues && wb.issues.length > 0) {
      const issues = el('div', { class: 'workbench-card-issues' }, [el('strong', {}, ['Issues:']), ...wb.issues.map(i => el('div', { class: 'workbench-issue' }, [i]))]);
      card.appendChild(issues);
    }
    card.appendChild(titleRow);
    card.appendChild(statusRow);
    card.appendChild(desc);
    card.appendChild(counts);
    card.appendChild(actions);
    return card;
  }

  async function install(id: string, btn: HTMLButtonElement): Promise<void> {
    btn.disabled = true;
    btn.textContent = 'INSTALLING\u2026';
    try {
      await api<BundleDetailResponse>('POST', '/api/workbenches/install', { id });
      opts.onToast('OK', `Installed ${id}`);
      await refresh();
    } catch (e) {
      opts.onToast('INTERNAL', `install failed: ${(e as Error).message}`);
      btn.disabled = false;
      btn.textContent = 'INSTALL';
    }
  }

  async function trust(id: string, server: string): Promise<void> {
    try {
      await api<BundleDetailResponse>('POST', '/api/workbenches/trust', { id, server, trusted: true });
      opts.onToast('OK', `Trusted ${server} in ${id}`);
      await refresh();
    } catch (e) {
      opts.onToast('INTERNAL', `trust failed: ${(e as Error).message}`);
    }
  }

  async function uninstall(id: string): Promise<void> {
    if (!window.confirm(`Uninstall bundle ${id}?`)) return;
    try {
      await api('POST', '/api/workbenches/uninstall', { id });
      opts.onToast('OK', `Uninstalled ${id}`);
      await refresh();
    } catch (e) {
      opts.onToast('INTERNAL', `uninstall failed: ${(e as Error).message}`);
    }
  }

  void refresh();
  return { refresh };
}

export interface WorkbenchesPanel { refresh(): Promise<void> }

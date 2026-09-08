// resident.ts (2026-09-08)
//
// Resident Assistant v0 minimal UI surface. Renders the §11 workspace
// readiness statement (AIDE is ready / attention) and the small set of
// actionable conditions. READ-ONLY — no buttons that mutate state; the RA
// observes, classifies, and recommends only. Any action flows through the
// existing capability surfaces, unchanged.

import type { ResidentSummaryT, ResidentConditionT } from '../../../common/contracts/resident.ts';
import { api } from '../services/api.ts';

type ElChild = Node | string | number;
function el(tag: string, attrs: Record<string, string> = {}, children: ElChild[] = []): HTMLElement {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = String(v);
    else node.setAttribute(k, String(v));
  }
  for (const c of children) {
    node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return node;
}

export interface ResidentPanel {
  refresh(): Promise<void>;
}

export function createResidentPanel(root: HTMLElement, residentStatus: HTMLElement, opts: { onToast: (code: string, message: string) => void }): ResidentPanel {
  root.innerHTML = '';
  const header = el('div', { class: 'resident-header' }, [
    el('h2', {}, ['RESIDENT']),
    el('button', { class: 'resident-refresh', type: 'button', title: 'Refresh workspace health' }, ['\u21bb'])
  ]);
  const body = el('div', { class: 'resident-body' });
  root.appendChild(header);
  root.appendChild(body);
  const refreshBtn = header.querySelector('button.resident-refresh') as HTMLButtonElement;
  refreshBtn.addEventListener('click', () => { void refresh(); });

  async function refresh(): Promise<void> {
    body.innerHTML = '<div class="resident-loading">Probing workspace…</div>';
    let summary: ResidentSummaryT;
    try {
      const res = await api.residentSummary();
      summary = res.summary;
    } catch (e) {
      body.innerHTML = '';
      body.appendChild(el('div', { class: 'resident-error' }, [`Failed to probe workspace: ${(e as Error).message}`]));
      residentStatus.textContent = 'assistant: unavailable';
      residentStatus.className = 'item resident-status err';
      opts.onToast('INTERNAL', 'resident probe failed');
      return;
    }
    render(summary);
  }

  function render(summary: ResidentSummaryT): void {
    residentStatus.textContent = `assistant: ${summary.status === 'ready' ? 'ready' : 'attention'}`;
    residentStatus.className = 'item resident-status ' + (summary.status === 'ready' ? 'ok' : 'err');

    body.innerHTML = '';
    const verdictRow = el('div', { class: 'resident-verdict ' + (summary.status === 'ready' ? 'ok' : 'warn') }, [summary.recommendation]);
    body.appendChild(verdictRow);

    const detail = el('div', { class: 'resident-detail' });
    detail.appendChild(el('div', {}, [`Project: ${summary.projectType}`]));
    detail.appendChild(el('div', {}, [`Git: ${summary.git.git_repo ? `${summary.git.branch ?? 'detached'} (${summary.git.clean ? 'clean' : `${summary.git.changes} changes`}${summary.git.behind > 0 ? `, ${summary.git.behind} behind` : ''})` : 'not a repo'}`]));
    detail.appendChild(el('div', {}, [`LSP: ${summary.lsp.available ? 'available' : 'unavailable'}`]));
    detail.appendChild(el('div', {}, [`Tests: ${summary.hasTestScript ? 'script present' : 'no script'}`]));
    detail.appendChild(el('div', {}, [`Model: ${summary.model.runtime_available ? (summary.model.ready_count > 0 ? 'available' : 'engine ready, no artifact') : 'unavailable'}`]));
    if (summary.deps.has_manifest) {
      detail.appendChild(el('div', {}, [`Deps: ${summary.deps.dependencies} runtime / ${summary.deps.dev_dependencies} dev${summary.deps.has_lockfile ? ', lockfile committed' : ''}`]));
    }
    body.appendChild(detail);

    const actionables = summary.conditions.filter(c => c.severity !== 'info');
    if (actionables.length > 0) {
      const list = el('div', { class: 'resident-conditions' });
      list.appendChild(el('div', { class: 'resident-conditions-title' }, ['Needs attention']));
      for (const c of actionables) list.appendChild(renderCondition(c));
      body.appendChild(list);
    }
  }

  function renderCondition(c: ResidentConditionT): HTMLElement {
    const row = el('div', { class: 'resident-condition ' + c.severity });
    const severity = el('span', { class: 'resident-cond-sev' }, [c.severity.toUpperCase()]);
    const text = el('div', { class: 'resident-cond-text' });
    text.appendChild(el('div', {}, [c.message]));
    text.appendChild(el('div', { class: 'resident-cond-reco' }, [`\u2192 ${c.recommendation}`]));
    row.appendChild(severity);
    row.appendChild(text);
    return row;
  }

  void refresh();
  return { refresh };
}
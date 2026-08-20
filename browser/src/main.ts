import editorWorker from 'monaco-editor/editor/editor.worker?worker';
import tsWorker from 'monaco-editor/language/typescript/ts.worker?worker';
import 'monaco-editor/editor/editor.main';
import '../../node_modules/monaco-editor/min/vs/editor/editor.main.css';
import { Store } from './store/store.ts';
import { INITIAL_STATE } from './store/state.ts';
import { api } from './services/api.ts';
import { SessionService } from './services/session.ts';
import { createShell } from './shell/shell.ts';
import { showToast } from './ui/toast.ts';
import { createEditorHost, type EditorHost } from './editor/host.ts';
import { createGroups } from './editor/groups.ts';
import { createSearchPanel } from './editor/search.ts';
import { onDirtyChange, isDirty, openPaths } from './editor/models.ts';
import { ArchLspBridge, applyDiagnostics } from './editor/lsp-bridge.ts';
import { registerLspProviders } from './editor/lsp-providers.ts';
import { createChatPanel } from './chat/chat.ts';
import type { DiagnosticsEventT } from '../../common/contracts/events.ts';
import type { LspStatusEventT } from '../../common/contracts/lsp.ts';
import { connectEvents } from './services/ws.ts';

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    return new editorWorker();
  }
};

function renderTabBar(tabBar: HTMLElement, groupId: string, host: EditorHost): void {
  tabBar.textContent = '';
  const paths = host.tabsIn(groupId);
  for (const relPath of paths) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tab' + (host.activePath() === relPath ? ' active' : '') + (isDirty(relPath) ? ' dirty' : '');
    button.textContent = relPath.split('\\').pop() ?? relPath;
    button.title = relPath;
    button.addEventListener('click', () => host.activate(relPath));
    const close = document.createElement('span');
    close.className = 'tab-close';
    close.textContent = '\u00d7';
    close.addEventListener('click', (event: MouseEvent) => {
      event.stopPropagation();
      void host.close(relPath);
    });
    button.appendChild(close);
    tabBar.appendChild(button);
  }
}

function renderAllTabs(host: EditorHost): void {
  for (const group of host.groups()) renderTabBar(group.tabBar, group.id, host);
}

function renderLspStatus(shell: ReturnType<typeof createShell>, states: Record<string, string>): void {
  const active = Object.entries(states);
  if (active.length === 0) {
    shell.lspStatus.textContent = '';
    return;
  }
  shell.lspStatus.textContent = active.map(([languageId, status]) => `${languageId}: ${status}`).join(' · ');
  shell.lspStatus.className = 'item lsp-status' + (active.every(([, status]) => status === 'running' || status === 'available') ? ' ok' : active.some(([, status]) => status === 'error' || status === 'not_found') ? ' err' : '');
}

async function boot(): Promise<void> {
  const app = document.getElementById('app');
  if (app === null) throw new Error('#app missing');
  const store = new Store(INITIAL_STATE);
  const shell = createShell(app, store);
  const session = new SessionService();
  const groups = createGroups(shell.editorRoot, {
    onSplit: direction => {
      void host.split(direction);
    },
    onCloseGroup: () => {
      void host.closeGroup();
    }
  });
  const host = createEditorHost(groups, session, {
    confirmDirty: relPath => window.confirm(`${relPath} has unsaved changes. Close anyway?`),
    onTabChange: () => {
      renderAllTabs(host);
      if (openPaths().length > 0) session.set(() => host.captureSession());
      const active = host.activePath();
      shell.statusLeft.textContent = active === null ? 'ready' : `${active}${isDirty(active) ? ' \u25cf' : ''}`;
    },
    onToast: (code, message) => showToast(shell.statusRight, code, message)
  }, new ArchLspBridge());
  registerLspProviders(host);
  onDirtyChange(() => renderAllTabs(host));
  groups.onGroupsChange(() => renderAllTabs(host));
  createSearchPanel(shell.searchPanel, { host, onToast: (code, message) => showToast(shell.statusRight, code, message) });
  const chatPanel = createChatPanel(shell.chatPanel, { onToast: (code, message) => showToast(shell.statusRight, code, message) });
  void chatPanel.refreshModels();

  const events = connectEvents(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`, {
    onStatus: connected => {
      shell.statusDot.className = connected ? 'status-dot ok' : 'status-dot err';
    }
  });
  events.subscribe('log', data => {
    const event = data as { level?: string; message?: string; path?: string };
    if (event.level === 'error') showToast(shell.statusRight, 'INTERNAL', `daemon: ${event.message ?? 'error'}${event.path ? ` (${event.path})` : ''}`);
  });
  events.subscribe('diagnostics', data => {
    applyDiagnostics(data as DiagnosticsEventT);
  });
  const lspStates: Record<string, string> = {};
  events.subscribe('lsp-status', data => {
    const event = data as LspStatusEventT;
    lspStates[event.languageId] = event.status;
    renderLspStatus(shell, lspStates);
  });
  void api.lspStatus().then(status => {
    for (const server of status.servers) lspStates[server.languageId] = server.status;
    renderLspStatus(shell, lspStates);
  }).catch(() => {});

  try {
    const health = await api.health();
    store.set(prev => ({ ...prev, booted: true, health }));
    shell.statusDot.className = 'status-dot ok';
    shell.title.textContent = `AIDE — ${health.workspace}`;
    shell.statusLeft.textContent = `daemon ${health.version}`;
  } catch (error) {
    shell.statusDot.className = 'status-dot err';
    shell.title.textContent = 'AIDE — daemon unreachable';
    showToast(shell.statusRight, 'NOT_READY', error instanceof Error ? error.message : 'daemon unreachable');
    return;
  }

  try {
    await session.restore();
    await host.restoreSession(session.current);
    store.set(prev => ({ ...prev, session: session.current }));
  } catch {
    // restore is best-effort
  }
  renderAllTabs(host);

  try {
    const workspace = await api.workspaceList();
    store.set(prev => ({ ...prev, workspace }));
    const list = document.createElement('ul');
    list.className = 'file-list';
    for (const entry of workspace.entries.filter(e => e.kind === 'file')) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = entry.name;
      button.addEventListener('click', () => {
        void host.open(entry.name);
      });
      item.appendChild(button);
      list.appendChild(item);
    }
    shell.mapFiles.replaceChildren(list);
  } catch (error) {
    showToast(shell.statusRight, 'INTERNAL', error instanceof Error ? error.message : 'workspace unavailable');
  }

  window.addEventListener('pagehide', () => {
    session.set(() => host.captureSession());
    void session.flush();
    events.dispose();
  });
}

void boot();

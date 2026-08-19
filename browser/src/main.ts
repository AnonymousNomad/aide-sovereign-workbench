import editorWorker from 'monaco-editor/editor/editor.worker?worker';
import tsWorker from 'monaco-editor/language/typescript/ts.worker?worker';
import '../../node_modules/monaco-editor/min/vs/editor/editor.main.css';
import { Store } from './store/store.ts';
import { INITIAL_STATE } from './store/state.ts';
import { api } from './services/api.ts';
import { SessionService } from './services/session.ts';
import { createShell } from './shell/shell.ts';
import { showToast } from './ui/toast.ts';
import { createEditorHost, type EditorHost } from './editor/host.ts';
import { createSearchPanel } from './editor/search.ts';
import { openPaths, onDirtyChange, isDirty } from './editor/models.ts';

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    return new editorWorker();
  }
};

function renderTabBar(tabBar: HTMLElement, host: EditorHost): void {
  tabBar.textContent = '';
  const paths = openPaths();
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

async function boot(): Promise<void> {
  const app = document.getElementById('app');
  if (app === null) throw new Error('#app missing');
  const store = new Store(INITIAL_STATE);
  const shell = createShell(app, store);
  const session = new SessionService();
  const host = createEditorHost(shell.editorRoot, session, {
    confirmDirty: relPath => window.confirm(`${relPath} has unsaved changes. Close anyway?`),
    onTabChange: () => {
      renderTabBar(shell.tabBar, host);
      session.set(() => host.captureSession());
      const active = host.activePath();
      shell.statusBar.textContent = active === null ? 'ready' : `${active}${isDirty(active) ? ' \u25cf' : ''}`;
    },
    onToast: (code, message) => showToast(shell.statusBar, code, message)
  });
  onDirtyChange(() => renderTabBar(shell.tabBar, host));
  createSearchPanel(shell.searchPanel, { host, onToast: (code, message) => showToast(shell.statusBar, code, message) });

  try {
    const health = await api.health();
    store.set(prev => ({ ...prev, booted: true, health }));
    shell.statusDot.className = 'status-dot ok';
    shell.title.textContent = `AIDE — ${health.workspace}`;
    shell.statusBar.textContent = `daemon ${health.version}`;
  } catch (error) {
    shell.statusDot.className = 'status-dot err';
    shell.title.textContent = 'AIDE — daemon unreachable';
    showToast(shell.statusBar, 'NOT_READY', error instanceof Error ? error.message : 'daemon unreachable');
    return;
  }

  try {
    await session.restore();
    await host.restoreSession(session.current, relPath => host.open(relPath));
    store.set(prev => ({ ...prev, session: session.current }));
  } catch {
    // restore is best-effort
  }
  renderTabBar(shell.tabBar, host);

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
    showToast(shell.statusBar, 'INTERNAL', error instanceof Error ? error.message : 'workspace unavailable');
  }

  window.addEventListener('pagehide', () => {
    session.set(() => host.captureSession());
    void session.flush();
  });
}

void boot();
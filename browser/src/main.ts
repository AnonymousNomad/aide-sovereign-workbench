import { Store } from './store/store.ts';
import { INITIAL_STATE } from './store/state.ts';
import { api } from './services/api.ts';
import { SessionService } from './services/session.ts';
import { createShell } from './shell/shell.ts';
import { showToast } from './ui/toast.ts';

async function boot(): Promise<void> {
  const app = document.getElementById('app');
  if (app === null) throw new Error('#app missing');
  const store = new Store(INITIAL_STATE);
  const shell = createShell(app, store);
  const session = new SessionService();

  let healthOk = false;
  try {
    const health = await api.health();
    store.set(prev => ({ ...prev, booted: true, health }));
    shell.statusDot.className = 'status-dot ok';
    shell.title.textContent = `AIDE — ${health.workspace}`;
    shell.statusBar.textContent = `daemon ${health.version} · ${health.freeMemoryMB} MB free`;
    healthOk = true;
  } catch (error) {
    shell.statusDot.className = 'status-dot err';
    shell.title.textContent = 'AIDE — daemon unreachable';
    shell.statusBar.textContent = 'daemon unreachable';
    showToast(shell.statusBar, 'NOT_READY', error instanceof Error ? error.message : 'daemon unreachable');
  }

  try {
    await session.restore();
    store.set(prev => ({ ...prev, session: session.current }));
  } catch {
    // session restore is best-effort
  }

  try {
    const workspace = await api.workspaceList();
    store.set(prev => ({ ...prev, workspace }));
    if (healthOk) shell.statusBar.textContent = `daemon ok · ${workspace.entries.length} entries`;
  } catch (error) {
    showToast(shell.statusBar, 'INTERNAL', error instanceof Error ? error.message : 'workspace unavailable');
  }

  window.addEventListener('pagehide', () => {
    void session.flush();
  });
}

void boot();
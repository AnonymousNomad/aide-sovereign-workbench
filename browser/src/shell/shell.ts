import type { Store } from '../store/store.ts';
import type { AppState, Activity } from '../store/state.ts';

const ACTIVITIES: { id: Activity; label: string }[] = [
  { id: 'learn', label: 'LEARN' },
  { id: 'map', label: 'MAP' },
  { id: 'exp', label: 'EXP' },
  { id: 'run', label: 'RUN' }
];

export interface Shell {
  title: HTMLElement;
  statusDot: HTMLElement;
  statusBar: HTMLElement;
  statusLeft: HTMLElement;
  lspStatus: HTMLElement;
  statusRight: HTMLElement;
  editorColumn: HTMLElement;
  editorRoot: HTMLElement;
  mapView: HTMLElement;
  mapFiles: HTMLElement;
  searchPanel: HTMLElement;
  chatPanel: HTMLElement;
  providersPanel: HTMLElement;
}

export function createShell(app: HTMLElement, store: Store<AppState>): Shell {
  app.innerHTML = `
    <div class="title-bar">
      <span class="status-dot" id="status-dot"></span>
      <span class="title" id="title">AIDE</span>
    </div>
    <div class="workbench">
      <nav class="activity-bar" id="activity-bar"></nav>
      <main class="main-column">
        <div class="editor-column" id="editor-column">
          <div class="editor-root" id="editor-root"></div>
          <section class="view-overlay active" data-view="learn"><h2>LEARN</h2></section>
          <section class="view-overlay" data-view="map">
            <h2>MAP</h2>
            <div class="map-files" id="map-files"></div>
            <div class="search-panel" id="search-panel"></div>
          </section>
          <section class="view-overlay" data-view="exp"><h2>EXP</h2><div class="chat-panel-root" id="chat-panel"></div><div class="providers-panel-root" id="providers-panel"></div></section>
          <section class="view-overlay" data-view="run"><h2>RUN</h2></section>
        </div>
      </main>
    </div>
    <div class="status-bar" id="status-bar">
      <span class="item" id="status-left">starting…</span>
      <span class="spacer"></span>
      <span class="item lsp-status" id="lsp-status"></span>
      <span class="item" id="status-right"></span>
    </div>
  `;

  const bar = app.querySelector<HTMLElement>('#activity-bar');
  const views = Array.from(app.querySelectorAll<HTMLElement>('.view-overlay'));
  if (bar === null) throw new Error('activity bar missing');
  for (const activity of ACTIVITIES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.activity = activity.id;
    button.textContent = activity.label;
    button.addEventListener('click', () => {
      store.set(prev => ({ ...prev, activity: prev.activity === activity.id ? 'editor' : activity.id }));
    });
    bar.appendChild(button);
  }

  const unbind = store.subscribe(state => {
    bar.querySelectorAll('button').forEach(button => {
      button.classList.toggle('active', button.dataset.activity === state.activity);
    });
    views.forEach(view => {
      view.classList.toggle('active', view.dataset.view === state.activity);
    });
  });

  const statusDot = app.querySelector<HTMLElement>('#status-dot');
  const statusBar = app.querySelector<HTMLElement>('#status-bar');
  const statusLeft = app.querySelector<HTMLElement>('#status-left');
  const lspStatus = app.querySelector<HTMLElement>('#lsp-status');
  const statusRight = app.querySelector<HTMLElement>('#status-right');
  const editorColumn = app.querySelector<HTMLElement>('#editor-column');
  const editorRoot = app.querySelector<HTMLElement>('#editor-root');
  const mapView = app.querySelector<HTMLElement>('[data-view="map"]');
  const mapFiles = app.querySelector<HTMLElement>('#map-files');
  const searchPanel = app.querySelector<HTMLElement>('#search-panel');
  const chatPanel = app.querySelector<HTMLElement>('#chat-panel');
  const providersPanel = app.querySelector<HTMLElement>('#providers-panel');
  const title = app.querySelector<HTMLElement>('#title');
  if (statusDot === null || statusBar === null || statusLeft === null || lspStatus === null || statusRight === null || editorColumn === null || editorRoot === null || mapView === null || mapFiles === null || searchPanel === null || chatPanel === null || providersPanel === null || title === null) throw new Error('shell mount failed');

  window.addEventListener('unload', () => unbind());

  return { title, statusDot, statusBar, statusLeft, lspStatus, statusRight, editorColumn, editorRoot, mapView, mapFiles, searchPanel, chatPanel, providersPanel };
}
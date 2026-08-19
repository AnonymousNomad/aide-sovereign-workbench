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
  editorColumn: HTMLElement;
  tabBar: HTMLElement;
  editorRoot: HTMLElement;
  mapView: HTMLElement;
  mapFiles: HTMLElement;
  searchPanel: HTMLElement;
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
          <div class="tab-bar" id="tab-bar"></div>
          <div class="editor-root" id="editor-root"></div>
          <section class="view-overlay active" data-view="learn"><h2>LEARN</h2></section>
          <section class="view-overlay" data-view="map">
            <h2>MAP</h2>
            <div class="map-files" id="map-files"></div>
            <div class="search-panel" id="search-panel"></div>
          </section>
          <section class="view-overlay" data-view="exp"><h2>EXP</h2></section>
          <section class="view-overlay" data-view="run"><h2>RUN</h2></section>
        </div>
      </main>
    </div>
    <div class="status-bar">
      <span class="item" id="status-left">starting…</span>
      <span class="spacer"></span>
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
    button.addEventListener('click', () => store.set(prev => ({ ...prev, activity: activity.id })));
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
  const editorColumn = app.querySelector<HTMLElement>('#editor-column');
  const tabBar = app.querySelector<HTMLElement>('#tab-bar');
  const editorRoot = app.querySelector<HTMLElement>('#editor-root');
  const mapView = app.querySelector<HTMLElement>('[data-view="map"]');
  const mapFiles = app.querySelector<HTMLElement>('#map-files');
  const searchPanel = app.querySelector<HTMLElement>('#search-panel');
  const title = app.querySelector<HTMLElement>('#title');
  if (statusDot === null || statusBar === null || editorColumn === null || tabBar === null || editorRoot === null || mapView === null || mapFiles === null || searchPanel === null || title === null) throw new Error('shell mount failed');

  window.addEventListener('unload', () => unbind());

  return { title, statusDot, statusBar, editorColumn, tabBar, editorRoot, mapView, mapFiles, searchPanel };
}
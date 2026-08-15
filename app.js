const state = { manifest: null, node: null, selected: null, runtimeReady: false, runtimeModels: new Map(), activeFile: 'README.md', secondaryFile: null, splitEditor: false, editorGroups: null, openFiles: [], dirtyFiles: new Set(), editorStacks: new Map(), findState: { query: '', matches: [], index: 0 }, conversation: [], files: {
  'agent.ts': `import { ChatMessage, ModelAdapter } from './types';
import { LocalModelRouter } from './router';

export class AgentRuntime {
  constructor(private readonly router: LocalModelRouter) {}

  async review(task: string) {
    const lanes = this.router.plan(task);
    return this.router.runBounded(lanes);
  }
}`,
  'router.ts': `export class LocalModelRouter {
  constructor(private readonly registry: ModelRegistry) {}

  plan(task: string) {
    return ['research', 'build', 'verify'].map(role => ({ role, task }));
  }

  async runBounded(lanes: Lane[]) {
    // Each lane receives only the context it needs and returns a reviewable artifact.
    return this.registry.executeSequentially(lanes, { maxTurns: 4, approval: true });
  }
}`,
  'models.ts': `export type ModelRole = 'research' | 'build' | 'verify';

export interface ModelManifest {
  id: string;
  status: 'experimental' | 'ready' | 'pending';
  roles: ModelRole[];
  runtime: 'llama.cpp' | 'ollama' | 'openai-compatible';
  endpoint: string;
}`,
  'types.ts': `export interface Lane {
  role: 'research' | 'build' | 'verify';
  task: string;
  claims?: string[];
  patch?: string;
  confidence?: number;
}`,
  'README.md': '# AIDE\n\nLocal-first development with explicit model lanes and reviewable patches.'
}};

const $ = selector => document.querySelector(selector);
const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const patchValid = value => /^diff --git\s+\S+\s+\S+/m.test(value) && /^---\s+/m.test(value) && /^\+\+\+\s+/m.test(value) && !/^```/m.test(value);

async function ensureEditorModules() {
  if (!window.UndoStack) await import('./editor/undo-stack.mjs');
  if (!window.EditorGroups) await import('./editor/groups.mjs');
}
const currentStack = () => state.editorStacks.get(state.activeFile) || null;

function refreshLineNumbers() {
  $('#line-numbers').textContent = $('#code').textContent.split('\n').map((_, index) => index + 1).join('\n');
}

function updateFindCount() {
  const { matches, index } = state.findState;
  $('#find-count').textContent = matches.length ? `${(index % matches.length) + 1}/${matches.length}` : '0/0';
}

function renderEditorText() {
  const stack = currentStack();
  $('#code').textContent = stack ? stack.text() : (state.files[state.activeFile] || '');
  refreshLineNumbers();
  if (state.findState.query) markFind(state.findState.query, true);
}

function markFind(query, keepIndex) {
  const text = currentStack()?.text() || '';
  if (!query) { $('#code').textContent = text; state.findState.matches = []; updateFindCount(); return; }
  const lower = text.toLowerCase(); const q = query.toLowerCase();
  const matches = []; let pos = lower.indexOf(q);
  while (pos !== -1) { matches.push(pos); pos = lower.indexOf(q, pos + q.length); }
  state.findState.query = query;
  state.findState.matches = matches;
  if (!keepIndex) state.findState.index = 0;
  updateFindCount();
  if (!matches.length) { $('#code').textContent = text; return; }
  const count = matches.length;
  const idx = ((state.findState.index % count) + count) % count;
  let html = ''; let cursor = 0;
  matches.forEach((match, i) => {
    html += esc(text.slice(cursor, match)) + `<mark>${esc(text.slice(match, match + q.length))}</mark>`;
    cursor = match + q.length;
  });
  html += esc(text.slice(cursor));
  $('#code').innerHTML = html;
  [...$('#code').querySelectorAll('mark')][idx]?.classList.add('active-match');
}

function findNext(dir = 1) {
  if (!state.findState.matches.length) return;
  const count = state.findState.matches.length;
  state.findState.index = ((state.findState.index + dir) % count + count) % count;
  markFind(state.findState.query, true);
}

function replaceCurrent() {
  const stack = currentStack();
  if (!stack || !state.findState.query || !state.findState.matches.length) return;
  const q = state.findState.query;
  const count = state.findState.matches.length;
  const idx = ((state.findState.index % count) + count) % count;
  const start = state.findState.matches[idx];
  const after = stack.text().slice(0, start) + $('#replace-input').value + stack.text().slice(start + q.length);
  try { for (const op of diffOperation(stack.text(), after)) stack.apply(op); } catch (error) { appendLog('EDITOR', `Replace blocked: ${error.message}`, 'warning'); return; }
  renderEditorText();
  markFind(state.findState.query, true);
  syncDirty();
}

function replaceAll() {
  const stack = currentStack();
  if (!stack || !state.findState.query) return;
  const q = state.findState.query; const query = q.toLowerCase();
  const text = stack.text(); const replacement = $('#replace-input').value;
  let out = ''; let pos = 0; let count = 0;
  let idx = text.toLowerCase().indexOf(query);
  while (idx !== -1) { out += text.slice(pos, idx) + replacement; pos = idx + q.length; count++; idx = text.toLowerCase().indexOf(query, pos); }
  out += text.slice(pos);
  try { for (const op of diffOperation(text, out)) stack.apply(op); } catch (error) { appendLog('EDITOR', `Replace all blocked: ${error.message}`, 'warning'); return; }
  renderEditorText();
  markFind(state.findState.query, true);
  appendLog('EDITOR', `Replaced ${count} occurrence(s) of "${state.findState.query}".`);
  syncDirty();
}

async function searchWorkspace() {
  const q = $('#find-input').value.trim();
  const panel = $('#search-results');
  if (!q) { panel.hidden = true; return; }
  panel.hidden = false;
  panel.innerHTML = '<div class="search-file">Searching workspace...</div>';
  try {
    const response = await fetch(`http://127.0.0.1:4777/api/search?q=${encodeURIComponent(q)}`);
    const result = await response.json();
    panel.innerHTML = `<div class="search-file">${result.total} match(es) across ${result.results.length} file(s) - click a hit to open.</div>` + result.results.map(file => `<div class="search-file">${esc(file.path)}</div>` + file.hits.map(hit => {
      const idx = hit.text.toLowerCase().indexOf(q.toLowerCase());
      const shown = idx === -1 ? esc(hit.text) : `${esc(hit.text.slice(0, idx))}<mark>${esc(hit.text.slice(idx, idx + q.length))}</mark>${esc(hit.text.slice(idx + q.length))}`;
      return `<button data-search-file="${esc(file.path)}">${hit.line}: ${shown}</button>`;
    }).join('')).join('');
    panel.querySelectorAll('[data-search-file]').forEach(button => button.onclick = () => { openFile(button.dataset.searchFile); panel.hidden = true; });
  } catch (error) { panel.innerHTML = `<div class="search-file">Search failed: ${esc(error.message)}</div>`; }
}

function undoEditor() {
  const stack = currentStack();
  if (!stack || !stack.canUndo) return;
  stack.undo(); renderEditorText(); syncDirty();
}
function redoEditor() {
  const stack = currentStack();
  if (!stack || !stack.canRedo) return;
  stack.redo(); renderEditorText(); syncDirty();
}

function syncDirty() {
  const dirty = new Set([...state.editorStacks.entries()].filter(([, stack]) => stack.dirty).map(([file]) => file));
  const key = [...dirty].sort().join('|');
  if (key !== [...state.dirtyFiles].sort().join('|')) { state.dirtyFiles = dirty; renderEditorTabs(); }
  saveSession({ active_file: state.activeFile, open_files: state.openFiles, buffers: Object.fromEntries([...state.editorStacks.entries()].filter(([, stack]) => stack.dirty).map(([file, stack]) => [file, stack.text()])) });
}

function openFind() {
  const bar = $('#find-bar');
  bar.hidden = false;
  $('#find-input').focus(); $('#find-input').select();
}
function closeFind() {
  $('#find-bar').hidden = true;
  $('#search-results').hidden = true;
  markFind('');
}

function bindEditorShortcuts() {
  $('#find-input').oninput = event => markFind(event.target.value);
  $('#find-input').onkeydown = event => {
    if (event.key === 'Enter') { event.preventDefault(); findNext(event.shiftKey ? -1 : 1); }
    if (event.key === 'Escape') { closeFind(); $('#code').focus(); }
  };
  $('#replace-input').onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); replaceCurrent(); } };
  $('#replace-one').onclick = replaceCurrent;
  $('#replace-all-file').onclick = replaceAll;
  $('#search-workspace').onclick = searchWorkspace;
  $('#find-close').onclick = () => { closeFind(); $('#code').focus(); };
  document.addEventListener('keydown', event => {
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName);
    if (mod && !typing && !event.shiftKey && key === 's') { event.preventDefault(); saveFile(); return; }
    if (mod && !typing && !event.shiftKey && key === 'z') { event.preventDefault(); undoEditor(); return; }
    if (mod && !typing && (key === 'y' || (event.shiftKey && key === 'z'))) { event.preventDefault(); redoEditor(); return; }
    if (mod && !event.shiftKey && key === 'f') { event.preventDefault(); openFind(); return; }
    if (mod && event.shiftKey && key === 'f') { event.preventDefault(); searchWorkspace(); }
  });
}

async function openFile(name) {
  const text = state.files[name] || state.files['agent.ts'];
  await ensureEditorModules();
  let content = text;
  try {
    const response = await fetch(`http://127.0.0.1:4777/api/file?path=${encodeURIComponent(name)}`);
    if (response.ok) content = (await response.json()).content;
  } catch { /* offline fallback below */ }
  state.activeFile = name;
  if (!state.openFiles.includes(name)) state.openFiles.push(name);
  if (!state.editorStacks.has(name)) state.editorStacks.set(name, new UndoStack(content));
  if (!state.editorGroups) state.editorGroups = new EditorGroups('A');
  if (!state.editorGroups.state().groups[0].tabs.includes(name)) state.editorGroups.open(0, name);
  renderEditorText();
  document.querySelectorAll('[data-file]').forEach(button => button.classList.toggle('active', button.dataset.file === name));
  renderEditorTabs();
  saveSession({ active_file: name, open_files: state.openFiles, buffers: Object.fromEntries([...state.editorStacks.entries()].filter(([, stack]) => stack.dirty).map(([file, stack]) => [file, stack.text()])) });
}

function renderEditorTabs() {
  $('#editor-tabs').innerHTML = state.openFiles.map(file => `<button class="tab ${state.activeFile === file ? 'active' : ''}" data-editor-tab="${esc(file)}">${esc(file.split('/').pop())}${state.dirtyFiles.has(file) ? ' *' : ''}<span data-close-tab="${esc(file)}">×</span></button>`).join('') + '<button class="tab-add">+</button><button id="split-editor" class="tab">SPLIT</button><button id="save-file" class="tab save-tab">SAVE APPROVED FILE</button>';
  $('#editor-tabs').querySelectorAll('[data-editor-tab]').forEach(button => button.onclick = event => { if (event.target.dataset.closeTab) return; openFile(button.dataset.editorTab); });
  $('#editor-tabs').querySelectorAll('[data-close-tab]').forEach(button => button.onclick = event => { event.stopPropagation(); state.openFiles = state.openFiles.filter(file => file !== button.dataset.closeTab); if (state.activeFile === button.dataset.closeTab) openFile(state.openFiles.at(-1) || 'README.md'); else renderEditorTabs(); });
  $('#save-file').onclick = saveFile;
  $('#split-editor').onclick = toggleSplitEditor;
}

async function toggleSplitEditor() {
  state.splitEditor = !state.splitEditor; $('#secondary-editor').hidden = !state.splitEditor;
  if (state.splitEditor) {
    const other = state.openFiles.find(file => file !== state.activeFile) || state.openFiles[0] || 'README.md';
    if (state.editorGroups) state.editorGroups.open(state.editorGroups.state().groups.length > 1 ? 1 : 0, other);
    await openSecondaryFile(other);
  }
  renderEditorTabs();
}

async function openSecondaryFile(name) {
  state.secondaryFile = name; const fallback = state.files[name] || ''; try { const response = await fetch(`http://127.0.0.1:4777/api/file?path=${encodeURIComponent(name)}`); $('#secondary-code').textContent = response.ok ? (await response.json()).content : fallback; } catch { $('#secondary-code').textContent = fallback; } $('#secondary-line-numbers').textContent = $('#secondary-code').textContent.split('\n').map((_, index) => index + 1).join('\n');
  if (state.editorGroups && state.editorGroups.state().groups.length > 1) state.editorGroups.open(1, name);
}

async function saveSession(statePatch) {
  try { await fetch('http://127.0.0.1:4777/api/session', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(statePatch) }); } catch { /* session persistence is best effort while daemon starts */ }
}

async function restoreSession() {
  try {
    const response = await fetch('http://127.0.0.1:4777/api/session');
    const session = await response.json();
    const files = (session.open_files || []).filter(file => typeof file === 'string' && file && !file.split(/[\\/]+/).includes('..')).slice(0, 32);
    const openFiles = files.length ? files : [session.active_file || 'README.md'];
    for (const file of openFiles) await openFile(file);
    for (const [file, recovered] of Object.entries(session.buffers || {})) {
      if (!state.editorStacks.has(file) || typeof recovered !== 'string') continue;
      const stack = state.editorStacks.get(file);
      for (const operation of diffOperation(stack.text(), recovered)) stack.apply(operation);
    }
    state.activeFile = openFiles.includes(session.active_file) ? session.active_file : openFiles[0];
    await openFile(state.activeFile);
    syncDirty();
    const recoveredFiles = Object.keys(session.buffers || {}).filter(file => state.editorStacks.get(file)?.dirty);
    if (recoveredFiles.length) appendLog('SESSION', `Recovered ${recoveredFiles.length} unsaved buffer${recoveredFiles.length === 1 ? '' : 's'} without writing to disk.`);
  } catch { await openFile('README.md'); }
}

function renderWorkspaceTree(nodes, depth = 0) {
  return nodes.map(node => node.kind === 'directory'
    ? `<div class="tree-folder" style="padding-left:${depth * 10}px">▾ ${esc(node.name)}</div>${renderWorkspaceTree(node.children, depth + 1)}`
    : `<button data-file="${esc(node.path)}" style="padding-left:${depth * 10 + 8}px">${esc(node.name.split('.').pop()?.toUpperCase() || 'FILE')} <span>${esc(node.name)}</span></button>`).join('');
}

async function loadWorkspaceTree() {
  try {
    const response = await fetch('http://127.0.0.1:4777/api/workspace/tree');
    if (!response.ok) throw new Error('workspace tree unavailable');
    const result = await response.json(); $('#workspace-tree').innerHTML = renderWorkspaceTree(result.tree);
    $('#workspace-tree').querySelectorAll('[data-file]').forEach(button => button.onclick = () => openFile(button.dataset.file));
  } catch (error) { $('#workspace-tree').innerHTML = `<span class="muted">${esc(error.message)}</span>`; }
}

async function loadProviders() {
  try { const response = await fetch('http://127.0.0.1:4777/api/providers'); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'provider registry unavailable'); $('#provider-select').innerHTML = result.providers.map(provider => `<option value="${esc(provider.id)}" ${provider.configured ? '' : 'disabled'}>${esc(provider.name)}${provider.configured ? '' : ' / NOT CONFIGURED'}</option>`).join(''); }
  catch (error) { appendLog('PROVIDERS', error.message, 'warning'); }
}

async function loadPlugins() {
  try {
    const response = await fetch('http://127.0.0.1:4777/api/plugins'); const result = await response.json(); const presetResponse = await fetch('http://127.0.0.1:4777/api/plugins/presets'); const presetResult = await presetResponse.json(); if (!response.ok || !presetResponse.ok) throw new Error(result.error || presetResult.error || 'plugin registry unavailable');
    $('#plugin-list').innerHTML = result.plugins.length ? result.plugins.map(plugin => `<div class="plugin-item"><b>${esc(plugin.name || plugin.id)}</b><small>${esc(plugin.version || 'invalid')} | ${plugin.trusted ? 'trusted' : 'approval required'}</small>${plugin.invalid ? `<em>${esc(plugin.invalid)}</em>` : plugin.trusted ? '<span class="plugin-state ready">ENABLED / ISOLATED</span>' : `<button data-plugin-trust="${esc(plugin.id)}" class="secondary">TRUST MANIFEST</button>`}</div>`).join('') : '<span class="muted">Drop a plugin folder with aide-plugin.json here.</span>';
    $('#plugin-list').querySelectorAll('[data-plugin-trust]').forEach(button => button.onclick = async () => { await fetch('http://127.0.0.1:4777/api/plugins/trust', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: button.dataset.pluginTrust, trusted: true }) }); loadPlugins(); });
    $('#plugin-presets').innerHTML = `<div class="plugin-presets-title">PRESET CATALOG / ${presetResult.presets.length}</div>` + presetResult.presets.map(preset => `<button class="preset-item" data-plugin-preset="${esc(preset.id)}"><b>${esc(preset.name)}</b><small>${esc(preset.installed ? 'INSTALLED' : 'SCAFFOLD')}</small></button>`).join('');
    $('#plugin-presets').querySelectorAll('[data-plugin-preset]').forEach(button => button.onclick = async () => { const response = await fetch('http://127.0.0.1:4777/api/plugins/scaffold', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: button.dataset.pluginPreset, approved: true }) }); const result = await response.json(); appendLog('PLUGINS', response.ok ? `Scaffolded ${button.dataset.pluginPreset}. Review and trust its manifest before execution.` : result.error, response.ok ? '' : 'warning'); if (response.ok) loadPlugins(); });
  } catch (error) { $('#plugin-list').innerHTML = `<span class="muted">${esc(error.message)}</span>`; }
}

async function loadGitStatus() {
  try {
    const response = await fetch('http://127.0.0.1:4777/api/git/status');
    const result = await response.json();
    if (!response.ok || result.unavailable) throw new Error(result.unavailable || 'Git status unavailable');
    const files = result.files || [];
    $('#git-status').innerHTML = files.length
      ? `<div class="git-summary">${esc(result.branch || 'detached')} · ${files.length} change${files.length === 1 ? '' : 's'}</div>` + files.map(file => `<div class="git-row"><span class="git-kind">${esc(file.kind || ' ')}</span><span class="git-file" title="${esc(file.path)}">${esc(file.path)}</span><button class="git-row-action" data-git-diff="${esc(file.path)}">DIFF</button><button class="git-row-action" data-git-stage="${esc(file.path)}">STAGE</button></div>`).join('')
      : '<div class="git-summary">Working tree clean.</div>';
    $('#git-status').querySelectorAll('[data-git-diff]').forEach(button => button.onclick = () => showGitDiff(button.dataset.gitDiff));
    $('#git-status').querySelectorAll('[data-git-stage]').forEach(button => button.onclick = () => stageGit([button.dataset.gitStage]));
  }
  catch (error) { $('#git-status').textContent = `Git unavailable: ${error.message}`; }
}

async function stageGit(paths) {
  try {
    const response = await fetch('http://127.0.0.1:4777/api/git/stage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paths, approved: true }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Git stage rejected');
    appendLog('GIT', `Staged ${paths.join(', ')} locally.`);
    await loadGitStatus();
  } catch (error) { appendLog('GIT', `Stage blocked: ${error.message}`, 'warning'); }
}

async function commitGit() {
  const input = $('#git-commit-message');
  const message = input.value.trim();
  if (!message) { appendLog('GIT', 'Commit blocked: enter a local commit message.', 'warning'); input.focus(); return; }
  try {
    const response = await fetch('http://127.0.0.1:4777/api/git/commit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, approved: true }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Git commit rejected');
    input.value = '';
    appendLog('GIT', `Local commit created: ${(result.committed || '').trim().split(/\s+/).slice(-1)[0] || 'recorded'}.`);
    await loadGitStatus();
  } catch (error) { appendLog('GIT', `Commit blocked: ${error.message}`, 'warning'); }
}

async function loadTasks() {
  try {
    const response = await fetch('http://127.0.0.1:4777/api/tasks');
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'task registry unavailable');
    $('#task-list').innerHTML = result.tasks.map(task => `<button class="task-item" data-task-id="${esc(task.id)}"><span>▶</span>${esc(task.label)}</button>`).join('');
    $('#task-list').querySelectorAll('[data-task-id]').forEach(button => button.onclick = () => runTask(button));
    $('#task-stop').onclick = stopTask;
  }
  catch (error) { $('#task-list').innerHTML = `<span class="muted">${esc(error.message)}</span>`; }
}

async function runTask(button) {
  const id = button.dataset.taskId;
  button.disabled = true;
  button.dataset.originalLabel = button.textContent;
  button.textContent = 'RUNNING…';
  $('#task-status').textContent = `${id} / RUNNING`;
  try {
    const response = await fetch('http://127.0.0.1:4777/api/tasks/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    const started = await response.json();
    if (!response.ok) throw new Error(started.error || 'task rejected');
    for (let attempt = 0; attempt < 600; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 250));
      const statusResponse = await fetch('http://127.0.0.1:4777/api/tasks/status');
      const status = await statusResponse.json();
      $('#task-status').textContent = `${id} / ${String(status.status || 'unknown').toUpperCase()}`;
      if (status.status !== 'running') {
        const output = `${status.stdout || ''}${status.stderr || ''}`.trim();
        $('#terminal').insertAdjacentHTML('beforeend', `<p class="muted">task ${esc(status.id || id)}: ${esc(status.status || 'finished')}</p>${output ? `<pre class="terminal-output ${status.status === 'passed' ? 'ok' : 'error'}">${esc(output)}</pre>` : ''}`);
        return;
      }
    }
    throw new Error('task status polling timed out after 150 seconds');
  } catch (error) {
    $('#task-status').textContent = `${id} / ERROR`;
    $('#terminal').insertAdjacentHTML('beforeend', `<pre class="terminal-output error">task ${esc(id)}: ${esc(error.message)}</pre>`);
  } finally {
    button.disabled = false;
    button.textContent = button.dataset.originalLabel || id;
  }
}

async function stopTask() {
  try {
    const response = await fetch('http://127.0.0.1:4777/api/tasks/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'task stop rejected');
    $('#task-status').textContent = `${result.id || 'task'} / STOPPING`;
  } catch (error) { appendLog('TASKS', `Stop blocked: ${error.message}`, 'warning'); }
}

async function loadDiagnostics() {
  try { const response = await fetch('http://127.0.0.1:4777/api/diagnostics'); const result = await response.json(); const diagnostics = result.diagnostics || []; $('#problem-count').textContent = diagnostics.length; $('#problems-list').innerHTML = diagnostics.length ? diagnostics.map(item => `<button class="problem-item" data-problem-uri="${esc(item.uri || '')}" data-problem-line="${item.range?.start?.line || 0}"><b>${esc(item.severity === 1 ? 'ERROR' : item.severity === 2 ? 'WARN' : 'INFO')}</b> ${esc(item.message)}<small>${esc(item.source || item.server || '')}</small></button>`).join('') : '<span class="muted">No diagnostics reported.</span>'; $('#problems-list').querySelectorAll('[data-problem-uri]').forEach(button => button.onclick = () => { const uri = decodeURIComponent(button.dataset.problemUri); const file = uri.replace(/^file:\/\/\/workspace\//, ''); openFile(file); appendLog('PROBLEMS', `Opened ${file}:${Number(button.dataset.problemLine) + 1}`); }); }
  catch { /* diagnostics are optional until an LSP is active */ }
}

async function showGitDiff(filePath = '') {
  try { const query = filePath ? `?path=${encodeURIComponent(filePath)}` : ''; const response = await fetch(`http://127.0.0.1:4777/api/git/diff${query}`); const result = await response.json(); $('#terminal').insertAdjacentHTML('beforeend', `<pre class="terminal-output">${esc(result.diff || result.unavailable || 'No changes.')}</pre>`); document.querySelector('.bottom-panel').scrollIntoView({ block: 'nearest' }); }
  catch (error) { appendLog('GIT', error.message, 'warning'); }
}

async function runTerminalCommand() {
  const input = $('#terminal-command'); const raw = input.value.trim(); if (!raw) return;
  const parts = raw.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || []; const program = parts.shift(); const args = parts.map(value => value.replace(/^['"]|['"]$/g, ''));
  $('#terminal').insertAdjacentHTML('beforeend', `<p><b>~/workspace $</b> ${esc(raw)}</p><p class="muted">running...</p>`); input.value = '';
  try {
    const response = await fetch('http://127.0.0.1:4777/api/terminal/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ program, args, approved: true }) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'command rejected');
    const output = `${result.stdout || ''}${result.stderr || ''}`.trim() || `(exit ${result.code})`; $('#terminal').insertAdjacentHTML('beforeend', `<pre class="terminal-output ${result.code ? 'error' : 'ok'}">${esc(output)}</pre>`);
  } catch (error) { $('#terminal').insertAdjacentHTML('beforeend', `<pre class="terminal-output error">${esc(error.message)}</pre>`); }
}

async function saveFile() {
  const stack = currentStack();
  await ensureEditorModules();
  try {
    const response = await fetch('http://127.0.0.1:4777/api/file/write', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: state.activeFile, content: stack ? stack.text() : $('#code').textContent, approved: true })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'file write rejected');
    stack?.markSaved();
    appendLog('WORKSPACE', `${result.path} saved atomically after explicit approval.`);
    syncDirty();
  } catch (error) {
    appendLog('WORKSPACE', `Save blocked: ${error.message}. Start the local daemon and open a trusted workspace.`, 'warning');
  }
}

function renderModels() {
  const list = $('#model-list');
  const lanes = $('#lane-grid');
  const select = $('#model-select');
  list.innerHTML = '';
  lanes.innerHTML = '';
  select.innerHTML = '';
  state.manifest.models.forEach(model => {
    const installed = JSON.parse(localStorage.getItem(`aide.model.${model.id}`) || 'null');
    const runtime = state.runtimeModels.get(model.id);
    const visibleStatus = installed ? 'imported' : (runtime?.setup_required ? 'setup-required' : (runtime?.status || model.status));
    const artifactName = runtime?.artifact_path ? runtime.artifact_path.split(/[\\/]/).pop() : '';
    const roles = model.roles.join(' / ');
    const item = document.createElement('button');
    item.className = 'model-item';
    item.innerHTML = `<span class="status ${visibleStatus}"></span><span>${esc(model.name)}</span><small>${esc(model.format)} | ${esc(visibleStatus)} | ${esc(roles)}${artifactName ? ` | ${esc(artifactName)}` : ''}</small><strong class="pack-action">${installed ? 'REPLACE' : 'IMPORT'}</strong>`;
    item.onclick = () => selectModel(model);
    item.querySelector('.pack-action').onclick = event => { event.stopPropagation(); importModel(model); };
    list.appendChild(item);
    const lane = document.createElement('button');
    lane.className = `lane ${visibleStatus}`;
    const runtimeNote = runtime?.conflict_message || runtime?.setup_message || '';
    lane.innerHTML = `<b>${esc(model.lane.toUpperCase())}</b><span>${esc(model.name)}</span><small>${esc(roles)}${runtimeNote ? ` | ${esc(runtimeNote)}` : ''}</small>`;
    lane.onclick = () => selectModel(model);
    lanes.appendChild(lane);
    const option = document.createElement('option'); option.value = model.id; option.textContent = `${model.name} [${visibleStatus}]`; option.disabled = model.status === 'training-only'; select.appendChild(option);
  });
  select.onchange = () => { const model = state.manifest.models.find(item => item.id === select.value); if (model) selectModel(model); };
}

let communityStore = { projects: [], issues: [], discussions: [], marketplace: [] };

async function importModel(model) {
  const input = $('#model-file-input');
  input.value = '';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const record = { id: model.id, name: file.name, bytes: file.size, sha256: hash, imported_at: new Date().toISOString(), source_repo: model.source_revision };
    localStorage.setItem(`aide.model.${model.id}`, JSON.stringify(record));
    appendLog('MODEL PACK', `${model.name} imported locally. SHA-256: ${hash}. Runtime attachment is still required before inference.`);
    renderModels();
    selectModel(model);
  };
  input.click();
}

async function loadRuntimeModelStatus() {
  try {
    const response = await fetch('http://127.0.0.1:4777/api/models/status');
    if (!response.ok) return;
    state.runtimeModels = new Map((await response.json()).models.map(model => [model.id, model]));
    renderModels();
    if (state.selected) selectModel(state.manifest.models.find(model => model.id === state.selected.id) || state.selected);
  } catch { /* the daemon may still be starting */ }
}

function modelStartRank(model) {
  const order = ['smollm2-360m-q8', 'qwen-coder-0.5b-q4', 'qwen-coder-1.5b-q4'];
  const known = order.indexOf(model.id);
  if (known >= 0) return known;
  return 100 + Number(model.parameters || 0);
}

function runnableModels(excludeIds = new Set()) {
  return (state.manifest?.models || [])
    .filter(model => !excludeIds.has(model.id))
    .filter(model => ['ready', 'experimental'].includes(model.status))
    .filter(model => {
      const runtime = state.runtimeModels.get(model.id);
      return !runtime?.setup_required && runtime?.status !== 'conflict';
    })
    .sort((a, b) => modelStartRank(a) - modelStartRank(b));
}

async function probeReadyModel(model) {
  const response = await fetch(`http://127.0.0.1:4777/api/model/ready?id=${encodeURIComponent(model.id)}`);
  const result = await response.json();
  const existing = state.runtimeModels.get(model.id) || {};
  const next = { ...existing, id: model.id, ready: result.ready === true, status: result.status || existing.status || model.status };
  if (result.status === 'conflict') {
    next.status = 'conflict';
    next.conflict_message = result.error || `Port conflict for ${model.name}.`;
    next.served_models = result.served_models || [];
  } else {
    delete next.conflict_message;
  }
  state.runtimeModels.set(model.id, next);
  return result;
}

function conflictAdvice(model, message) {
  const port = (() => {
    try { return new URL(model.endpoint).port; } catch { return ''; }
  })();
  const prefix = message || `Port ${port || 'for this model'} is occupied by another runtime.`;
  return `${prefix} AIDE will not stop unrelated processes. Choose another model, or free port ${port || 'the configured port'} outside AIDE and try again.`;
}

async function selectBestModel({ excludeIds = new Set(), announce = false } = {}) {
  const candidates = runnableModels(excludeIds);
  let firstStartable = null;
  for (const model of candidates) {
    try {
      const result = await probeReadyModel(model);
      if (result.ready) {
        selectModel(model);
        if (announce) appendLog('RUNTIME', `Selected verified running model: ${model.name}.`, 'approved');
        renderModels();
        return model;
      }
      if (result.status === 'conflict') {
        appendLog('RUNTIME', conflictAdvice(model, result.error), 'warning');
      } else if (!firstStartable) {
        firstStartable = model;
      }
    } catch {
      if (!firstStartable) firstStartable = model;
    }
  }
  if (firstStartable) {
    selectModel(firstStartable);
    if (announce) appendLog('RUNTIME', `Selected fastest available local model: ${firstStartable.name}. Press START MODEL to load it.`, 'warning');
  }
  renderModels();
  return firstStartable;
}

function selectModel(model) {
  state.selected = model;
  const runtime = state.runtimeModels.get(model.id);
  state.runtimeReady = runtime?.status === 'running';
  if ($('#model-select')) $('#model-select').value = model.id;
  $('#selected-model').textContent = model.name;
  const artifactName = runtime?.artifact_path ? runtime.artifact_path.split(/[\\/]/).pop() : '';
  $('#selected-detail').textContent = `${model.format} | ${runtime?.status || model.status}${artifactName ? ` | ${artifactName}` : ''} | ${model.description}`;
  $('#runtime-name').textContent = model.runtime;
  setRuntimeState(
    runtime?.setup_required ? runtime.setup_message
      : runtime?.status === 'conflict' ? conflictAdvice(model, runtime.conflict_message)
        : state.runtimeReady ? 'Model ready. You can chat now.'
          : 'Model selected. Press START MODEL.',
    runtime?.setup_required || runtime?.status === 'conflict' ? 'error' : state.runtimeReady ? 'ready' : ''
  );
}

function setRuntimeState(text, kind = '') {
  const status = $('#runtime-state');
  if (status) { status.textContent = text; status.className = `runtime-state ${kind}`; }
  if ($('#send-button')) $('#send-button').disabled = !state.runtimeReady;
}

function appendLog(role, text, type = '') {
  const log = $('#collab-log');
  if (log.querySelector('.empty-state')) log.innerHTML = '';
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.innerHTML = `<b>${esc(role)}</b><p>${esc(text)}</p>`;
  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
}

function appendChatLane(role, text, type = '') {
  $('#chat').insertAdjacentHTML('beforeend', `<p class="assistant ${type}"><b>${esc(role)}</b><br>${esc(text)}</p>`);
  $('#chat').scrollTop = $('#chat').scrollHeight;
}

async function requestLocal(model, messages) {
  const response = await fetch('http://127.0.0.1:4777/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modelId: model.id, messages })
  });
  if (!response.ok) throw new Error(`runtime returned HTTP ${response.status}`);
  const data = await response.json();
  return data.choices?.[0]?.message?.content || 'Runtime returned no content.';
}

async function runReview() {
  const task = $('#input').value.trim() || 'Review the local provider router for safer fallback behavior.';
  if (!state.selected || !state.runtimeReady) return appendLog('WORKFLOW', 'Start the selected model and wait for the green ready state first.', 'warning');
  $('#review-button').disabled = true;
  $('#review-button').textContent = 'RUNNING...';
  $('#collab-log').innerHTML = '';
  appendLog('WORKFLOW', `Planning with ${state.selected.name}: ${task}`);
  try {
    const response = await fetch('http://127.0.0.1:4777/api/workflow/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modelId: state.selected.id, task }) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'workflow failed');
    appendLog('PLAN', result.plan); appendLog(result.status === 'awaiting-approval' ? 'PATCH READY' : 'BLOCKED', result.patch || result.verification.reason, result.status === 'awaiting-approval' ? 'patch' : 'warning');
    if (result.status === 'awaiting-approval') { const approval = document.createElement('button'); approval.className = 'agent-approval'; approval.textContent = 'APPROVE AND APPLY PATCH'; approval.onclick = async () => { approval.disabled = true; const applied = await fetch('http://127.0.0.1:4777/api/workflow/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ patch: result.patch, approved: true }) }); const data = await applied.json(); appendLog('APPLY', applied.ok ? `Applied. Audit artifact ${data.audit?.id || 'recorded'}. Run tests before commit.` : data.error, applied.ok ? 'approved' : 'warning'); }; $('#collab-log').appendChild(approval); }
  } catch (error) {
    appendLog('STOPPED', error.message, 'warning');
  } finally {
    await saveReplay('review-complete');
    $('#review-button').disabled = false;
    $('#review-button').textContent = 'START BOUNDED REVIEW';
  }
}

async function startModelHandoff() {
  if (!state.selected || !state.runtimeReady) return appendLog('HANDOFF', 'Start the selected model first.', 'warning');
  const candidates = state.manifest.models.filter(model => model.id !== state.selected.id && model.status !== 'training-only'); const target = candidates.find(model => model.status === 'ready') || candidates[0];
  if (!target) return appendLog('HANDOFF', 'Install or configure a second model before starting a handoff.', 'warning');
  const task = $('#input').value.trim() || 'Inspect this workspace and propose the next safe improvement.';
  try { appendChatLane('HANDOFF', `${state.selected.name} -> ${target.name}: preparing visible handoff...`); const response = await fetch('http://127.0.0.1:4777/api/handoff/propose', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fromModelId: state.selected.id, toModelId: target.id, task }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'handoff proposal failed'); appendChatLane(`ANALYST / ${state.selected.name}`, result.handoff.analysis); const approval = document.createElement('button'); approval.className = 'agent-approval'; approval.textContent = `APPROVE HANDOFF TO ${target.name}`; approval.onclick = async () => { approval.disabled = true; const continued = await fetch('http://127.0.0.1:4777/api/handoff/continue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ handoff: result.handoff, approved: true }) }); const data = await continued.json(); appendChatLane(`BUILDER / ${target.name}`, continued.ok ? data.answer : data.error, continued.ok ? '' : 'warning'); }; $('#chat').appendChild(approval); }
  catch (error) { appendChatLane('HANDOFF ERROR', error.message, 'warning'); }
}

async function testRuntime() {
  const model = state.selected || state.manifest.models.find(item => item.status !== 'pending');
  if (!model) return appendLog('RUNTIME', 'No configured local model endpoint.', 'warning');
  const runtime = state.runtimeModels.get(model.id);
  if (runtime?.setup_required) { setRuntimeState(runtime.setup_message, 'error'); return appendLog('RUNTIME', runtime.setup_message, 'warning'); }
  appendLog('RUNTIME', `Testing ${model.name} through the local daemon...`);
  try {
    const result = await probeReadyModel(model);
    state.runtimeReady = result.ready;
    if (result.status === 'conflict') {
      const message = conflictAdvice(model, result.error);
      setRuntimeState(message, 'error');
      appendLog('RUNTIME', message, 'warning');
      await selectBestModel({ excludeIds: new Set([model.id]), announce: true });
      return;
    }
    setRuntimeState(result.ready ? 'Model ready. You can chat now.' : 'Model is not running yet. Press START MODEL.', result.ready ? 'ready' : 'error');
    appendLog('RUNTIME', result.ready ? 'Local runtime reachable through daemon. Model is ready for chat.' : (result.error || 'Model server is not listening yet.'), result.ready ? 'approved' : 'warning');
  } catch (error) {
    state.runtimeReady = false;
    setRuntimeState('Model is not ready yet. Start it and wait.', 'error');
    appendLog('RUNTIME', `Daemon health check failed: ${error.message}. Start AIDE with node scripts/start.mjs.`, 'warning');
  }
}

async function startRuntime() {
  const model = state.selected;
  if (!model) return appendLog('RUNTIME', 'Select a model pack first.', 'warning');
  const runtime = state.runtimeModels.get(model.id);
  if (runtime?.setup_required) { setRuntimeState(runtime.setup_message, 'error'); return appendLog('RUNTIME', runtime.setup_message, 'warning'); }
  if (model.status === 'pending' || model.status === 'training-only') return appendLog('RUNTIME', 'This model is not available for chat. Choose the ready coding model.', 'warning');
  state.runtimeReady = false;
  setRuntimeState('Starting model. Please wait...', 'busy');
  $('#start-selected').disabled = true;
  try {
    const response = await fetch('http://127.0.0.1:4777/api/models/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: model.id })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'runtime start failed');
    appendLog('RUNTIME', `${model.name} is starting. Waiting for the daemon readiness signal...`);
    let conflictError = null;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      try {
        const detail = await probeReadyModel(model);
        if (detail.ready) {
          state.runtimeReady = true;
          await loadRuntimeModelStatus();
          setRuntimeState('Model ready. You can chat now.', 'ready');
          appendLog('RUNTIME', 'Model is ready for chat.', 'approved');
          break;
        }
        if (detail.status === 'conflict') {
          conflictError = new Error(detail.error || 'runtime port conflict');
          break;
        }
      } catch { /* keep waiting */ }
    }
    if (conflictError) throw conflictError;
    if (!state.runtimeReady) setRuntimeState('Model did not become ready. Check the runtime status.', 'error');
  } catch (error) {
    const message = /port|serving|occupied/i.test(error.message) ? conflictAdvice(model, error.message) : `Could not start model: ${error.message}`;
    setRuntimeState(message, 'error');
    appendLog('RUNTIME', message, 'warning');
    await selectBestModel({ excludeIds: new Set([model.id]), announce: true });
  } finally { $('#start-selected').disabled = false; }
}

function closeLaunchGuide() {
  if ($('#launch-dont-show').checked) localStorage.setItem('aide.launch.version', '2');
  $('#launch-guide').hidden = true;
}

function bindLaunchGuide() {
  const guide = $('#launch-guide');
  if (localStorage.getItem('aide.launch.version') !== '2') guide.hidden = false;
  $('#launch-start').onclick = async () => { await selectBestModel({ announce: true }); closeLaunchGuide(); await startRuntime(); };
  $('#launch-learn').onclick = () => { closeLaunchGuide(); $('#learn-button').click(); };
}

async function sendChat() {
  const input = $('#input');
  const value = input.value.trim();
  if (!value) return;
  if (!state.selected || !state.runtimeReady) return appendLog('CHAT', 'Start the selected model and wait for the green “Model ready” message first.', 'warning');
  if ($('#assistant-mode').value === 'dual') { await startModelHandoff(); return; }
  $('#chat').insertAdjacentHTML('beforeend', `<p><b>YOU</b><br>${esc(value)}</p><p class="assistant"><b>${esc(state.selected.name)}</b><br><span class="muted">Thinking locally...</span></p>`);
  input.value = '';
  try {
    const mode = $('#assistant-mode').value; const providerId = $('#provider-select').value;
    const history = state.conversation.slice(-4);
    const response = providerId === 'local-openai-compatible'
      ? await fetch('http://127.0.0.1:4777/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modelId: state.selected.id, messages: [...history, { role: 'user', content: value }], max_tokens: 180, timeout_ms: 120000 }) })
      : await fetch('http://127.0.0.1:4777/api/providers/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ providerId, messages: [...history, { role: 'user', content: value }], max_tokens: 512 }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'chat request failed');
    const answer = result.answer || result.choices?.[0]?.message?.content || 'The selected provider returned no text.';
    state.conversation.push({ role: 'user', content: value }, { role: 'assistant', content: answer });
    state.conversation = state.conversation.slice(-8);
    const last = $('#chat').lastElementChild; last.innerHTML = `<b>${esc(state.selected.name)}</b><br>${esc(answer)}`;
    if (result.mode && mode === 'auto') last.insertAdjacentHTML('beforeend', `<small class="audit-badge">ROUTED: ${esc(result.mode.toUpperCase())}</small>`);
    if (result.audit?.id) last.insertAdjacentHTML('beforeend', `<small class="audit-badge">AUDIT ARTIFACT ${esc(result.audit.id)} / ${esc(result.audit.status)}</small>`);
    if (result.approval_required && result.proposed_tools?.length) {
      const approval = document.createElement('button'); approval.className = 'agent-approval'; approval.textContent = `APPROVE ${result.proposed_tools.length} TOOL CALL(S)`; approval.onclick = async () => { approval.disabled = true; for (const tool of result.proposed_tools) { const toolResponse = await fetch('http://127.0.0.1:4777/api/terminal/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...tool, approved: true }) }); const toolResult = await toolResponse.json(); $('#chat').insertAdjacentHTML('beforeend', `<pre class="terminal-output ${toolResponse.ok && !toolResult.code ? 'ok' : 'error'}">${esc(toolResult.stdout || toolResult.stderr || toolResult.error || `(exit ${toolResult.code})`)}</pre>`); } }; $('#chat').appendChild(approval);
    }
  } catch (error) { const last = $('#chat').lastElementChild; last.innerHTML = `<b>CHAT ERROR</b><br>${esc(error.message)}`; last.classList.add('warning'); }
}

function localNodeId() {
  let id = localStorage.getItem('aide.node.id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('aide.node.id', id);
  }
  return id;
}

function renderCommunity(tab = 'projects') {
  const entries = communityStore[tab] || [];
  $('#community-feed').innerHTML = `<div style="color:#72ff9e;margin-bottom:5px">LOCAL CACHE / SYNC OFF</div>${entries.map((entry, index) => `<div style="border-left:2px solid #b277ff;padding-left:5px;margin:5px 0"><b>${esc(entry.title)}</b><br>${esc(entry.detail)}<br><span style="color:#718994">${esc(entry.boundary || entry.status || 'local')}</span> <button data-community-remove="${index}" style="color:#ff6d82;background:none;border:0;font:9px ui-monospace,monospace;cursor:pointer">REMOVE</button></div>`).join('')}`;
  document.querySelectorAll('[data-community-tab]').forEach(button => button.style.color = button.dataset.communityTab === tab ? '#72ff9e' : '#718994');
  document.querySelectorAll('[data-community-remove]').forEach(button => button.onclick = () => removeCommunityItem(tab, Number(button.dataset.communityRemove)));
}

async function removeCommunityItem(type, index) {
  try {
    await fetch('http://127.0.0.1:4777/api/community/items', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, index }) });
    await loadCommunity();
  } catch (error) { appendLog('COMMUNITY', `Could not remove local item: ${error.message}`, 'warning'); }
}

async function loadCommunity() {
  try {
    const response = await fetch('http://127.0.0.1:4777/api/community');
    if (response.ok) communityStore = await response.json();
  } catch { /* offline cache remains empty until the daemon is running */ }
  renderCommunity();
}

async function addCommunityIssue() {
  const title = $('#community-title').value.trim();
  if (!title) return;
  try {
    const response = await fetch('http://127.0.0.1:4777/api/community/items', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: $('#community-type').value, item: { title, detail: 'Created locally from AIDE.' } })
    });
    if (!response.ok) throw new Error('daemon rejected item');
    $('#community-title').value = '';
    await loadCommunity();
    appendLog('COMMUNITY', `Issue created locally: ${title}`);
  } catch (error) {
    appendLog('COMMUNITY', `Local daemon unavailable: ${error.message}`, 'warning');
  }
}

async function startTool(kind, id, label) {
  try {
    const response = await fetch(`http://127.0.0.1:4777/api/${kind}/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `${label} failed`);
    $('#tool-status').textContent = `${label}: ${result.status}`;
    appendLog('TOOLCHAIN', `${label} ${result.status}.`);
    if (kind === 'lsp') {
      const init = await fetch('http://127.0.0.1:4777/api/lsp/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, message: { method: 'initialize', params: { processId: null, rootUri: null, capabilities: {} } } }) });
      const initialized = await fetch('http://127.0.0.1:4777/api/lsp/notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, message: { method: 'initialized', params: {} } }) });
      appendLog('LSP', init.ok && initialized.ok ? 'initialize handshake completed.' : 'initialize handshake failed.', init.ok && initialized.ok ? '' : 'warning');
    }
    if (kind === 'dap') {
      const init = await fetch('http://127.0.0.1:4777/api/dap/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, request: { command: 'initialize', arguments: { clientID: 'aide', clientName: 'AIDE', adapterID: id, linesStartAt1: true, columnsStartAt1: true, pathFormat: 'path' } } }) });
      const payload = await init.json().catch(() => ({}));
      const capabilities = Object.keys(payload.body || {}).filter(key => key.startsWith('supports'));
      $('#debug-status').textContent = init.ok ? `Adapter ready: ${capabilities.length} capabilities.` : 'Adapter initialize failed.';
      appendLog('DAP', init.ok ? `initialize handshake completed; ${capabilities.length} capabilities reported.` : 'initialize request failed.', init.ok ? '' : 'warning');
    }
  } catch (error) {
    $('#tool-status').textContent = `${label}: unavailable`;
    appendLog('TOOLCHAIN', `${label} unavailable: ${error.message}`, 'warning');
  }
}

async function checkActiveFile() {
  try {
    const content = $('#code').textContent;
    const uri = `file:///workspace/${state.activeFile}`;
    const open = await fetch('http://127.0.0.1:4777/api/lsp/notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'typescript', message: { method: 'textDocument/didOpen', params: { textDocument: { uri, languageId: 'typescript', version: 1, text: content } } } }) });
    if (!open.ok) throw new Error('LSP is not running');
    const response = await fetch('http://127.0.0.1:4777/api/lsp/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'typescript', message: { method: 'textDocument/completion', params: { textDocument: { uri }, position: { line: 0, character: 0 } } } }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || 'completion request failed');
    const count = result.result?.items?.length ?? result.result?.length ?? 0;
    appendLog('LSP', `Active file analyzed. Completion items returned: ${count}.`);
  } catch (error) { appendLog('LSP', error.message, 'warning'); }
}

async function lspAction(action) {
  const uri = `file:///workspace/${state.activeFile}`;
  const base = { textDocument: { uri }, position: { line: 0, character: 0 } };
  const requests = {
    hover: { method: 'textDocument/hover', params: base },
    definition: { method: 'textDocument/definition', params: base },
    rename: { method: 'textDocument/rename', params: { ...base, newName: 'AIDE_RENAMED' } },
    formatting: { method: 'textDocument/formatting', params: { textDocument: { uri }, options: { tabSize: 2, insertSpaces: true } } }
  };
  try {
    const response = await fetch('http://127.0.0.1:4777/api/lsp/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'typescript', message: requests[action] }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || 'LSP request failed');
    appendLog('LSP', `${action}: ${JSON.stringify(result.result || null).slice(0, 500)}`);
  } catch (error) { appendLog('LSP', `${action} blocked: ${error.message}`, 'warning'); }
}

async function debugActiveFile() {
  if (!state.activeFile.endsWith('.py')) {
    $('#debug-status').textContent = 'Blocked: active file is not Python.';
    appendLog('DAP', 'Debug launch blocked because the active file is not Python.', 'warning');
    return;
  }
  try {
    const response = await fetch('http://127.0.0.1:4777/api/dap/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'python-debugpy', request: { command: 'launch', arguments: { program: `/workspace/${state.activeFile}`, cwd: '/workspace', stopOnEntry: true } } }) });
    const result = await response.json();
    if (!response.ok || result.success === false) throw new Error(result.message || 'debug launch rejected');
    $('#debug-status').textContent = 'Debug launch requested; waiting for entry stop.';
    appendLog('DAP', 'Debug launch requested for the active Python file.');
  } catch (error) { $('#debug-status').textContent = `Debug blocked: ${error.message}`; appendLog('DAP', error.message, 'warning'); }
}

async function refreshDebugThreads() {
  try {
    const response = await fetch('http://127.0.0.1:4777/api/dap/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'python-debugpy', request: { command: 'threads', arguments: {} } }) });
    const result = await response.json();
    if (!response.ok || result.error) throw new Error(result.error?.format || 'debug adapter is not running');
    const threads = result.body?.threads || []; const count = threads.length;
    const stateResponse = await fetch('http://127.0.0.1:4777/api/dap/state?id=python-debugpy'); const session = await stateResponse.json(); const stopped = session.events?.findLast(event => event.event === 'stopped');
    $('#debug-status').textContent = stopped ? `Debug stopped: ${stopped.body.reason || 'breakpoint'} / thread ${stopped.body.threadId || 'unknown'}. Threads: ${count}.` : `Debug threads: ${count}. Stack/variables populate after launch.`;
    if (threads[0]) {
      const stackResponse = await fetch('http://127.0.0.1:4777/api/dap/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'python-debugpy', request: { command: 'stackTrace', arguments: { threadId: threads[0].id, levels: 20 } } }) });
      const stack = await stackResponse.json(); const frame = stack.body?.stackFrames?.[0];
      $('#debug-details').innerHTML = frame ? `<b>CALL STACK</b><br>${esc(frame.name)}<br><span>${esc(frame.source?.path || '')}:${esc(frame.line || '')}</span>` : 'No stack frames returned.';
      if (frame?.id) { const scopesResponse = await fetch('http://127.0.0.1:4777/api/dap/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'python-debugpy', request: { command: 'scopes', arguments: { frameId: frame.id } } }) }); const scopes = await scopesResponse.json(); $('#debug-details').insertAdjacentHTML('beforeend', `<br><b>SCOPES</b> ${esc((scopes.body?.scopes || []).map(scope => scope.name).join(', ') || 'none')}`); }
    }
    appendLog('DAP', `Threads refreshed: ${count}.`);
  } catch (error) { appendLog('DAP', error.message, 'warning'); }
}

async function trainingRequest(action, payload = {}) {
  try {
    const response = await fetch(`http://127.0.0.1:4777/api/training/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Training Room request failed');
    $('#training-status').textContent = result.status === 'running' ? `Running: ${result.id}` : `Training Room: ${result.status}`;
    appendLog('TRAINING', JSON.stringify(result));
  } catch (error) { $('#training-status').textContent = `Blocked: ${error.message}`; appendLog('TRAINING', error.message, 'warning'); }
}

async function refreshTrainingStatus() {
  try {
    const response = await fetch('http://127.0.0.1:4777/api/training/status');
    if (!response.ok) return;
    const result = await response.json();
    const active = result.active ? `running: ${result.active.id}` : 'idle';
    const last = result.logs?.at(-1)?.line || 'no log output';
    $('#training-status').textContent = `Training Room ${active} | ${result.jobs.length} job(s) | ${last.slice(0, 100)}`;
  } catch { /* daemon is optional while the static shell is offline */ }
}

async function saveReplay(status = 'verified') {
  try { await fetch('http://127.0.0.1:4777/api/replays', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task_class: 'code-change', model: state.selected?.id || 'unknown', status, checks: { human_approval_required: true, source_exported: false } }) }); } catch { /* replay is optional while daemon is offline */ }
}

async function compareModels() {
  $('#arena-status').textContent = 'Running models sequentially...';
  try {
    const response = await fetch('http://127.0.0.1:4777/api/arena/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approved: true }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'arena failed');
    $('#arena-status').textContent = result.winner ? `Winner: ${result.winner.model} (${(result.winner.score * 100).toFixed(1)}%, avg ${result.winner.latency_ms}ms)` : 'No model completed.';
    appendLog('MODEL ARENA', 'Live sequential comparison complete. Scores are benchmark-local only.');
  } catch (error) { $('#arena-status').textContent = `Arena blocked: ${error.message}`; appendLog('MODEL ARENA', error.message, 'warning'); }
}

const blueprintState = { graph: null, yaw: -0.45, pitch: 0.28, zoom: 1, panX: 0, panY: 0, dragging: false, lastX: 0, lastY: 0, selected: null };
const blueprintColors = { source: '#58c7ff', data: '#b277ff', build: '#72ff9e', verify: '#ffc76b', release: '#ff5fcf' };
const academyState = { catalog: [], session: null };

function blueprintCanvasPoint(node, width, height) {
  const cy = Math.cos(blueprintState.yaw), sy = Math.sin(blueprintState.yaw);
  const cp = Math.cos(blueprintState.pitch), sp = Math.sin(blueprintState.pitch);
  const x1 = node.x * cy - node.z * sy;
  const z1 = node.x * sy + node.z * cy;
  const y1 = node.y * cp - z1 * sp;
  const z2 = node.y * sp + z1 * cp;
  const depth = 1 + z2 / 14;
  return { x: width / 2 + blueprintState.panX + x1 * 72 * blueprintState.zoom / depth, y: height / 2 + blueprintState.panY - y1 * 72 * blueprintState.zoom / depth, depth, scale: blueprintState.zoom / depth };
}

function drawBlueprint() {
  const canvas = $('#blueprint-canvas');
  if (!canvas || !blueprintState.graph) return;
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  if (canvas.width !== Math.floor(rect.width * ratio) || canvas.height !== Math.floor(rect.height * ratio)) { canvas.width = Math.floor(rect.width * ratio); canvas.height = Math.floor(rect.height * ratio); }
  const ctx = canvas.getContext('2d'); ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, rect.width, rect.height);
  const points = new Map(blueprintState.graph.nodes.map(node => [node.id, { node, point: blueprintCanvasPoint(node, rect.width, rect.height) }]));
  blueprintState.graph.edges.forEach(edge => { const from = points.get(edge.source)?.point; const to = points.get(edge.target)?.point; if (!from || !to) return; ctx.strokeStyle = '#4f768066'; ctx.setLineDash([4, 5]); ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke(); ctx.setLineDash([]); });
  [...points.values()].sort((a, b) => a.point.depth - b.point.depth).forEach(({ node, point }) => { const color = blueprintColors[node.layer] || '#9fb8ba'; const radius = Math.max(5, 8 * point.scale); const selected = blueprintState.selected === node.id; ctx.globalAlpha = Math.max(.45, Math.min(1, point.depth)); ctx.shadowBlur = selected ? 18 : 9; ctx.shadowColor = color; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(point.x, point.y, radius + (selected ? 3 : 0), 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0; ctx.fillStyle = '#071018'; ctx.beginPath(); ctx.arc(point.x, point.y, Math.max(2, radius - 3), 0, Math.PI * 2); ctx.fill(); ctx.font = `${Math.max(8, 10 * point.scale)}px ui-monospace,monospace`; ctx.fillStyle = selected ? '#ffffff' : color; ctx.fillText(node.label, point.x + radius + 5, point.y + 3); });
  ctx.globalAlpha = 1;
}

function inspectBlueprint(node) {
  blueprintState.selected = node?.id || null;
  const inspector = $('#blueprint-inspector');
  if (!node) { inspector.innerHTML = '<b>SELECT A NODE</b><p>Choose a node to inspect its dependencies and next gate.</p>'; drawBlueprint(); return; }
  const incoming = blueprintState.graph.edges.filter(edge => edge.target === node.id).map(edge => edge.source).join(', ') || 'none';
  const outgoing = blueprintState.graph.edges.filter(edge => edge.source === node.id).map(edge => edge.target).join(', ') || 'none';
  inspector.innerHTML = `<b>${esc(node.label)}</b><p><span style="color:${blueprintColors[node.layer]}">${esc(node.layer.toUpperCase())}</span> / ${esc(node.status)}</p><p>${esc(node.detail)}</p><p>needs: ${esc(incoming)}<br>feeds: ${esc(outgoing)}</p>`;
  drawBlueprint();
}

async function loadBlueprint() {
  try { const response = await fetch('http://127.0.0.1:4777/api/blueprint'); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'blueprint unavailable'); blueprintState.graph = result; $('#blueprint-count').textContent = `${result.nodes.length} NODES / ${result.edges.length} EDGES`; inspectBlueprint(null); drawBlueprint(); }
  catch (error) { appendLog('BLUEPRINT', `Graph unavailable: ${error.message}. Start the local daemon to hydrate the project map.`, 'warning'); }
}

function bindBlueprint() {
  const canvas = $('#blueprint-canvas'); const view = $('#blueprint-view');
  $('#blueprint-button').onclick = () => {
    const showing = view.hidden;
    if (showing) {
      setWorkbenchView('map');
      loadBlueprint();
      requestAnimationFrame(drawBlueprint);
    } else {
      setWorkbenchView('chat');
      $('#input').focus();
    }
  };
  $('#blueprint-refresh').onclick = loadBlueprint;
  $('#blueprint-reset').onclick = () => { blueprintState.yaw = -.45; blueprintState.pitch = .28; blueprintState.zoom = 1; blueprintState.panX = 0; blueprintState.panY = 0; drawBlueprint(); };
  canvas.onpointerdown = event => { blueprintState.dragging = false; blueprintState.lastX = event.clientX; blueprintState.lastY = event.clientY; canvas.setPointerCapture(event.pointerId); };
  canvas.onpointermove = event => { if (!canvas.hasPointerCapture(event.pointerId)) return; const dx = event.clientX - blueprintState.lastX; const dy = event.clientY - blueprintState.lastY; if (Math.abs(dx) + Math.abs(dy) > 3) blueprintState.dragging = true; blueprintState.lastX = event.clientX; blueprintState.lastY = event.clientY; if (event.shiftKey) { blueprintState.panX += dx; blueprintState.panY += dy; } else { blueprintState.yaw += dx * .009; blueprintState.pitch = Math.max(-1.2, Math.min(1.2, blueprintState.pitch + dy * .009)); } drawBlueprint(); };
  canvas.onpointerup = event => { canvas.releasePointerCapture(event.pointerId); };
  canvas.onwheel = event => { event.preventDefault(); blueprintState.zoom = Math.max(.45, Math.min(2.5, blueprintState.zoom * (event.deltaY < 0 ? 1.1 : .9))); drawBlueprint(); };
  canvas.onclick = event => { if (blueprintState.dragging || !blueprintState.graph) return; const rect = canvas.getBoundingClientRect(); const x = event.clientX - rect.left; const y = event.clientY - rect.top; let closest = null; let distance = 18; blueprintState.graph.nodes.forEach(node => { const point = blueprintCanvasPoint(node, rect.width, rect.height); const next = Math.hypot(point.x - x, point.y - y); if (next < distance) { distance = next; closest = node; } }); inspectBlueprint(closest); };
  window.addEventListener('resize', drawBlueprint);
}

function renderAcademy() {
  const list = $('#course-list'); if (!list) return;
  list.innerHTML = '<h4>COURSES / LOCAL CATALOG</h4>' + academyState.catalog.map(course => { const done = course.progress.completed.length; return `<button class="course-item ${academyState.session?.course.id === course.id ? 'active' : ''}" data-course-id="${esc(course.id)}"><b>${esc(course.title)}</b><small>${esc(course.level)} / ${done}/${course.lessons.length} complete</small></button>`; }).join('');
  list.querySelectorAll('[data-course-id]').forEach(button => button.onclick = () => loadAcademySession(button.dataset.courseId));
  const session = academyState.session; if (!session) return;
  $('#lesson-kicker').textContent = `${session.course.title.toUpperCase()} / ${session.lesson.kind.toUpperCase()}`; $('#lesson-title').textContent = session.lesson.title; $('#lesson-objective').textContent = session.lesson.objective; $('#tutor-prompt-text').textContent = 'What do you think the safest first step is? Build it in the workspace, run the check, then explain your reasoning below.'; $('#lesson-progress').textContent = `${session.progress.completed.length} lesson(s) complete. Next gate: ${session.next?.title || 'course complete'}.`; $('#certificate-button').hidden = !session.progress.eligible_for_certificate;
}

async function loadAcademySession(courseId) {
  try { const response = await fetch(`http://127.0.0.1:4777/api/academy/session${courseId ? `?course=${encodeURIComponent(courseId)}` : ''}`); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Tutor Mode unavailable'); academyState.session = result; renderAcademy(); }
  catch (error) { appendLog('TUTOR', `Academy unavailable: ${error.message}`, 'warning'); }
}

async function loadAcademy() {
  try { const response = await fetch('http://127.0.0.1:4777/api/academy'); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'course catalog unavailable'); academyState.catalog = result.courses; renderAcademy(); await loadAcademySession(academyState.catalog[0]?.id); }
  catch (error) { appendLog('TUTOR', `Course catalog unavailable: ${error.message}. Start the local daemon to load Academy.`, 'warning'); }
}

async function completeLesson() {
  const session = academyState.session; if (!session) return;
  try { const response = await fetch('http://127.0.0.1:4777/api/academy/complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ courseId: session.course.id, lessonId: session.lesson.id, reflection: $('#lesson-reflection').value }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'lesson gate rejected'); academyState.session = result; $('#lesson-reflection').value = ''; appendLog('TUTOR', `Lesson complete. Next: ${result.next?.title || 'course complete'}.`); renderAcademy(); }
  catch (error) { appendLog('TUTOR', error.message, 'warning'); }
}

async function checkLesson() {
  const session = academyState.session; if (!session) return;
  $('#lesson-check').disabled = true; $('#lesson-check-result').textContent = 'Running check...';
  try { const response = await fetch('http://127.0.0.1:4777/api/academy/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ courseId: session.course.id, lessonId: session.lesson.id }) }); const result = await response.json(); $('#lesson-check-result').textContent = result.passed ? `PASS\n${result.stdout || ''}` : `FAIL\n${result.stderr || ''}`; $('#lesson-complete').disabled = !result.passed; }
  catch (error) { $('#lesson-check-result').textContent = `ERROR\n${error.message}`; }
  finally { $('#lesson-check').disabled = false; }
}

function bindAcademy() {
  const view = $('#learn-view');
  $('#learn-button').onclick = () => {
    const showing = view.hidden;
    if (showing) {
      setWorkbenchView('learn');
      loadAcademy();
    } else {
      setWorkbenchView('chat');
      $('#input').focus();
    }
  };
  $('#lesson-complete').onclick = completeLesson;
  $('#lesson-check').onclick = checkLesson;
  $('#lesson-hint').onclick = () => { $('#tutor-prompt-text').textContent = 'Hint: name the value first, then choose the smallest operation that proves the lesson objective. Run the lesson check before asking for the answer.'; appendLog('TUTOR', 'Progressive hint unlocked.'); };
  $('#certificate-button').onclick = async () => { const courseId = academyState.session?.course.id; const response = await fetch(`http://127.0.0.1:4777/api/academy/certificate?course=${encodeURIComponent(courseId)}`); const result = await response.json(); if (!response.ok) return appendLog('ACADEMY', result.error || 'credential unavailable', 'warning'); appendLog('ACADEMY', `Local completion credential issued: ${result.digest}. ${result.limitation}`, 'approved'); };
}

function bindWorkbenchNavigation() {
  $('#explorer-button').onclick = () => { setWorkbenchView('editor'); $('#mode-toggle').textContent = 'ADVANCED'; $('#workspace-tree').scrollIntoView({ block: 'nearest' }); };
  $('#run-button').onclick = () => { setWorkbenchView('run'); document.querySelector('.bottom-panel')?.scrollIntoView({ block: 'nearest' }); $('#terminal-command').focus(); };
  $('#ai-button').onclick = () => { setWorkbenchView('chat'); document.querySelector('.agent-panel').scrollIntoView({ block: 'nearest' }); $('#input').focus(); };
  $('#plugins-button').onclick = () => { document.body.classList.remove('simple-mode', 'workbench-view-editor', 'workbench-view-run', 'workbench-view-learn', 'workbench-view-map'); $('#mode-toggle').textContent = 'SIMPLE'; setActivityButton('plugins-button'); console.log('VIEW: PLUGINS'); $('#plugin-list').scrollIntoView({ block: 'nearest' }); };
  $('#settings-button').onclick = () => appendLog('SETTINGS', 'Settings surface is not enabled yet. No hidden configuration is being changed.', 'warning');
}

function setWorkbenchView(view) {
  const viewClasses = ['workbench-view-editor', 'workbench-view-run', 'workbench-view-learn', 'workbench-view-map'];
  document.body.classList.add('simple-mode');
  document.body.classList.remove(...viewClasses);
  $('#learn-view').hidden = view !== 'learn';
  $('#blueprint-view').hidden = view !== 'map';
  if (view !== 'chat') document.body.classList.add(`workbench-view-${view}`);
  const activityId = { chat: 'ai-button', editor: 'explorer-button', run: 'run-button', learn: 'learn-button', map: 'blueprint-button' }[view];
  if (activityId) setActivityButton(activityId);
  console.log(`VIEW: ${String(view).toUpperCase()}`);
}

function setActivityButton(activeId) {
  document.querySelectorAll('.activity-button').forEach(button => button.classList.toggle('active', button.id === activeId));
}

const commands = [
  { id: 'open-readme', label: 'Open README.md', run: () => openFile('README.md') },
  { id: 'editor-undo', label: 'Editor: Undo (Ctrl+Z)', run: () => { undoEditor(); } },
  { id: 'editor-redo', label: 'Editor: Redo (Ctrl+Y)', run: () => { redoEditor(); } },
  { id: 'editor-find', label: 'Editor: Find (Ctrl+F)', run: () => { openFind(); } },
  { id: 'editor-replace', label: 'Editor: Replace in file (Alt+R)', run: () => { openFind(); $('#replace-input').focus(); } },
  { id: 'editor-save', label: 'Editor: Save active file (Ctrl+S)', run: () => { saveFile(); } },
  { id: 'search-workspace', label: 'Search: Whole workspace (Ctrl+Shift+F)', run: () => { openFind(); searchWorkspace(); } },
  { id: 'run-tests', label: 'Tasks: Run full test suite', run: () => document.querySelector('[data-task-id="test"]')?.click() },
  { id: 'focus-chat', label: 'Assistant: Focus chat', run: () => { $('#ai-button').click(); $('#input').focus(); } },
  { id: 'show-blueprint', label: 'AIDE: Open Blueprint', run: () => $('#blueprint-button').click() },
  { id: 'show-academy', label: 'AIDE: Open Academy', run: () => $('#learn-button').click() },
  { id: 'show-problems', label: 'View: Problems', run: () => $('#problems-tab').click() }
];

function renderCommands(query = '') {
  const results = commands.filter(command => command.label.toLowerCase().includes(query.toLowerCase()));
  $('#command-results').innerHTML = results.map((command, index) => `<button class="command-item" data-command-id="${command.id}"><span>${index + 1}</span>${esc(command.label)}</button>`).join('') || '<div class="muted command-empty">No matching commands.</div>';
  $('#command-results').querySelectorAll('[data-command-id]').forEach(button => button.onclick = () => { commands.find(command => command.id === button.dataset.commandId)?.run(); closeCommandPalette(); });
}

function closeCommandPalette() { $('#command-palette').hidden = true; }
function openCommandPalette() { $('#command-palette').hidden = false; $('#command-search').value = ''; renderCommands(); $('#command-search').focus(); }
function bindCommandPalette() { $('#command-button').onclick = openCommandPalette; $('#command-search').oninput = event => renderCommands(event.target.value); $('#command-search').onkeydown = event => { if (event.key === 'Escape') closeCommandPalette(); if (event.key === 'Enter') document.querySelector('#command-results .command-item')?.click(); }; document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openCommandPalette(); } }); }

function renderNode() {
  if (!state.node) return;
  const id = localStorage.getItem('aide.node.id');
  $('#node-status').innerHTML = `<b>LOCAL-FIRST</b><br>Network: ${esc(state.node.network_default)}<br>Private data: ${esc(state.node.replication.private)}<br>Group sync: ${esc(state.node.capabilities.encrypted_group_sync ? 'enabled' : 'disabled')}<br>Node ID: ${id ? esc(id.slice(0, 13) + '...') : 'not created'}`;
}

async function boot() {
  try {
    const response = await fetch('models/manifest.json', { cache: 'no-store' });
    state.manifest = await response.json();
  } catch (error) {
    state.manifest = { models: [] };
    appendLog('BOOT', 'Could not load models/manifest.json.', 'warning');
  }
  try {
    const nodeResponse = await fetch('community/node-manifest.json', { cache: 'no-store' });
    state.node = await nodeResponse.json();
    renderNode();
  } catch (error) {
    $('#node-status').textContent = 'Node policy unavailable.';
  }
  renderModels();
  await loadRuntimeModelStatus();
  await selectBestModel();
  if (!state.selected) setRuntimeState('Choose START MODEL, then wait for the green ready message.');
  $('#start-selected').onclick = startRuntime;
  $('#test-selected').onclick = testRuntime;
  $('#connection-button').onclick = startRuntime;
  $('#mode-toggle').onclick = () => { document.body.classList.toggle('simple-mode'); $('#mode-toggle').textContent = document.body.classList.contains('simple-mode') ? 'ADVANCED' : 'SIMPLE'; };
  bindLaunchGuide();
  restoreSession();
   loadWorkspaceTree();
   loadPlugins();
   loadProviders();
   $('#git-refresh').onclick = loadGitStatus;
   $('#git-diff').onclick = showGitDiff;
   $('#git-stage-all').onclick = async () => { const paths = [...document.querySelectorAll('[data-git-stage]')].map(button => button.dataset.gitStage); if (paths.length) await stageGit(paths); else appendLog('GIT', 'Nothing to stage.'); };
   $('#git-commit').onclick = commitGit;
   $('#git-commit-message').onkeydown = event => { if (event.key === 'Enter') commitGit(); };
   loadGitStatus();
  loadTasks();
  loadDiagnostics();
  setInterval(loadDiagnostics, 3000);
  $('#problems-tab').onclick = () => { $('#problems-list').hidden = false; $('#terminal').style.display = 'none'; };
  $('#review-button').onclick = runReview;
  $('#handoff-button').onclick = startModelHandoff;
  $('#connection-button').onclick = startRuntime;
  $('#send-button').onclick = sendChat;
  $('#terminal-run').onclick = runTerminalCommand;
  $('#terminal-command').onkeydown = event => { if (event.key === 'Enter') runTerminalCommand(); };
  $('#node-button').onclick = () => { localNodeId(); renderNode(); appendLog('NODE', 'Local identity created. No network connection or private data was shared.'); };
  document.querySelectorAll('[data-community-tab]').forEach(button => button.onclick = () => renderCommunity(button.dataset.communityTab));
  $('#community-add').onclick = addCommunityIssue;
  $('#lsp-button').onclick = () => startTool('lsp', 'typescript', 'TypeScript LSP');
  $('#lsp-check').onclick = checkActiveFile;
  document.querySelectorAll('[data-lsp-action]').forEach(button => button.onclick = () => lspAction(button.dataset.lspAction));
  $('#dap-button').onclick = () => startTool('dap', 'python-debugpy', 'Python DAP');
  $('#debug-file').onclick = debugActiveFile;
  $('#debug-threads').onclick = refreshDebugThreads;
  $('#training-verify').onclick = () => trainingRequest('start', { id: 'verify-release', approved: true });
  $('#training-stop').onclick = () => trainingRequest('stop');
  $('#arena-button').onclick = compareModels;
  bindBlueprint();
  bindAcademy();
  bindWorkbenchNavigation();
  bindCommandPalette();
  testRuntime();
  refreshTrainingStatus();
  setInterval(refreshTrainingStatus, 5000);
  loadCommunity();
  $('#input').onkeydown = event => { if (event.key === 'Enter') sendChat(); };
  bindEditorShortcuts();
  $('#code').oninput = () => {
    const stack = currentStack();
    if (!stack) return;
    const before = stack.text();
    const after = $('#code').textContent;
    if (before === after) return;
    try {
      for (const op of diffOperation(before, after)) stack.apply(op);
    } catch (error) {
      appendLog('EDITOR', `Undo history reset: ${error.message}`, 'warning');
      state.editorStacks.set(state.activeFile, new UndoStack(after));
    }
    syncDirty();
    refreshLineNumbers();
    if (state.findState.query) markFind(state.findState.query, true);
  };
  renderEditorTabs();
}

boot();

const state = { manifest: null, node: null, selected: null, runtimeReady: false, activeFile: 'src/agent.ts', files: {
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

async function openFile(name) {
  const text = state.files[name] || state.files['agent.ts'];
  state.activeFile = name;
  try {
    const response = await fetch(`http://127.0.0.1:4777/api/file?path=${encodeURIComponent(name)}`);
    if (response.ok) $('#code').textContent = (await response.json()).content;
    else $('#code').textContent = text;
  } catch { $('#code').textContent = text; }
  $('#line-numbers').textContent = text.split('\n').map((_, index) => index + 1).join('\n');
  $('#line-numbers').textContent = $('#code').textContent.split('\n').map((_, index) => index + 1).join('\n');
  document.querySelectorAll('[data-file]').forEach(button => button.classList.toggle('active', button.dataset.file === name));
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

async function loadPlugins() {
  try {
    const response = await fetch('http://127.0.0.1:4777/api/plugins'); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'plugin registry unavailable');
    $('#plugin-list').innerHTML = result.plugins.length ? result.plugins.map(plugin => `<div class="plugin-item"><b>${esc(plugin.name || plugin.id)}</b><small>${esc(plugin.version || 'invalid')} | ${plugin.trusted ? 'trusted' : 'approval required'}</small>${plugin.invalid ? `<em>${esc(plugin.invalid)}</em>` : plugin.trusted ? '<span class="plugin-state ready">ENABLED / ISOLATED</span>' : `<button data-plugin-trust="${esc(plugin.id)}" class="secondary">TRUST MANIFEST</button>`}</div>`).join('') : '<span class="muted">Drop a plugin folder with aide-plugin.json here.</span>';
    $('#plugin-list').querySelectorAll('[data-plugin-trust]').forEach(button => button.onclick = async () => { await fetch('http://127.0.0.1:4777/api/plugins/trust', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: button.dataset.pluginTrust, trusted: true }) }); loadPlugins(); });
  } catch (error) { $('#plugin-list').innerHTML = `<span class="muted">${esc(error.message)}</span>`; }
}

async function loadGitStatus() {
  try { const response = await fetch('http://127.0.0.1:4777/api/git/status'); const result = await response.json(); $('#git-status').textContent = result.unavailable ? `Git unavailable: ${result.unavailable}` : (result.status || 'Working tree clean.'); }
  catch (error) { $('#git-status').textContent = `Git unavailable: ${error.message}`; }
}

async function loadTasks() {
  try { const response = await fetch('http://127.0.0.1:4777/api/tasks'); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'task registry unavailable'); $('#task-list').innerHTML = result.tasks.map(task => `<button class="task-item" data-task-id="${esc(task.id)}"><span>▶</span>${esc(task.label)}</button>`).join(''); $('#task-list').querySelectorAll('[data-task-id]').forEach(button => button.onclick = async () => { button.disabled = true; const run = await fetch('http://127.0.0.1:4777/api/tasks/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: button.dataset.taskId }) }); const data = await run.json(); $('#terminal').insertAdjacentHTML('beforeend', `<p class="muted">task ${esc(data.id || button.dataset.taskId)}: ${esc(data.status || data.error)}</p>`); }); }
  catch (error) { $('#task-list').innerHTML = `<span class="muted">${esc(error.message)}</span>`; }
}

async function showGitDiff() {
  try { const response = await fetch('http://127.0.0.1:4777/api/git/diff'); const result = await response.json(); $('#terminal').insertAdjacentHTML('beforeend', `<pre class="terminal-output">${esc(result.diff || result.unavailable || 'No changes.')}</pre>`); document.querySelector('.bottom-panel').scrollIntoView({ block: 'nearest' }); }
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
  try {
    const response = await fetch('http://127.0.0.1:4777/api/file/write', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: state.activeFile, content: $('#code').textContent, approved: true })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'file write rejected');
    appendLog('WORKSPACE', `${result.path} saved atomically after explicit approval.`);
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
    const visibleStatus = installed ? 'imported' : model.status;
    const roles = model.roles.join(' / ');
    const item = document.createElement('button');
    item.className = 'model-item';
    item.innerHTML = `<span class="status ${visibleStatus}"></span><span>${esc(model.name)}</span><small>${esc(model.format)} | ${esc(visibleStatus)} | ${esc(roles)}</small><strong class="pack-action">${installed ? 'REPLACE' : 'IMPORT'}</strong>`;
    item.onclick = () => selectModel(model);
    item.querySelector('.pack-action').onclick = event => { event.stopPropagation(); importModel(model); };
    list.appendChild(item);
    const lane = document.createElement('button');
    lane.className = `lane ${model.status}`;
    lane.innerHTML = `<b>${esc(model.lane.toUpperCase())}</b><span>${esc(model.name)}</span><small>${esc(roles)}</small>`;
    lane.onclick = () => selectModel(model);
    lanes.appendChild(lane);
    const option = document.createElement('option'); option.value = model.id; option.textContent = `${model.name} [${model.status}]`; option.disabled = model.status === 'training-only'; select.appendChild(option);
  });
  select.onchange = () => { const model = state.manifest.models.find(item => item.id === select.value); if (model) selectModel(model); };
}

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

let communityStore = { projects: [], issues: [], discussions: [], marketplace: [] };
  input.click();
}

function selectModel(model) {
  state.selected = model;
  state.runtimeReady = false;
  if ($('#model-select')) $('#model-select').value = model.id;
  $('#selected-model').textContent = model.name;
  $('#selected-detail').textContent = `${model.format} | ${model.status} | ${model.description}`;
  $('#runtime-name').textContent = model.runtime;
  setRuntimeState('Model selected. Press START MODEL.', '');
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

async function requestLocal(model, messages) {
  const response = await fetch(`${model.endpoint}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: model.model, messages, temperature: model.temperature, max_tokens: model.max_tokens })
  });
  if (!response.ok) throw new Error(`runtime returned HTTP ${response.status}`);
  const data = await response.json();
  return data.choices?.[0]?.message?.content || 'Runtime returned no content.';
}

async function runReview() {
  const task = $('#input').value.trim() || 'Review the local provider router for safer fallback behavior.';
  const runnable = model => ['ready', 'experimental'].includes(model.status) && model.endpoint?.startsWith('http');
  const ready = state.manifest.models.filter(runnable);
   const research = state.manifest.models.find(model => model.lane === 'research' && runnable(model)) || ready[0];
  const builder = state.manifest.models.find(model => model.lane === 'build' && runnable(model)) || ready[0];
  const verifier = state.manifest.models.find(model => model.lane === 'verify') || builder;
  $('#review-button').disabled = true;
  $('#review-button').textContent = 'RUNNING...';
  $('#collab-log').innerHTML = '';
  appendLog('COORDINATOR', `Task accepted with a four-turn maximum: ${task}`);
  try {
    if (research.status === 'pending') throw new Error('Research lane is not configured. Add a local endpoint or checkpoint first.');
    const findings = await requestLocal(research, [{ role: 'system', content: research.system_prompt }, { role: 'user', content: task }]);
    appendLog('RESEARCH', findings);
    if (builder.status === 'pending') throw new Error('Coding lane is not configured. Install a coding checkpoint before applying patches.');
    let patch = await requestLocal(builder, [{ role: 'system', content: builder.system_prompt }, { role: 'user', content: `Task: ${task}\nResearch findings:\n${findings}\nReturn a unified diff only.` }]);
    if (!patchValid(patch)) {
      appendLog('REPAIR', 'Builder output was not a valid unified diff. Requesting one bounded repair.', 'warning');
      patch = await requestLocal(builder, [{ role: 'system', content: 'Convert the raw response into one valid unfenced unified diff. Preserve intent. Return only the diff. Do not invent files or claim tests passed.' }, { role: 'user', content: `Task: ${task}\nRaw response:\n${patch}` }]);
    }
    if (!patchValid(patch)) throw new Error('Patch repair failed structural validation; no files changed.');
    appendLog('BUILD', patch, 'patch');
    if (verifier.status === 'pending') throw new Error('Verifier lane is not configured.');
    const verdict = await requestLocal(verifier, [{ role: 'system', content: verifier.system_prompt }, { role: 'user', content: `Task: ${task}\nProposed patch:\n${patch}\nReturn APPROVE, REJECT, or NEEDS-EVIDENCE with reasons.` }]);
    appendLog('VERIFY', verdict, verdict.includes('APPROVE') ? 'approved' : 'warning');
    appendLog('COORDINATOR', 'No files were changed. Review and approve the patch before applying it.');
  } catch (error) {
    appendLog('STOPPED', error.message, 'warning');
  } finally {
    await saveReplay('review-complete');
    $('#review-button').disabled = false;
    $('#review-button').textContent = 'START BOUNDED REVIEW';
  }
}

async function testRuntime() {
  const model = state.selected || state.manifest.models.find(item => item.status !== 'pending');
  if (!model) return appendLog('RUNTIME', 'No configured local model endpoint.', 'warning');
  appendLog('RUNTIME', `Testing ${model.name} at ${model.endpoint}...`);
  try {
    const response = await fetch(`${model.endpoint}/models`);
    state.runtimeReady = response.ok;
    setRuntimeState(response.ok ? 'Model ready. You can chat now.' : `Runtime returned HTTP ${response.status}.`, response.ok ? 'ready' : 'error');
    appendLog('RUNTIME', response.ok ? 'Local runtime reachable. Model is ready for chat.' : `Runtime returned HTTP ${response.status}.`, response.ok ? 'approved' : 'warning');
  } catch (error) {
    state.runtimeReady = false;
    setRuntimeState('Model is not ready yet. Start it and wait.', 'error');
    appendLog('RUNTIME', 'Offline shell is healthy, but no local HTTP runtime is reachable. This is expected until the adapter is started.', 'warning');
  }
}

async function startRuntime() {
  const model = state.selected;
  if (!model) return appendLog('RUNTIME', 'Select a model pack first.', 'warning');
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
    appendLog('RUNTIME', `${model.name} is starting at ${result.endpoint}. Waiting for readiness...`);
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      try { const ready = await fetch(`${model.endpoint}/models`); if (ready.ok) { state.runtimeReady = true; setRuntimeState('Model ready. You can chat now.', 'ready'); appendLog('RUNTIME', 'Model is ready for chat.', 'approved'); break; } } catch { /* keep waiting */ }
    }
    if (!state.runtimeReady) setRuntimeState('Model did not become ready. Check the runtime status.', 'error');
  } catch (error) {
    setRuntimeState(`Could not start model: ${error.message}`, 'error');
    appendLog('RUNTIME', `Local daemon unavailable: ${error.message}. Start daemon/server.mjs first.`, 'warning');
  } finally { $('#start-selected').disabled = false; }
}

function closeLaunchGuide() {
  if ($('#launch-dont-show').checked) localStorage.setItem('aide.launch.version', '2');
  $('#launch-guide').hidden = true;
}

function bindLaunchGuide() {
  const guide = $('#launch-guide');
  if (localStorage.getItem('aide.launch.version') !== '2') guide.hidden = false;
  $('#launch-start').onclick = async () => { const model = state.manifest.models.find(item => item.id === 'qwen-coder-1.5b-q4') || state.manifest.models.find(item => item.status === 'ready'); if (model) selectModel(model); closeLaunchGuide(); await startRuntime(); };
  $('#launch-learn').onclick = () => { closeLaunchGuide(); $('#learn-button').click(); };
}

async function sendChat() {
  const input = $('#input');
  const value = input.value.trim();
  if (!value) return;
  if (!state.selected || !state.runtimeReady) return appendLog('CHAT', 'Start the selected model and wait for the green “Model ready” message first.', 'warning');
  $('#chat').insertAdjacentHTML('beforeend', `<p><b>YOU</b><br>${esc(value)}</p><p class="assistant"><b>${esc(state.selected.name)}</b><br><span class="muted">Thinking locally...</span></p>`);
  input.value = '';
  try {
    const mode = $('#assistant-mode').value;
    const response = await fetch('http://127.0.0.1:4777/api/operator', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode, modelId: state.selected.id, prompt: value }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'chat request failed');
    const answer = result.answer || 'The local model returned no text.';
    const last = $('#chat').lastElementChild; last.innerHTML = `<b>${esc(state.selected.name)}</b><br>${esc(answer)}`;
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
    const count = result.body?.threads?.length || 0;
    $('#debug-status').textContent = `Debug threads: ${count}. Stack/variables populate after launch.`;
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
  $('#blueprint-button').onclick = () => { const showing = view.hidden; view.hidden = !showing; $('#blueprint-button').classList.toggle('active', showing); if (showing) { $('#learn-view').hidden = true; $('#learn-button').classList.remove('active'); loadBlueprint(); requestAnimationFrame(drawBlueprint); } };
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
  $('#lesson-kicker').textContent = `${session.course.title.toUpperCase()} / ${session.lesson.kind.toUpperCase()}`; $('#lesson-title').textContent = session.lesson.title; $('#lesson-objective').textContent = session.lesson.objective; $('#tutor-prompt-text').textContent = 'What do you think the safest first step is? Build it in the workspace, run the check, then explain your reasoning below.'; $('#lesson-progress').textContent = `${session.progress.completed.length} lesson(s) complete. Next gate: ${session.next?.title || 'course complete'}.`;
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

function bindAcademy() {
  const view = $('#learn-view');
  $('#learn-button').onclick = () => { const showing = view.hidden; view.hidden = !showing; $('#learn-button').classList.toggle('active', showing); if (showing) { $('#blueprint-view').hidden = true; $('#blueprint-button').classList.remove('active'); loadAcademy(); } };
  $('#lesson-complete').onclick = completeLesson;
  $('#lesson-hint').onclick = () => { $('#tutor-prompt-text').textContent = 'Hint: name the value first, then choose the smallest operation that proves the lesson objective. Run the lesson check before asking for the answer.'; appendLog('TUTOR', 'Progressive hint unlocked.'); };
}

function bindWorkbenchNavigation() {
  $('#explorer-button').onclick = () => { document.body.classList.add('simple-mode'); $('#mode-toggle').textContent = 'ADVANCED'; $('#workspace-tree').scrollIntoView({ block: 'nearest' }); };
  $('#run-button').onclick = () => { document.querySelector('.bottom-panel').scrollIntoView({ block: 'nearest' }); $('#terminal-command').focus(); };
  $('#ai-button').onclick = () => { document.querySelector('.agent-panel').scrollIntoView({ block: 'nearest' }); $('#input').focus(); };
  $('#plugins-button').onclick = () => { document.body.classList.remove('simple-mode'); $('#mode-toggle').textContent = 'SIMPLE'; $('#plugin-list').scrollIntoView({ block: 'nearest' }); };
  $('#settings-button').onclick = () => appendLog('SETTINGS', 'Settings surface is not enabled yet. No hidden configuration is being changed.', 'warning');
}

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
  const firstReady = state.manifest.models.find(model => model.status !== 'pending');
  if (firstReady) selectModel(firstReady);
  setRuntimeState('Choose START MODEL, then wait for the green ready message.');
  $('#start-selected').onclick = startRuntime;
  $('#test-selected').onclick = testRuntime;
  $('#connection-button').onclick = startRuntime;
  $('#mode-toggle').onclick = () => { document.body.classList.toggle('simple-mode'); $('#mode-toggle').textContent = document.body.classList.contains('simple-mode') ? 'ADVANCED' : 'SIMPLE'; };
  bindLaunchGuide();
  openFile('README.md');
  loadWorkspaceTree();
  loadPlugins();
  $('#git-refresh').onclick = loadGitStatus;
  $('#git-diff').onclick = showGitDiff;
  loadGitStatus();
  loadTasks();
  $('#review-button').onclick = runReview;
  $('#save-file').onclick = saveFile;
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
  testRuntime();
  refreshTrainingStatus();
  setInterval(refreshTrainingStatus, 5000);
  loadCommunity();
  $('#input').onkeydown = event => { if (event.key === 'Enter') sendChat(); };
}

boot();

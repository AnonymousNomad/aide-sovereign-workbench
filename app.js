const state = { manifest: null, node: null, selected: null, casefile: null, activeFile: 'src/agent.ts', files: {
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

function openFile(name) {
  const text = state.files[name] || state.files['agent.ts'];
  state.activeFile = `src/${name}`;
  $('#code').textContent = text;
  $('#line-numbers').textContent = text.split('\n').map((_, index) => index + 1).join('\n');
  document.querySelectorAll('[data-file]').forEach(button => button.classList.toggle('active', button.dataset.file === name));
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
  list.innerHTML = '';
  lanes.innerHTML = '';
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
  });
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
  $('#selected-model').textContent = model.name;
  $('#selected-detail').textContent = `${model.format} | ${model.status} | ${model.description}`;
  $('#runtime-name').textContent = model.runtime;
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
  const ready = state.manifest.models.filter(model => model.status === 'ready');
  const research = state.manifest.models.find(model => model.lane === 'research' && model.status !== 'pending') || ready[0];
  const builder = state.manifest.models.find(model => model.lane === 'build' && model.status !== 'pending') || ready[0];
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
    appendLog('RUNTIME', response.ok ? 'Local runtime reachable. Model remains subject to capability checks.' : `Runtime returned HTTP ${response.status}.`, response.ok ? 'approved' : 'warning');
  } catch (error) {
    appendLog('RUNTIME', 'Offline shell is healthy, but no local HTTP runtime is reachable. This is expected until the adapter is started.', 'warning');
  }
}

async function startRuntime() {
  const model = state.selected;
  if (!model) return appendLog('RUNTIME', 'Select a model pack first.', 'warning');
  try {
    const response = await fetch('http://127.0.0.1:4777/api/models/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: model.id })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'runtime start failed');
    appendLog('RUNTIME', `${model.name} is starting at ${result.endpoint}.`);
    setTimeout(testRuntime, 1500);
  } catch (error) {
    appendLog('RUNTIME', `Local daemon unavailable: ${error.message}. Start daemon/server.mjs first.`, 'warning');
  }
}

function sendChat() {
  const input = $('#input');
  const value = input.value.trim();
  if (!value) return;
  $('#chat').insertAdjacentHTML('beforeend', `<p><b>YOU</b><br>${esc(value)}</p><p class="assistant"><b>AIDE</b><br>Use START BOUNDED REVIEW to send this task through the research, build, and verify lanes. No files will change automatically.</p>`);
  input.value = '';
}

function localNodeId() {
  let id = localStorage.getItem('aide.node.id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('aide.node.id', id);
  }
  return id;
}

function renderCasefile() {
  const status = $('#case-status');
  const list = $('#evidence-list');
  if (!state.casefile) {
    status.textContent = 'No case open.';
    list.textContent = '';
    return;
  }
  status.innerHTML = `<b>CASE ${esc(state.casefile.id)}</b><br>${state.casefile.evidence.length} evidence item(s)<br>Local-only provenance ledger`;
  list.innerHTML = state.casefile.evidence.map(item => `<div style="border-left:2px solid #58c7ff;padding-left:5px;margin-top:6px"><b>${esc(item.name)}</b><br>${esc(item.bytes)} bytes | SHA-256 ${esc(item.hash.slice(0, 12))}...<br>dates: ${esc(item.dates.join(', ') || 'none detected')}</div>`).join('');
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

async function trainingRequest(action, payload = {}) {
  try {
    const response = await fetch(`http://127.0.0.1:4777/api/training/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Training Room request failed');
    $('#training-status').textContent = result.status === 'running' ? `Running: ${result.id}` : `Training Room: ${result.status}`;
    appendLog('TRAINING', JSON.stringify(result));
  } catch (error) { $('#training-status').textContent = `Blocked: ${error.message}`; appendLog('TRAINING', error.message, 'warning'); }
}

async function digestFile(file) {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const text = new TextDecoder().decode(buffer);
  const dates = [...new Set(text.match(/\b(?:19|20)\d{2}(?:[-/]\d{1,2}(?:[-/]\d{1,2})?)?\b/g) || [])].slice(0, 20);
  return { name: file.name, bytes: file.size, hash, dates, imported_at: new Date().toISOString() };
}

async function importEvidence(event) {
  if (!state.casefile) {
    appendLog('CASEFILE', 'Create a case before importing evidence.', 'warning');
    event.target.value = '';
    return;
  }
  for (const file of event.target.files) state.casefile.evidence.push(await digestFile(file));
  localStorage.setItem(`aide.case.${state.casefile.id}`, JSON.stringify(state.casefile));
  renderCasefile();
  appendLog('CASEFILE', `${event.target.files.length} evidence item(s) imported locally. Hashes and date anchors recorded; no network request made.`);
  event.target.value = '';
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
  openFile('agent.ts');
  document.querySelectorAll('[data-file]').forEach(button => button.onclick = () => openFile(button.dataset.file));
  $('#review-button').onclick = runReview;
  $('#save-file').onclick = saveFile;
  $('#connection-button').onclick = startRuntime;
  $('#send-button').onclick = sendChat;
  $('#node-button').onclick = () => { localNodeId(); renderNode(); appendLog('NODE', 'Local identity created. No network connection or private data was shared.'); };
  $('#case-button').onclick = () => {
    state.casefile = { id: `AIDE-${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}`, evidence: [], created_at: new Date().toISOString(), boundary: 'private' };
    localStorage.setItem(`aide.case.${state.casefile.id}`, JSON.stringify(state.casefile));
    renderCasefile();
    appendLog('CASEFILE', `Created ${state.casefile.id}. Boundary: private. Evidence remains on this device.`);
  };
  $('#evidence-input').onchange = importEvidence;
  document.querySelectorAll('[data-community-tab]').forEach(button => button.onclick = () => renderCommunity(button.dataset.communityTab));
  $('#community-add').onclick = addCommunityIssue;
  $('#lsp-button').onclick = () => startTool('lsp', 'typescript', 'TypeScript LSP');
  $('#lsp-check').onclick = checkActiveFile;
  $('#dap-button').onclick = () => startTool('dap', 'python-debugpy', 'Python DAP');
  $('#training-verify').onclick = () => trainingRequest('start', { id: 'verify-release', approved: true });
  $('#training-stop').onclick = () => trainingRequest('stop');
  loadCommunity();
  $('#input').onkeydown = event => { if (event.key === 'Enter') sendChat(); };
}

boot();

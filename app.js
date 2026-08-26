const $ = s => document.querySelector(s);
const API = 'http://127.0.0.1:4777';
const state = { selected: null, ready: false, started: false, history: [] };

const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const setStrip = t => { $('#strip-text').textContent = t; };
const stepDone = n => document.querySelector(`#checklist li[data-step="${n}"]`)?.classList.add('done');

async function jget(url) {
  const r = await fetch(url);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

async function jpost(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error((j.error && (j.error.message || j.error)) || `HTTP ${r.status}`);
  return j;
}

async function jput(url, body) {
  const r = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error((j.error && (j.error.message || j.error)) || `HTTP ${r.status}`);
  return j;
}

function threadMsg(kind, text, name) {
  const el = document.createElement('div');
  el.className = `msg ${kind}`;
  el.innerHTML = kind === 'user' ? esc(text) : `<b>${esc(name || 'AIDE')}</b><br>${esc(text)}`;
  $('#thread').appendChild(el);
  $('#thread').scrollTop = $('#thread').scrollHeight;
  return el;
}

async function loadModels() {
  setStrip('Looking for models on this machine…');
  try {
    const res = await jget(`${API}/api/models/status`);
    const rank = m => (m.runtime_available ? 0 : 2) + (m.artifact_available ? 0 : 1);
    const usable = res.models
      .filter(m => m.artifact_available && !['pending', 'training-only'].includes(m.status))
      .sort((a, b) => rank(a) - rank(b));
    if (usable.length) {
      let chosen = usable[0];
      try {
        const session = await jget(`${API}/api/session`);
        const remembered = session?.data?.selected_engine_id || session?.selected_engine_id;
        const match = usable.find(m => m.id === remembered);
        if (match) chosen = match;
      } catch { /* session store optional */ }
      state.selected = chosen;
      $('#cold-line').innerHTML = `Recommended for this machine: <b>${esc(chosen.name)}</b>${chosen !== usable[0] ? ' <span class="muted">(your last engine)</span>' : ''}`;
      $('#start-engine').hidden = false;
      setStrip(`Press START to run ${chosen.name}. Everything stays on this computer.`);
      stepDone(1);
    } else {
      $('#cold-line').textContent = 'No chat-capable model found in the bottle. The Model Hub (search + download inside AIDE) arrives in an upcoming update.';
      setStrip('No usable local model found.');
    }
  } catch (e) {
    $('#cold-line').textContent = `Local daemon unreachable (${e.message}). Start the stack and reload.`;
    setStrip('Waiting for the local daemon…');
  }
}

async function startEngine() {
  const btn = $('#start-engine');
  const model = state.selected;
  if (!model || state.started || btn.disabled) return;
  btn.disabled = true;
  btn.textContent = 'STARTING…';
  $('#cold-line').innerHTML = `Starting <b>${esc(model.name)}</b> — first start can take a while. Hang tight.`;
  setStrip(`Starting ${model.name}… waiting for the readiness signal.`);
  try {
    const r = await fetch(`${API}/api/models/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: model.id })
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error || `HTTP ${r.status}`);
    }
    let ready = false;
    for (let i = 0; i < 120; i++) {
      await new Promise(res => setTimeout(res, 1000));
      const d = await jget(`${API}/api/model/ready?id=${encodeURIComponent(model.id)}`);
      if (d.ready) { ready = true; break; }
      if (d.status === 'conflict') throw new Error(d.error || 'port conflict with another engine');
    }
    if (!ready) throw new Error('timed out waiting for the engine to become ready');
    state.ready = true; state.started = true;
    document.body.classList.replace('state-cold', 'state-ready');
    $('#cold-card').hidden = true;
    $('#editor-slot').hidden = false;
    loadTree();
    const chip = $('#engine-chip');
    chip.classList.add('on');
    $('#engine-name').textContent = model.name;
    $('#describe-input').disabled = false;
    $('#send').disabled = false;
    $('#plan-btn').disabled = false;
    $('#stop-engine').hidden = false;
    threadMsg('engine', `${model.name} is ready. Describe what you want to build or fix.`, 'AIDE');
    setStrip('Describe a task below. AIDE plans first — you approve before anything changes.');
    stepDone(2);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'RETRY START';
    $('#cold-line').innerHTML = `Could not start: ${esc(e.message)}<br><span class="muted">Press RETRY. If it keeps failing, another engine may hold the port — closing other model apps usually fixes it.</span>`;
    setStrip('Engine start failed — see the fix hint above.');
  }
}

async function sendDescribe(value) {
  threadMsg('user', value);
  const pending = threadMsg('pending', 'Thinking locally… nothing leaves this machine.');
  setStrip('Working on your request…');
  // Micro-expert advisory (never authoritative): task-router classifies intent
  // locally in microseconds; chip shows the read so the operator sees the read.
  void jpost(`${API}/api/experts/intent`, { message: value }).then(r => {
    if (!r?.phase) return;
    pending.insertAdjacentHTML('beforeend',
      ` <div><span class="prov-chip">ROUTED ${esc(r.phase.toUpperCase())}</span><span class="muted small"> micro-expert advisory · ${(r.confidence * 100).toFixed(0)}% · ${esc(r.expert)}</span></div>`);
  }).catch(() => {});
  try {
    const r = await fetch(`${API}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        modelId: state.selected.id,
        messages: [...state.history.slice(-4), { role: 'user', content: value }],
        max_tokens: 300,
        timeout_ms: 120000
      })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'chat failed');
    const answer = j.answer || j.choices?.[0]?.message?.content || '(the engine returned no text)';
    pending.className = 'msg engine';
    pending.innerHTML = `<b>${esc(state.selected.name)}</b><br>${linkifySources(esc(answer))}` +
      `<div><span class="prov-chip">UNVERIFIED</span><span class="muted small"> model output — validate before relying on it</span></div>` +
      (j.harness?.injected ? `<br><small class="stage">HARNESS ${esc(j.harness.tier.toUpperCase())} · ${esc(String(j.harness.version))}</small>` : '');
    if (j.harness?.injected) {
      const hb = $('#harness-badge');
      hb.textContent = `ON · ${(j.harness.tier || '').toUpperCase()}`;
      hb.className = 'badge on';
    }
    state.history.push({ role: 'user', content: value }, { role: 'assistant', content: answer });
    state.history = state.history.slice(-8);
    stepDone(3);
    setStrip('Reply ready. Plan/approve cards arrive in the next update — nothing is changed without you.');
  } catch (e) {
    pending.className = 'msg error';
    pending.innerHTML = `<b>ERROR</b><br>${esc(e.message)}<br><small>Check that the topbar chip is green, then send again.</small>`;
    setStrip('Chat failed — see the error card for the fix.');
  }
}

$('#describe-form').addEventListener('submit', e => {
  e.preventDefault();
  const v = $('#describe-input').value.trim();
  if (!v || !state.ready) return;
  $('#describe-input').value = '';
  sendDescribe(v);
});
$('#plan-btn').addEventListener('click', () => {
  const v = $('#describe-input').value.trim();
  if (!v || !state.ready) return;
  $('#describe-input').value = '';
  stepDone(3);
  lastIntent = v;
  planAndBuild(v);
});
$('#start-engine').addEventListener('click', startEngine);
$('#stop-engine').addEventListener('click', async () => {
  if (!state.selected) return;
  $('#stop-engine').disabled = true;
  setStrip('Stopping the engine and freeing memory…');
  try {
    await fetch(`${API}/api/models/stop`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: state.selected.id })
    });
  } catch { /* best effort - reload regardless */ }
  location.reload();
});
$('#help-button').addEventListener('click', () => { $('#help-panel').hidden = false; });
$('#help-close').addEventListener('click', () => { $('#help-panel').hidden = true; });

let downloadsTimer = null;

async function refreshEngineList() {
  try {
    const res = await jget(`${API}/api/models/status`);
    const list = $('#engine-list');
    if (!res.models.length) { list.innerHTML = '<span class="muted">No models in the bottle yet.</span>'; return; }
    list.innerHTML = res.models.map(m => {
      const running = m.runtime_available === true;
      const usable = m.artifact_available && !['pending', 'training-only'].includes(m.status);
      return `<div class="engine-item"><span class="engine-name">${esc(m.name)}</span><span class="engine-meta">${running ? 'READY' : (usable ? 'installed' : 'missing artifact')}</span><button data-use="${usable ? esc(m.id) : ''}" ${state.selected?.id === m.id ? 'disabled' : ''}>${state.selected?.id === m.id ? 'SELECTED' : 'USE'}</button></div>`;
    }).join('');
    list.querySelectorAll('[data-use]').forEach(btn => {
      btn.onclick = async () => {
        const id = btn.dataset.use;
        if (!id) return;
        const found = res.models.find(m => m.id === id);
        if (!found) return;
        state.selected = found; state.ready = false; state.started = false;
        fetch(`${API}/api/session`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ selected_engine_id: found.id }) }).catch(() => {});
        $('#models-panel').hidden = true;
        document.body.classList.replace('state-ready', 'state-cold');
        $('#cold-card').hidden = false;
        $('#editor-slot').hidden = true;
        $('#start-engine').hidden = false;
        $('#start-engine').disabled = false;
        $('#start-engine').textContent = 'START ENGINE';
        $('#cold-line').innerHTML = `Selected: <b>${esc(found.name)}</b>`;
        setStrip(`${found.name} selected — press START.`);
      };
    });
  } catch (e) {
    $('#engine-list').innerHTML = `<span class="muted">Could not load engines: ${esc(e.message)}</span>`;
  }
}

async function pollDownloads() {
  try {
    const res = await jget(`${API}/api/modelhub/downloads`);
    const jobs = res.jobs || [];
    const active = jobs.filter(j => j.status === 'running');
    const box = $('#downloads-list');
    if (!jobs.length && box.dataset.empty !== '1') { box.innerHTML = '<span class="muted">No downloads yet.</span>'; }
    if (jobs.length) {
      box.innerHTML = jobs.map(j => {
        const pct = j.bytes_total ? Math.round((j.bytes_done / j.bytes_total) * 100) : 0;
        const mb = (j.bytes_done / 1048576).toFixed(1);
        const total = j.bytes_total ? ` / ${(j.bytes_total / 1048576).toFixed(1)} MB` : ' MB';
        return `<div class="dl-item"><b>${esc(j.filename)}</b><span class="engine-meta">${j.status.toUpperCase()} ${mb}${total} (${pct}%)</span>${j.status === 'running' ? `<button data-cancel="${esc(j.job_id)}">CANCEL</button>` : ''}</div>`;
      }).join('');
      box.querySelectorAll('[data-cancel]').forEach(btn => {
        btn.onclick = async () => {
          await fetch(`${API}/api/modelhub/downloads/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: btn.dataset.cancel }) });
          pollDownloads();
        };
      });
      const justDone = jobs.filter(j => j.status === 'done' && !j.registered);
      for (const job of justDone) {
        job.registered = true;
        try {
          const reg = await fetch(`${API}/api/models/register`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: job.filename, repo_id: job.repo_id })
          });
          const rj = await reg.json();
          if (reg.ok) threadMsg('system', `Downloaded and registered: ${job.filename} (engine id: ${rj.id}). Open MODELS to use it.`);
          refreshEngineList();
        } catch { /* register retry on next poll */ delete job.registered; }
      }
    }
    if (!active.length && downloadsTimer) { clearInterval(downloadsTimer); downloadsTimer = null; }
  } catch { /* hub offline - ignore */ }
}

function openModelsPanel() {
  $('#models-panel').hidden = false;
  refreshEngineList();
  pollDownloads();
  if (!downloadsTimer) downloadsTimer = setInterval(pollDownloads, 1500);
  const block = $('#tuning-block');
  if (state.selected) {
    block.hidden = false;
    $('#tuning-engine').textContent = state.selected.name;
  } else {
    block.hidden = true;
  }
}

$('#models-button').addEventListener('click', openModelsPanel);
document.querySelectorAll('[data-preset]').forEach(btn => {
  btn.onclick = async () => {
    if (!state.selected) return;
    $('#tuning-note').textContent = 'Saving preset…';
    try {
      const r = await fetch(`${API}/api/models/profile`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: state.selected.id, preset: btn.dataset.preset })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      $('#tuning-note').textContent = `Saved "${btn.dataset.preset}" for ${state.selected.name}. Applies on next START.`;
      setStrip(`Tuning saved: ${btn.dataset.preset} — takes effect on next engine start.`);
    } catch (e) {
      $('#tuning-note').textContent = `Save failed: ${e.message}`;
    }
  };
});
$('#models-close').addEventListener('click', () => {
  $('#models-panel').hidden = true;
  if (downloadsTimer) { clearInterval(downloadsTimer); downloadsTimer = null; }
});

$('#hub-search-btn').addEventListener('click', async () => {
  const q = $('#hub-query').value.trim();
  if (!q) return;
  const results = $('#hub-results');
  const files = $('#hub-files');
  files.innerHTML = '';
  results.innerHTML = '<span class="muted">Searching Hugging Face…</span>';
  setStrip('Searching Hugging Face — this is the only network call, and it is logged.');
  try {
    const res = await jget(`${API}/api/modelhub/search?q=${encodeURIComponent(q)}&limit=12`);
    if (!res.models.length) { results.innerHTML = '<span class="muted">No GGUF repos matched.</span>'; return; }
    results.innerHTML = res.models.map(m =>
      `<div class="hub-item"><b>${esc(m.repo_id)}</b><span class="engine-meta">↓${m.downloads.toLocaleString()} ★${m.likes}</span><button data-repo="${esc(m.repo_id)}">VIEW GGUF FILES</button></div>`
    ).join('');
    results.querySelectorAll('[data-repo]').forEach(btn => {
      btn.onclick = async () => {
        const repo = btn.dataset.repo;
        files.innerHTML = '<span class="muted">Listing quantizations…</span>';
        try {
          const fr = await jget(`${API}/api/modelhub/files?repo_id=${encodeURIComponent(repo)}`);
          files.innerHTML = fr.files.length
            ? fr.files.map(f => {
                const sizeGB = f.size ? `${(f.size / 1073741824).toFixed(2)} GB` : 'size?';
                return `<div class="hub-item"><span>${esc(f.filename)}</span><span class="engine-meta">${sizeGB}</span><button data-dl="${esc(f.filename)}" data-repo2="${esc(repo)}">DOWNLOAD</button></div>`;
              }).join('')
            : '<span class="muted">No .gguf files in this repo.</span>';
          files.querySelectorAll('[data-dl]').forEach(dbtn => {
            dbtn.onclick = async () => {
              dbtn.disabled = true; dbtn.textContent = 'QUEUED';
              const dr = await fetch(`${API}/api/modelhub/download`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ repo_id: dbtn.dataset.repo2, filename: dbtn.dataset.dl })
              });
              const dj = await dr.json().catch(() => ({}));
              if (!dr.ok) { threadMsg('error', `Download failed to start: ${dj.error || dr.status}`); dbtn.textContent = 'RETRY'; dbtn.disabled = false; return; }
              setStrip(`Downloading ${dbtn.dataset.dl}… progress in the panel.`);
              if (!downloadsTimer) downloadsTimer = setInterval(pollDownloads, 1500);
              pollDownloads();
            };
          });
        } catch (e) {
          files.innerHTML = `<span class="muted">Could not list files: ${esc(e.message)}</span>`;
        }
      };
    });
    setStrip('Search done. Pick a repo, then a quant that fits your machine.');
  } catch (e) {
    results.innerHTML = `<span class="muted">Search failed: ${esc(e.message)}</span>`;
    setStrip('Hub search failed.');
  }
});

$('#import-btn').addEventListener('click', async () => {
  const p = $('#import-path').value.trim();
  const out = $('#import-result');
  if (!p) return;
  const ctx = Number($('#import-ctx').value) || undefined;
  out.textContent = 'Importing (copying into AIDE models folder)…';
  try {
    const r = await fetch(`${API}/api/models/import`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_path: p, context_tokens: ctx })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    out.textContent = `Imported as engine "${j.id}" (${(j.bytes / 1048576).toFixed(1)} MB${ctx ? `, ctx ${ctx}` : ''}). It now appears in Engines.`;
    refreshEngineList();
    setStrip(`Imported ${j.id} — press USE then START when ready.`);
  } catch (e) {
    out.textContent = `Import failed: ${e.message}`;
  }
});

// Bounded delegation posture: STANDARD auto-approves read-only tools;
// STRICT asks for every tool call. Persisted per browser.
let delegationMode = localStorage.getItem('aide.delegation') || 'standard';
function setDelegation(mode) {
  delegationMode = mode;
  localStorage.setItem('aide.delegation', mode);
  const b = $('#delegation-badge');
  if (b) { b.textContent = mode.toUpperCase(); b.className = 'badge' + (mode === 'strict' ? ' warn' : ' on'); }
  const t = $('#delegation-toggle');
  if (t) t.setAttribute('aria-pressed', mode === 'strict' ? 'true' : 'false');
}
setDelegation(delegationMode);

async function planAndBuild(task) {
  threadMsg('user', task);
  const note = threadMsg('pending', 'Starting agent loop…');
  let sessionId = null;
  try {
    const r = await fetch(`${API}/api/agent/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task, mode: 'act' })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'agent unavailable');
    sessionId = j.session_id;
  } catch (e) {
    note.remove();
    threadMsg('system', `Agent loop not reachable (${e.message}) — falling back to single-shot planner.`);
    return workflowPlan(task);
  }
  note.remove();
  setStrip('Agent working with checkpoints — every change waits for your approval.');
  let lastApprovalId = null;
  for (let poll = 0; poll < 160; poll++) {
    await new Promise(res => setTimeout(res, 1500));
    let s;
    try {
      s = await jget(`${API}/api/agent/status?id=${encodeURIComponent(sessionId)}`);
    } catch { continue; }
    if (s.state === 'running') {
      cardTick(`Agent working… step ${s.iterations}${s.mistake_count ? ` · ${s.mistake_count} recovery(ies)` : ''}`);
      setStrip(`Agent working — step ${s.iterations}.`);
    } else if (s.state === 'awaiting_approval') {
      const a = s.pending_approval;
      if (!a || a.approval_id === lastApprovalId) continue;
      lastApprovalId = a.approval_id;
      // Bounded delegation (MSR 2026): read-only tools pre-approved in
      // STANDARD posture; STRICT asks for everything. Writes always ask.
      const READ_ONLY = new Set(['read_file', 'list_dir', 'search']);
      if (delegationMode === 'standard' && READ_ONLY.has(a.tool)) {
        await fetch(`${API}/api/agent/decision`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId, approval_id: a.approval_id, decision: 'approve' })
        }).catch(() => {});
        threadMsg('system', `Auto-approved read-only ${a.tool} (standard delegation).`);
        continue;
      }
      renderApproval(sessionId, a);
      setStrip(`Waiting on you: approve or reject ${a.tool}.`);
    } else if (s.state === 'done') {
      finishCard(`<b>DONE</b><br>Task finished in ${s.iterations} step(s). Diff is open in the workbench.`);
      await showDiff();
      refreshRail();
      setStrip('Done — review the diff above; verification counts are in the rail.');
      return;
    } else if (s.state === 'error' || s.state === 'aborted') {
      finishError(`Agent ${s.state}: ${s.error || 'ended'}`);
      return;
    }
  }
  finishError('Timed out waiting for the agent to finish.');

  function cardTick(text) {
    let el = document.getElementById('agent-tick');
    if (!el) { el = threadMsg('pending', text); el.id = 'agent-tick'; }
    else el.textContent = text;
  }
  function finishCard(html) {
    document.getElementById('agent-tick')?.remove();
    threadMsg('engine', html.replace(/<[^>]+>/g, ''), 'AIDE');
    const c = threadMsg('pending', '');
    c.remove();
  }
  function finishError(text) {
    document.getElementById('agent-tick')?.remove();
    threadMsg('error', text);
  }
  function renderApproval(sid, a) {
    document.getElementById('agent-tick')?.remove();
    const card = threadMsg('pending', '');
    card.className = 'msg engine';
    const argsText = Object.entries(a.args_preview || {}).map(([k, v]) => `${k}: ${String(v).slice(0, 160)}`).join('\n');
    card.innerHTML = `<b>APPROVAL — ${esc(a.tool.toUpperCase())}</b><br><pre class="approval-preview">${esc(argsText)}</pre>` +
      (a.preview ? `<pre class="approval-preview">${esc(String(a.preview).slice(0, 1400))}</pre>` : '') +
      (a.risks && a.risks.length ? `<small class="stage">RISKS: ${esc(a.risks.join('; '))}</small>` : '');
    const bar = document.createElement('div');
    bar.className = 'approval-bar';
    const ok = document.createElement('button');
    ok.className = 'approve';
    ok.textContent = 'APPROVE';
    const no = document.createElement('button');
    no.textContent = 'REJECT';
    const decide = async decision => {
      ok.disabled = true; no.disabled = true;
      card.querySelector('.approval-preview')?.classList.add('dim');
      setStrip(decision === 'approve' ? 'Approved — agent continues.' : 'Rejected — agent adjusts course.');
      try {
        await fetch(`${API}/api/agent/decision`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sid, approval_id: a.approval_id, decision })
        });
        card.innerHTML = `<b>${esc(a.tool.toUpperCase())}</b><br>${decision === 'approve' ? 'Approved by you.' : 'Rejected by you.'}`;
        card.classList.add('applied');
      } catch (e) {
        threadMsg('error', `Decision failed: ${e.message}`);
      }
    };
    ok.onclick = () => decide('approve');
    no.onclick = () => decide('reject');
    bar.append(ok, no);
    card.appendChild(bar);
  }
}

async function workflowPlan(task) {
  const card = threadMsg('pending', 'Planning…');
  setStrip(`Planning "${task.slice(0, 40)}${task.length > 40 ? '…' : ''}" — the model drafts, validation gates check it.`);
  try {
    const r = await fetch(`${API}/api/workflow/plan`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelId: state.selected.id, task })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'plan failed');
    if (j.status === 'blocked-invalid-patch') {
      card.className = 'msg error';
      card.innerHTML = `<b>BLOCKED</b><br>The drafted patch failed validation. <b>Nothing was changed.</b><br><small>${esc(j.verification?.error || 'Try a smaller, more specific task.')}</small>`;
      setStrip('Patch invalid — nothing changed. Try a smaller task.');
      return;
    }
    card.className = 'msg engine';
    card.innerHTML = `<b>PLAN</b><br>${esc(j.plan)}<br><small class="stage">PATCH ${j.patch ? j.patch.split('\n').length : 0} LINES · VALIDATION PASSED</small>`;
    const bar = document.createElement('div');
    bar.className = 'approval-bar';
    const ok = document.createElement('button');
    ok.textContent = 'APPROVE & APPLY';
    ok.className = 'approve';
    const no = document.createElement('button');
    no.textContent = 'DISMISS';
    ok.onclick = async () => {
      ok.disabled = true; no.disabled = true;
      setStrip('Applying your approved patch…');
      try {
        const ar = await fetch(`${API}/api/workflow/apply`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ patch: j.patch, approved: true })
        });
        const aj = await ar.json();
        if (!ar.ok) throw new Error(aj.error || 'apply failed');
        card.classList.add('applied');
        bar.remove();
        threadMsg('engine', `Applied and recorded (audit ${aj.audit?.id || 'logged'}). The diff is open in the workbench.`);
        await showDiff();
        refreshRail();
        setStrip('Built. Review the diff above — verification counts are in the right rail.');
      } catch (e) {
        threadMsg('error', `Apply failed: ${e.message}`);
        setStrip('Apply failed — nothing was hidden; see the error card.');
      }
    };
    no.onclick = () => { card.remove(); setStrip('Plan dismissed — nothing changed.'); };
    bar.append(ok, no);
    card.appendChild(bar);
    setStrip('Plan ready — review it, then APPROVE to build.');
  } catch (e) {
    card.className = 'msg error';
    card.innerHTML = `<b>ERROR</b><br>${esc(e.message)}<br><small>Is the engine chip still green?</small>`;
    setStrip('Planning failed — see the error card.');
  }
}
async function showDiff() {
  try {
    const d = await jget(`${API}/api/git/diff`);
    document.body.classList.replace('state-cold', 'state-ready');
    $('#cold-card').hidden = true;
    $('#editor-slot').hidden = false;
    const box = $('#diff-view');
    box.hidden = false;
    box.innerHTML = `<div class="eyebrow">CHANGES — GIT DIFF</div><pre>${esc(d.diff || d.unavailable || '(no changes detected)')}</pre>`;
  } catch { /* diff is best-effort */ }
}

async function refreshRail() {
  try {
    const g = await jget(`${API}/api/git/status`);
    const b = $('#git-badge');
    b.textContent = String(g.branch || g.status || 'repo').slice(0, 14).toUpperCase();
    b.className = 'badge' + (g.unavailable ? '' : ' on');
  } catch { /* leave placeholder */ }
  try {
    const d = await jget(`${API}/api/diagnostics`);
    const n = (d.diagnostics || []).length;
    const b = $('#diag-badge');
    b.textContent = n === 0 ? 'CLEAN' : `${n} ISSUE${n === 1 ? '' : 'S'}`;
    b.className = 'badge' + (n === 0 ? ' on' : ' warn');
  } catch { /* leave placeholder */ }
  try {
    const p = await jget(`${API}/api/providers`);
    const configured = (p.providers || []).filter(x => x.configured).length;
    const chip = $('#cloud-state');
    if (configured > 0) { chip.textContent = 'AVAILABLE'; chip.className = 'badge'; chip.title = 'Opt-in cloud providers are configured. Handoff stays manual until the continuity slice lands.'; }
    else { chip.textContent = 'NOT CONFIGURED'; chip.className = 'badge off'; }
  } catch { /* providers optional */ }
}

// Hot-exit v0: persist unsaved buffer on unload; offer recovery on boot.
window.addEventListener('beforeunload', () => {
  if (!editorState.path) return;
  fetch(`${API}/api/session`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, keepalive: true,
    body: JSON.stringify({
      selected_engine_id: state.selected?.id,
      open_files: [editorState.path],
      buffers: editorState.dirty && editorState.instance ? { [editorState.path]: editorState.instance.getValue() } : {}
    })
  }).catch(() => {});
});

async function tryHotExitRecovery() {
  try {
    const session = await jget(`${API}/api/session`);
    const buffers = session?.buffers || {};
    const entries = Object.entries(buffers).filter(([path, text]) => typeof text === 'string' && text.length > 0);
    if (!entries.length) return;
    const [path, text] = entries[0];
    threadMsg('system', `Unsaved changes found for ${path} from your last session.`);
    const recover = threadMsg('pending', '');
    recover.className = 'msg engine';
    recover.innerHTML = `<b>RECOVER</b><br>Unsaved buffer for ${esc(path)}.`;
    const bar = document.createElement('div');
    bar.className = 'approval-bar';
    const ok = document.createElement('button');
    ok.className = 'approve'; ok.textContent = 'REOPEN';
    const no = document.createElement('button'); no.textContent = 'DISCARD';
    ok.onclick = async () => {
      bar.remove(); recover.remove();
      await fetch(`${API}/api/file/write`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path, content: text, approved: true }) });
      threadMsg('system', `Recovered ${path} to disk (${text.length} chars).`);
    };
    no.onclick = () => { bar.remove(); recover.remove(); };
    bar.append(ok, no);
    recover.appendChild(bar);
  } catch { /* optional */ }
}
// ---------- Workbench editor (Monaco, multi-tab) ----------
const editorTabs = [];  // [{path, model, dirty}]
let activeTab = null;   // currently displayed path
const monacoInstance = { editor: null };
// Derived view of the ACTIVE tab — backs hot-exit/save/LSP paths written against
// a single-editor shape ({path, instance, dirty}) while storage stays multi-tab.
const editorState = {
  get path() { return activeTab; },
  get instance() { return monacoInstance.editor && activeTab ? monacoInstance.editor : null; },
  get dirty() { const t = editorTabs.find(x => x.path === activeTab); return t ? t.dirty : false; },
  set dirty(v) { const t = editorTabs.find(x => x.path === activeTab); if (t) { t.dirty = v; renderTabBar(); $('#save-file').disabled = !v; } },
};

function loadMonaco(cb) {
  if (window.__monacoReady) return cb();
  window.addEventListener('monaco-ready', () => cb(), { once: true });
}

function getExtLang(path) {
  const ext = path.split('.').pop().toLowerCase();
  return { js:'javascript', mjs:'javascript', ts:'typescript', json:'json', css:'css', html:'html', md:'markdown', py:'python' }[ext] || 'plaintext';
}

function renderTabBar() {
  const bar = $('#tab-bar');
  if (!bar) return;
  bar.innerHTML = editorTabs.map(t =>
    `<div class="tab${t.path === activeTab ? ' active' : ''}${t.dirty ? ' dirty' : ''}" data-tab="${esc(t.path)}">${esc(t.path.split('/').pop())}<span class="tab-close" data-close="${esc(t.path)}">×</span></div>`
  ).join('');
  bar.querySelectorAll('[data-tab]').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.classList.contains('tab-close')) return;
      switchToTab(el.dataset.tab);
    });
  });
  bar.querySelectorAll('[data-close]').forEach(el => {
    el.addEventListener('click', e => { e.stopPropagation(); closeTab(el.dataset.close); });
  });
}

function switchToTab(path) {
  const tab = editorTabs.find(t => t.path === path);
  if (!tab || !monacoInstance.editor) return;
  monacoInstance.editor.setModel(tab.model);
  activeTab = path;
  $('#save-file').disabled = !tab.dirty;
  $('#open-file-name').textContent = path.split('/').pop();
  lspMaybeOpen(path, tab.model.getValue());
  renderTabBar();
}

function closeTab(path) {
  const idx = editorTabs.findIndex(t => t.path === path);
  if (idx < 0) return;
  const wasActive = activeTab === path;
  editorTabs[idx].model.dispose();
  editorTabs.splice(idx, 1);
  if (wasActive && editorTabs.length) {
    switchToTab(editorTabs[Math.max(0, idx - 1)].path);
  } else if (!editorTabs.length) {
    monacoInstance.editor.setModel(null);
    activeTab = null;
    $('#open-file-name').textContent = 'WORKBENCH';
    $('#save-file').disabled = true;
  }
  renderTabBar();
}

function openInEditor(path, content) {
  loadMonaco(() => {
    const container = $('#editor-container');
    if (!monacoInstance.editor) {
      monacoInstance.editor = monaco.editor.create(container, { value: '', language: 'plaintext', theme: 'vs-dark', automaticLayout: true, minimap: { enabled: false }, fontSize: 12 });
      monacoInstance.editor.onDidChangeModelContent(() => {
        const tab = editorTabs.find(t => t.path === activeTab);
        if (tab && !tab.dirty) { tab.dirty = true; renderTabBar(); $('#save-file').disabled = false; }
        clearTimeout(lspChangeDebounce);
        lspChangeDebounce = setTimeout(() => {
          const version = (lspState.versions.get(activeTab) || 0) + 1;
          lspState.versions.set(activeTab, version);
          lspNotify('textDocument/didChange', { textDocument: { uri: LSP_URI(activeTab), version }, contentChanges: [{ text: monacoInstance.editor.getValue() }] });
        }, 400);
      });
    }
    // Already open? Just switch to it.
    const existing = editorTabs.find(t => t.path === path);
    if (existing) { switchToTab(path); return; }
    const model = monaco.editor.createModel(content, getExtLang(path));
    editorTabs.push({ path, model, dirty: false });
    monacoInstance.editor.setModel(model);
    activeTab = path;
    $('#open-file-name').textContent = path.split('/').pop();
    lspMaybeOpen(path, content);
    renderTabBar();
  });
}

let lspChangeDebounce = null;

async function saveCurrentFile() {
  if (!editorState.path || !editorState.instance || !editorState.dirty) return;
  setStrip(`Saving ${editorState.path}…`);
  try {
    if (formatOnSave && FORMAT_LANGS.has(editorState.path.split('.').pop().toLowerCase())) {
      await formatActiveDocument();
    }
    const r = await fetch(`${API}/api/file/write`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: editorState.path, content: editorState.instance.getValue(), approved: true })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    editorState.dirty = false;
    $('#save-file').disabled = true;
    $('#open-file-name').textContent = editorState.path;
    threadMsg('system', `Saved ${j.path} (${j.bytes} bytes).`);
    setStrip('Saved. Rail verification refreshes.');
    refreshRail();
  } catch (e) {
    threadMsg('error', `Save failed: ${e.message}`);
    setStrip('Save failed — see the error card.');
  }
}

$('#save-file').addEventListener('click', saveCurrentFile);

const TREE_SKIP = new Set(['node_modules','.git','dist','build','assets','academy','.aide','logs','legacy-shell-backup','desktop','skills','training','benchmarks','capsules','community','plugins','providers','session','tasks','editor','artifacts','harness','blueprint','debuggers','languages']);

async function loadTree() {
  try {
    const res = await jget(`${API}/api/workspace/tree`);
    const tree = $('#file-tree');
    const render = (nodes, depth) => nodes.filter(n => n.kind !== 'directory' || !TREE_SKIP.has(n.name)).map(n => {
      if (n.kind === 'directory') {
        return `<div class="tree-dir" style="padding-left:${depth * 12}px">${esc(n.name)}/</div>` + render(n.children || [], depth + 1);
      }
      return `<div class="tree-file" data-path="${esc(n.path)}" style="padding-left:${depth * 12}px">${esc(n.name)}</div>`;
    }).join('');
    tree.innerHTML = render(res.tree || [], 0);
    tree.querySelectorAll('[data-path]').forEach(el => {
      el.onclick = async () => {
        try {
          const f = await jget(`${API}/api/file?path=${encodeURIComponent(el.dataset.path)}`);
          if (f.too_large) return threadMsg('system', `${f.path} is too large to open here.`);
          openInEditor(f.path, f.content ?? '');
        } catch (e) { threadMsg('error', `Open failed: ${e.message}`); }
      };
    });
  } catch { $('#file-tree').innerHTML = '<span class="muted small">tree unavailable</span>'; }
}

// ---------- E2: LSP -> Monaco bridge ----------
const lspState = { started: false, versions: new Map(), opened: new Set(), pollTimer: null };
const LSP_URI = path => `file:///workspace/${path}`;
const LSP_LANGS = new Set(['javascript', 'typescript']);

function lspPosition(model, position) {
  return { line: position.lineNumber - 1, character: position.column - 1 };
}

async function ensureLsp() {
  if (lspState.started) return true;
  try {
    const r = await fetch(`${API}/api/lsp/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'typescript' })
    });
    lspState.started = r.ok;
    return lspState.started;
  } catch { return false; }
}

async function lspNotify(method, params) {
  if (!lspState.started) return;
  try {
    await fetch(`${API}/api/lsp/notify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'typescript', message: { method, params } })
    });
  } catch { /* best-effort notifications */ }
}

async function lspRequest(method, params, attempt = 0) {
  if (!await ensureLsp()) return null;
  try {
    const r = await fetch(`${API}/api/lsp/request`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'typescript', message: { method, params } })
    });
    const j = await r.json();
    // Open-in-flight race: one retry after 800ms (protocols skill note).
    if (!j.result && attempt === 0 && /not open/i.test(JSON.stringify(j))) {
      await new Promise(res => setTimeout(res, 800));
      return lspRequest(method, params, 1);
    }
    return j.result ?? null;
  } catch { return null; }
}

function lspMaybeOpen(path, content) {
  const lang = path.split('.').pop().toLowerCase();
  if (!LSP_LANGS.has(lang)) return;
  ensureLsp().then(ok => {
    if (!ok) return;
    const uri = LSP_URI(path);
    const version = (lspState.versions.get(path) || 0) + 1;
    lspState.versions.set(path, version);
    if (!lspState.opened.has(uri)) {
      lspState.opened.add(uri);
      lspNotify('textDocument/didOpen', { textDocument: { uri, languageId: 'typescript', version, text: content } });
    } else {
      lspNotify('textDocument/didChange', { textDocument: { uri, version }, contentChanges: [{ text: content }] });
    }
  });
}

let lspChangeTimer = null;

function wireEditorLsp() {
  loadMonaco(() => {
    for (const lang of ['javascript', 'typescript']) {
      monaco.languages.registerHoverProvider(lang, {
        provideHover: async (model, position) => {
          const result = await lspRequest('textDocument/hover', {
            textDocument: { uri: LSP_URI(editorState.path || '') },
            position: lspPosition(model, position)
          });
          if (!result?.contents) return null;
          const value = Array.isArray(result.contents)
            ? result.contents.map(c => typeof c === 'string' ? c : c.value).join('\n\n')
            : (result.contents.value || '');
          if (!value.trim()) return null;
          return { contents: [{ value: esc(value) }] };
        }
      });
      monaco.languages.registerDefinitionProvider(lang, {
        provideDefinition: async (model, position) => {
          const result = await lspRequest('textDocument/definition', {
            textDocument: { uri: LSP_URI(editorState.path || '') },
            position: lspPosition(model, position)
          });
          if (!result) return null;
          const defs = Array.isArray(result) ? result : [result];
          for (const def of defs) {
            const targetPath = decodeURIComponent((def.uri || '').replace('file:///workspace/', ''));
            if (targetPath && targetPath !== editorState.path) {
              try {
                const f = await jget(`${API}/api/file?path=${encodeURIComponent(targetPath)}`);
                openInEditor(f.path ?? targetPath, f.content ?? '');
                editorState.instance.revealLineInCenter(def.range.start.line + 1);
                return null;
              } catch { /* fall through to location rendering */ }
            }
            return {
              range: new monaco.Range(def.range.start.line + 1, def.range.start.character + 1, def.range.end.line + 1, def.range.end.character + 1),
              uri: monaco.Uri.parse(def.uri)
            };
          }
          return null;
        }
      });
      monaco.languages.registerCompletionItemProvider(lang, {
        triggerCharacters: ['.', '"', "'"],
        provideCompletionItems: async (model, position) => {
          const result = await lspRequest('textDocument/completion', {
            textDocument: { uri: LSP_URI(editorState.path || '') },
            position: lspPosition(model, position)
          });
          const items = Array.isArray(result) ? result : result?.items || [];
          const word = model.getWordUntilPosition(position);
          const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
          return {
            suggestions: items.slice(0, 60).map(item => ({
              label: item.label,
              kind: monaco.languages.CompletionItemKind.Field,
              insertText: item.insertText || item.label,
              range
            }))
          };
        }
      });
    }

    lspState.pollTimer = setInterval(async () => {
      if (!editorState.path) return;
      try {
        const d = await jget(`${API}/api/diagnostics`);
        const model = editorState.model;
        if (!model) return;
        const mine = (d.diagnostics || []).filter(x => (x.uri || '').endsWith(editorState.path));
        const SEV = { 1: monaco.MarkerSeverity.Error, 2: monaco.MarkerSeverity.Warning, 3: monaco.MarkerSeverity.Info, 4: monaco.MarkerSeverity.Hint };
        monaco.editor.setModelMarkers(model, 'aide.lsp', mine.map(x => ({
          message: x.message,
          severity: SEV[x.severity] || monaco.MarkerSeverity.Info,
          startLineNumber: (x.range?.start?.line ?? 0) + 1,
          startColumn: (x.range?.start?.character ?? 0) + 1,
          endLineNumber: (x.range?.end?.line ?? 0) + 1,
          endColumn: (x.range?.end?.character ?? 1) + 1
        })));
      } catch { /* diagnostics best-effort */ }
    }, 5000);
  });
}

wireEditorLsp();

// Provenance-lite: file paths (optionally :line) mentioned in replies become
// clickable navigation into the workbench. Applied AFTER escaping; tokens are
// validated against the tree cache before becoming links.
function linkifySources(escapedText) {
  return escapedText.replace(/([\w./-]+\.(?:js|mjs|ts|json|css|html|md))(?::(\d+))?/g, (match, path, line) => {
    if (!treeCache.files.includes(path)) return match;
    return `<span class="src-ref" data-path="${path}" data-line="${line || 1}">${match}</span>`;
  });
}

document.addEventListener('click', e => {
  const ref = e.target.closest && e.target.closest('.src-ref');
  if (!ref) return;
  const path = ref.dataset.path;
  fetchAndOpen(path).then(() => {
    const line = Number(ref.dataset.line);
    if (line > 1 && editorState.instance) {
      editorState.instance.revealLineInCenter(line);
      editorState.instance.setPosition({ lineNumber: line, column: 1 });
    }
  });
});

let lastIntent = '';

$('#ship-button').addEventListener('click', openShipPanel);

async function openShipPanel() {
  const panel = $('#ship-panel');
  panel.hidden = !panel.hidden;
  if (panel.hidden) return;
  $('#ship-result').textContent = '';
  await refreshShipFiles();
}

async function refreshShipFiles() {
  try {
    const g = await jget(`${API}/api/git/status`);
    const files = (g.files || []).filter(f => f.status !== 'untracked' || true);
    const box = $('#ship-files');
    if (!files.length) { box.innerHTML = '<span class="muted small">Working tree clean — nothing to ship.</span>'; return; }
    box.innerHTML = files.map((f, i) => {
      const p = f.path || f;
      const st = f.status ? ` [${String(f.status).slice(0,1).toUpperCase()}]` : '';
      return `<label class="ship-file"><input type="checkbox" checked data-ship="${esc(p)}"> <span>${esc(p)}</span><span class="engine-meta">${st}</span></label>`;
    }).join('');
    if (!lastIntent) lastIntent = 'chore: workspace updates via AIDE cockpit';
    $('#ship-message').value = $('#ship-message').value || suggestMessage(files);
  } catch (e) {
    $('#ship-files').innerHTML = `<span class="muted small">git status unavailable: ${esc(e.message)}</span>`;
  }
}

function suggestMessage(files) {
  const count = files.length;
  const kinds = { M: 'fix', A: 'feat', '?': 'chore', D: 'chore' };
  const type = files.every(f => (f.status || '').startsWith('?')) ? 'chore' : 'update';
  return `${type}: ${count} file${count === 1 ? '' : 's'} updated via AIDE cockpit`;
}

$('#ship-cancel').addEventListener('click', () => { $('#ship-panel').hidden = true; });

$('#ship-commit').addEventListener('click', async () => {
  const message = $('#ship-message').value.trim();
  if (!message) { $('#ship-result').textContent = 'Commit message required.'; return; }
  const paths = [...document.querySelectorAll('#ship-files input[data-ship]:checked')].map(cb => cb.dataset.ship);
  if (!paths.length) { $('#ship-result').textContent = 'No files selected.'; return; }
  const trailer = $('#ship-trailer').checked ? '\n\nAssisted-by: AIDE harness ' + HARNESS_VERSION_LABEL : '';
  const finalMessage = message + trailer;
  $('#ship-commit').disabled = true;
  setStrip('Staging and committing your approved changes…');
  try {
    const s = await fetch(`${API}/api/git/stage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths, approved: true })
    });
    if (!s.ok) { const sj = await s.json().catch(() => ({})); throw new Error(sj.error || `stage HTTP ${s.status}`); }
    const c = await fetch(`${API}/api/git/commit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: finalMessage, approved: true, intent: lastIntent || undefined })
    });
    const cj = await c.json().catch(() => ({}));
    if (!c.ok) throw new Error(cj.error || `commit HTTP ${c.status}`);
    threadMsg('engine', `Shipped: committed ${paths.length} file(s). Audit trail in git history.`);
    $('#ship-panel').hidden = true;
    refreshRail();
    refreshEngineList && null;
    setStrip('Shipped locally. Push stays a separate, explicit action.');
    loadTree();
  } catch (e) {
    $('#ship-result').textContent = `Ship failed: ${e.message}`;
    setStrip('Ship failed — see the panel for details.');
  } finally {
    $('#ship-commit').disabled = false;
  }
});

const HARNESS_VERSION_LABEL = 'v2.1.0';

// ---------- E1 power surface: palette / global search / terminal ----------
const COMMANDS = [
  { label: 'Open Models panel', kw: 'models hub engines download import tuning', run: () => { $('#models-panel').hidden = false; refreshEngineList(); } },
  { label: 'Telegram bridge setup', kw: 'telegram bot remote phone bridge connect token', run: openTelegramPanel },
  { label: 'Desktop control (grants & panic)', kw: 'desktop control grants panic allow apps files windows permission', run: openDesktopPanel },
  { label: 'Find in workspace', kw: 'search find files grep', run: () => { $('#search-overlay').hidden = false; $('#gs-query').focus(); } },
  { label: 'Toggle terminal drawer', kw: 'terminal shell console run command', run: toggleTerminal },
  { label: 'Stop running engine', kw: 'stop engine kill model memory', run: () => $('#stop-engine').click() },
  { label: 'Open SHIP review', kw: 'ship commit stage git changes', run: () => { if (!$('#editor-slot').hidden) openShipPanel(); else threadMsg('system', 'Start an engine and make a change first — nothing to ship yet.'); } },
  { label: 'Open help', kw: 'help guide how works getting started', run: () => { $('#help-panel').hidden = false; } }
];

let treeCache = { at: 0, files: [] };
async function fileList() {
  if (Date.now() - treeCache.at > 60000) {
    try {
      const res = await jget(`${API}/api/workspace/tree`);
      const flat = [];
      (function walk(nodes) { for (const n of nodes || []) { if (n.kind === 'directory') walk(n.children); else flat.push(n.path); } })(res.tree || []);
      treeCache = { at: Date.now(), files: flat };
    } catch { return treeCache.files; }
  }
  return treeCache.files;
}

function fuzzyScore(needle, hay) {
  needle = needle.toLowerCase(); hay = hay.toLowerCase();
  if (!needle) return 1;
  let score = 0, idx = 0, streak = 0;
  for (const ch of needle) {
    const found = hay.indexOf(ch, idx);
    if (found === -1) return -1;
    streak = found === idx ? streak + 1 : 0;
    score += 1 + streak + (found === 0 || /[\W_]/.test(hay[found - 1] || '') ? 2 : 0);
    idx = found + 1;
  }
  return score;
}

let cmdkActive = -1;
function renderCmdk(query) {
  const box = $('#cmdk-results');
  const commandsOnly = query.startsWith('>');
  const q = commandsOnly ? query.slice(1).trim() : query.trim();
  let rows = [];
  if (commandsOnly) {
    rows = COMMANDS.filter(c => fuzzyScore(q, c.label + ' ' + c.kw) >= 0).map(c => ({ type: 'cmd', label: c.label }));
  } else {
    rows = COMMANDS.filter(c => fuzzyScore(q, c.label + ' ' + c.kw) >= 0).map(c => ({ type: 'cmd', label: c.label }));
    const files = treeCache.files.filter(f => fuzzyScore(q, f) >= 0)
      .sort((a, b) => fuzzyScore(q, b) - fuzzyScore(q, a)).slice(0, 12)
      .map(f => ({ type: 'file', label: f }));
    rows = [...rows.slice(0, 8), ...files];
  }
  box.innerHTML = rows.map((r, i) => `<div class="cmdk-item${i === 0 ? ' active' : ''}" data-i="${i}"><span class="engine-meta">${r.type.toUpperCase()}</span> ${esc(r.label)}</div>`).join('') || '<span class="muted small">No matches.</span>';
  cmdkActive = 0;
  box.querySelectorAll('.cmdk-item').forEach(el => el.onclick = () => execCmdk(rows[Number(el.dataset.i)]));
  box._rows = rows;
}

function execCmdk(row) {
  $('#command-palette').hidden = true;
  if (row.type === 'cmd') row.run();
  else fetchAndOpen(row.label);
}

async function fetchAndOpen(path) {
  try {
    const f = await jget(`${API}/api/file?path=${encodeURIComponent(path)}`);
    if (f.too_large) return threadMsg('system', `${path} is too large to open here.`);
    openInEditor(f.path ?? path, f.content ?? '');
  } catch (e) { threadMsg('error', `Open failed: ${e.message}`); }
}

$('#cmdk-input').addEventListener('input', e => renderCmdk(e.target.value));
$('#cmdk-input').addEventListener('keydown', e => {
  const items = [...document.querySelectorAll('#cmdk-results .cmdk-item')];
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!items.length) return;
    cmdkActive = (cmdkActive + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
    items.forEach((el, i) => el.classList.toggle('active', i === cmdkActive));
    items[cmdkActive].scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    e.preventDefault();
    items[cmdkActive]?.click();
  } else if (e.key === 'Escape') {
    $('#command-palette').hidden = true;
  }
});

document.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'k') { e.preventDefault(); (async () => { await fileList(); $('#command-palette').hidden = false; $('#cmdk-input').value = ''; renderCmdk(''); $('#cmdk-input').focus(); })(); }
  else if ((e.ctrlKey || e.metaKey) && e.shiftKey && k === 'f') { e.preventDefault(); $('#search-overlay').hidden = false; $('#gs-query').focus(); }
  else if ((e.ctrlKey || e.metaKey) && k === '`') { e.preventDefault(); toggleTerminal(); }
  else if (e.key === 'Escape') {
    const overlays = ['help-panel','models-panel','command-palette','search-overlay','git-sheet','skills-panel','plugins-panel','telegram-panel','desktop-panel'];
    for (const id of overlays) {
      const el = document.getElementById(id);
      if (el && !el.hidden) { el.hidden = true; break; }
    }
  }
});

// ---------- Global search ----------
$('#gs-go').addEventListener('click', runGlobalSearch);
$('#gs-query').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); runGlobalSearch(); } });

async function runGlobalSearch() {
  const q = $('#gs-query').value.trim();
  const box = $('#gs-results');
  if (!q) return;
  box.innerHTML = '<span class="muted small">Searching…</span>';
  $('#gs-replace-all').disabled = true;
  try {
    const res = await jget(`${API}/api/search?q=${encodeURIComponent(q)}&icase=1`);
    window.__lastSearch = res;
    const MAX_FILES = 40, MAX_HITS = 8;
    const files = (res.results || []).slice(0, MAX_FILES);
    box.innerHTML = files.length
      ? files.map(f => `<div class="gs-file"><b>${esc(f.path)}</b>${f.hits.slice(0, MAX_HITS).map(h => `<div class="gs-hit" data-path="${esc(f.path)}" data-line="${h.line}"><span class="engine-meta">L${h.line}</span> ${esc(h.text.slice(0, 160))}</div>`).join('')}${f.hits.length > MAX_HITS ? `<div class="muted small">…${f.hits.length - MAX_HITS} more</div>` : ''}</div>`).join('')
      : '<span class="muted small">No matches.</span>';
    $('#gs-replace-all').disabled = files.length === 0;
    box.querySelectorAll('.gs-hit').forEach(hit => hit.onclick = async () => {
      const path = hit.dataset.path, line = Number(hit.dataset.line);
      try {
        const f = await jget(`${API}/api/file?path=${encodeURIComponent(path)}`);
        if (!f.too_large) { openInEditor(f.path ?? path, f.content ?? ''); editorState.instance?.revealLineInCenter(Math.min(line, editorState.instance.getModel().getLineCount())); editorState.instance?.setPosition({ lineNumber: line, column: 1 }); }
      } catch {}
    });
    setStrip(`Search: ${res.total} hits in ${res.results.length} files${res.results.length > MAX_FILES ? ` (showing first ${MAX_FILES})` : ''}. Replace-all is approval-gated.`);
  } catch (e) { box.innerHTML = `<span class="muted small">Search failed: ${esc(e.message)}</span>`; }
}

$('#gs-replace-all').addEventListener('click', async () => {
  const q = $('#gs-query').value.trim();
  const replacement = $('#gs-replace').value;
  const last = window.__lastSearch;
  if (!q || !last || !last.results.length) return;
  const fileCount = last.results.length;
  if (!confirm(`Replace ALL "${q}" with "${replacement || '(empty)'}" across ${fileCount} file(s)? This rewrites files on disk.`)) return;
  setStrip('Replacing across workspace (approval granted)…');
  try {
    const r = await fetch(`${API}/api/search/replace`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q, replacement, approved: true, icase: true })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    threadMsg('system', `Replaced ${j.occurrences} occurrence(s) in ${j.filesChanged} file(s).`);
    await runGlobalSearch();
    refreshRail();
  } catch (e) {
    threadMsg('error', `Replace failed: ${e.message}`);
  }
});

// ---------- Terminal drawer ----------
let termLines = [];
function termPrint(text, cls) {
  termLines.push(`<div class="term-line ${cls || ''}">${esc(text)}</div>`);
  const out = $('#term-out');
  out.innerHTML = termLines.slice(-300).join('');
  out.scrollTop = out.scrollHeight;
}
function toggleTerminal(force) {
  const d = $('#terminal-drawer');
  const show = force !== undefined ? force : d.hidden;
  d.hidden = !show;
  if (show && !termLines.length) termPrint('Cockpit terminal v1 — one-shot commands with output. Long-running processes: coming with TASKS.', 'muted');
}
$('#term-toggle').addEventListener('click', () => toggleTerminal());
$('#term-close').addEventListener('click', () => toggleTerminal(false));
$('#term-clear').addEventListener('click', () => { termLines = []; $('#term-out').innerHTML = ''; });

function splitArgs(s) {
  const out = []; let cur = '', q = null;
  for (const ch of s) {
    if (q) { if (ch === q) q = null; else cur += ch; }
    else if (ch === '"' || ch === "'") q = ch;
    else if (/\s/.test(ch)) { if (cur) { out.push(cur); cur = ''; } }
    else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

$('#term-form').addEventListener('submit', async e => {
  e.preventDefault();
  const raw = $('#term-input').value.trim();
  if (!raw) return;
  $('#term-input').value = '';
  termPrint('> ' + raw, 'muted');
  const parts = splitArgs(raw);
  try {
    const r = await fetch(`${API}/api/terminal/run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ program: parts[0], args: parts.slice(1), approved: true })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    const text = [j.stdout, j.stderr].filter(Boolean).join('\n').trim();
    termPrint(text || `(no output, exit ${j.code ?? 0})`, j.code ? 'msg error' : '');
    setStrip(`Terminal: exit ${j.code ?? 0}.`);
  } catch (e2) {
    termPrint(`failed: ${e2.message}`, 'msg error');
  }
});

// ---------- Git sheet: branches, history, consented push ----------
$('#git-badge').addEventListener('click', openGitSheet);

async function openGitSheet() {
  $('#git-sheet').hidden = false;
  try {
    const b = await jget(`${API}/api/git/branches`);
    const sel = $('#git-branch-select');
    sel.innerHTML = b.branches.map(br => `<option${br === b.current ? ' selected' : ''}>${esc(br)}</option>`).join('');
  } catch { /* status fallback below */ }
  await refreshGitSheet();
}

async function refreshGitSheet() {
  try {
    const s = await jget(`${API}/api/git/status`);
    $('#git-ab').textContent = `${s.branch || '?'} · ahead ${s.ahead ?? 0} · behind ${s.behind ?? 0} · ${s.files.length} change(s)`;
    $('#git-push').disabled = !(Number(s.ahead) > 0);
    $('#push-note').textContent = Number(s.ahead) > 0
      ? `Push uploads ${s.ahead} commit(s) to ${s.tracking || 'origin'} — one logged network call.`
      : 'Nothing to push — local branch is in sync.';
  } catch {}
  try {
    const l = await jget(`${API}/api/git/log?n=30`);
    const commits = l.commits || [];
    $('#git-history').innerHTML = commits.map(c =>
      `<div class="cmdk-item"><b>${esc(c.hash)}</b> ${esc(c.subject)}<span class="engine-meta">${esc((c.date || '').slice(0, 16))}</span></div>`
    ).join('') || '<span class="muted small">No commits yet.</span>';
    // DORA rework signal v0: revert-style subjects within the recent window.
    const reworks = commits.filter(c => /^(revert|Revert )|^(fix|chore):.*\brevert\b/i.test(c.subject)).length;
    let ab = $('#git-ab');
    const base = ab.textContent.split(' · rework')[0];
    ab.textContent = base + (reworks ? ` · rework ${reworks}` : '');
    if (reworks >= 2) { ab.textContent += ' ⚠'; }
  } catch { /* leave previous */ }
}

$('#git-switch').addEventListener('click', async () => {
  const branch = $('#git-branch-select').value;
  if (!branch) return;
  setStrip(`Switching to ${branch}…`);
  try {
    await fetch(`${API}/api/git/checkout`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch })
    }).then(async r => { if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `HTTP ${r.status}`); } });
    threadMsg('system', `Switched to branch ${branch}.`);
    refreshRail();
    refreshGitSheet();
  } catch (e) {
    threadMsg('error', `Checkout failed: ${e.message}`);
    setStrip('Branch switch failed — commit your changes first.');
  }
});

$('#git-push').addEventListener('click', async () => {
  if (!confirm('Push commits to the remote? This makes one network call.')) return;
  $('#push-note').textContent = 'Pushing…';
  try {
    const r = await fetch(`${API}/api/git/push`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved: true })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    threadMsg('system', 'Pushed to remote.');
    $('#push-note').textContent = 'Pushed.';
    refreshRail();
  } catch (e) {
    $('#push-note').textContent = `Push failed: ${e.message}`;
  }
});

$('#git-close').addEventListener('click', () => { $('#git-sheet').hidden = true; });

// ---------- Skills browser (in-box SOP packs) ----------
let skillsData = null;
// ---------- Telegram bridge panel (monthly setup; palette entry) ----------
async function openTelegramPanel() {
  $('#telegram-panel').hidden = false;
  await renderTelegramPanel();
}

async function renderTelegramPanel() {
  const body = $('#tg-body');
  let status;
  try { status = await jget(`${API}/api/telegram/status`); }
  catch (e) { body.textContent = `bridge unreachable: ${e.message}`; return; }
  body.hidden = true;
  $('#tg-connect').hidden = true;
  $('#tg-authorize').hidden = true;
  $('#tg-live').hidden = true;
  if (!status.connected) {
    $('#tg-connect').hidden = false;
    $('#tg-connect-btn').onclick = async () => {
      $('#tg-connect-err').textContent = '';
      try {
        await jpost(`${API}/api/telegram/connect`, { token: $('#tg-token').value.trim() });
        setStrip(`Telegram bot connected — send it a message to finish.`);
        await renderTelegramPanel();
      } catch (e) { $('#tg-connect-err').textContent = String(e.message).slice(0, 120); }
    };
    return;
  }
  if (!status.chat_ids.length) {
    $('#tg-authorize').hidden = false;
    $('#tg-seen').innerHTML = status.seen_chats.length
      ? status.seen_chats.map(c =>
        `<div style="margin:4px 0"><button class="primary" data-tg-auth="${c.chat_id}">AUTHORIZE</button> <span class="small">${esc(c.first_name || 'chat')} · id ${c.chat_id}</span></div>`).join('')
      : '<span class="muted small">No messages seen yet — press START on your bot, then send hello.</span>';
    body.hidden = false;
    body.querySelectorAll('[data-tg-auth]').forEach(btn => {
      btn.onclick = async () => {
        await jpost(`${API}/api/telegram/authorize`, { chat_id: Number(btn.dataset.tgAuth) });
        await renderTelegramPanel();
      };
    });
    return;
  }
  $('#tg-live').hidden = false;
  $('#tg-statusline').textContent = `@${status.bot_username} · ${status.poll_cycles} poll cycles · last ${(status.last_poll_at || '—').slice(11, 19)} UTC`;
  $('#tg-chats').textContent = `Authorized chats: ${status.chat_ids.join(', ')}`;
  $('#tg-disconnect').onclick = async () => {
    if (!confirm('Disconnect the Telegram bridge?')) return;
    await jpost(`${API}/api/telegram/disconnect`, {});
    await renderTelegramPanel();
  };
}

// ---------- Desktop control panel (monthly surface; palette entry) ----------
async function openDesktopPanel() {
  $('#desktop-panel').hidden = false;
  await renderDesktopPanel();
}

async function renderDesktopPanel() {
  const body = $('#desktop-body');
  let status;
  try { status = await jget(`${API}/api/desktop/status`); }
  catch (e) { body.textContent = `desktop service unreachable: ${e.message}`; return; }
  body.hidden = true;
  $('#dc-wizard').hidden = true;
  $('#dc-active').hidden = true;
  if (!status.enabled) {
    $('#dc-wizard').hidden = false;
    $('#dc-enable').onclick = async () => {
      const apps = $('#dc-apps').value.split(',').map(s => s.trim()).filter(Boolean);
      const roots = $('#dc-roots').value.split(',').map(s => s.trim()).filter(Boolean);
      const titles = $('#dc-titles').value.split(',').map(s => s.trim()).filter(Boolean);
      const ttl = Math.max(1, Math.min(720, Number($('#dc-ttl').value) || 30));
      try {
        await jpost(`${API}/api/desktop/grants`, { enabled: true, grants: { apps, roots, window_titles: titles }, ttl_minutes: ttl });
        setStrip(`Desktop control enabled for ${ttl} min — ${apps.length} app(s), ${roots.length} folder(s).`);
        await renderDesktopPanel();
      } catch (e) { threadMsg('error', `desktop grants rejected: ${e.message}`); }
    };
    return;
  }
  // ENABLED state — live status + panic
  const g = status.grants || {};
  const minsLeft = status.session_started_at ? Math.max(0, Math.ceil(status.ttl_minutes - (Date.now() - new Date(status.session_started_at).getTime()) / 60000)) : '?';
  $('#dc-active').hidden = false;
  $('#dc-statusline').textContent = `${minsLeft} min left in session · ${status.tracked_children} tracked process(es)${status.panicked ? ' · PANICKED' : ''}`;
  $('#dc-grants-summary').innerHTML =
    `<b>Apps:</b> ${(g.apps || []).map(a => esc(a)).join(', ') || '—'}<br>` +
    `<b>Folders:</b> ${(g.roots || []).map(r => esc(r)).join(', ') || '—'}<br>` +
    `<b>Windows:</b> ${(g.window_titles || []).map(t => esc(t)).join(', ') || '—'}`;
  $('#dc-panic').onclick = async () => {
    if (!confirm('PANIC revokes all desktop grants immediately and kills any processes AIDE started. Continue?')) return;
    const p = await jpost(`${API}/api/desktop/panic`, {});
    setStrip(`Desktop PANIC — grants revoked in ${p.latency_ms} ms.`);
    await renderDesktopPanel();
  };
  $('#dc-disable').onclick = async () => {
    await jpost(`${API}/api/desktop/grants`, { enabled: false, grants: { apps: [], roots: [], window_titles: [] }, ttl_minutes: 1 });
    setStrip('Desktop control disabled.');
    await renderDesktopPanel();
  };
  // Pending executor approvals (T2 seam): render + poll while panel is open.
  const pendBlock = $('#dc-pending-block');
  const pendList = $('#dc-pending-list');
  const pending = status.pending_approvals || [];
  if (!pending.length) {
    pendBlock.hidden = true;
  } else {
    pendBlock.hidden = false;
    pendList.innerHTML = pending.map(p =>
      `<div style="margin:6px 0;padding:8px;border:1px solid #333;background:#0d0d0d">` +
      `<span class="badge ${p.class === 'DESTRUCTIVE' ? 'warn' : 'on'}">${esc(p.class)}</span> ` +
      `<code class="small">${esc(p.action_raw)}</code><br>` +
      `<button class="primary" data-dc-res="${esc(p.approval_id)}" data-dc-decision="approve" style="margin-top:6px">APPROVE</button> ` +
      `<button data-dc-res="${esc(p.approval_id)}" data-dc-decision="reject" style="background:#111;border:1px solid #a33;color:#ff9b9b;padding:6px 12px;font-family:var(--mono);cursor:pointer;margin-left:6px">REJECT</button>` +
      `</div>`).join('');
    pendList.querySelectorAll('[data-dc-res]').forEach(btn => {
      btn.onclick = async () => {
        await jpost(`${API}/api/desktop/pending/resolve`, { approval_id: btn.dataset.dcRes, decision: btn.dataset.dcDecision });
        setStrip(`Desktop action ${btn.dataset.dcDecision}d.`);
        await renderDesktopPanel();
      };
    });
  }
  clearInterval(dcPollTimer);
  dcPollTimer = setInterval(() => {
    if ($('#desktop-panel').hidden) { clearInterval(dcPollTimer); return; }
    jget(`${API}/api/desktop/status`).then(s => {
      const nowPending = (s.pending_approvals || []).length;
      if (nowPending !== pending.length) renderDesktopPanel();
    }).catch(() => {});
  }, 3000);
}
let dcPollTimer = null;

async function openSkillsPanel() {
  $('#skills-panel').hidden = false;
  if (!skillsData) {
    try { skillsData = await jget('/skills/registry.json'); }
    catch (e) { $('#skills-results').innerHTML = `<span class="muted small">registry unavailable: ${esc(e.message)}</span>`; return; }
    const cats = [...new Set(skillsData.skills.map(s => s.category))].sort();
    $('#skills-cat').innerHTML = '<option value="">ALL</option>' + cats.map(c => `<option>${esc(c)}</option>`).join('');
  }
  renderSkills();
}
function renderSkills() {
  const q = $('#skills-query').value.trim().toLowerCase();
  const cat = $('#skills-cat').value;
  const list = skillsData.skills.filter(s =>
    (!cat || s.category === cat) &&
    (!q || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q))
  );
  $('#skills-results').innerHTML = list.length
    ? list.map((s, i) => `<div class="cmdk-item" data-i="${i}"><b>${esc(s.name)}</b><span class="engine-meta">${esc(s.category)}</span><span class="muted small">${esc(s.description.slice(0, 110))}…</span></div>`).join('')
    : '<span class="muted small">No matches.</span>';
  boxBind(list);
  function boxBind(list2) {
    document.querySelectorAll('#skills-results .cmdk-item').forEach(el => el.onclick = () => {
      const s = list2[Number(el.dataset.i)];
      window.open(`/${s.path}`, '_blank');
    });
  }
}
$('#skills-button').addEventListener('click', openSkillsPanel);
$('#skills-close').addEventListener('click', () => { $('#skills-panel').hidden = true; });
$('#skills-query').addEventListener('input', renderSkills);
$('#skills-cat').addEventListener('change', renderSkills);

$('#delegation-toggle').addEventListener('click', () => {
  setDelegation(delegationMode === 'standard' ? 'strict' : 'standard');
  setStrip(`Delegation: ${delegationMode.toUpperCase()} — ${delegationMode === 'strict' ? 'every tool call asks you first.' : 'read-only tools run without asking; writes always ask.'}`);
});
$('#delegation-toggle').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#delegation-toggle').click(); } });

$('#fos-toggle').addEventListener('click', () => {
  formatOnSave = !formatOnSave;
  localStorage.setItem('aide.format_on_save', formatOnSave ? '1' : '0');
  const b = $('#fos-badge');
  b.textContent = formatOnSave ? 'ON' : 'OFF';
  b.className = 'badge ' + (formatOnSave ? 'on' : 'off');
  $('#fos-toggle').setAttribute('aria-pressed', formatOnSave ? 'true' : 'false');
});
$('#fos-toggle').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#fos-toggle').click(); } });

// ---------- Plugins surface v1 (declarative capability plugins) ----------
const PLUGIN_CONTRIBUTIONS = {
  'git-review': { label: 'Open GIT review', run: () => { if (!$('#editor-slot').hidden) openGitSheet(); else threadMsg('system', 'Start an engine first — git review lives in the workbench.'); } },
  'env-inspector': { label: 'Report runtime versions', run: () => { toggleTerminal(true); $('#term-input').value = 'node --version'; $('#term-form').dispatchEvent(new Event('submit')); } },
  'markdown-preview': { label: 'Preview active markdown', run: () => previewActiveMarkdown() }
};

function pluginTrusted(id) {
  return !!((window.__pluginState?.trust || {})[id]);
}

async function loadPluginsPanel() {
  try {
    const res = await jget(`${API}/api/plugins`);
    const presets = await jget(`${API}/api/plugins/presets`);
    window.__pluginState = { installed: res.plugins || [], catalog: (presets.presets || presets).filter(p => !p.installed) };
    renderPlugins();
  } catch (e) {
    $('#plugins-installed').innerHTML = `<span class="muted small">Plugin service unavailable: ${esc(e.message)}</span>`;
    $('#plugins-catalog').innerHTML = '';
  }
}

function renderPlugins() {
  const { installed, catalog } = window.__pluginState;
  const instEl = $('#plugins-installed');
  if (!installed.length) instEl.innerHTML = '<span class="muted small">No plugins installed yet — install from the catalog below.</span>';
  else instEl.innerHTML = installed.map(p => {
    if (p.invalid) return `<div class="hub-item"><b>${esc(p.id)}</b><span class="engine-meta">INVALID: ${esc(p.invalid)}</span></div>`;
    const trusted = p.trusted === true;
    const contribution = trusted && PLUGIN_CONTRIBUTIONS[p.id];
    return `<div class="hub-item"><b>${esc(p.name || p.id)}</b><span class="engine-meta">${(p.capabilities || []).join(', ')}</span>` +
      `<button data-trust="${esc(p.id)}" data-val="${!trusted}">${trusted ? 'TRUSTED' : 'UNTRUSTED'}</button>` +
      (contribution ? `<button data-open="${esc(p.id)}">${esc(contribution.label)}</button>` : '') +
      `</div>`;
  }).join('');
  $('#plugins-catalog').innerHTML = catalog.map(p =>
    `<div class="hub-item"><b>${esc(p.name)}</b><span class="muted small" style="flex:1">${esc(p.description)}</span><button data-install="${esc(p.id)}">INSTALL</button></div>`
  ).join('') || '<span class="muted small">All catalog plugins installed.</span>';

  document.querySelectorAll('[data-trust]').forEach(btn => btn.onclick = async () => {
    await fetch(`${API}/api/plugins/trust`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: btn.dataset.trust, trusted: btn.dataset.val === 'true' }) });
    loadPluginsPanel();
  });
  document.querySelectorAll('[data-install]').forEach(btn => btn.onclick = async () => {
    btn.disabled = true; btn.textContent = 'INSTALLING…';
    await fetch(`${API}/api/plugins/scaffold`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: btn.dataset.install, approved: true }) });
    loadPluginsPanel();
  });
  document.querySelectorAll('[data-open]').forEach(btn => btn.onclick = () => PLUGIN_CONTRIBUTIONS[btn.dataset.open]?.run());
}

$('#plugins-button').addEventListener('click', () => { $('#plugins-panel').hidden = false; loadPluginsPanel(); });
$('#plugins-close').addEventListener('click', () => { $('#plugins-panel').hidden = true; });
$('#telegram-close').addEventListener('click', () => { $('#telegram-panel').hidden = true; });
$('#desktop-close').addEventListener('click', () => { $('#desktop-panel').hidden = true; });
$('#plugins-panel').addEventListener('click', e => { if (e.target === e.currentTarget) $('#plugins-panel').hidden = true; });

function previewActiveMarkdown() {
  if (!editorState.path || !editorState.path.endsWith('.md')) return threadMsg('system', 'Open a .md file first, then preview.');
  const raw = editorState.instance.getValue();
  let html = esc(raw)
    .replace(/^### (.*)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*)$/gm, '<h2>$1</h2>')
    .replace(/^# (.*)$/gm, '<h1>$1</h1>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^- (.*)$/gm, '&bull; $1');
  const box = $('#diff-view');
  $('#editor-slot').hidden = false;
  box.hidden = false;
  box.innerHTML = `<div class="eyebrow">MARKDOWN PREVIEW (safe subset)</div><div class="md-preview">${html}</div>`;
}

// ---------- R1: Rename Symbol (F2) with previewed multi-file apply ----------
const renameState = { edits: null };

function uriToRel(uri) {
  let decoded = decodeURIComponent(uri);
  const marker = '/aide-sovereign-workbench/';
  const idx = decoded.indexOf(marker);
  if (idx === -1) return null;
  return decoded.slice(idx + marker.length);
}

function applyTextEditsToContent(content, edits) {
  const toOffset = (line, ch) => {
    const lines = content.split('\n');
    let offset = 0;
    for (let i = 0; i < Math.min(line, lines.length); i++) offset += lines[i].length + 1;
    return offset + ch;
  };
  const sorted = [...edits].sort((a, b) =>
    (b.range.start.line - a.range.start.line) || (b.range.start.character - a.range.start.character));
  for (const edit of sorted) {
    const start = toOffset(edit.range.start.line, edit.range.start.character);
    const end = toOffset(edit.range.end.line, edit.range.end.character);
    content = content.slice(0, start) + edit.newText + content.slice(end);
  }
  return content;
}

function startRenameFlow() {
  if (!editorState.instance || !editorState.path || !LSP_LANGS.has(editorState.path.split('.').pop().toLowerCase())) {
    return threadMsg('system', 'Rename works on open .ts/.js files.');
  }
  const model = editorState.instance.getModel();
  const position = editorState.instance.getPosition();
  const word = model.getWordAtPosition(position);
  if (!word) return threadMsg('system', 'Place the cursor on a symbol first.');
  $('#rename-card').hidden = false;
  $('#rename-preview').textContent = '';
  $('#rename-actions').hidden = true;
  $('#rename-input').value = word.word;
  $('#rename-input').focus();
  $('#rename-input').select();
}

$('#rename-go').addEventListener('click', runRenamePreview);
$('#rename-input').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); runRenamePreview(); } });

async function runRenamePreview() {
  const newName = $('#rename-input').value.trim();
  if (!newName || !editorState.path) return;
  const position = editorState.instance.getPosition();
  $('#rename-preview').textContent = 'Computing workspace edits…';
  try {
    const result = await lspRequest('textDocument/rename', {
      textDocument: { uri: LSP_URI(editorState.path) },
      position: lspPosition(editorState.instance.getModel(), position),
      newName
    });
    if (!result || !result.changes) { $('#rename-preview').textContent = 'Cannot rename this symbol here.'; return; }
    const grouped = Object.entries(result.changes).map(([uri, edits]) => ({ rel: uriToRel(uri), uri, edits }))
      .filter(g => g.rel !== null && g.edits.length);
    if (!grouped.length) { $('#rename-preview').textContent = 'Nothing to change.'; return; }
    renameState.edits = grouped;
    $('#rename-preview').innerHTML = grouped.map(g =>
      `<div class="hub-item"><b>${esc(g.rel)}</b><span class="engine-meta">${g.edits.length} edit(s)</span></div>`).join('') +
      `<div class="muted small">Review above — APPLY rewrites these files on disk. Git diff stays available for review.</div>`;
    $('#rename-actions').hidden = false;
  } catch (e) {
    $('#rename-preview').textContent = `Rename failed: ${e.message}`;
  }
}

$('#rename-approve').addEventListener('click', async () => {
  if (!renameState.edits) return;
  $('#rename-approve').disabled = true;
  setStrip('Applying approved rename…');
  const failures = [];
  for (const group of renameState.edits) {
    try {
      let content;
      if (editorState.path === group.rel && editorState.instance) content = editorState.instance.getValue();
      else content = (await jget(`${API}/api/file?path=${encodeURIComponent(group.rel)}`)).content ?? '';
      const updated = applyTextEditsToContent(content, group.edits);
      const w = await fetch(`${API}/api/file/write`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: group.rel, content: updated, approved: true })
      });
      if (!w.ok) { const wj = await w.json().catch(() => ({})); throw new Error(`${group.rel}: ${wj.error || w.status}`); }
      if (editorState.path === group.rel && editorState.model) {
        const pos = editorState.instance.getPosition();
        editorState.model.setValue(updated);
        editorState.instance.setPosition(pos);
        lspMaybeOpen(group.rel, updated);
      }
    } catch (e) {
      failures.push(e.message);
      break;
    }
  }
  $('#rename-approve').disabled = false;
  $('#rename-card').hidden = true;
  if (failures.length) {
    threadMsg('error', `Rename PARTIALLY applied — stopped at: ${failures[0]}`);
    setStrip('Rename incomplete — check git diff for current state.');
  } else {
    threadMsg('engine', `Renamed across ${renameState.edits.length} file(s). Git diff is available for review.`);
    setStrip('Rename applied. Review the diff, then SHIP when satisfied.');
    loadTree();
    refreshRail();
  }
  renameState.edits = null;
});
$('#rename-cancel').addEventListener('click', () => { $('#rename-card').hidden = true; renameState.edits = null; });

document.addEventListener('keydown', e => {
  if (e.key === 'F2' && editorState.instance && editorState.instance.hasTextFocus()) {
    e.preventDefault();
    startRenameFlow();
  }
});

// ---------- R2: Find All References + Format document/on-save ----------
function groupReferences(locations) {
  const byFile = new Map();
  for (const loc of locations || []) {
    const rel = uriToRel(loc.uri);
    if (rel === null) continue;
    if (!byFile.has(rel)) byFile.set(rel, []);
    byFile.get(rel).push({ line: loc.range.start.line + 1, character: loc.range.start.character + 1 });
  }
  return byFile;
}

document.addEventListener('keydown', e => {
  if (e.key === 'F12' && e.shiftKey && editorState.instance && editorState.instance.hasTextFocus()) {
    e.preventDefault();
    const model = editorState.instance.getModel();
    const position = editorState.instance.getPosition();
    threadMsg('system', `Finding references for "${model.getWordAtPosition(position)?.word || 'symbol'}"…`);
    lspRequest('textDocument/references', {
      textDocument: { uri: LSP_URI(editorState.path || '') },
      position: lspPosition(model, position),
      context: { includeDeclaration: true }
    }).then(result => {
      if (!result || !result.length) return threadMsg('system', 'No references found.');
      const grouped = groupReferences(result);
      $('#search-overlay').hidden = false;
      $('#gs-results').innerHTML = [...grouped.entries()].map(([path, hits]) =>
        `<div class="gs-file"><b>${esc(path)}</b>${hits.slice(0, 10).map(h =>
          `<div class="gs-hit" data-path="${esc(path)}" data-line="${h.line}"><span class="engine-meta">L${h.line}</span> reference</div>`).join('')}</div>`
      ).join('');
      $('#gs-results').querySelectorAll('.gs-hit').forEach(hit => hit.onclick = async () => {
        const f = await jget(`${API}/api/file?path=${encodeURIComponent(hit.dataset.path)}`);
        openInEditor(f.path ?? hit.dataset.path, f.content ?? '');
        editorState.instance?.revealLineInCenter(Number(hit.dataset.line));
      });
      setStrip(`References: ${result.length} location(s) across ${grouped.size} file(s).`);
    });
  }
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'i' && editorState.instance && editorState.instance.hasTextFocus()) {
    e.preventDefault();
    formatActiveDocument();
  }
});

const FORMAT_LANGS = new Set(['javascript', 'typescript', 'json', 'css', 'html']);
let formatOnSave = localStorage.getItem('aide.format_on_save') === '1';

async function formatActiveDocument() {
  if (!editorState.instance || !editorState.path) return false;
  const ext = editorState.path.split('.').pop().toLowerCase();
  const model = editorState.instance.getModel();
  if (['json', 'css', 'html'].includes(ext)) {
    await editorState.instance.getAction('editor.action.formatDocument').run();
    return true;
  }
  if (LSP_LANGS.has(ext)) {
    const edits = await lspRequest('textDocument/formatting', {
      textDocument: { uri: LSP_URI(editorState.path) },
      options: { tabSize: 2, insertSpaces: true }
    });
    if (edits && edits.length) {
      const updated = applyTextEditsToContent(model.getValue(), edits);
      const pos = editorState.instance.getPosition();
      model.setValue(updated);
      editorState.instance.setPosition(pos);
    }
    return true;
  }
  return false;
}

tryHotExitRecovery();
loadModels();
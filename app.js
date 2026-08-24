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
    pending.innerHTML = `<b>${esc(state.selected.name)}</b><br>${esc(answer)}` +
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
  out.textContent = 'Importing (copying into AIDE models folder)…';
  try {
    const r = await fetch(`${API}/api/models/import`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_path: p })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    out.textContent = `Imported as engine "${j.id}" (${(j.bytes / 1048576).toFixed(1)} MB). It now appears in Engines.`;
    refreshEngineList();
    setStrip(`Imported ${j.id} — press USE then START when ready.`);
  } catch (e) {
    out.textContent = `Import failed: ${e.message}`;
  }
});

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
    let block = $('#cloud-chip');
    if (!block) {
      block = document.createElement('div');
      block.className = 'rail-block';
      block.innerHTML = '<span class="k">CLOUD</span><span id="cloud-state" class="badge off">—</span>';
      $('.rail').appendChild(block);
    }
    const chip = $('#cloud-state');
    if (configured > 0) { chip.textContent = 'AVAILABLE'; chip.className = 'badge'; chip.title = 'Opt-in cloud providers are configured. Handoff stays manual until the continuity slice lands.'; }
    else { chip.textContent = 'NOT CONFIGURED'; chip.className = 'badge off'; }
  } catch { /* providers optional */ }
}

// ---------- Workbench editor (Monaco, offline bundle) ----------
const editorState = { instance: null, model: null, path: null };

function loadMonaco(cb) {
  if (window.__monacoReady) return cb();
  window.addEventListener('monaco-ready', () => cb(), { once: true });
}

function openInEditor(path, content) {
  loadMonaco(() => {
    const container = $('#editor-container');
    if (!editorState.instance) {
      editorState.instance = monaco.editor.create(container, { value: '', language: 'plaintext', theme: 'vs-dark', automaticLayout: true, minimap: { enabled: false }, fontSize: 12 });
      editorState.instance.onDidChangeModelContent(() => {
        if (!editorState.dirty) {
          editorState.dirty = true;
          $('#save-file').disabled = false;
          $('#open-file-name').textContent = `${editorState.path} *`;
        }
        clearTimeout(lspChangeDebounce);
        lspChangeDebounce = setTimeout(() => {
          const version = (lspState.versions.get(editorState.path) || 0) + 1;
          lspState.versions.set(editorState.path, version);
          lspNotify('textDocument/didChange', { textDocument: { uri: LSP_URI(editorState.path), version }, contentChanges: [{ text: editorState.instance.getValue() }] });
        }, 400);
      });
    }
    if (editorState.model) editorState.model.dispose();
    const ext = path.split('.').pop().toLowerCase();
    const langs = { js: 'javascript', mjs: 'javascript', ts: 'typescript', json: 'json', css: 'css', html: 'html', md: 'markdown', py: 'python' };
    editorState.model = monaco.editor.createModel(content, langs[ext] || 'plaintext');
    editorState.instance.setModel(editorState.model);
    editorState.path = path;
    editorState.dirty = false;
    $('#save-file').disabled = true;
    $('#open-file-name').textContent = path;
    lspMaybeOpen(path, content);
  });
}

let lspChangeDebounce = null;

async function saveCurrentFile() {
  if (!editorState.path || !editorState.instance || !editorState.dirty) return;
  setStrip(`Saving ${editorState.path}…`);
  try {
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

async function loadTree() {
  try {
    const res = await jget(`${API}/api/workspace/tree`);
    const tree = $('#file-tree');
    const render = (nodes, depth) => nodes.map(n => {
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
      lspNotify('textDocument/didChange', { textDocument: { uri, version }, contentChanges: [{ text }] });
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
    const l = await jget(`${API}/api/git/log?n=15`);
    $('#git-history').innerHTML = l.commits.map(c =>
      `<div class="cmdk-item"><b>${esc(c.hash)}</b> ${esc(c.subject)}<span class="engine-meta">${esc((c.date || '').slice(0, 16))}</span></div>`
    ).join('') || '<span class="muted small">No commits yet.</span>';
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

loadModels();
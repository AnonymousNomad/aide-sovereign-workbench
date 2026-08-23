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
      state.selected = usable[0];
      $('#cold-line').innerHTML = `Recommended for this machine: <b>${esc(state.selected.name)}</b>`;
      $('#start-engine').hidden = false;
      setStrip(`Press START to run ${state.selected.name}. Everything stays on this computer.`);
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
}

loadModels();

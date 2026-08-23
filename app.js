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
    pending.innerHTML = `<b>${esc(state.selected.name)}</b><br>${esc(answer)}`;
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

async function planAndBuild(task) {
  threadMsg('user', task);
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

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
$('#start-engine').addEventListener('click', startEngine);
$('#help-button').addEventListener('click', () => { $('#help-panel').hidden = false; });
$('#help-close').addEventListener('click', () => { $('#help-panel').hidden = true; });

loadModels();

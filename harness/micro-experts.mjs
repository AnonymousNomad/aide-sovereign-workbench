// Micro-Expert Collective runner — 1K-10K-param distilled decision modules.
// Zero deps; plain-JSON weights; deterministic forward pass; CPU-only SGD
// training; stigmergic signal store; response-threshold activation;
// hot/cold residency with utility-scored retention. See
// aide-micro-expert-collective SKILL.md for the governing design.
import { promises as fs } from 'node:fs';
import path from 'node:path';

const EXPERTS_DIR = '.aide/experts';
const DORMANT_DIR = '.aide/experts/dormant';
const ARCHIVE_DIR = '.aide/experts/archive';
const SIGNALS_FILE = '.aide/experts/signals.json';
export const MAX_PARAMS = 10_000;

export class ExpertError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function paramCount(arch, inDim, classes) {
  let p = 0;
  let prev = inDim;
  for (const h of arch.hidden || []) { p += prev * h + h; prev = h; }
  p += prev * classes + classes;
  return p;
}

function matVec(W, x, b) {
  const out = new Array(W.length).fill(0);
  for (let i = 0; i < W.length; i++) {
    const row = W[i];
    let s = b[i];
    for (let j = 0; j < row.length; j++) s += row[j] * x[j];
    out[i] = s;
  }
  return out;
}

function tanhV(v) { return v.map(x => Math.tanh(x)); }

function softmax(v) {
  const m = Math.max(...v);
  const e = v.map(x => Math.exp(x - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map(x => x / s);
}

function toVector(manifest, features) {
  return manifest.input_features.map(k => {
    const v = Number(features?.[k]);
    return Number.isFinite(v) ? v : 0;
  });
}

export function createExpertRegistry({ workspace }) {
  const hot = new Map(); // name -> parsed manifest

  function fileFor(name, dormant = false) {
    return path.join(workspace, dormant ? DORMANT_DIR : EXPERTS_DIR, `${name}.json`);
  }

  async function load(name) {
    if (hot.has(name)) return hot.get(name);
    for (const dormant of [false, true]) {
      try {
        const manifest = JSON.parse(await fs.readFile(fileFor(name, dormant), 'utf8'));
        hot.set(name, manifest);
        return manifest;
      } catch { /* try next tier */ }
    }
    throw new ExpertError('EXPERT_NOT_FOUND', `no such micro-expert: ${name}`);
  }

  async function save(manifest) {
    const inDim = manifest.input_features.length;
    const classes = manifest.classes.length;
    const params = paramCount(manifest.architecture, inDim, classes);
    if (params > MAX_PARAMS) {
      throw new ExpertError('OVER_CAP', `${manifest.name} would be ${params} params; cap is ${MAX_PARAMS}. Narrow the domain or shrink hidden layers.`);
    }
    if (!Array.isArray(manifest.input_features) || !manifest.input_features.length) {
      throw new ExpertError('VALIDATION', 'input_features must be a non-empty ordered list');
    }
    if (!Array.isArray(manifest.classes) || manifest.classes.length < 2) {
      throw new ExpertError('VALIDATION', 'classes must have at least two entries');
    }
    const file = fileFor(manifest.name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(manifest, null, 2), 'utf8');
    hot.set(manifest.name, manifest);
    return { name: manifest.name, params };
  }

  // Deterministic inference. Same inputs -> identical outputs, always.
  function inferSync(manifest, features) {
    let x = toVector(manifest, features);
    const hidden = manifest.architecture.hidden || [];
    for (const h of hidden) {
      // layer sizes encoded by weight shapes; x length selects W rows implicitly
      void h;
    }
    const layers = Object.keys(manifest.weights).filter(k => k.startsWith('W')).sort();
    let last = null;
    for (const wKey of layers) {
      const iKey = 'b' + wKey.slice(1);
      last = matVec(manifest.weights[wKey], x, manifest.weights[iKey]);
      x = tanhV(last); // hidden activations; final softmax applied after loop
    }
    const probs = softmax(last);
    let bestIdx = 0;
    probs.forEach((p, i) => { if (p > probs[bestIdx]) bestIdx = i; });
    return { class: manifest.classes[bestIdx], confidence: probs[bestIdx], probs };
  }

  async function infer(name, features) {
    const manifest = await load(name);
    const result = inferSync(manifest, features);
    await bumpSignal(manifest.domain ?? name);
    return result;
  }

  // ---- Training (CPU SGD, cross-entropy; seconds at this scale) ----
  function initWeights(inDim, hidden, classes) {
    const weights = {};
    let prev = inDim;
    const dims = [...hidden, classes];
    dims.forEach((dim, li) => {
      const scale = Math.sqrt(2 / (prev + dim));
      weights[`W${li + 1}`] = Array.from({ length: dim }, () =>
        Array.from({ length: prev }, () => (Math.random() * 2 - 1) * scale));
      weights[`b${li + 1}`] = new Array(dim).fill(0);
      prev = dim;
    });
    return weights;
  }

  function forwardTrain(manifest, x) {
    const layers = Object.keys(manifest.weights).filter(k => k.startsWith('W')).sort();
    const acts = [x];
    let a = x;
    const L = layers.length;
    layers.forEach((wKey, li) => {
      const z = matVec(manifest.weights[wKey], a, manifest.weights['b' + wKey.slice(1)]);
      a = li === L - 1 ? z : tanhV(z);
      acts.push(a);
    });
    return { out: softmax(a), acts };
  }

  function trainFromRows(rows, { hidden = [16], epochs = 40, lr = 0.08 } = {}) {
    if (!rows.length) throw new ExpertError('VALIDATION', 'no training rows');
    const input_features = Object.keys(rows[0].features);
    const classes = [...new Set(rows.map(r => r.label))];
    const classIdx = new Map(classes.map((c, i) => [c, i]));
    const manifest = {
      name: 'in-training',
      role: rows[0].role || 'classify',
      domain: rows[0].domain || 'unassigned',
      input_features,
      classes,
      architecture: { type: 'mlp', hidden, activation: 'tanh' },
      weights: initWeights(input_features.length, hidden, classes.length),
      meta: { train_rows: rows.length }
    };
    const X = rows.map(r => toVector(manifest, r.features));
    const Y = rows.map(r => classIdx.get(r.label));
    for (let ep = 0; ep < epochs; ep++) {
      for (let n = 0; n < X.length; n++) {
        const { out, acts } = forwardTrain(manifest, X[n]);
        const y = Y[n];
        // output delta (softmax + CE)
        let delta = out.map((p, k) => p - (k === y ? 1 : 0));
        for (let li = layersCount(manifest) - 1; li >= 0; li--) {
          const wKey = `W${li + 1}`;
          const bKey = `b${li + 1}`;
          const W = manifest.weights[wKey];
          const inAct = acts[li]; // activation feeding this layer
          const dNew = delta;
          const dPrev = new Array(inAct.length).fill(0);
          for (let i = 0; i < W.length; i++) {
            const g = dNew[i];
            for (let j = 0; j < W[i].length; j++) {
              dPrev[j] += g * W[i][j];
              W[i][j] -= lr * g * inAct[j];
            }
            manifest.weights[bKey][i] -= lr * g;
          }
          if (li > 0) {
            // tanh derivative uses stored activation of previous layer output
            for (let j = 0; j < dPrev.length; j++) {
              const aVal = acts[li][j];
              dPrev[j] *= (1 - aVal * aVal);
            }
          }
          delta = dPrev;
        }
      }
    }
    manifest.meta.val_agreement = evaluateAgreement(manifest, rows);
    return manifest;
  }

  function layersCount(manifest) {
    return Object.keys(manifest.weights).filter(k => k.startsWith('W')).length;
  }

  function evaluateAgreement(manifest, rows) {
    let ok = 0;
    for (const r of rows) {
      const { out } = forwardTrain(manifest, toVector(manifest, r.features));
      let bi = 0;
      out.forEach((p, i) => { if (p > out[bi]) bi = i; });
      if (manifest.classes[bi] === r.label) ok += 1;
    }
    return rows.length ? ok / rows.length : 0;
  }

  // ---- Signals (stigmergic store) + thresholds ----
  async function readSignals() {
    try { return JSON.parse(await fs.readFile(path.join(workspace, SIGNALS_FILE), 'utf8')); }
    catch { return {}; }
  }

  async function writeSignals(signals) {
    const file = path.join(workspace, SIGNALS_FILE);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(signals, null, 2), 'utf8');
    return signals;
  }

  async function bumpSignal(domain) {
    const signals = await readSignals();
    const s = signals[domain] ?? { intensity: 0 };
    s.intensity += 1;
    s.last_used = new Date().toISOString();
    signals[domain] = s;
    await writeSignals(signals);
    return s;
  }

  async function decaySignals(factor = 0.9) {
    const signals = await readSignals();
    for (const k of Object.keys(signals)) {
      signals[k].intensity = Math.max(0, signals[k].intensity * factor);
    }
    await writeSignals(signals);
    return signals;
  }

  // Response-threshold allocation: pick the active expert covering `domain`
  // whose threshold <= signal intensity; highest utility wins ties. If none
  // active qualifies, recruit lowest-threshold covering expert (dormant thaw).
  async function allocate(domain) {
    const names = (await listNames()).filter(n => n.domain === domain || String(n.domain).startsWith(`${domain}.`));
    if (!names.length) return null;
    const signals = await readSignals();
    const intensity = signals[domain]?.intensity ?? 0;
    const detailed = [];
    for (const n of names) {
      const m = await load(n.name);
      detailed.push({ name: m.name, threshold: m.threshold ?? 1, utility: m.meta?.utility ?? 0, dormant: Boolean(n.dormant), manifest: m });
    }
    const activeReady = detailed.filter(d => !d.dormant && d.threshold <= intensity)
      .sort((a, b) => b.utility - a.utility);
    if (activeReady.length) return activeReady[0].name;
    const recruits = detailed.sort((a, b) => a.threshold - b.threshold)[0];
    return recruits?.name ?? null;
  }

  async function listNames() {
    const out = [];
    for (const [rel, dormant] of [[EXPERTS_DIR, false], [DORMANT_DIR, true]]) {
      try {
        const files = await fs.readdir(path.join(workspace, rel));
        files.filter(f => f.endsWith('.json') && f !== 'signals.json').forEach(f => {
          out.push({ name: f.replace('.json', ''), domain: '', dormant });
        });
      } catch { /* dir may not exist yet */ }
    }
    // fill domains without loading weights into hot cache unnecessarily
    for (const entry of out) {
      try {
        const m = JSON.parse(await fs.readFile(fileFor(entry.name, entry.dormant), 'utf8'));
        entry.domain = m.domain;
      } catch { /* unreadable entries surface on load */ }
    }
    return out;
  }

  async function freeze(name) {
    await load(name);
    await fs.mkdir(path.join(workspace, DORMANT_DIR), { recursive: true });
    await fs.rename(fileFor(name), fileFor(name, true));
    hot.delete(name);
    return { name, state: 'dormant' };
  }

  async function thaw(name) {
    const manifest = await load(name); // load() checks dormant tier too
    return { name: manifest.name, state: 'hot' };
  }

  async function prune(name, reason) {
    await load(name);
    await fs.mkdir(path.join(workspace, ARCHIVE_DIR), { recursive: true });
    await fs.rename(fileFor(name), path.join(workspace, ARCHIVE_DIR, `${name}.${Date.now()}.json`));
    hot.delete(name);
    return { name, state: 'archived', reason };
  }

  return {
    load, save, infer, inferSync, trainFromRows,
    allocate, freeze, thaw, prune,
    bumpSignal, decaySignals, readSignals,
    _test: { toVector, paramCount, hot }
  };
}

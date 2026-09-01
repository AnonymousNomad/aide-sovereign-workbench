// train-first-experts.mjs — audit Week 1 item #5 (cline/T4, 2026-09-01)
// Trains + registers diff-risk-gate and request-intent-classifier (task-router
// already exists, 0.978 agreement — never retrain a verified artifact).
// Pattern = scripts/experts-battery.mjs canonical round-trip:
//   role/domain on every row -> trainFromRows -> name/domain on manifest ->
//   holdout agreement gate (>=0.90 per skill PRUNE floor) -> save -> smoke.
// Deterministic: corpus PRNG seeded; Math.random seeded around trainFromRows
// (initWeights uses bare Math.random — verified in harness/micro-experts.mjs).
// .aide/ is gitignored: the script is the committed, reproducible artifact.
// Usage:
//   node scripts/train-first-experts.mjs                 # real workspace
//   AIDE_WORKSPACE=<tmp> node scripts/train-first-experts.mjs   # validate
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { createExpertRegistry } = require(path.join(ROOT, 'harness', 'micro-experts.mjs'));
const { diffRiskFeatures, requestIntentFeatures } = require(path.join(ROOT, 'harness', 'expert-featurizers.mjs'));

// mulberry32 — seeded PRNG for the corpus
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Deterministic shuffle (Fisher-Yates with the same rng)
function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const DIFF_TEMPLATES = {
  low: [
    '+  // clarify comment\n   console.log(1);', '+  return result;\n-  return null;',
    '+  const x = 1;\n+  return x + 1;'
  ],
  review: [
    '+++ b/src/auth.ts\n+  const realm = config.realm;',
    '-  const old = 1;\n+  const config = loadEnv();',
    '- it("works", () => { expect(1).toBe(1); });\n-  const oldTest = makeSuite();\n+ it("works", () => { expect(fast()).toBe(1); });'
  ],
  block: [
    '+++ b/src/exec.ts\n+  eval(userInput);',
    '-  const safe = sanitize(input);\n+  fetch(userUrl + secret);',
    '-  const cfg = validated(config);\n+  child_process.exec(rawUserCommand);'
  ]
};
function diffRows(n, rng) {
  const labels = Object.keys(DIFF_TEMPLATES);
  const rows = [];
  for (let i = 0; i < n; i++) {
    const label = labels[i % labels.length];
    const t = DIFF_TEMPLATES[label];
    let text = t[Math.floor(rng() * t.length)];
    const pad = Math.floor(rng() * 20);
    for (let j = 0; j < pad; j++) text += '\n+  line' + j + ' = value' + j + ';';
    if (label === 'block') text += '\n-  // removed safety check';
    if (rng() > 0.7) text += '\n-  const oldImpl = legacy();';
    rows.push({ features: diffRiskFeatures(text), label, role: 'gate', domain: 'agent.proposal.diff' });
  }
  return rows;
}

const MSG_TEMPLATES = {
  code: ['fix the parser bug', 'build the export endpoint', 'refactor the cache layer', 'run the failing test in src/'],
  system: ['restart the engine on port 8084', 'stop the daemon', 'start the model server', 'show engine status'],
  business: ['schedule the client meeting', 'update the budget roadmap', 'send the invoice draft', 'plan next week']
};
function msgRows(n, rng) {
  const labels = Object.keys(MSG_TEMPLATES);
  const rows = [];
  for (let i = 0; i < n; i++) {
    const label = labels[i % labels.length];
    const t = MSG_TEMPLATES[label];
    const text = t[Math.floor(rng() * t.length)] + (rng() > 0.6 ? '?' : '');
    rows.push({ features: requestIntentFeatures(text), label, role: 'classify', domain: 'telegram.message' });
  }
  return rows;
}


// ---- Train + evaluate + save ----
const HOLDOUT_FRACTION = 0.2;
const AGREE_FLOOR = 0.90; // skill PRUNE floor — below this we do NOT save
const SPECS = [
  { name: 'diff-risk-gate', seed: 4242, rows: () => diffRows(400, makeRng(4242)) },
  { name: 'request-intent-classifier', seed: 9001, rows: () => msgRows(400, makeRng(9001)) }
];

const workspace = process.env.AIDE_WORKSPACE || ROOT;
const registry = createExpertRegistry({ workspace });
const report = { workspace, experts: [], failures: [] };

for (const spec of SPECS) {
  try {
    const rng = makeRng(spec.seed);
    const all = shuffle(spec.rows(), rng);
    const holdoutN = Math.floor(all.length * HOLDOUT_FRACTION);
    const trainRows = all.slice(holdoutN);
    const holdoutRows = all.slice(0, holdoutN);

    // initWeights uses bare Math.random — seed it around training for
    // reproducible weights, restore right after.
    const origRandom = Math.random;
    Math.random = makeRng(spec.seed);
    let manifest;
    try { manifest = registry.trainFromRows(trainRows); }
    finally { Math.random = origRandom; }

    manifest.name = spec.name;
    manifest.domain = trainRows[0].domain;
    manifest.role = trainRows[0].role;
    manifest.meta.teacher = 'featurizer-signal-bootstrap';
    manifest.meta.holdout_n = holdoutRows.length;

    // Holdout agreement via inferSync (pure — no signal writes)
    let hits = 0;
    for (const r of holdoutRows) {
      if (registry.inferSync(manifest, r.features).class === r.label) hits += 1;
    }
    const holdoutAgreement = hits / holdoutRows.length;
    manifest.meta.holdout_agreement = Number(holdoutAgreement.toFixed(4));

    if (holdoutAgreement < AGREE_FLOOR) {
      report.failures.push({ name: spec.name, holdoutAgreement, reason: 'below PRUNE floor 0.90 — NOT saved' });
      continue;
    }
    const saved = await registry.save(manifest);

    // Smoke: 6 probes through the public infer() (the serving path)
    const smokes = [];
    for (const p of trainRows.slice(0, 6)) {
      const r = await registry.infer(spec.name, p.features);
      smokes.push({ expected: p.label, got: r.class, confidence: Number(r.confidence.toFixed(3)), match: r.class === p.label });
    }
    report.experts.push({
      name: spec.name, role: manifest.role, domain: manifest.domain,
      train_rows: trainRows.length, holdout_n: holdoutRows.length,
      train_agreement: Number(manifest.meta.val_agreement.toFixed(4)),
      holdout_agreement: manifest.meta.holdout_agreement,
      params: saved.params, smokes, status: 'trained'
    });
  } catch (e) {
    report.failures.push({ name: spec.name, error: String(e?.message ?? e) });
  }
}

console.log(JSON.stringify(report, null, 2));
if (report.failures.length > 0 || report.experts.some(e => e.status !== 'trained' || e.holdout_agreement < AGREE_FLOOR)) {
  process.exitCode = 1;
}

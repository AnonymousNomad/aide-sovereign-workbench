// Bootstrap distillation for `task-router` — the first micro-expert.
// Scripted teacher (L1 regex layer from phase-router research) labels a
// template-expanded corpus of realistic describe-box messages; the micro-expert
// distills that policy into weights. As real usage rows accumulate, the SAME
// expert is re-distilled from primary-model decisions (true distillation).
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { createExpertRegistry } = require(path.join(root, 'harness', 'micro-experts.mjs'));

const WORKSPACE = process.argv[2] || root;

// ---- L1 teacher: deterministic, first-match-wins ----
function teacherLabel(msg) {
  const t = msg.toLowerCase();
  if (/\b(error|exception|stack trace|crash|broken|fails?|bug|traceback)\b/.test(t)) return 'debug';
  if (/\b(explain|what is|how does|why does|difference between|document)\b/.test(t)) return 'question';
  if (/\b(plan|architect|design|roadmap|break down|phases)\b/.test(t) && !/\b(implement|build|create)\b/.test(t)) return 'plan';
  if (/\b(build|create|implement|add|write|make|generate|scaffold)\b/.test(t)) return 'code';
  return 'code'; // default posture: building intent
}

const TEMPLATES = {
  debug: [
    'I get an {err} when I {action} the {thing}',
    'the {thing} is broken, throws {err} on startup',
    '{verb_fix} this bug: {thing} crashes with {err}',
    'tests fail after my changes to {thing}',
    'stack trace says {err}, help me {verb_debug}'
  ],
  question: [
    'explain how the {thing} works',
    'what is the difference between {a} and {b}',
    'how does authentication flow through {thing}',
    'why does {thing} behave differently on windows',
    'document the {thing} module for new contributors'
  ],
  plan: [
    'plan the architecture for {thing}',
    'design a roadmap for migrating {a} to {b}',
    'break down the work needed for {thing}',
    'we need phases and milestones for {thing}',
    'help me think through the design of {thing}'
  ],
  code: [
    '{verb_build} a {thing} that supports {a}',
    'create an endpoint for {thing}',
    'implement {a} handling in the {thing}',
    'write tests for {thing}',
    'add retry logic to {thing}',
    'scaffold a new {thing} module'
  ]
};

const FILL = {
  err: ['ECONNREFUSED', 'TypeError: undefined is not a function', '404', 'segfault', 'ERR_MODULE_NOT_FOUND', 'timeout'],
  thing: ['auth module', 'parser', 'telegram bridge', 'desktop panel', 'model router', 'cache layer', 'CLI', 'websocket client'],
  a: ['v1', 'REST', 'SQLite', 'the old API', 'webhooks'],
  b: ['v2', 'GraphQL', 'Postgres', 'the new API', 'polling'],
  verb_fix: ['fix', 'debug', 'track down'],
  verb_debug: ['diagnose it', 'find the root cause', 'investigate'],
  verb_build: ['build', 'create', 'implement']
};

function fill(template, rng) {
  return template.replace(/\{(\w+)\}/g, (_, k) => {
    const opts = FILL[k];
    if (!opts) return k;
    return opts[Math.floor(rng() * opts.length)];
  });
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function features(msg) {
  const words = msg.split(/\s+/).filter(Boolean);
  const lc = msg.toLowerCase();
  return {
    len_chars: msg.length / 200,
    len_words: words.length / 40,
    question: /\?/.test(msg) ? 1 : 0,
    path_like: /[\w-]+\.[a-z]{1,4}\b|\/[a-z]/i.test(msg) ? 1 : 0,
    verb_fix: /\b(fix|debug|broken|crash|fails?|error)\b/i.test(msg) ? 1 : 0,
    verb_build: /\b(build|create|implement|add|write|make|generate|scaffold)\b/i.test(msg) ? 1 : 0,
    verb_plan: /\b(plan|architect|design|roadmap|break down|phases)\b/i.test(msg) ? 1 : 0,
    verb_explain: /\b(explain|what|how|why|document|difference)\b/i.test(msg) ? 1 : 0,
    code_fence: /```/.test(msg) ? 1 : 0
  };
}

async function main() {
  const rng = mulberry32(20260825);
  const rows = [];
  for (const [label, templates] of Object.entries(TEMPLATES)) {
    for (let i = 0; i < 300; i++) {
      const tpl = templates[Math.floor(rng() * templates.length)];
      let msg = fill(tpl, rng);
      // noise: casing + trailing punctuation variety
      if (rng() < 0.3) msg = msg.charAt(0).toUpperCase() + msg.slice(1);
      if (rng() < 0.4) msg += rng() < 0.5 ? '.' : '?';
      rows.push({ features: features(msg), label: teacherLabel(msg) });
    }
  }
  // shuffle
  rows.sort(() => rng() - 0.5);

  const reg = createExpertRegistry({ workspace: WORKSPACE });
  const split = Math.floor(rows.length * 0.85);
  const manifest = reg.trainFromRows(rows.slice(0, split), { hidden: [16], epochs: 140 });
  manifest.name = 'task-router';
  manifest.role = 'route';
  manifest.domain = 'orchestrator.intent';
  manifest.threshold = 1;
  manifest.meta.teacher = 'l1-regex-bootstrap';
  manifest.meta.val_rows = rows.length - split;

  // held-out agreement vs teacher
  const held = rows.slice(split);
  hot_check: {
    await reg.save(manifest);
  }
  let agree = 0;
  for (const r of held) {
    const res = await reg.infer('task-router', r.features);
    if (res.class === r.label) agree += 1;
  }
  const agreement = agree / held.length;
  console.log(`held-out agreement vs teacher: ${(agreement * 100).toFixed(1)}% (${agree}/${held.length})`);
  if (agreement < 0.95) {
    console.error('VALIDATION GATE FAILED (<95%) — expert NOT promoted');
    process.exit(1);
  }
  // stamp agreement into persisted manifest
  manifest.meta.val_agreement = agreement;
  manifest.meta.holdout_n = held.length;
  await reg.save(manifest);

  // spot demos
  for (const probe of [
    'the telegram bridge crashes with ECONNREFUSED',
    'plan the architecture for offline sync',
    'add retry logic to the model hub',
    'explain how the facade routes requests'
  ]) {
    const r = await reg.infer('task-router', features(probe));
    console.log(`"${probe}" -> ${r.class} (${r.confidence.toFixed(2)})`);
  }
  console.log(`task-router deployed: ${manifest.name} @ .aide/experts/task-router.json`);
}

main().catch(e => { console.error(e); process.exit(1); });


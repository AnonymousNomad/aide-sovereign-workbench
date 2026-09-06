// Orchestrator (v1) - classifies a user request into a WorkflowBundle.
// Pure CPU. No LLM. Uses keyword matching on skill applies_to + lightweight
// cosine similarity over skill names + descriptions, plus a Helix digest
// similarity pass. The output is a glass-box WorkflowBundle whose
// routingLog field exposes the evidence chain.
//
// The orchestrator does NOT do LLM calls. It runs on the operator's CPU
// instantly. The model stays cold until the agent loop actually invokes it.
//
// This is the batched C3+C4 "orchestrator" half. The "scaffold" half is
// scaffold-v2.mjs, which consumes a WorkflowBundle and produces a system
// prompt under a strict byte budget.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { createWorkflowBundle, addRoutingEvidence, HELIX_CONFIDENCE_THRESHOLD, HELIX_MIN_TRAJECTORIES } from './workflow-bundle.mjs';
import { createSkillLoader } from './skill-loader.mjs';
import { createSopLoader } from './sop-loader.mjs';

// Lightweight shim: turn a legacy `skills/registry.json` entry into a
// minimal WorkflowBundle-compatible envelope. Keywords are derived from
// the skill name (split on '-', deduped). Body is the legacy description.
// When a legacy skill is used, the shim marks `skillShimUsed: true` so
// the upgrade path can auto-promote it to the full envelope later.
function shimLegacySkill(legacy) {
  if (!legacy) return null;
  const id = String(legacy.id ?? legacy.name ?? '').trim();
  if (!id) return null;
  // Registry ids contain routing-noise tokens (`aide`, `task`, `service`,
  // phase labels). Excluding those prevents generic prose from selecting an
  // arbitrary legacy skill; meaningful domain tokens such as `build`, `git`,
  // or `android` remain available.
  const legacyNoise = new Set(['aide', 'task', 'service', 'phase']);
  const keywords = id.split('-').filter(k => k.length > 1 && !legacyNoise.has(k) && !/^b\d+$/.test(k));
  return {
    name: id,
    version: '0.0.0-legacy',
    category: legacy.category || 'general',
    appliesTo: keywords,
    toolsRequired: ['read_file'],
    body: legacy.description || legacy.title || '',
    fingerprint: `legacy::${id}::${legacy.category || 'general'}`,
    path: null,
    root: null,
    kind: 'skill-legacy-shim',
    shim_used: true,
    legacy: true
  };
}

function cosineSimilarity(a, b) {
  if (!a || !b) return 0;
  const setA = new Set(String(a).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const setB = new Set(String(b).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  if (setA.size === 0 || setB.size === 0) return 0;
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter += 1;
  return inter / Math.sqrt(setA.size * setB.size);
}

function loadLegacySkills(workspace) {
  const paths = [
    path.join(workspace, 'skills', 'registry.json'),
    path.join(workspace, '.aide', 'skills', 'registry.json')
  ];
  for (const p of paths) {
    if (existsSync(p)) {
      try {
        const data = JSON.parse(readFileSync(p, 'utf8'));
        const skills = Array.isArray(data.skills) ? data.skills : [];
        return { path: p, skills };
      } catch { /* ignore */ }
    }
  }
  return { path: null, skills: [] };
}

function helixDigestDirectory(workspace) {
  const candidates = [
    path.join(workspace, '.aide', 'helix'),
    path.join(workspace, '.aide', 'trajectories')
  ];
  for (const dir of candidates) {
    if (existsSync(dir)) {
      try {
        const files = readdirSync(dir, { withFileTypes: true });
        const jsonl = files.filter(f => f.isFile() && (f.name.endsWith('.jsonl') || f.name.endsWith('.traj.json'))).map(f => path.join(dir, f.name));
        return { dir, files: jsonl };
      } catch { /* ignore */ }
    }
  }
  return { dir: null, files: [] };
}

function readHelixDigests(files, limit = 5) {
  const out = [];
  for (const f of files) {
    if (out.length >= limit) break;
    try {
      const raw = readFileSync(f, 'utf8');
      const lines = raw.split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          if (obj && obj.digest) out.push(obj.digest);
          else if (typeof obj === 'string') out.push(obj);
          if (out.length >= limit) break;
        } catch { /* skip bad line */ }
      }
    } catch { /* skip file */ }
  }
  return out;
}

export function createOrchestrator({ workspace = process.cwd() } = {}) {
  const project = path.resolve(workspace);
  const skillLoader = createSkillLoader({ workspace: project });
  const sopLoader = createSopLoader({ workspace: project });
  const legacy = loadLegacySkills(project);
  const helix = helixDigestDirectory(project);

  let catalog = null;
  function getCatalog() {
    if (catalog) return catalog;
    const items = [];
    for (const skillDir of skillLoader.listAvailable()) {
      const r = skillLoader.readSkillFile(skillDir);
      if (r.ok) items.push({ ...r, shim_used: false });
    }
    if (legacy.skills.length) {
      for (const legacyEntry of legacy.skills) {
        const shim = shimLegacySkill(legacyEntry);
        if (shim) items.push(shim);
      }
    }
    catalog = items;
    return catalog;
  }

  function findBestMatch(requestText) {
    const tokens = String(requestText).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const all = getCatalog();
    if (all.length === 0) return null;
    let best = null;
    let bestScore = 0;
    for (const item of all) {
      let score = 0;
      const triggers = (item.appliesTo || []).map(t => String(t).toLowerCase());
      let triggerHits = 0;
      for (const trigger of triggers) {
        const triggerTokens = trigger.split(/[^a-z0-9]+/).filter(Boolean);
        const hit = triggerTokens.length === 1
          ? tokens.includes(triggerTokens[0])
          : triggerTokens.every(token => tokens.includes(token));
        if (hit) {
          score += 0.35;
          triggerHits += 1;
        }
      }
      if (triggerHits > 0) score += 0.2;
      const cos = cosineSimilarity(`${item.name} ${item.body || ''}`, requestText);
      score += cos * 0.45;
      if (score > bestScore) { bestScore = score; best = item; }
    }
    if (!best || bestScore < 0.15) return { item: null, score: 0 };
    return { item: best, score: Math.min(1, bestScore) };
  }

  function safeFindBestMatch(requestText) {
    try {
      const r = findBestMatch(requestText);
      if (!r) return { item: null, score: 0 };
      return r;
    } catch {
      return { item: null, score: 0 };
    }
  }

  const L0_CHASSIS_SOPS = ['ask-dont-circle', 'verify-before-claiming', 'fail-closed', 'operator-approves-mutations'];
  // Skill-writer and kaizen-loop are conditional: included only when a skill
  // is being WRITTEN (rare) or when the agent-loop flags a 3-fail pattern.
  // For now, they're optional in the bundle.sopNames list (operator can opt in
  // by passing {sopNames: [..., 'skill-writer']}).

  function findHelixMatches(goal, limit = 3) {
    if (helix.files.length < HELIX_MIN_TRAJECTORIES) {
      return { matches: 0, digests: [], skipped: true, skippedReason: `Helix has ${helix.files.length} trajectories; need at least ${HELIX_MIN_TRAJECTORIES} for L4 retrieval.` };
    }
    const digests = readHelixDigests(helix.files, 50);
    if (digests.length < HELIX_MIN_TRAJECTORIES) {
      return { matches: 0, digests: [], skipped: true, skippedReason: `Helix has ${digests.length} digests; need at least ${HELIX_MIN_TRAJECTORIES}.` };
    }
    const goalVec = new Set(String(goal).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
    const scored = digests.map(d => {
      const dVec = new Set(String(d).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
      let inter = 0; for (const t of goalVec) if (dVec.has(t)) inter += 1;
      const score = goalVec.size === 0 || dVec.size === 0 ? 0 : inter / Math.sqrt(goalVec.size * dVec.size);
      return { digest: d, score };
    }).sort((a, b) => b.score - a.score);
    const above = scored.filter(s => s.score >= HELIX_CONFIDENCE_THRESHOLD).slice(0, limit);
    return { matches: above.length, digests: above, skipped: false, skippedReason: null };
  }

  function classify(goal, opts = {}) {
    if (!goal || typeof goal !== 'string') throw new Error('goal is required');
    const t0 = Date.now();
    const bundle = createWorkflowBundle({
      goal,
      primarySkill: { name: 'unknown' },
      auxSkills: [],
      sopNames: [],
      toolSet: ['read_file', 'search', 'list'],
      promptBudget: { lines: 80, bytes: 2048 },
      helixMatches: 0,
      helixSkipped: false,
      helixSkippedReason: null,
      rationale: '',
      requireApproval: true
    });

    const kw = safeFindBestMatch(goal);
    addRoutingEvidence(bundle, 'keyword_match', goal.slice(0, 80), kw.score, 0.15, kw.item ? 'kept' : 'rejected');

    if (kw.item) {
      const cos = cosineSimilarity(`${kw.item.name} ${kw.item.body || ''}`, goal);
      addRoutingEvidence(bundle, 'embedding_cosine', `${kw.item.name} + body`, cos, 0.15, cos >= 0.15 ? 'kept' : 'rejected');
    } else {
      addRoutingEvidence(bundle, 'embedding_cosine', goal.slice(0, 80), 0, 0.15, 'rejected');
    }

    const helixResult = findHelixMatches(goal);
    if (helixResult.skipped) {
      addRoutingEvidence(bundle, 'helix_similarity', 'helix', 0, HELIX_CONFIDENCE_THRESHOLD, 'skipped');
      bundle.helix.skipped = true;
      bundle.helix.skipped_reason = helixResult.skippedReason;
      bundle.helix.matches = 0;
    } else {
      addRoutingEvidence(bundle, 'helix_similarity', 'helix', helixResult.digests[0]?.score ?? 0, HELIX_CONFIDENCE_THRESHOLD, helixResult.matches > 0 ? 'injected' : 'skipped');
      bundle.helix.matches = helixResult.matches;
    }

    // L0.5: the operator's credo is loaded first, always, if the catalog
    // has it. The chassis's law (L0 SOPs) is derived from the credo, not
    // the other way around. Record the load order in the routing log so the
    // operator can see what the model saw, in what order.
    const credo = findCredo();
    if (credo) {
      bundle.sopNames.unshift('developer-credo');
      addRoutingEvidence(bundle, 'L0.5_credo', credo.name + ' v' + credo.version, 1.0, 1.0, 'injected');
    } else {
      addRoutingEvidence(bundle, 'L0.5_credo', '(absent)', 0, 0, 'skipped');
    }

    if (kw.item) {
      bundle.primarySkill = kw.item;
      bundle.auxSkills = [];
      // L0: chassis's universal law. Selected-skill's own sop is injected by
      // scaffold-v2 from skillBody, not here. We add the skill-writer and
      // kaizen-loop only when the operator explicitly opts in (sopNames
      // override in the request).
      const requestedSops = Array.isArray(opts.sopNames) ? opts.sopNames : [];
      const operatorAdded = requestedSops.filter(n => !L0_CHASSIS_SOPS.includes(n) && n !== 'developer-credo' && n !== 'ask-dont-circle' && n !== 'verify-before-claiming' && n !== 'fail-closed' && n !== 'operator-approves-mutations');
      bundle.sopNames = [
        ...bundle.sopNames,  // credo already prepended above
        ...L0_CHASSIS_SOPS.filter(n => !bundle.sopNames.includes(n)),
        ...operatorAdded
      ];
      bundle.toolSet = kw.item.toolsRequired && kw.item.toolsRequired.length ? [...kw.item.toolsRequired] : ['read_file', 'search', 'list'];
      bundle.rationale = `Picked ${kw.item.name} (v${kw.item.version}) on keyword match (${kw.item.appliesTo.join(', ')}). Skill envelope: ${kw.item.shim_used ? 'shim from legacy registry' : 'v1 envelope'}.`;
      bundle.legacySkillId = kw.item.legacy ? kw.item.name : null;
    } else {
      bundle.primarySkill = { name: 'unknown', reason: 'no catalog match', shim_used: false };
      bundle.auxSkills = [];
      bundle.sopNames = [
        ...bundle.sopNames,  // credo
        'ask-dont-circle',
        'surface-uncertainty'
      ];
      bundle.toolSet = ['read_file', 'list'];
      bundle.rationale = 'No skill in the catalog matched. Operator routing required.';
    }

    const baseTools = new Set(['read_file', 'search', 'list', 'git_diff']);
    for (const t of bundle.toolSet) baseTools.add(t);
    baseTools.add('write_file');
    baseTools.add('bash');
    bundle.toolSet = [...baseTools];

    bundle.estimatedTokens = Math.ceil((bundle.toolSet.length * 8) + (bundle.sopNames.length * 12) + 40);
    bundle.routingTimeMs = Date.now() - t0;
    return bundle;
  }

  function findCredo() {
    // The credo is the first skill in the catalog with name 'developer-credo'.
    // It's a single-shot lookup: we don't enumerate the catalog every
    // classify call because the catalog is already cached. If the credo is
    // not in the catalog, the bundle is built without L0.5 and the
    // operator sees a routing log entry "L0.5_credo (absent) skipped."
    return findSkillByName('developer-credo');
  }

  function findSkillByName(name) {
    for (const item of getCatalog()) {
      if (item && item.name === name) return item;
    }
    return null;
  }

  return {
    classify,
    listCatalog: () => getCatalog().map(s => ({ name: s.name, version: s.version, category: s.category, shim_used: !!s.shim_used, legacy: !!s.legacy })),
    listLegacy: () => legacy.skills.map(s => ({ id: s.id, category: s.category, description: s.description })),
    helixStatus: () => ({ file_count: helix.files.length, dir: helix.dir, threshold: HELIX_CONFIDENCE_THRESHOLD, min_trajectories: HELIX_MIN_TRAJECTORIES }),
    legacyPath: () => legacy.path
  };
}

export { HELIX_CONFIDENCE_THRESHOLD, HELIX_MIN_TRAJECTORIES };

// Chassis Bundles service (C6 agent-bundles adapter).
// Per docs/evidence/report-source.md the operator flow is:
//   1. POST /api/agent/bundles/preview { task, mode }
//      - composes the bundle + scaffold (no session, no side effects)
//      - persists the bundle card under the review key (bundle.id)
//      - returns the bundle card so the operator can review why-thi-skill,
//        what-enters-context, helix truth, and the tool allowlist BEFORE
//        any tool runs
//   2. operator reviews the card
//   3. POST /api/agent/bundles/run { bundle_id, chat_source?, ... }
//      - loads the persisted bundle (FORBIDDEN if unknown — the operator
//        MUST preview first)
//      - delegates to the existing agent loop start() but pins the
//        reviewed bundle + scaffold on the session, so the status payload
//        reports the bundle the operator actually approved
//
// Durable state lives in <workspace>/.aide/bundle-reviews.json. The file
// is a flat object keyed by bundle_id. Failures to read/write the file
// are best-effort try/catch: a missing or corrupt file is treated as
// "no reviews yet", the operator is told to preview first.
//
// Per the chassis: the adapter compose() lives in agent-loop.mjs to keep
// one source of truth for the preview/run bundle composition. This service
// imports createChassisAdapter and delegates to it.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createChassisAdapter } from './agent-loop.mjs';

const REVIEWS_FILE = path.join('.aide', 'bundle-reviews.json');
const MAX_REVIEWS_KEPT = 200;
const ID_PATTERN = /^wb_\d+_[a-z0-9]+$/;

function safeKey(value) {
  // Defence in depth: only wb_<timestamp>_<rand> ids are accepted as keys
  // so a malicious or malformed bundle_id can never collide with a
  // structural key on the JSON object.
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) return null;
  return value;
}

async function readReviewsFile(workspace) {
  const file = path.join(workspace, REVIEWS_FILE);
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    return {};
  } catch {
    return {};
  }
}

async function writeReviewsFile(workspace, reviews) {
  const file = path.join(workspace, REVIEWS_FILE);
  await fs.mkdir(path.dirname(file), { recursive: true });
  // Atomic write: write to temp file, then rename. Prevents a partial
  // JSON from corrupting the review store if the daemon dies mid-write.
  const tmp = file + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(reviews, null, 2), 'utf8');
  await fs.rename(tmp, file);
}

function toBundleCard({ bundle, scaffold, task, mode }) {
  // The card shape mirrors OrchestratorBundleCardResponse so the preview
  // route can return the same payload as the GET /api/orchestrator/bundle-card.
  // Why-this-skill + scaffold + helix live in the bundle; the scaffold
  // bytes/lines/dropped come from assembleScaffold's return value.
  const primary = bundle.primarySkill || { name: 'unknown', version: '0.0.0', category: 'unknown' };
  const helix = bundle.helix || { enabled: true, skipped: true, skipped_reason: 'no-helix', threshold: 0, min_trajectories: 0, matches: 0, bootstrap_visible: true };
  return {
    bundle_id: bundle.id,
    goal: task,
    mode: mode === 'plan' ? 'plan' : 'act',
    primary_skill: {
      name: primary.name,
      version: primary.version || '0.0.0',
      category: primary.category || 'unknown',
      shim_used: Boolean(primary.shim_used),
      legacy: Boolean(bundle.legacySkillId)
    },
    sop_names: bundle.sopNames || [],
    tool_set: bundle.toolSet || [],
    prompt_budget: bundle.promptBudget || { lines: 0, bytes: 0 },
    helix: {
      enabled: Boolean(helix.enabled),
      skipped: Boolean(helix.skipped),
      skipped_reason: helix.skipped_reason || null,
      threshold: Number(helix.threshold) || 0,
      min_trajectories: Number(helix.min_trajectories) || 0,
      matches: Number(helix.matches) || 0,
      bootstrap_visible: helix.bootstrap_visible !== false
    },
    rationale: bundle.rationale || '',
    routing_log: Array.isArray(bundle.routingLog) ? bundle.routingLog : [],
    scaffold: {
      system: scaffold.system || '',
      bytes: Number(scaffold.bytes) || 0,
      lines: Number(scaffold.lines) || 0,
      dropped: Array.isArray(scaffold.dropped) ? scaffold.dropped : []
    }
  };
}

export function createChassisBundlesService({ workspace }) {
  if (!workspace) throw new Error('workspace is required for the chassis bundles service');
  // One adapter per service. compose() is read-only against the chassis
  // state so the same adapter instance is safe to share.
  const adapter = createChassisAdapter(workspace);

  async function preview(task, mode) {
    if (typeof task !== 'string' || task.length === 0) {
      const error = new Error('task is required');
      error.code = 'VALIDATION';
      throw error;
    }
    const normalizedMode = mode === 'plan' ? 'plan' : 'act';
    let composed;
    try {
      composed = adapter.compose(task, normalizedMode);
    } catch (error) {
      const wrapped = new Error(`chassis compose failed: ${String(error?.message ?? error).slice(0, 300)}`);
      wrapped.code = 'CHILD_FAILED';
      throw wrapped;
    }
    const card = toBundleCard({
      bundle: composed.bundle,
      scaffold: composed.scaffold,
      task,
      mode: normalizedMode
    });
    // Persist the card so the run endpoint can re-load it. The card is
    // the source of truth for the run; the agent loop re-composes
    // internally so the run's chassis metadata is identical to the
    // preview's metadata.
    const reviews = await readReviewsFile(workspace);
    reviews[card.bundle_id] = {
      ...card,
      reviewed_at: new Date().toISOString()
    };
    // Bound the on-disk size: keep only the most recent N reviews. The
    // operator's recent workflow is what matters; an unbounded log
    // would be a slow disk write.
    const ids = Object.keys(reviews);
    if (ids.length > MAX_REVIEWS_KEPT) {
      ids.sort((a, b) => (reviews[a]?.reviewed_at || '').localeCompare(reviews[b]?.reviewed_at || ''));
      for (const id of ids.slice(0, ids.length - MAX_REVIEWS_KEPT)) {
        delete reviews[id];
      }
    }
    try {
      await writeReviewsFile(workspace, reviews);
    } catch {
      // Persistence is best-effort: a failed write means the run endpoint
      // will FORBIDDEN, but the preview card is still returned to the
      // operator for review. The next preview overwrites the stale entry.
    }
    return card;
  }

  async function getReviewedBundle(bundleId) {
    const key = safeKey(bundleId);
    if (!key) return null;
    const reviews = await readReviewsFile(workspace);
    return reviews[key] || null;
  }

  async function listReviewedBundles() {
    const reviews = await readReviewsFile(workspace);
    return Object.entries(reviews).map(([bundle_id, card]) => ({
      bundle_id,
      reviewed_at: card.reviewed_at,
      goal: card.goal,
      mode: card.mode,
      primary_skill: card.primary_skill?.name || 'unknown'
    }));
  }

  return { preview, getReviewedBundle, listReviewedBundles };
}

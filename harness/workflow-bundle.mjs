// Workflow bundle (v1) - the orchestrator's output that the scaffold consumes.
// Pure data, no I/O, no LLM. The orchestrator composes a bundle; the scaffold
// renders it into a system prompt with budget enforcement.
//
// Glass-box design: every decision the orchestrator makes is captured in
// `routingLog` with the evidence chain. The operator can see "why this skill
// was picked" without having to trust a black box. This is the differentiator
// from cloud IDEs that route through an LLM and can't easily surface the
// evidence chain.

export const HELIX_CONFIDENCE_THRESHOLD = 0.85;
export const HELIX_MIN_TRAJECTORIES = 5;

export function createWorkflowBundle({
  goal,
  primarySkill,
  auxSkills = [],
  sopNames = [],
  toolSet = [],
  promptBudget = { lines: 80, bytes: 2048 },
  helixMatches = 0,
  helixSkipped = false,
  helixSkippedReason = null,
  rationale = '',
  estimatedTokens = null,
  requireApproval = true,
  skillShimUsed = false,
  legacySkillId = null
}) {
  if (!goal) throw new Error('goal is required');
  if (!primarySkill || !primarySkill.name) throw new Error('primarySkill with .name is required');
  if (!Array.isArray(auxSkills)) throw new Error('auxSkills must be an array');
  if (!Array.isArray(sopNames)) throw new Error('sopNames must be an array');
  if (!Array.isArray(toolSet)) throw new Error('toolSet must be an array');
  if (typeof helixMatches !== 'number') throw new Error('helixMatches must be a number (count)');
  if (typeof helixSkipped !== 'boolean') throw new Error('helixSkipped must be a boolean');
  if (!promptBudget || typeof promptBudget.lines !== 'number') throw new Error('promptBudget.lines must be a number');
  if (typeof promptBudget.bytes !== 'number') throw new Error('promptBudget.bytes must be a number');

  return {
    id: `wb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    goal,
    primarySkill: { ...primarySkill, shim_used: skillShimUsed },
    auxSkills: auxSkills.map(s => ({ ...s, shim_used: s.shim_used || skillShimUsed })),
    sopNames: [...sopNames],
    toolSet: [...toolSet],
    promptBudget: { ...promptBudget },
    helix: {
      enabled: true,
      skipped: helixSkipped,
      skipped_reason: helixSkippedReason,
      threshold: HELIX_CONFIDENCE_THRESHOLD,
      min_trajectories: HELIX_MIN_TRAJECTORIES,
      matches: helixMatches,
      bootstrap_visible: true
    },
    rationale: rationale || `Picked ${primarySkill.name} for the goal.`,
    estimatedTokens,
    requireApproval,
    legacySkillId,
    routingLog: [],
    createdAt: new Date().toISOString()
  };
}

export function addRoutingEvidence(bundle, stage, signal, score, threshold, decision, extra = {}) {
  if (!bundle) throw new Error('bundle is required');
  if (!stage) throw new Error('stage is required');
  if (!decision) throw new Error('decision is required');
  bundle.routingLog.push({
    stage,
    signal,
    score,
    threshold,
    decision,
    timestamp: new Date().toISOString(),
    ...extra
  });
  return bundle;
}


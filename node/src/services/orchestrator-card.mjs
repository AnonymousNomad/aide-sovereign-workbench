import { createOrchestrator } from '../../../harness/orchestrator.mjs';
import { createSopLoader } from '../../../harness/sop-loader.mjs';
import { createSkillLoader } from '../../../harness/skill-loader.mjs';
import { assembleScaffold } from '../../../harness/scaffold-v2.mjs';

// Read-only projection of the CPU orchestrator for operator inspection. It
// deliberately returns the same bundle evidence used by the agent loop, but
// never starts a model, mutates workspace state, or exposes legacy file paths.
export function createOrchestratorCardService({ workspace }) {
  const orchestrator = createOrchestrator({ workspace });
  const sopLoader = createSopLoader({ workspace });
  const skillLoader = createSkillLoader({ workspace });

  function compose(task, mode = 'act') {
    const bundle = orchestrator.classify(task);
    const sopBodies = {};
    for (const name of bundle.sopNames) {
      if (name === 'developer-credo') {
        const credo = skillLoader.readSkillFile(name);
        if (credo.ok) sopBodies[name] = credo.body;
        continue;
      }
      const sop = sopLoader.readSopFile(name);
      if (sop.ok) sopBodies[name] = sop.body;
    }
    const scaffold = assembleScaffold({
      workflowBundle: bundle,
      sopBodies,
      skillBody: bundle.primarySkill?.body || '',
      workspaceFacts: `workspace: ${workspace}\nmode: ${mode}`
    });
    return { bundle, scaffold };
  }

  function card(task, mode = 'act') {
    const { bundle, scaffold } = compose(task, mode);
    return {
      bundle_id: bundle.id,
      goal: bundle.goal,
      mode,
      primary_skill: {
        name: bundle.primarySkill.name,
        version: bundle.primarySkill.version || '0.0.0-legacy',
        category: bundle.primarySkill.category || 'general',
        shim_used: bundle.primarySkill.shim_used === true,
        legacy: bundle.primarySkill.legacy === true
      },
      sop_names: bundle.sopNames,
      tool_set: bundle.toolSet,
      prompt_budget: bundle.promptBudget,
      helix: bundle.helix,
      rationale: bundle.rationale,
      routing_log: bundle.routingLog,
      scaffold: {
        system: scaffold.system,
        bytes: scaffold.bytes,
        lines: scaffold.lines,
        dropped: scaffold.dropped
      }
    };
  }

  return { card };
}

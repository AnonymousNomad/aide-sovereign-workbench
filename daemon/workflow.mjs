import { normalizeUnifiedPatch, validateUnifiedPatch } from '../harness/patch.mjs';

export class WorkflowManager {
  constructor({ modelManager, workspaceManager, artifactStore }) { this.modelManager = modelManager; this.workspaceManager = workspaceManager; this.artifactStore = artifactStore; }
  async planAndPropose({ modelId, task }) {
    const tree = (await this.workspaceManager.tree(2)).slice(0, 60);
    const context = JSON.stringify(tree).slice(0, 3500);
    const planResult = await this.modelManager.chat(modelId, [{ role: 'system', content: 'You are AIDE Plan mode. Return a concise ordered plan, files, risks, and verification. Do not edit.' }, { role: 'user', content: `Workspace: ${context}\nTask: ${task}` }], { max_tokens: 160 });
    const plan = planResult.choices?.[0]?.message?.content || '';
    const patchResult = await this.modelManager.chat(modelId, [{ role: 'system', content: 'You are AIDE Build mode. Return one unified diff only. Use real paths. No prose, markdown, or test claims.' }, { role: 'user', content: `Task: ${task}\nPlan:\n${plan}\nFiles:\n${context}` }], { max_tokens: 350 });
    const patch = normalizeUnifiedPatch(patchResult.choices?.[0]?.message?.content || '');
    const valid = validateUnifiedPatch(patch);
    const audit = await this.artifactStore.add({ kind: 'workflow-proposal', status: valid.valid ? 'awaiting-approval' : 'blocked-invalid-patch', model_id: modelId, task, plan, patch_valid: valid.valid, source_exported: false });
    return { status: valid.valid ? 'awaiting-approval' : 'blocked-invalid-patch', task, plan, patch, audit, verification: valid };
  }
  async apply({ patch, approved }) {
    if (approved !== true) throw new Error('explicit approval required');
    const result = await this.workspaceManager.applyPatch(patch, true);
    const audit = await this.artifactStore.add({ kind: 'workflow-apply', status: 'applied', patch_bytes: Buffer.byteLength(patch), approved: true, source_exported: false });
    return { ...result, audit };
  }
}

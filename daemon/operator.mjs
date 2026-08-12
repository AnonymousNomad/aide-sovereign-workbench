export class Operator {
  constructor({ modelManager, workspaceManager, gitStatus }) { this.modelManager = modelManager; this.workspaceManager = workspaceManager; this.gitStatus = gitStatus; }

  async run({ mode = 'ask', modelId, prompt }) {
    if (!prompt?.trim()) throw new Error('operator prompt is empty');
    const tree = await this.workspaceManager.tree(2);
    const context = JSON.stringify({ workspace_tree: tree.slice(0, 40), git: await this.gitStatus() }).slice(0, 6000);
    const system = mode === 'plan'
      ? 'You are AIDE Plan mode. Explain the goal, files to inspect, ordered steps, risks, and exact verification checks. Do not edit files or run commands.'
      : mode === 'agent'
        ? 'You are AIDE Agent mode. Return a concise plan followed by proposed tool calls as JSON in a fenced json block. Allowed tools are workspace.read and terminal.run. Never claim a tool ran. All tool calls require user approval.'
        : 'You are AIDE Ask mode. Answer the user clearly using the supplied workspace context. Do not edit files or claim commands ran.';
    const result = await this.modelManager.chat(modelId, [{ role: 'system', content: system }, { role: 'user', content: `Workspace context:\n${context}\n\nUser request:\n${prompt}` }], { max_tokens: mode === 'ask' ? 512 : 180 });
    return { mode, modelId, answer: result.choices?.[0]?.message?.content || '', approval_required: mode === 'agent', tools_executed: [] };
  }
}

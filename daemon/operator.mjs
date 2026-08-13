import { routeIntent } from './intent-router.mjs';

export class Operator {
  constructor({ modelManager, workspaceManager, gitStatus }) { this.modelManager = modelManager; this.workspaceManager = workspaceManager; this.gitStatus = gitStatus; }

  async run({ mode = 'ask', modelId, prompt, history = [] }) {
    if (!prompt?.trim()) throw new Error('operator prompt is empty');
    const requestedMode = mode;
    const routing = mode === 'auto' ? routeIntent(prompt) : { mode, reason: 'explicit user-selected mode' };
    mode = ['ask', 'plan', 'agent'].includes(routing.mode) ? routing.mode : 'ask';
    const tree = await this.workspaceManager.tree(2);
    const context = JSON.stringify({ workspace_tree: tree.slice(0, 40), git: await this.gitStatus() }).slice(0, 6000);
    const recent = Array.isArray(history)
      ? history.filter(item => item && (item.role === 'user' || item.role === 'assistant') && String(item.content || '').trim()).slice(-8).map(item => ({ role: item.role, content: String(item.content).slice(0, 2000) }))
      : [];
    const system = mode === 'plan'
      ? 'You are AIDE Plan mode. Explain the goal, files to inspect, ordered steps, risks, and exact verification checks. Do not edit files or run commands.'
      : mode === 'agent'
        ? 'You are AIDE Agent mode. Return a concise plan followed by proposed tool calls as JSON in a fenced json block. Allowed tools are workspace.read and terminal.run. Never claim a tool ran. All tool calls require user approval.'
        : 'You are AIDE Ask mode. Answer the user clearly using the supplied workspace context. Do not edit files or claim commands ran.';
    const result = await this.modelManager.chat(modelId, [{ role: 'system', content: system }, ...recent, { role: 'user', content: `Workspace context:\n${context}\n\nUser request:\n${prompt}` }], { max_tokens: mode === 'ask' ? 512 : 180 });
    const answer = result.choices?.[0]?.message?.content || '';
    const proposed_tools = mode === 'agent' ? this.extractTools(answer) : [];
    return { mode, requested_mode: requestedMode, routing, modelId, answer, context_turns: recent.length, approval_required: mode === 'agent', proposed_tools, tools_executed: [] };
  }

  extractTools(answer) {
    const match = String(answer).match(/```json\s*([\s\S]*?)```/i);
    if (!match) return [];
    try {
      const value = JSON.parse(match[1]);
      const calls = Array.isArray(value) ? value : value.commands || value.tools || value.tool_calls || [];
      return calls.filter(call => call && call.program && Array.isArray(call.args) && call.program.length < 32 && call.args.length < 24).map(call => ({ program: call.program, args: call.args.map(String) }));
    } catch { return []; }
  }
}

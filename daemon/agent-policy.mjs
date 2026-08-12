import { promises as fs } from 'node:fs';

export class AgentPolicy {
  constructor(manifestPath) { this.manifestPath = manifestPath; this.agents = new Map(); }
  async load() { const data = JSON.parse(await fs.readFile(this.manifestPath, 'utf8')); this.agents = new Map(data.agents.map(agent => [agent.id, agent])); return data; }
  check(agentId, tool, approved = false) {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error('agent role is not allowlisted');
    if (agent.tools.includes(tool) !== true) throw new Error('tool is not permitted for agent role');
    if (agent.approval.startsWith('required') && tool.includes('apply') && approved !== true) throw new Error('agent action requires explicit approval');
    return { allowed: true, agent: agentId, tool };
  }
}

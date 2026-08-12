import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AgentPolicy } from './agent-policy.mjs';
const root = await mkdtemp(path.join(tmpdir(), 'aide-agents-')); const file = path.join(root, 'manifest.json');
await writeFile(file, JSON.stringify({ agents: [{ id: 'builder', tools: ['patch.propose'], approval: 'required-for-apply' }] }));
const policy = new AgentPolicy(file); await policy.load(); assert.deepEqual(policy.check('builder', 'patch.propose'), { allowed: true, agent: 'builder', tool: 'patch.propose' }); await assert.rejects(Promise.resolve().then(() => policy.check('builder', 'patch.apply-approved')), /not permitted/); console.log('agent policy test passed');

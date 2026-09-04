import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAgentLoop } from '../../node/src/services/agent-loop.mjs';

async function removeWithRetry(directory: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await fs.rm(directory, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? '';
      if (!['EBUSY', 'ENOTEMPTY', 'EPERM'].includes(code)) throw error;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  throw new Error(`fixture cleanup failed: ${directory}`);
}

test('agent loop loads a matching project skill before the first model call', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-agent-context-'));
  try {
    const skillDir = path.join(workspace, '.agents', 'skills', 'aide-arch-protocols');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: aide-arch-protocols\ndescription: fixture protocol procedure\n---\n\n# Fixture skill\n\nlocal fixture skill body\n',
      'utf8'
    );

    let firstSystem = '';
    const loop = createAgentLoop({
      workspace,
      rg: null,
      chatFn: async messages => {
        firstSystem = messages[0]?.content ?? '';
        return '<attempt_completion>\n<result>context loaded</result>\n</attempt_completion>';
      },
      maxIterations: 2
    });
    const { session_id } = loop.start('debug this protocol fixture', 'act');

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const status = loop.status(session_id) as { state: string };
      if (status.state !== 'running') break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    const final = loop.status(session_id) as { state: string; error: string | null };
    assert.equal(final.state, 'done', final.error ?? 'agent did not finish');
    assert.match(firstSystem, /RELEVANT PROJECT SKILLS/);
    assert.match(firstSystem, /=== SKILL: aide-arch-protocols ===/);
    assert.match(firstSystem, /local fixture skill body/);

    let trajectory: { skills?: string[]; skill_bytes?: number } | null = null;
    const trajectoryPath = path.join(workspace, '.aide', 'trajectories', `${session_id}.traj.json`);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        trajectory = JSON.parse(await fs.readFile(trajectoryPath, 'utf8')) as { skills?: string[]; skill_bytes?: number };
        break;
      } catch {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
    assert.deepEqual(trajectory?.skills, ['aide-arch-protocols']);
    assert.ok((trajectory?.skill_bytes ?? 0) > 0);
  } finally {
    await removeWithRetry(workspace);
  }
});

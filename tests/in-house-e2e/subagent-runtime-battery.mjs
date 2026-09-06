import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ArchServer } from '../../node/src/server.ts';
import { buildRoutes } from '../../node/src/openapi.ts';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function request(base, method, pathname, body) {
  const response = await fetch(base + pathname, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

async function waitFor(base, sessionId, expected) {
  let last = null;
  for (let i = 0; i < 80; i += 1) {
    const result = await request(base, 'GET', `/api/agent/status?id=${encodeURIComponent(sessionId)}`);
    last = result.body?.data ?? result.body;
    if (result.body?.data?.state === expected) return result.body.data;
    await wait(25);
  }
  throw new Error(`session ${sessionId} did not reach ${expected}: ${JSON.stringify(last)}`);
}

async function waitForChild(base, childId, expected) {
  let last = null;
  for (let i = 0; i < 80; i += 1) {
    const result = await request(base, 'GET', `/api/agent/subagent/status?child_session_id=${encodeURIComponent(childId)}`);
    last = result.body?.data ?? result.body;
    if (result.body?.data?.status === expected) return result.body.data;
    await wait(25);
  }
  throw new Error(`child ${childId} did not reach ${expected}: ${JSON.stringify(last)}`);
}

test('subagent runtime: real route task, policy denial, parent listing, durable trajectory', async () => {
  const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), 'aide-subagent-runtime-'));
  const scratchName = 'route-battery';
  const scratch = path.join(workspace, '.aide', 'subagents', scratchName);
  await fsp.mkdir(scratch, { recursive: true });
  await fsp.writeFile(path.join(scratch, 'fixture.txt'), 'verified child fixture\n', 'utf8');
  let server;
  try {
    const deterministicChat = async messages => {
      const userText = messages.filter(message => message.role === 'user').map(message => String(message.content)).join('\n');
      if (userText.includes('attempt forbidden command')) {
        return '<run_command><command>node -e "require(\'fs\').writeFileSync(\'should-not-exist.txt\',\'bad\')"</command></run_command>';
      }
      if (userText.includes('inspect subagent fixture') && !userText.includes('<tool_result tool="read_file"')) {
        return '<read_file><path>fixture.txt</path><offset>1</offset><limit>20</limit></read_file>';
      }
      return '<attempt_completion><result>verified task evidence and completed</result></attempt_completion>';
    };
    const routes = await buildRoutes(workspace, 'test', {
      agentChatFn: deterministicChat,
      indexEmbedFn: async texts => texts.map(() => []),
      watchIndex: false
    });
    const arch = new ArchServer(workspace, path.join(workspace, 'arch.log'));
    for (const route of routes) arch.route(route);
    server = await arch.listen(0);
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}`;

    const parentStart = await request(base, 'POST', '/api/agent/start', { task: 'parent orchestration task', mode: 'act' });
    assert.equal(parentStart.status, 200);
    const parentId = parentStart.body.data.session_id;
    const parentDone = await waitFor(base, parentId, 'done');
    assert.equal(parentDone.state, 'done');

    const childSpawn = await request(base, 'POST', '/api/agent/subagent', {
      parent_session_id: parentId,
      task: 'inspect subagent fixture and report evidence',
      role: 'researcher',
      scratch_dir: scratchName,
      policy: { allow_read: true, allow_search: false, max_iterations: 4, max_mistakes: 2 }
    });
    assert.equal(childSpawn.status, 200);
    assert.equal(childSpawn.body.data.parent_session_id, parentId);
    const childId = childSpawn.body.data.child_session_id;
    const childDone = await waitForChild(base, childId, 'done');
    assert.equal(childDone.status, 'done');

    const listed = await request(base, 'GET', `/api/agent/subagent?parent_session_id=${encodeURIComponent(parentId)}`);
    assert.equal(listed.status, 200);
    assert.equal(listed.body.data.subagents.length, 1);
    assert.equal(listed.body.data.subagents[0].child_session_id, childId);
    assert.equal(listed.body.data.subagents[0].evidence[0].ok, true);
    const trajectoryPath = path.join(scratch, '.aide', 'trajectories', `${childId}.traj.json`);
    const trajectory = JSON.parse(await fsp.readFile(trajectoryPath, 'utf8'));
    assert.equal(trajectory.outcome, 'done');
    assert.ok(trajectory.tool_log.some(row => row.tool === 'read_file' && row.ok === true));

    const deniedScratchName = 'deny-battery';
    const deniedSpawn = await request(base, 'POST', '/api/agent/subagent', {
      parent_session_id: parentId,
      task: 'attempt forbidden command and fail closed',
      role: 'tester',
      scratch_dir: deniedScratchName,
      policy: { allow_read: true, allow_search: false, allow_run_command: false, max_iterations: 2, max_mistakes: 1 }
    });
    assert.equal(deniedSpawn.status, 200);
    const deniedId = deniedSpawn.body.data.child_session_id;
    const deniedDone = await waitForChild(base, deniedId, 'error');
    assert.match(deniedDone.result_summary, /POLICY_DENIED/);
    assert.equal(await fsp.stat(path.join(workspace, '.aide', 'subagents', deniedScratchName, 'should-not-exist.txt')).then(() => true, () => false), false);
    const deniedTrajectory = JSON.parse(await fsp.readFile(path.join(workspace, '.aide', 'subagents', deniedScratchName, '.aide', 'trajectories', `${deniedId}.traj.json`), 'utf8'));
    assert.equal(deniedTrajectory.outcome, 'error');
    assert.ok(deniedTrajectory.tool_log.some(row => row.output.includes('POLICY_DENIED')));
  } finally {
    if (server) {
      await new Promise(resolve => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      });
    }
    for (let i = 0; i < 10; i += 1) {
      try { await fsp.rm(workspace, { recursive: true, force: true }); break; }
      catch (error) {
        if (!['EBUSY', 'ENOTEMPTY', 'EPERM'].includes(error?.code)) throw error;
        await wait(100);
      }
    }
  }
});

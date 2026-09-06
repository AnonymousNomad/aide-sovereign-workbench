import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createAgentLoop } from './agent-loop.mjs';

const DEFAULT_POLICY = Object.freeze({
  allow_read: true,
  allow_search: true,
  allow_write: false,
  allow_edit: false,
  allow_run_command: false,
  allow_subagent_spawn: false,
  allow_desktop: false,
  allow_provider: false,
  allow_network: false,
  max_iterations: 8,
  max_mistakes: 3
});

const ROLE_MODES = new Set(['researcher', 'reviewer']);

function normalizePolicy(policy = {}) {
  return { ...DEFAULT_POLICY, ...policy };
}

function safeScratchName(name) {
  if (name === undefined) return null;
  const value = String(name);
  if (!/^[a-z0-9_-]{1,128}$/.test(value)) {
    throw Object.assign(new Error('scratch_dir must be a lowercase relative name'), { code: 'VALIDATION' });
  }
  return value;
}

function terminalState(state) {
  return state === 'done' || state === 'error' || state === 'aborted';
}

/**
 * Real child AgentLoop runtime. A child gets its own scratch root and a
 * narrowed, default-deny tool policy. The parent's transcript is never copied
 * into the child and the child transcript is never returned to the parent.
 */
export function createAgentSubagentService({
  workspace,
  parentLoop,
  chatFn,
  resolveChatFn = null,
  rg = null,
  onEvent = () => {},
  maxChildren = 4
}) {
  const root = path.resolve(workspace);
  const records = new Map();

  function currentStatus(record) {
    let loopStatus;
    try { loopStatus = record.loop.status(record.childSessionId); }
    catch { loopStatus = { state: record.state, iterations: 0, mistake_count: 0, error: record.error }; }
    const state = loopStatus.state === 'awaiting_approval' ? 'running' : loopStatus.state;
    if (terminalState(state) && !record.endedAt) record.endedAt = Date.now();
    if (state === 'done' && !record.summary) record.summary = record.lastEvent?.summary || 'child completed';
    if (state === 'error' && !record.summary) record.summary = loopStatus.error || record.lastEvent?.error || 'child failed';
    const trajectory = path.join(record.workspace, '.aide', 'trajectories', `${record.childSessionId}.traj.json`);
    return {
      child_session_id: record.childSessionId,
      parent_session_id: record.parentSessionId,
      role: record.role,
      status: state === 'running' ? 'running' : state,
      iterations: Number(loopStatus.iterations ?? 0),
      mistake_count: Number(loopStatus.mistake_count ?? 0),
      files_changed: [],
      result_summary: String(record.summary || loopStatus.error || state || 'running').slice(0, 4000),
      evidence: [{ kind: 'trajectory', ref: path.relative(root, trajectory).replaceAll(path.sep, '/'), ok: existsSync(trajectory) }],
      started_at: record.startedAt,
      ended_at: record.endedAt ?? null
    };
  }

  function activeCount() {
    return [...records.values()].filter(record => currentStatus(record).status === 'running').length;
  }

  async function spawn(request) {
    if (!request || typeof request !== 'object') throw Object.assign(new Error('spawn request is required'), { code: 'VALIDATION' });
    try { parentLoop.status(request.parent_session_id); }
    catch (error) { throw Object.assign(new Error(`unknown parent session: ${request.parent_session_id}`), { code: 'SESSION_NOT_FOUND', cause: error }); }
    if (activeCount() >= maxChildren) throw Object.assign(new Error(`maximum concurrent subagents reached (${maxChildren})`), { code: 'VALIDATION' });

    const scratchName = safeScratchName(request.scratch_dir);
    const childSessionId = randomUUID();
    const childWorkspace = path.join(root, '.aide', 'subagents', scratchName || childSessionId);
    for (const record of records.values()) {
      if (path.resolve(record.workspace) === path.resolve(childWorkspace) && currentStatus(record).status === 'running') {
        throw Object.assign(new Error(`scratch directory is already in use: ${scratchName}`), { code: 'VALIDATION' });
      }
    }
    await fs.mkdir(childWorkspace, { recursive: true });
    const policy = normalizePolicy(request.policy);
    const childChatFn = request.model && resolveChatFn ? resolveChatFn(request.model) : chatFn;
    if (typeof childChatFn !== 'function') throw Object.assign(new Error('no child chat function is available'), { code: 'NOT_READY' });

    const record = {
      childSessionId,
      parentSessionId: request.parent_session_id,
      role: request.role,
      workspace: childWorkspace,
      startedAt: Date.now(),
      endedAt: null,
      summary: '',
      error: null,
      lastEvent: null,
      loop: null
    };
    const childLoop = createAgentLoop({
      workspace: childWorkspace,
      chatFn: childChatFn,
      rg,
      checkpoints: null,
      maxIterations: policy.max_iterations,
      maxMistakes: policy.max_mistakes,
      toolPolicy: policy,
      onEvent: event => {
        record.lastEvent = event;
        if (event.event === 'done') record.summary = String(event.summary || 'child completed');
        if (event.event === 'error') { record.error = String(event.error || 'child failed'); record.summary = record.error; }
        if (event.event === 'aborted') record.summary = 'child aborted';
        try { onEvent({ ...event, parent_session_id: record.parentSessionId, child_session_id: record.childSessionId }); } catch {}
      }
    });
    record.loop = childLoop;
    records.set(childSessionId, record);

    // The loop owns its UUID. Keep the public id stable by asserting that the
    // generated id is the one the status map reports; callers never see the
    // internal workspace name or transcript.
    const started = childLoop.start(request.task, ROLE_MODES.has(request.role) ? 'plan' : 'act');
    record.childSessionId = started.session_id;
    if (started.session_id !== childSessionId) {
      records.delete(childSessionId);
      records.set(started.session_id, record);
    }
    return {
      child_session_id: record.childSessionId,
      parent_session_id: record.parentSessionId,
      role: record.role,
      status: 'running'
    };
  }

  return {
    spawn,
    list(parentSessionId) {
      return [...records.values()]
        .filter(record => !parentSessionId || record.parentSessionId === parentSessionId)
        .map(currentStatus);
    },
    status(childSessionId) {
      const record = records.get(childSessionId);
      return record ? currentStatus(record) : null;
    }
  };
}


import { createHash } from 'node:crypto';

// Risk is selected by the executor adapter, never supplied by a model/body.
export const OPERATION_POLICY = Object.freeze({
  'workspace.read': 'read', 'workspace.write': 'write',
  'git.read': 'read', 'git.mutate': 'write', 'git.push': 'external',
  'tasks.read': 'read', 'tasks.run': 'execute', 'tasks.stop': 'write',
  'terminal.read': 'read', 'terminal.run': 'execute',
  'desktop.read': 'read', 'desktop.action': 'execute', 'desktop.panic': 'revoke',
  'desktop.grants': 'permission', 'agent.start': 'execute', 'agent.read': 'read',
  'agent.tool': 'execute', 'agent.decision': 'permission',
  'checkpoint.snapshot': 'write', 'checkpoint.restore': 'write',
  'cache.mutate': 'write',
  'tasks.command': 'execute',
  'capability.read': 'read', 'capability.write': 'write',
  'capability.execute': 'execute', 'capability.external': 'external',
  'authority.grant': 'permission', 'telegram.read': 'read',
  'telegram.connect': 'external', 'telegram.start': 'external', 'telegram.disconnect': 'revoke'
});

// Explicit endpoint classifications; neither HTTP method nor caller labels
// confer permission. Additional route families are enrolled deliberately.
const HTTP_POLICY = new Map([
  ['GET /api/telegram/status', 'telegram.read'],
  ['POST /api/telegram/connect', 'telegram.connect'], ['POST /api/telegram/authorize', 'authority.grant'],
  ['POST /api/telegram/start', 'telegram.start'], ['POST /api/telegram/disconnect', 'telegram.disconnect'],
  // GET /api/health is PUBLIC by the server's health short-circuit; it must not
  // also carry central policy metadata (one declared owner per route).
  ['GET /api/workspace', 'workspace.read'], ['GET /api/workspace/tree', 'workspace.read'],
  ['GET /api/file', 'workspace.read'], ['GET /api/search', 'workspace.read'],
  ['POST /api/file/write', 'workspace.write'], ['POST /api/patch/apply', 'workspace.write'],
  ['POST /api/search/replace', 'workspace.write'],
  ...['status', 'branches'].map(op => [`GET /api/git/${op}`, 'git.read']),
  ...['diff', 'log', 'file-log', 'hunks/list', 'blame'].map(op => [`POST /api/git/${op}`, 'git.read']),
  ...['stage', 'unstage', 'commit', 'checkout', 'hunks/stage', 'hunks/unstage'].map(op => [`POST /api/git/${op}`, 'git.mutate']),
  ['POST /api/git/push', 'git.push'],
  ['GET /api/tasks', 'tasks.read'], ['GET /api/tasks/status', 'tasks.read'],
  ['GET /api/tasks/matchers', 'tasks.read'], ['GET /api/tasks/cache/stats', 'tasks.read'],
  // POST /api/tasks/run and POST /api/tasks/cache/clear are route-owned
  // descriptors (routes/tasks.ts); they must not also carry central policy
  // metadata (one declared owner per route).
  ['POST /api/tasks/stop', 'tasks.stop'],
  ['POST /api/terminal/run', 'terminal.run'],
  ['GET /api/desktop/status', 'desktop.read'], ['POST /api/desktop/action', 'desktop.action'],
  ['POST /api/desktop/grants', 'desktop.grants'], ['POST /api/desktop/panic', 'desktop.panic'],
  ['POST /api/desktop/pending', 'capability.write'], ['GET /api/desktop/pending', 'desktop.read'],
  ['GET /api/desktop/pending/verdict', 'desktop.read'], ['POST /api/desktop/pending/resolve', 'authority.grant'],
  ['POST /api/agent/start', 'agent.start'], ['POST /api/agent/decision', 'agent.decision'],
  ['POST /api/agent/tool', 'agent.tool'], ['GET /api/agent/status', 'agent.read'],
  ['GET /api/agent/sessions', 'agent.read'],
  ['GET /api/audit/events', 'capability.read'], ['GET /api/audit/session', 'capability.read'],
  ['GET /api/audit/bundle', 'capability.read'], ['GET /api/openapi.json', 'capability.read'],
  // Read-only notification/hook observation. Mutating notification/hook routes
  // carry exact route-owned descriptors (node/src/routes/notifications.ts).
  ['GET /api/notifications', 'capability.read'], ['GET /api/notifications/unread', 'capability.read'],
  ['GET /api/hooks', 'capability.read'],
  // Read-only Bucket-C surfaces. Mutating/executing Bucket-C routes carry exact
  // route-owned descriptors (academy.ts, exercise.ts, community.ts, plugins.ts,
  // replays.ts); no mutation is authorized by path enrollment alone.
  ['GET /api/academy', 'capability.read'], ['GET /api/academy/session', 'capability.read'],
  ['GET /api/academy/certificate', 'capability.read'], ['GET /api/academy/exercises/next', 'capability.read'],
  ['GET /api/academy/hint', 'capability.read'],
  ['GET /api/community', 'capability.read'],
  ['GET /api/plugins', 'capability.read'], ['GET /api/plugins/presets', 'capability.read'],
  ['GET /api/replays', 'capability.read'],
  ['GET /api/artifacts', 'capability.read'],
  // Phase 2A wave 2: READY-CENTRAL disposition from the 208-route policy
  // matrix. Pure reads and side-effect-free compute only; every mutation and
  // execution remains unenrolled until an exact descriptor is authorized.
  ['GET /api/session', 'capability.read'], ['GET /api/settings', 'capability.read'],
  ['GET /api/models/status', 'capability.read'], ['GET /api/model/ready', 'capability.read'],
  ['GET /api/models/routes', 'capability.read'],
  ['GET /api/chat/history', 'capability.read'],
  ['GET /api/providers', 'capability.read'], ['GET /api/byok/status', 'capability.read'],
  ['GET /api/learner/state', 'capability.read'], ['GET /api/learner/reviews', 'capability.read'],
  ['GET /api/training/datasets', 'capability.read'], ['GET /api/training/datasets/read', 'capability.read'],
  ['GET /api/training/presets', 'capability.read'], ['GET /api/training/status', 'capability.read'],
  ['GET /api/training/checkpoints', 'capability.read'], ['GET /api/training/exports', 'capability.read'],
  ['GET /api/commands', 'capability.read'], ['GET /api/keybindings', 'capability.read'],
  ['POST /api/keybindings/resolve', 'capability.read'],
  ['GET /api/rg/quick-open', 'capability.read'], ['GET /api/rg/files', 'capability.read'],
  ['POST /api/rg/search', 'capability.read'],
  ['GET /api/editor/options', 'capability.read'],
  ['GET /api/modelhub/files', 'capability.read'], ['GET /api/modelhub/downloads', 'capability.read'],
  ['POST /api/problems/parse', 'capability.read'],
  ['GET /api/orch/context', 'capability.read'],
  // GET /api/memory/digests is NOT centrally enrolled: it refreshes day
  // digests and drives the Helix cascade, so it carries an exact route-owned
  // capability.write descriptor (node/src/routes/memory.ts).
  ['GET /api/workbenches', 'capability.read'], ['POST /api/workbenches/detail', 'capability.read'],
  ['GET /api/workbench/worktree/list', 'capability.read'],
  ['GET /api/onboarding/state', 'capability.read'], ['GET /api/system-map/snapshot', 'capability.read'],
  ['GET /api/resident/summary', 'capability.read'], ['GET /api/resident/context', 'capability.read'],
  ['GET /api/resident/push-summary', 'capability.read'], ['GET /api/resident/decisions', 'capability.read'],
  ['GET /api/experts', 'capability.read'], ['GET /api/experts/stats', 'capability.read'],
  ['GET /api/hardware/profile', 'capability.read'], ['GET /api/hardware/recommend', 'capability.read'],
  ['GET /api/closed-loop/status', 'capability.read'],
  ['GET /api/index/status', 'capability.read'], ['GET /api/index/search', 'capability.read'],
  ['GET /api/handoff/bundles', 'capability.read'], ['GET /api/handoff/bundles/get', 'capability.read'],
  ['GET /api/lsp/status', 'capability.read'],
  ['POST /api/lsp/completion', 'capability.read'], ['POST /api/lsp/hover', 'capability.read'],
  ['POST /api/lsp/definition', 'capability.read'],
  ['GET /api/dap/status', 'capability.read'], ['GET /api/dap/state', 'capability.read'],
  // Phase 2A wave 3R: pure read/compute routes proven in the descriptor design
  // pass (no durable effect, no process, no egress).
  ['POST /api/models/route', 'capability.read'], ['POST /api/models/fit', 'capability.read'],
  ['POST /api/training/export-eval', 'capability.read']
]);

export function httpOperationKind(method, routePath) {
  return HTTP_POLICY.get(`${method} ${routePath}`) ?? null;
}

export function legacyOperation(workspace, request, snapshot = null) {
  const url = new URL(request.path, 'http://127.0.0.1');
  const kind = httpOperationKind(request.method, url.pathname);
  if (!kind || !request.path.startsWith('/') || request.path.startsWith('//') || url.hash) throw new TypeError('legacy capability has no authority policy');
  return { workspace, taskId: request.task_id, kind,
    args: { adapter: 'legacy', method: request.method, path: url.pathname,
      query: Object.fromEntries(url.searchParams), body: request.body ?? {}, snapshot } };
}

function canonical(value, depth = 0) {
  if (depth > 32) throw new TypeError('operation nesting limit exceeded');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(item => canonical(item, depth + 1)));
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError('operation must contain plain JSON values');
  }
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new TypeError('unsafe operation key');
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property || !('value' in property)) throw new TypeError('operation accessors are not allowed');
    result[key] = canonical(property.value, depth + 1);
  }
  return Object.freeze(result);
}

export function normalizeOperation({ workspace, taskId, kind, args }) {
  if (typeof workspace !== 'string' || !workspace || typeof taskId !== 'string' || !taskId || taskId.length > 256) {
    throw new TypeError('workspace and bounded task identity are required');
  }
  if (!Object.hasOwn(OPERATION_POLICY, kind)) throw new TypeError('unknown capability');
  const data = canonical({ workspace, taskId, kind, args });
  const json = JSON.stringify(data);
  if (Buffer.byteLength(json) > 5 * 1024 * 1024) throw new TypeError('operation size limit exceeded');
  return Object.freeze({ ...data, risk: OPERATION_POLICY[kind], digest: createHash('sha256').update(json).digest('hex') });
}

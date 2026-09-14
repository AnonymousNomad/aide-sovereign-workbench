import path from 'node:path';
import { SessionGetResponse, SessionPutRequest, SessionPutResponse } from '../../../common/contracts/session.ts';
import { RouteError, type Route } from '../server.ts';
import type { OperationInput } from '../../../common/security/operation-policy.mjs';
import type { SessionStore } from '../services/session-store.ts';

// The session store owns a single workspace session file; the descriptor binds
// the exact patch that will be merged into it. The file anchor fails closed if
// the production layout is absent.
function workspaceOf(store: SessionStore): string {
  const aideDir = path.dirname(store.file);
  if (path.basename(aideDir) !== '.aide') throw new RouteError('FORBIDDEN', 'workspace anchor unavailable');
  return path.dirname(aideDir);
}

export function routeForSessionGet(store: SessionStore): Route {
  return {
    method: 'GET',
    path: '/api/session',
    response: SessionGetResponse,
    handler: () => store.load()
  };
}

export function routeForSessionPut(store: SessionStore): Route {
  return {
    method: 'PUT',
    path: '/api/session',
    body: SessionPutRequest,
    response: SessionPutResponse,
    describeOperation: async ({ body }, taskId): Promise<OperationInput> => ({
      workspace: workspaceOf(store), taskId, kind: 'capability.write', args: { body }
    }),
    handler: ({ body }) => store.save(body as Parameters<SessionStore['save']>[0])
  };
}
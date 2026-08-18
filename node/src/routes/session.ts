import { SessionGetResponse, SessionPutRequest, SessionPutResponse } from '../../../common/contracts/session.ts';
import type { Route } from '../server.ts';
import type { SessionStore } from '../services/session-store.ts';

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
    handler: ({ body }) => store.save(body as Parameters<SessionStore['save']>[0])
  };
}
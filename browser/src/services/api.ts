import type { ZodType } from 'zod';
import { Envelope } from '../../../common/errors.ts';
import {
  FileReadQuery,
  FileReadResponse,
  type FileReadResponseT,
  FileWriteRequest,
  FileWriteResponse,
  type FileWriteResponseT
} from '../../../common/contracts/file.ts';
import { HealthResponse, type HealthResponseT } from '../../../common/contracts/health.ts';
import {
  WorkspaceListResponse,
  type WorkspaceListResponseT
} from '../../../common/contracts/workspace.ts';
import {
  SessionFile,
  type SessionFileT
} from '../../../common/contracts/session.ts';
import { egressFetch } from './egress.ts';

export class ApiError extends Error {
  readonly code: string;
  readonly detail: unknown;

  constructor(code: string, message: string, detail?: unknown) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

export async function call<T>(path: string, opts: { query?: unknown; body?: unknown; schema: ZodType<T> }): Promise<T> {
  const url = opts.query ? `${path}?${new URLSearchParams(opts.query as Record<string, string>).toString()}` : path;
  const init: RequestInit = {
    method: opts.body !== undefined ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json' }
  };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
  const res = await egressFetch(url, init);
  let env: unknown;
  try {
    env = await res.json();
  } catch {
    throw new ApiError('BAD_RESPONSE', `daemon returned non-JSON status ${res.status}`);
  }
  const parsedEnv = Envelope.safeParse(env);
  if (!parsedEnv.success) throw new ApiError('BAD_RESPONSE', 'invalid response envelope', parsedEnv.error.issues);
  if (!parsedEnv.data.ok) throw new ApiError(parsedEnv.data.error.code, parsedEnv.data.error.message, parsedEnv.data.error.detail);
  const parsedData = opts.schema.safeParse(parsedEnv.data.data);
  if (!parsedData.success) throw new ApiError('BAD_RESPONSE', 'response does not match contract', parsedData.error.issues);
  return parsedData.data;
}

export const api = {
  health(): Promise<HealthResponseT> {
    return call('/api/health', { schema: HealthResponse });
  },
  workspaceList(): Promise<WorkspaceListResponseT> {
    return call('/api/workspace', { schema: WorkspaceListResponse });
  },
  fileRead(path: string): Promise<FileReadResponseT> {
    const query = FileReadQuery.safeParse({ path });
    if (!query.success) throw new ApiError('BAD_REQUEST', 'invalid file path');
    return call('/api/file', { query: query.data, schema: FileReadResponse });
  },
  fileWrite(path: string, content: string): Promise<FileWriteResponseT> {
    const body = FileWriteRequest.safeParse({ path, content, approved: true });
    if (!body.success) throw new ApiError('BAD_REQUEST', 'invalid write request');
    return call('/api/file', { body: body.data, schema: FileWriteResponse });
  },
  sessionGet(): Promise<SessionFileT> {
    return call('/api/session', { schema: SessionFile });
  },
  sessionPut(session: SessionFileT): Promise<SessionFileT> {
    return call('/api/session', { body: session, schema: SessionFile });
  }
};
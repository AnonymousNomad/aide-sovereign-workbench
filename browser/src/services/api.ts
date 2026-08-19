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
import {
  SearchQuery,
  SearchResponse,
  type SearchResponseT,
  SearchReplaceRequest,
  SearchReplaceResponse,
  type SearchReplaceResponseT
} from '../../../common/contracts/search.ts';
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

export async function call<T>(path: string, opts: { query?: unknown; body?: unknown; method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; schema: ZodType<T> }): Promise<T> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries((opts.query ?? {}) as Record<string, unknown>)) {
    if (value !== undefined) params.append(key, String(value));
  }
  const url = params.size > 0 ? `${path}?${params.toString()}` : path;
  const method = opts.method ?? (opts.body !== undefined ? 'POST' : 'GET');
  const init: RequestInit = {
    method,
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
    return call('/api/file/write', { body: body.data, schema: FileWriteResponse });
  },
  search(q: string, opts: { regex?: boolean; icase?: boolean; word?: boolean; mask?: string } = {}): Promise<SearchResponseT> {
    const flag = (value: boolean | undefined): string | undefined => (value === undefined ? undefined : value ? '1' : '0');
    const query = SearchQuery.safeParse({ q, regex: flag(opts.regex), icase: flag(opts.icase), word: flag(opts.word), mask: opts.mask });
    if (!query.success) throw new ApiError('BAD_REQUEST', 'invalid search query');
    return call('/api/search', { query: query.data, schema: SearchResponse });
  },
  searchReplace(req: { query: string; replacement: string; regex?: boolean; icase?: boolean; word?: boolean; mask?: string }): Promise<SearchReplaceResponseT> {
    const body = SearchReplaceRequest.safeParse({ ...req, approved: true });
    if (!body.success) throw new ApiError('BAD_REQUEST', 'invalid replace request');
    return call('/api/search/replace', { body: body.data, schema: SearchReplaceResponse });
  },
  sessionGet(): Promise<SessionFileT> {
    return call('/api/session', { schema: SessionFile });
  },
  sessionPut(session: SessionFileT): Promise<SessionFileT> {
    return call('/api/session', { method: 'PUT', body: session, schema: SessionFile });
  }
};
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
import {
  LspStatusResponse,
  type LspStatusResponseT,
  LspStartRequest,
  type LspStartResponseT,
  LspStartResponse,
  LspOpenRequest,
  type LspOpenResponseT,
  LspOpenResponse,
  LspCloseRequest,
  type LspCloseResponseT,
  LspCloseResponse,
  LspChangeRequest,
  type LspChangeResponseT,
  LspChangeResponse,
  LspFeatureRequest,
  type LspPositionT,
  type LspCompletionItemT,
  LspCompletionResponse,
  LspHoverResponse,
  LspDefinitionResponse,
  type LspDefinitionLocationT
} from '../../../common/contracts/lsp.ts';
import {
  ModelStatusResponse,
  type ModelStatusResponseT
} from '../../../common/contracts/models.ts';
import {
  RoutesResponse,
  RouteRequest,
  RouteResponse,
  FitRequest,
  FitResponse,
  type RoutesResponseT,
  type RouteResponseT,
  type FitResponseT
} from '../../../common/contracts/routing.ts';
import {
  ChatResponse,
  type ChatResponseT,
  ChatStreamRequest,
  ChatHistoryResponse,
  type ChatHistoryResponseT,
  ChatHistorySaveRequest,
  ChatHistorySaveResponse,
  type ChatMessageT
} from '../../../common/contracts/chat.ts';
import { egressFetch } from './egress.ts';
import {
  ByokStatusResponse,
  ProviderSetRequest,
  IdRequest,
  KeyPutRequest,
  KeyPutResponse,
  RoutingPutRequest,
  ConsentPutRequest,
  ByokTestRequest,
  ByokTestResponse
} from '../../../common/contracts/byok.ts';
import type { ByokStatusResponseT, ByokTestResponseT, ProviderSetRequestT, KeyPutRequestT, RoutingPutRequestT } from '../../../common/contracts/byok.ts';
import {
  ProviderListResponse,
  ProviderConnectRequest,
  ProviderConnectResponse,
  ProviderDisconnectRequest,
  ProviderDisconnectResponse,
  ProviderImportRequest,
  ProviderImportResponse,
  type ProviderListResponseT,
  type ProviderConnectRequestT,
  type ProviderConnectResponseT,
  type ProviderDisconnectResponseT,
  type ProviderImportResponseT
} from '../../../common/contracts/providers.ts';
import {
  ResidentSummaryResponse,
  type ResidentSummaryResponseT
} from '../../../common/contracts/resident.ts';
import {
  WorkbenchListResponse,
  WorkbenchDetailResponse,
  WorkbenchUninstallResponse,
  WorkbenchInstallRequest,
  WorkbenchTrustRequest,
  WorkbenchUninstallRequest,
  type WorkbenchListResponseT,
  type WorkbenchDetailResponseT,
  type WorkbenchUninstallResponseT
} from '../../../common/contracts/workbench.ts';

export const API_FORMAT_HEADER = 'X-AIDE-API-Format';
export const API_FORMAT = 'envelope-v1';

export class ApiError extends Error {
  readonly code: string;
  readonly detail: unknown;

  constructor(code: string, message: string, detail?: unknown) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set(API_FORMAT_HEADER, API_FORMAT);
  return egressFetch(path, { ...init, headers });
}

async function throwResponseError(res: Response): Promise<never> {
  let env: unknown;
  try { env = await res.json(); }
  catch { throw new ApiError('BAD_RESPONSE', `daemon returned non-JSON status ${res.status}`); }
  const parsed = Envelope.safeParse(env);
  if (parsed.success && !parsed.data.ok) {
    throw new ApiError(parsed.data.error.code, parsed.data.error.message, parsed.data.error.detail);
  }
  throw new ApiError('BAD_RESPONSE', `daemon returned invalid error envelope status ${res.status}`);
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
  const res = await apiFetch(url, init);
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
  },
  lspStatus(): Promise<LspStatusResponseT> {
    return call('/api/lsp/status', { schema: LspStatusResponse });
  },
  lspStart(languageId: string): Promise<LspStartResponseT> {
    const body = LspStartRequest.safeParse({ languageId });
    if (!body.success) throw new ApiError('BAD_REQUEST', 'invalid lsp start request');
    return call('/api/lsp/start', { body: body.data, schema: LspStartResponse });
  },
  lspOpen(uri: string, languageId: string, text: string): Promise<LspOpenResponseT> {
    const body = LspOpenRequest.safeParse({ uri, languageId, text });
    if (!body.success) throw new ApiError('BAD_REQUEST', 'invalid lsp open request');
    return call('/api/lsp/open', { body: body.data, schema: LspOpenResponse });
  },
  lspClose(uri: string): Promise<LspCloseResponseT> {
    const body = LspCloseRequest.safeParse({ uri });
    if (!body.success) throw new ApiError('BAD_REQUEST', 'invalid lsp close request');
    return call('/api/lsp/close', { body: body.data, schema: LspCloseResponse });
  },
  lspChange(uri: string, text: string, version: number): Promise<LspChangeResponseT> {
    const body = LspChangeRequest.safeParse({ uri, text, version });
    if (!body.success) throw new ApiError('BAD_REQUEST', 'invalid lsp change request');
    return call('/api/lsp/change', { body: body.data, schema: LspChangeResponse });
  },
  lspCompletion(uri: string, position: LspPositionT): Promise<LspCompletionItemT[]> {
    const body = LspFeatureRequest.safeParse({ uri, position });
    if (!body.success) throw new ApiError('BAD_REQUEST', 'invalid lsp completion request');
    return call('/api/lsp/completion', { body: body.data, schema: LspCompletionResponse }).then(response => response.items);
  },
  lspHover(uri: string, position: LspPositionT): Promise<string> {
    const body = LspFeatureRequest.safeParse({ uri, position });
    if (!body.success) throw new ApiError('BAD_REQUEST', 'invalid lsp hover request');
    return call('/api/lsp/hover', { body: body.data, schema: LspHoverResponse }).then(response => response.contents);
  },
  lspDefinition(uri: string, position: LspPositionT): Promise<LspDefinitionLocationT[]> {
    const body = LspFeatureRequest.safeParse({ uri, position });
    if (!body.success) throw new ApiError('BAD_REQUEST', 'invalid lsp definition request');
    return call('/api/lsp/definition', { body: body.data, schema: LspDefinitionResponse }).then(response => response.locations);
  },
  modelsStatus(): Promise<ModelStatusResponseT> {
    return call('/api/models/status', { schema: ModelStatusResponse });
  },
  routes(): Promise<RoutesResponseT> {
    return call('/api/models/routes', { schema: RoutesResponse });
  },
  route(role: string): Promise<RouteResponseT> {
    const body = RouteRequest.safeParse({ role });
    if (!body.success) throw new ApiError('BAD_REQUEST', 'invalid route request');
    return call('/api/models/route', { body: body.data, schema: RouteResponse });
  },
  fit(messages: ChatMessageT[], contextLength: number): Promise<FitResponseT> {
    const body = FitRequest.safeParse({ messages, contextLength });
    if (!body.success) throw new ApiError('BAD_REQUEST', 'invalid fit request');
    return call('/api/models/fit', { body: body.data, schema: FitResponse });
  },
  chat(modelId: string, messages: ChatMessageT[]): Promise<ChatResponseT> {
    return call('/api/chat', { body: { modelId, messages }, schema: ChatResponse });
  },
  async chatStream(modelId: string, messages: ChatMessageT[], signal?: AbortSignal): Promise<Response> {
    const body = ChatStreamRequest.safeParse({ modelId, messages });
    if (!body.success) throw new ApiError('BAD_REQUEST', 'invalid chat stream request');
    const response = await apiFetch('/api/chat/stream', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body.data), ...(signal ? { signal } : {})
    });
    if (!response.ok) return throwResponseError(response);
    return response;
  },
  chatHistory(): Promise<ChatHistoryResponseT> {
    return call('/api/chat/history', { schema: ChatHistoryResponse });
  },
  chatHistorySave(conversation: { id?: string; modelId: string; title: string; messages: ChatMessageT[] }): Promise<{ id: string; updatedAt: number }> {
    const body = ChatHistorySaveRequest.safeParse(conversation);
    if (!body.success) throw new ApiError('BAD_REQUEST', 'invalid chat history save');
    return call('/api/chat/history', { body: body.data, schema: ChatHistorySaveResponse });
  },
  providers(): Promise<ProviderListResponseT> {
    return call('/api/providers', { schema: ProviderListResponse });
  },
  providerConnect(request: ProviderConnectRequestT): Promise<ProviderConnectResponseT> {
    const body = ProviderConnectRequest.safeParse(request);
    if (!body.success) throw new ApiError('BAD_REQUEST', 'invalid provider connect request');
    return call('/api/providers/connect', { body: body.data, schema: ProviderConnectResponse });
  },
  providerDisconnect(providerId: string): Promise<ProviderDisconnectResponseT> {
    const body = ProviderDisconnectRequest.safeParse({ providerId });
    if (!body.success) throw new ApiError('BAD_REQUEST', 'invalid provider disconnect request');
    return call('/api/providers/disconnect', { body: body.data, schema: ProviderDisconnectResponse });
  },
  providerImport(format: 'chatgpt' | 'claude', payload: string): Promise<ProviderImportResponseT> {
    const body = ProviderImportRequest.safeParse({ format, payload });
    if (!body.success) throw new ApiError('BAD_REQUEST', 'invalid import request');
    return call('/api/providers/import', { body: body.data, schema: ProviderImportResponse });
  },
  byokStatus(): Promise<ByokStatusResponseT> {
    return call('/api/byok/status', { schema: ByokStatusResponse });
  },
  async byokSetProvider(provider: ProviderSetRequestT['provider']): Promise<void> {
    const body = ProviderSetRequest.safeParse({ provider });
    if (!body.success) throw new ApiError('BAD_REQUEST', 'invalid provider config');
    await call('/api/byok/providers/set', { method: 'PUT', body: body.data, schema: ByokStatusResponse.pick({ providers: true }) });
  },
  async byokDeleteProvider(id: string): Promise<void> {
    const body = IdRequest.safeParse({ id });
    if (!body.success) throw new ApiError('BAD_REQUEST', 'invalid provider id');
    await call('/api/byok/providers/delete', { method: 'DELETE', body: body.data, schema: ByokStatusResponse.pick({ providers: true }) });
  },
  async byokPutKey(providerId: string, apiKey: string): Promise<void> {
    const body = KeyPutRequest.safeParse({ provider_id: providerId, api_key: apiKey } satisfies KeyPutRequestT);
    if (!body.success) throw new ApiError('BAD_REQUEST', 'invalid key payload');
    await call('/api/byok/key', { method: 'PUT', body: body.data, schema: KeyPutResponse });
  },
  async byokSetRouting(routing: RoutingPutRequestT['routing']): Promise<void> {
    const body = RoutingPutRequest.safeParse({ routing });
    if (!body.success) throw new ApiError('BAD_REQUEST', 'invalid routing');
    await call('/api/byok/routing', { method: 'PUT', body: body.data, schema: ByokStatusResponse.pick({ routing: true }) });
  },
  async byokConsent(enabled: boolean): Promise<void> {
    const body = ConsentPutRequest.safeParse({ enabled });
    if (!body.success) throw new ApiError('BAD_REQUEST', 'invalid consent payload');
    await call('/api/byok/consent', { method: 'PUT', body: body.data, schema: ByokStatusResponse.pick({ consent_enabled: true }) });
  },
  byokTest(providerId: string): Promise<ByokTestResponseT> {
    const body = ByokTestRequest.safeParse({ provider_id: providerId });
    if (!body.success) throw new ApiError('BAD_REQUEST', 'invalid test request');
    return call('/api/byok/test', { method: 'POST', body: body.data, schema: ByokTestResponse });
  },
  residentSummary(): Promise<ResidentSummaryResponseT> {
    return call('/api/resident/summary', { schema: ResidentSummaryResponse });
  },
  workbenches(): Promise<WorkbenchListResponseT> {
    return call('/api/workbenches', { schema: WorkbenchListResponse });
  },
  workbenchInstall(id: string): Promise<WorkbenchDetailResponseT> {
    const body = WorkbenchInstallRequest.safeParse({ id });
    if (!body.success) throw new ApiError('BAD_REQUEST', 'invalid workbench install request');
    return call('/api/workbenches/install', { body: body.data, schema: WorkbenchDetailResponse });
  },
  workbenchTrust(id: string, server: string, trusted: boolean): Promise<WorkbenchDetailResponseT> {
    const body = WorkbenchTrustRequest.safeParse({ id, server, trusted });
    if (!body.success) throw new ApiError('BAD_REQUEST', 'invalid workbench trust request');
    return call('/api/workbenches/trust', { body: body.data, schema: WorkbenchDetailResponse });
  },
  workbenchUninstall(id: string): Promise<WorkbenchUninstallResponseT> {
    const body = WorkbenchUninstallRequest.safeParse({ id });
    if (!body.success) throw new ApiError('BAD_REQUEST', 'invalid workbench uninstall request');
    return call('/api/workbenches/uninstall', { body: body.data, schema: WorkbenchUninstallResponse });
  }
};

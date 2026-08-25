import type { ModelRuntime } from './model-runtime.ts';
import type { ProviderService } from './providers.ts';
import { BUILTIN_PROVIDERS } from './providers.ts';
import { fitHistory } from './history-fit.ts';
import type { ChatMessageT } from '../../../common/contracts/chat.ts';
import type { RouteFallbackT, RouteStatusT } from '../../../common/contracts/routing.ts';

export type RouteFailureReason = 'down' | 'busy' | 'unsupported' | 'context_overflow';

export class RouterError extends Error {
  readonly reason: RouteFailureReason;
  readonly code: 'NOT_READY' | 'CHILD_FAILED';

  constructor(reason: RouteFailureReason, message: string) {
    super(message);
    this.reason = reason;
    this.code = reason === 'down' || reason === 'busy' ? 'NOT_READY' : 'CHILD_FAILED';
  }
}

export interface ModelRoute {
  id: string;
  displayName: string;
  providerType: 'local' | 'cloud';
  baseUrl: string;
  modelString: string;
  contextLength: number;
  chatTemplate: string;
  status: RouteStatusT;
  probeMs: number | null;
  roles: string[];
  capabilities: string[];
}

export interface RouteSelection {
  modelId: string;
  displayName: string;
  providerType: 'local' | 'cloud';
  status: RouteStatusT;
  contextLength: number;
  fellBack?: RouteFallbackT;
}

export interface RouteChatResult {
  text: string;
  modelId: string;
  tokens?: number;
  timingMs: number;
  usedApprox: number;
  dropped: number;
  truncatedSystem: boolean;
}

const PROBE_TTL_MS = 30_000;
const LOCAL_PROBE_TIMEOUT_MS = 3_000;

function normalizeOptions(options: { maxTokens?: number | undefined; temperature?: number | undefined; timeoutMs?: number | undefined }): { maxTokens?: number; temperature?: number; timeoutMs?: number } {
  const out: { maxTokens?: number; temperature?: number; timeoutMs?: number } = {};
  if (options.maxTokens !== undefined) out.maxTokens = options.maxTokens;
  if (options.temperature !== undefined) out.temperature = options.temperature;
  if (options.timeoutMs !== undefined) out.timeoutMs = options.timeoutMs;
  return out;
}

export class ModelRouter {
  private readonly runtime: ModelRuntime;
  private readonly providers: ProviderService;
  private readonly health = new Map<string, { status: RouteStatusT; at: number }>();

  constructor(runtime: ModelRuntime, providers: ProviderService) {
    this.runtime = runtime;
    this.providers = providers;
  }

  private localRoute(entry: { id: string; name: string; endpoint: string; model: string; context_tokens: number; roles: string[] }): ModelRoute {
    return {
      id: `local:${entry.id}`,
      displayName: entry.name,
      providerType: 'local',
      baseUrl: entry.endpoint,
      modelString: entry.model,
      contextLength: entry.context_tokens,
      chatTemplate: 'gguf-metadata',
      status: 'unverified',
      probeMs: null,
      roles: entry.roles,
      capabilities: []
    };
  }

  private cloudRoutes(): ModelRoute[] {
    const routes: ModelRoute[] = [];
    for (const provider of BUILTIN_PROVIDERS) {
      for (const model of provider.models) {
        routes.push({
          id: `cloud:${provider.id}:${model}`,
          displayName: `${provider.name} · ${model}`,
          providerType: 'cloud',
          baseUrl: provider.baseUrl,
          modelString: model,
          contextLength: provider.contextLength,
          chatTemplate: 'provider',
          status: 'unverified',
          probeMs: null,
          roles: ['chat'],
          capabilities: []
        });
      }
    }
    return routes;
  }

  async routes(): Promise<ModelRoute[]> {
    const status = await this.runtime.status();
    const running = new Set(status.models.filter(model => model.status === 'running').map(model => String(model.id)));
    const local = this.runtime.list().map(entry => {
      const route = this.localRoute(entry);
      if (running.has(entry.id)) {
        const health = this.health.get(route.id);
        route.status = health !== undefined && Date.now() - health.at < PROBE_TTL_MS ? health.status : 'unverified';
        route.probeMs = health?.at ?? null;
      } else {
        route.status = entry.status === 'ready' ? 'unverified' : 'down';
        route.probeMs = null;
      }
      return route;
    });
    const connected = new Set(await this.providers.list().then(list => list.filter(provider => provider.status === 'connected').map(provider => provider.id)));
    const cloud = this.cloudRoutes().map(route => {
      const providerId = route.id.split(':')[1]!;
      if (connected.has(providerId)) {
        const health = this.health.get(route.id);
        route.status = health !== undefined && Date.now() - health.at < PROBE_TTL_MS ? health.status : 'unverified';
        route.probeMs = health?.at ?? null;
      } else {
        route.status = 'down';
        route.probeMs = null;
      }
      return route;
    });
    return [...local, ...cloud];
  }

  async probe(id: string): Promise<RouteStatusT> {
    const route = (await this.routes()).find(entry => entry.id === id);
    if (route === undefined) return 'down';
    let status: RouteStatusT;
    let at = Date.now();
    if (route.providerType === 'local') {
      const modelId = id.slice('local:'.length);
      const result = await this.runtime.verifyEndpointModel(modelId, LOCAL_PROBE_TIMEOUT_MS).catch(() => ({ ready: false as const }));
      status = result.ready ? 'ready' : 'down';
    } else {
      const parts = id.split(':');
      const providerId = parts[1]!;
      const list = await this.providers.list();
      const provider = list.find(entry => entry.id === providerId);
      status = provider !== undefined && provider.status === 'connected' ? 'ready' : 'down';
      if (provider !== undefined && provider.status === 'connected') at = Date.now();
    }
    this.health.set(id, { status, at });
    return status;
  }

  private async freshStatus(id: string): Promise<RouteStatusT> {
    const health = this.health.get(id);
    if (health !== undefined && Date.now() - health.at < PROBE_TTL_MS) return health.status;
    return this.probe(id);
  }

  async routeForRole(role: string): Promise<RouteSelection> {
    const routes = await this.routes();
    const candidates = routes.filter(route => route.providerType === 'local' && route.roles.includes(role));
    if (candidates.length === 0) {
      throw new RouterError('down', `no local model is configured for role "${role}"`);
    }
    for (const candidate of candidates) {
      const status = await this.freshStatus(candidate.id);
      if (status === 'ready') {
        const fellBack = candidate.id !== candidates[0]!.id ? { from: candidates[0]!.id, to: candidate.id, reason: 'down' as const } : undefined;
        return { modelId: candidate.id, displayName: candidate.displayName, providerType: candidate.providerType, status, contextLength: candidate.contextLength, ...(fellBack !== undefined ? { fellBack } : {}) };
      }
    }
    throw new RouterError('down', `no model is ready for role "${role}"; start this model in the models panel and try again`);
  }

  async routeForId(id: string): Promise<RouteSelection> {
    const routes = await this.routes();
    const route = routes.find(entry => entry.id === id) ?? routes.find(entry => entry.id === `local:${id}`);
    if (route === undefined) throw new RouterError('down', `start this model before chatting: route ${id} is not available`);
    const status = await this.freshStatus(id);
    if (status === 'ready') {
      return { modelId: route.id, displayName: route.displayName, providerType: route.providerType, status, contextLength: route.contextLength };
    }
    const role = route.roles[0] ?? 'chat';
    const fallback = await this.routeForRole(role).catch(() => null);
    if (fallback === null) throw new RouterError('down', `start this model before chatting: route ${id} is down (${status}) and no fallback is ready`);
    return {
      modelId: fallback.modelId,
      displayName: fallback.displayName,
      providerType: fallback.providerType,
      status: fallback.status,
      contextLength: fallback.contextLength,
      fellBack: { from: id, to: fallback.modelId, reason: 'down' }
    };
  }

  private async resolve(routeId: string): Promise<{ route: ModelRoute; selection: RouteSelection }> {
    const routes = await this.routes();
    // Accept bare manifest ids ('smollm2-360m-q8') as well as fully-qualified
    // 'local:<id>' route ids — callers use both forms interchangeably.
    const direct = routes.find(entry => entry.id === routeId)
      ?? routes.find(entry => entry.id === `local:${routeId}`);
    if (direct === undefined) throw new RouterError('down', `unknown route ${routeId}`);
    if ((await this.freshStatus(direct.id)) === 'ready') {
      return { route: direct, selection: { modelId: direct.id, displayName: direct.displayName, providerType: direct.providerType, status: 'ready', contextLength: direct.contextLength } };
    }
    const selection = await this.routeForId(routeId);
    const fallback = routes.find(entry => entry.id === selection.modelId);
    if (fallback === undefined) throw new RouterError('down', `fallback route ${selection.modelId} disappeared`);
    return { route: fallback, selection };
  }

  async chat(routeId: string, messages: ChatMessageT[], options: { maxTokens?: number | undefined; temperature?: number | undefined; timeoutMs?: number | undefined } = {}): Promise<RouteChatResult> {
    const { route, selection } = await this.resolve(routeId);
    const fit = fitHistory(messages, route.contextLength, options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {});
    const chatOptions = normalizeOptions(options);
    let result: { text: string; modelId: string; tokens?: number; timingMs: number };
    try {
      if (route.providerType === 'local') {
        result = await this.runtime.chat(route.id.slice('local:'.length), fit.messages, chatOptions);
      } else {
        const parts = route.id.split(':');
        result = await this.providers.chat(parts[1]!, route.modelString, fit.messages, chatOptions);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('busy')) throw new RouterError('busy', error.message);
      if (error instanceof Error && error.message.includes('timed out')) throw new RouterError('busy', error.message);
      throw error;
    }
    const out: RouteChatResult = {
      text: result.text,
      modelId: selection.modelId,
      timingMs: result.timingMs,
      usedApprox: fit.estimatedTokens,
      dropped: fit.dropped,
      truncatedSystem: fit.truncatedSystem
    };
    if (result.tokens !== undefined) out.tokens = result.tokens;
    return out;
  }

  async chatStream(routeId: string, messages: ChatMessageT[], onDelta: (delta: string) => void, signal: AbortSignal, options: { maxTokens?: number | undefined } = {}): Promise<RouteChatResult> {
    const { route, selection } = await this.resolve(routeId);
    const fit = fitHistory(messages, route.contextLength, options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {});
    const chatOptions = normalizeOptions(options);
    let result: { text: string; modelId: string; tokens?: number; timingMs: number };
    if (route.providerType === 'local') {
      const modelId = route.id.slice('local:'.length);
      const started = Date.now();
      let text = '';
      await this.runtime.chatStream(modelId, fit.messages, delta => {
        text += delta;
        onDelta(delta);
      }, signal, chatOptions);
      result = { text, modelId, timingMs: Date.now() - started };
    } else {
      const parts = route.id.split(':');
      result = await this.providers.chat(parts[1]!, route.modelString, fit.messages, chatOptions);
      onDelta(result.text);
    }
    const out: RouteChatResult = {
      text: result.text,
      modelId: selection.modelId,
      timingMs: result.timingMs,
      usedApprox: fit.estimatedTokens,
      dropped: fit.dropped,
      truncatedSystem: fit.truncatedSystem
    };
    if (result.tokens !== undefined) out.tokens = result.tokens;
    return out;
  }
}
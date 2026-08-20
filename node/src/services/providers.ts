import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { CredentialStore } from './credentials.ts';
import { scrubKey } from './credentials.ts';
import type { ProviderConnectRequestT, ProviderInfoT } from '../../../common/contracts/providers.ts';

export interface ProviderDefinition {
  id: string;
  name: string;
  kind: 'openai-compatible' | 'anthropic';
  baseUrl: string;
  models: string[];
  contextLength: number;
  egressHost: string;
}

export const BUILTIN_PROVIDERS: ProviderDefinition[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    kind: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o-mini', 'gpt-4o'],
    contextLength: 128000,
    egressHost: 'api.openai.com'
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    models: ['claude-3-5-haiku-latest', 'claude-3-5-sonnet-latest'],
    contextLength: 200000,
    egressHost: 'api.anthropic.com'
  },
  {
    id: 'google',
    name: 'Google Gemini',
    kind: 'openai-compatible',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: ['gemini-2.0-flash'],
    contextLength: 1048576,
    egressHost: 'generativelanguage.googleapis.com'
  },
  {
    id: 'mistral',
    name: 'Mistral',
    kind: 'openai-compatible',
    baseUrl: 'https://api.mistral.ai/v1',
    models: ['mistral-small-latest'],
    contextLength: 32768,
    egressHost: 'api.mistral.ai'
  },
  {
    id: 'groq',
    name: 'Groq',
    kind: 'openai-compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: ['llama-3.3-70b-versatile'],
    contextLength: 128000,
    egressHost: 'api.groq.com'
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    kind: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: ['openrouter/auto'],
    contextLength: 128000,
    egressHost: 'openrouter.ai'
  }
];

export type ProbeResult = 'connected' | 'invalid_key' | 'unreachable';

export interface ProviderServiceOptions {
  credentials: CredentialStore;
  fetchFn?: typeof fetch;
  allowlistFile?: string;
  logger?: { info(message: string): void } | undefined;
}

export class ProviderError extends Error {
  readonly code: 'FORBIDDEN' | 'NOT_READY' | 'CHILD_FAILED';

  constructor(code: 'FORBIDDEN' | 'NOT_READY' | 'CHILD_FAILED', message: string) {
    super(message);
    this.code = code;
  }
}

interface AllowlistFile {
  version: number;
  hosts: string[];
}

interface ProbeCacheEntry {
  status: Exclude<ProbeResult, 'connected'> | 'connected';
  at: number;
}

const PROBE_TIMEOUT_MS = 5_000;
const PROBE_CACHE_TTL_MS = 60_000;

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export class ProviderService {
  private readonly credentials: CredentialStore;
  private readonly fetchFn: typeof fetch;
  private readonly allowlistPath: string;
  private readonly logger: { info(message: string): void } | undefined;
  private allowlist: Set<string> | null = null;
  private readonly probeCache = new Map<string, ProbeCacheEntry>();

  constructor(workspace: string, options: ProviderServiceOptions) {
    this.credentials = options.credentials;
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.allowlistPath = options.allowlistFile ?? path.join(workspace, '.aide', 'provider-hosts.json');
    this.logger = options.logger;
  }

  async list(): Promise<ProviderInfoT[]> {
    const connected = new Set(await this.credentials.ids());
    return BUILTIN_PROVIDERS.map(provider => {
      let status: ProviderInfoT['status'] = 'not_connected';
      if (connected.has(provider.id)) {
        const cached = this.probeCache.get(provider.id);
        status = cached !== undefined && Date.now() - cached.at < PROBE_CACHE_TTL_MS ? cached.status : 'connected';
      }
      return {
        id: provider.id,
        name: provider.name,
        kind: provider.kind,
        baseUrl: provider.baseUrl,
        models: provider.models,
        status
      };
    });
  }

  async connect(request: ProviderConnectRequestT): Promise<{ status: ProbeResult; message: string }> {
    const provider = BUILTIN_PROVIDERS.find(entry => entry.id === request.providerId);
    if (provider === undefined) throw new ProviderError('NOT_READY', `unknown provider ${request.providerId}`);
    const baseUrl = request.baseUrl ?? provider.baseUrl;
    const host = hostOf(baseUrl);
    if (host.length === 0) throw new ProviderError('FORBIDDEN', 'invalid provider base URL');
    const builtin = host === provider.egressHost;
    if (!builtin && !(await this.isHostApproved(host))) {
      if (request.approveHost !== true) {
        throw new ProviderError('FORBIDDEN', `host ${host} is not approved; approve it explicitly to connect`);
      }
      await this.approveHost(host);
    }
    if (!(await this.credentials.available())) {
      throw new ProviderError('NOT_READY', 'credential store unavailable on this platform');
    }
    await this.credentials.set(request.providerId, request.key);
    const model = request.model ?? provider.models[0]!;
    const probe = await this.probe(provider, request.key, baseUrl, model, host);
    this.probeCache.set(request.providerId, { status: probe, at: Date.now() });
    this.logger?.info(`PROVIDER: ${provider.id} probe -> ${probe} (host=${host}, model=${model})`);
    const message =
      probe === 'connected'
        ? `connected (${model})`
        : probe === 'invalid_key'
          ? 'the key was rejected by the provider'
          : 'the provider could not be reached';
    return { status: probe, message };
  }

  async disconnect(providerId: string): Promise<void> {
    this.probeCache.delete(providerId);
    await this.credentials.delete(providerId);
  }

  async chat(
    providerId: string,
    model: string,
    messages: Array<{ role: string; content: string }>,
    options: { maxTokens?: number; temperature?: number } = {}
  ): Promise<{ text: string; modelId: string; tokens?: number; timingMs: number }> {
    const provider = BUILTIN_PROVIDERS.find(entry => entry.id === providerId);
    if (provider === undefined) throw new ProviderError('NOT_READY', `unknown provider ${providerId}`);
    const key = await this.credentials.get(providerId);
    if (key === undefined) throw new ProviderError('NOT_READY', `provider ${providerId} is not connected`);
    const baseUrl = provider.baseUrl.replace(/\/$/, '');
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
      let response: Response;
      if (provider.kind === 'anthropic') {
        const systemParts = messages.filter(message => message.role === 'system' || message.role === 'developer').map(message => message.content);
        const conversation: Array<{ role: string; content: string }> = [];
        for (const message of messages) {
          if (message.role === 'system' || message.role === 'developer') continue;
          const previous = conversation[conversation.length - 1];
          if (previous !== undefined && previous.role === message.role) previous.content += `\n${message.content}`;
          else conversation.push({ role: message.role, content: message.content });
        }
        const body: Record<string, unknown> = {
          model,
          max_tokens: Math.min(options.maxTokens ?? 512, 8192),
          messages: conversation
        };
        if (systemParts.length > 0) body.system = systemParts.join('\n');
        response = await this.fetchFn(`${baseUrl}/messages`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': key,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify(body),
          signal: controller.signal
        });
      } else {
        response = await this.fetchFn(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${key}`
          },
          body: JSON.stringify({
            model,
            messages,
            temperature: options.temperature ?? 0.2,
            max_tokens: Math.min(options.maxTokens ?? 512, 8192)
          }),
          signal: controller.signal
        });
      }
      if (response.status === 429 || response.status === 503) throw new ProviderError('CHILD_FAILED', `provider ${providerId} is busy (HTTP ${response.status})`);
      if (response.status === 401 || response.status === 403) throw new ProviderError('NOT_READY', `provider ${providerId} rejected the stored key (HTTP ${response.status})`);
      if (!response.ok) throw new ProviderError('CHILD_FAILED', `provider ${providerId} returned HTTP ${response.status}`);
      const payload = (await response.json().catch(() => {
        throw new ProviderError('CHILD_FAILED', `provider ${providerId} returned non-JSON`);
      })) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { completion_tokens?: number };
        content?: Array<{ type?: string; text?: string }>;
      };
      const text =
        provider.kind === 'anthropic'
          ? (payload.content ?? []).map(block => block.text ?? '').join('')
          : payload.choices?.[0]?.message?.content ?? '';
      if (text.length === 0) throw new ProviderError('CHILD_FAILED', `provider ${providerId} returned an empty response`);
      const result: { text: string; modelId: string; tokens?: number; timingMs: number } = {
        text,
        modelId: `${providerId}:${model}`,
        timingMs: Date.now() - started
      };
      const tokens = payload.usage?.completion_tokens;
      if (tokens !== undefined) result.tokens = tokens;
      return result;
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (error instanceof Error && error.name === 'AbortError') throw new ProviderError('CHILD_FAILED', `provider ${providerId} timed out after 60s`);
      const message = error instanceof Error ? error.message : String(error);
      throw new ProviderError('CHILD_FAILED', scrubKey(message, key));
    } finally {
      clearTimeout(timer);
    }
  }

  private async probe(
    provider: ProviderDefinition,
    key: string,
    baseUrl: string,
    model: string,
    host: string
  ): Promise<ProbeResult> {
    if (!(await this.isHostApproved(host)) && host !== provider.egressHost) return 'unreachable';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      let response: Response;
      if (provider.kind === 'anthropic') {
        response = await this.fetchFn(`${baseUrl.replace(/\/$/, '')}/messages`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': key,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
          signal: controller.signal
        });
      } else {
        response = await this.fetchFn(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${key}`
          },
          body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
          signal: controller.signal
        });
      }
      if (response.status >= 200 && response.status < 300) return 'connected';
      if (response.status === 401 || response.status === 403) return 'invalid_key';
      return 'unreachable';
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return 'unreachable';
      const message = error instanceof Error ? error.message : String(error);
      this.logger?.info(`PROVIDER: ${provider.id} probe error: ${scrubKey(message, key)}`);
      return 'unreachable';
    } finally {
      clearTimeout(timer);
    }
  }

  private async isHostApproved(host: string): Promise<boolean> {
    if (this.allowlist === null) await this.loadAllowlist();
    return this.allowlist!.has(host);
  }

  private async approveHost(host: string): Promise<void> {
    if (this.allowlist === null) await this.loadAllowlist();
    this.allowlist!.add(host);
    await fs.mkdir(path.dirname(this.allowlistPath), { recursive: true }).catch(() => {});
    const file: AllowlistFile = { version: 1, hosts: [...this.allowlist!] };
    await fs.writeFile(this.allowlistPath, JSON.stringify(file, null, 2), 'utf8');
    this.logger?.info(`PROVIDER: host approved for egress: ${host}`);
  }

  private async loadAllowlist(): Promise<void> {
    this.allowlist = new Set();
    try {
      const file = JSON.parse(await fs.readFile(this.allowlistPath, 'utf8')) as AllowlistFile;
      for (const host of file.hosts ?? []) this.allowlist.add(host);
    } catch {
      this.allowlist = new Set();
    }
  }
}
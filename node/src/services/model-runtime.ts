import { promises as fs, existsSync, createReadStream } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import { probeGguf } from './gguf.ts';
import { fitModel } from './model-fit.ts';
import { probeHardware } from './hardware.ts';
import type { ModelFitReportT } from '../../../common/contracts/models.ts';

export class ModelRuntimeError extends Error {
  readonly code: 'NOT_READY' | 'CONFLICT' | 'CHILD_FAILED';
  constructor(code: 'NOT_READY' | 'CONFLICT' | 'CHILD_FAILED', message: string) {
    super(message);
    this.code = code;
  }
}

export const RAM_GUARD_BYTES = 2 * 1024 ** 3;

export interface ModelEntry {
  id: string;
  name: string;
  status: string;
  roles: string[];
  endpoint: string;
  model: string;
  artifact_uri: string;
  context_tokens: number;
  system_prompt?: string;
  ingested?: boolean;
  file: string;
  fileSize?: number;
}

export interface ModelRuntimeOptions {
  workspace: string;
  manifestPath: string;
  ingestedPath: string;
  modelDir: string;
  pythonServer?: boolean;
  spawnChild?: typeof spawn;
  requestTimeoutMs?: number;
  logger?: { error(msg: string, meta?: Record<string, unknown>): void; warn(msg: string, meta?: Record<string, unknown>): void; info(msg: string, meta?: Record<string, unknown>): void } | undefined;
  onStatusChange?: (id: string, status: string, detail?: string) => void;
}

interface PythonCandidate {
  interp: string;
  args: string[];
}

const ALLOWED_ARCHITECTURES = ['llama', 'qwen2'];

export class ModelRuntime {
  private readonly workspace: string;
  private readonly manifestPath: string;
  private readonly ingestedPath: string;
  private readonly modelDir: string;
  private readonly spawnChild: typeof spawn;
  private readonly logger: ModelRuntimeOptions['logger'];
  private readonly onStatusChange: NonNullable<ModelRuntimeOptions['onStatusChange']>;

  private pythonReady = false;
  private pythonCmd: PythonCandidate | null = null;
  private lastProbeAt = 0;
  private pythonProbe: Promise<boolean> | null = null;
  private models = new Map<string, ModelEntry>();
  private readonly processes = new Map<string, ChildProcess>();
  private readonly warmed = new Set<string>();
  private readonly hashCache = new Map<string, { mtimeMs: number; size: number; hash: string }>();

  constructor(options: ModelRuntimeOptions) {
    this.workspace = options.workspace;
    this.manifestPath = options.manifestPath;
    this.ingestedPath = options.ingestedPath;
    this.modelDir = options.modelDir;
    this.spawnChild = options.spawnChild ?? spawn;
    this.logger = options.logger;
    this.onStatusChange = options.onStatusChange ?? (() => {});
  }

  async load(): Promise<void> {
    const manifest = JSON.parse(await fs.readFile(this.manifestPath, 'utf8')) as { models?: Array<Record<string, unknown>> };
    for (const raw of manifest.models ?? []) {
      const entry = this.entryFromManifest(raw);
      if (entry !== null) this.models.set(entry.id, entry);
    }
    try {
      const ingested = JSON.parse(await fs.readFile(this.ingestedPath, 'utf8')) as Array<Record<string, unknown>>;
      for (const raw of ingested) {
        const entry = this.entryFromManifest(raw);
        if (entry !== null) {
          entry.ingested = true;
          this.models.set(entry.id, entry);
        }
      }
    } catch {
      // no ingested models yet
    }
  }

  private entryFromManifest(raw: Record<string, unknown>): ModelEntry | null {
    const id = raw.id;
    const endpoint = raw.endpoint;
    const file = typeof raw.file === 'string' ? raw.file : String(raw.artifact_uri ?? '').startsWith('local://')
      ? path.resolve(this.modelDir, path.basename(String(raw.artifact_uri).replace('local://', '')))
      : '';
    if (typeof id !== 'string' || id.length === 0 || typeof endpoint !== 'string' || endpoint.length === 0) return null;
    const entry: ModelEntry = {
      id,
      name: String(raw.name ?? id),
      status: String(raw.status ?? 'pending'),
      roles: Array.isArray(raw.roles) ? raw.roles.map(String) : [],
      endpoint,
      model: String(raw.model ?? (file.length > 0 ? path.basename(file) : id)),
      artifact_uri: String(raw.artifact_uri ?? `local://${file}`),
      context_tokens: Number(raw.context_tokens ?? 2048),
      ingested: raw.ingested === true,
      file
    };
    if (typeof raw.system_prompt === 'string') entry.system_prompt = raw.system_prompt;
    if (typeof raw.file_size === 'number') entry.fileSize = raw.file_size;
    return entry;
  }

  async probePython(): Promise<boolean> {
    if (this.pythonReady) return true;
    if (this.pythonProbe !== null) return this.pythonProbe;
    const candidates: PythonCandidate[] = [];
    const explicit = process.env.AIDE_PYTHON;
    if (explicit) candidates.push({ interp: explicit, args: ['-E'] });
    candidates.push({ interp: 'py', args: ['-3.10', '-E'] });
    candidates.push({ interp: 'py', args: ['-3', '-E'] });
    candidates.push({ interp: 'E:\\Python310\\python.exe', args: ['-E'] });
    this.lastProbeAt = Date.now();
    const probeCandidate = (candidate: PythonCandidate): Promise<boolean> => new Promise(resolve => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const finish = (ready: boolean): void => {
        if (settled) return;
        settled = true;
        if (timer !== null) clearTimeout(timer);
        resolve(ready);
      };
      let child: ChildProcess;
      try {
        child = this.spawnChild(candidate.interp, [...candidate.args, '-c', 'import llama_cpp'], { stdio: 'ignore', windowsHide: true });
      } catch {
        finish(false);
        return;
      }
      timer = setTimeout(() => {
        child.kill();
        finish(false);
      }, 5000);
      child.once('error', () => finish(false));
      child.once('exit', code => finish(code === 0));
    });
    this.pythonProbe = (async () => {
      for (const candidate of candidates) {
        if (await probeCandidate(candidate)) {
          this.pythonCmd = candidate;
          this.pythonReady = true;
          return true;
        }
      }
      this.pythonReady = false;
      this.pythonCmd = null;
      return false;
    })().finally(() => {
      this.pythonProbe = null;
    });
    return this.pythonProbe;
  }

  async status(): Promise<{ runtime: boolean; models: Array<Record<string, unknown>> }> {
    if (!this.pythonReady && this.pythonProbe === null && Date.now() - this.lastProbeAt > 5000) await this.probePython();
    const runtimeAvailable = this.pythonReady;
    return {
      runtime: runtimeAvailable,
      models: [...this.models.values()].map(model => {
        const artifactAvailable = model.file.length > 0 && existsSync(model.file);
        let modelStatus = model.status;
        if (artifactAvailable && model.status !== 'ready' && runtimeAvailable) modelStatus = 'ready';
        const setup: string[] = [];
        if (!runtimeAvailable) setup.push('fix Python runtime: set AIDE_PYTHON or ensure `py -3.10 -E -c "import llama_cpp"` succeeds');
        if (modelStatus === 'ready' && !artifactAvailable) setup.push(`model file was not found at ${model.file}`);
        const entry: Record<string, unknown> = {
          id: model.id,
          name: model.name,
          status: this.processes.has(model.id) ? 'running' : modelStatus,
          declared_status: modelStatus,
          endpoint: model.endpoint,
          runtime_available: runtimeAvailable,
          artifact_available: artifactAvailable,
          setup_required: setup.length > 0 && modelStatus === 'ready',
          setup_message: setup.length > 0 ? setup.join('; ') : undefined,
          ingested: model.ingested === true
        };
        return entry;
      })
    };
  }

  get(id: string): ModelEntry | undefined {
    return this.models.get(id);
  }

  list(): ModelEntry[] {
    return [...this.models.values()];
  }

  private expectedModelIds(model: ModelEntry): string[] {
    const values = [
      model.id,
      model.model,
      path.basename(model.file),
      model.file,
      path.resolve(model.file)
    ].filter(Boolean).map(value => String(value).toLowerCase());
    return [...new Set(values)];
  }

  private servedModelMatches(model: ModelEntry, servedId: string): boolean {
    const served = servedId.toLowerCase();
    if (served.length === 0) return false;
    return this.expectedModelIds(model).some(expected =>
      served === expected || served.endsWith(`/${expected}`) || served.endsWith(`\\${expected}`)
    );
  }

  private endpointPort(model: ModelEntry): { host: string; port: number } {
    const endpoint = new URL(model.endpoint);
    return { host: endpoint.hostname || '127.0.0.1', port: Number(endpoint.port || 80) };
  }

  private async endpointPortOpen(model: ModelEntry, timeoutMs = 1000): Promise<boolean> {
    const { host, port } = this.endpointPort(model);
    return new Promise(resolve => {
      const socket = net.createConnection({ host, port });
      const done = (open: boolean): void => {
        socket.removeAllListeners();
        socket.destroy();
        resolve(open);
      };
      socket.setTimeout(timeoutMs);
      socket.once('connect', () => done(true));
      socket.once('timeout', () => done(false));
      socket.once('error', () => done(false));
    });
  }

  async verifyEndpointModel(id: string, timeoutMs = 5000): Promise<{ ready: boolean; status: string; served_models: string[]; error?: string }> {
    const model = this.models.get(id);
    if (!model) throw new Error('model is not allowlisted');
    try {
      const response = await fetch(`${model.endpoint}/models`, { signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) return { ready: false, status: 'not-ready', served_models: [] };
      const payload = await response.json().catch(() => ({})) as { data?: Array<{ id?: string }> };
      const servedModels = Array.isArray(payload.data) ? payload.data.map(item => item.id).filter((v): v is string => typeof v === 'string') : [];
      const matched = servedModels.some(servedId => this.servedModelMatches(model, servedId));
      if (!matched) {
        return {
          ready: false,
          status: 'conflict',
          served_models: servedModels,
          error: `port ${this.endpointPort(model).port} is serving ${servedModels.join(', ') || 'an unknown model'}, not ${model.id}`
        };
      }
      return { ready: true, status: 'running', served_models: servedModels };
    } catch {
      return { ready: false, status: 'not-ready', served_models: [] };
    }
  }

  private async warmup(id: string): Promise<boolean> {
    const model = this.models.get(id);
    if (!model || this.warmed.has(id)) return true;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(`${model.endpoint}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: model.model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1, temperature: 0 }),
          signal: AbortSignal.timeout(10_000)
        });
        if (response.ok) {
          this.warmed.add(id);
          return true;
        }
      } catch {
        // server still loading; retry
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    return false;
  }

  async waitReady(id: string, timeoutMs = 60_000): Promise<boolean> {
    const model = this.models.get(id);
    if (!model) throw new Error('model is not allowlisted');
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const result = await this.verifyEndpointModel(id, 5000);
        if (result.ready && await this.warmup(id)) {
          this.onStatusChange(id, 'running');
          return true;
        }
        if (result.status === 'conflict') throw new Error(result.error ?? 'endpoint conflict');
      } catch (error) {
        if (error instanceof Error && error.message.includes('is serving')) throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error(`${model.name} did not become ready within ${timeoutMs}ms`);
  }

  async start(id: string): Promise<{ id: string; status: string; endpoint: string }> {
    const model = this.models.get(id);
    if (!model) throw new ModelRuntimeError('CHILD_FAILED', 'model is not allowlisted');
    if (this.processes.has(id)) return { id, status: 'running', endpoint: model.endpoint };
    if (model.file.length === 0) throw new ModelRuntimeError('NOT_READY', `Local model setup required: model file was not found at ${model.file || '(unknown path)'}.`);
    await fs.access(model.file).catch(() => {
      throw new ModelRuntimeError('NOT_READY', `Local model setup required: model file was not found at ${model.file}.`);
    });
    const hardware = await probeHardware();
    if (hardware.freeRamBytes < RAM_GUARD_BYTES) {
      throw new ModelRuntimeError('NOT_READY', `Not enough free RAM to start a model: ${Math.round(hardware.freeRamBytes / 1048576)} MB free, at least ${RAM_GUARD_BYTES / 1048576} MB required.`);
    }
    if (model.ingested === true && model.fileSize !== undefined) {
      const current = await fs.stat(model.file).catch(() => null);
      if (current === null) throw new ModelRuntimeError('CONFLICT', `model file went missing after ingestion: ${model.file}`);
      if (current.size !== model.fileSize) {
        throw new ModelRuntimeError('CONFLICT', `model file changed on disk since ingestion (${model.fileSize} -> ${current.size} bytes). Re-ingest the file or restore the original.`);
      }
    }
    if (!this.pythonReady) await this.probePython();
    if (!this.pythonReady) {
      throw new ModelRuntimeError('NOT_READY', 'Local model setup required: no Python with llama_cpp found. Set AIDE_PYTHON to a Python 3.10 interpreter with llama-cpp-python installed (tried AIDE_PYTHON, `py -3.10 -E`, `py -3 -E`, E:\\Python310\\python.exe).');
    }
    const alreadyUp = await this.verifyEndpointModel(id).catch(async () => {
      if (await this.endpointPortOpen(model)) {
        return { ready: false, status: 'conflict', served_models: [], error: `port ${this.endpointPort(model).port} is occupied but did not return a verifiable /v1/models response for ${model.id}` };
      }
      return { ready: false, status: 'not-ready', served_models: [] };
    });
    if (alreadyUp.ready) return { id, status: 'running', endpoint: model.endpoint };
    if (alreadyUp.status === 'conflict') {
      const from = model.endpoint;
      const port = await allocateFreePort();
      model.endpoint = `http://127.0.0.1:${port}/v1`;
      this.logger?.warn('model endpoint occupied by a foreign server; relocating to a free port', { id, from, to: model.endpoint, error: alreadyUp.error ?? 'unknown occupant' });
      if (model.ingested === true) await this.persistIngested();
    }
    const endpoint = new URL(model.endpoint);
    const args = [
      ...(this.pythonCmd?.args ?? []),
      '-m', 'llama_cpp.server',
      '--model', model.file,
      '--host', '127.0.0.1',
      '--port', String(endpoint.port || 8080),
      '--n_ctx', String(model.context_tokens || 2048),
      '--n_gpu_layers', '0',
      '--logits_all', 'false'
    ];
    const child = this.spawnChild(this.pythonCmd!.interp, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    this.processes.set(id, child);
    this.onStatusChange(id, 'starting');
    const stderrLog = path.join(this.workspace, '.aide', 'logs', `model-${id}.err.log`);
    await fs.mkdir(path.dirname(stderrLog), { recursive: true }).catch(() => {});
    let stderrTail = '';
    child.stderr?.on('data', chunk => {
      stderrTail = (stderrTail + String(chunk)).slice(-8192);
    });
    child.once('exit', (code, signal) => {
      this.processes.delete(id);
      this.warmed.delete(id);
      void fs.appendFile(stderrLog, `${stderrTail}[exit code=${code} signal=${signal}]\n`).catch(() => {});
      this.onStatusChange(id, 'stopped');
    });
    return { id, status: 'starting', endpoint: model.endpoint };
  }

  async stop(id: string): Promise<{ id: string; status: string }> {
    const child = this.processes.get(id);
    if (!child) return { id, status: 'stopped' };
    this.processes.delete(id);
    this.warmed.delete(id);
    const waitExit = new Promise<void>(resolve => {
      if (child.exitCode !== null) resolve();
      else child.once('exit', () => resolve());
    });
    if (child.exitCode === null) child.kill('SIGTERM');
    await Promise.race([waitExit, new Promise<void>(resolve => setTimeout(resolve, 5000))]);
    if (child.exitCode === null) child.kill('SIGKILL');
    return { id, status: 'stopped' };
  }

  async stopAll(): Promise<void> {
    for (const id of [...this.processes.keys()]) await this.stop(id);
  }

  async chat(id: string, messages: Array<{ role: string; content: string }>, options: { maxTokens?: number; temperature?: number } = {}): Promise<{ text: string; modelId: string; tokens?: number; timingMs: number }> {
    const model = this.models.get(id);
    if (!model) throw new ModelRuntimeError('CHILD_FAILED', 'model is not allowlisted');
    if (!this.processes.has(id)) {
      // Adopt externally-started servers (e.g. legacy daemon or operator CLI):
      // if the endpoint verifiably serves this model, chat through it.
      const external = await this.verifyEndpointModel(id, 3000).catch(() => ({ ready: false as const }));
      if (!external.ready) throw new ModelRuntimeError('NOT_READY', 'start this model before chatting');
    }
    const warmed = await this.warmup(id);
    if (!warmed) throw new ModelRuntimeError('NOT_READY', 'model still warming up; try again in a few seconds');
    const started = Date.now();
    const response = await fetch(`${model.endpoint}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model.model,
        messages,
        temperature: options.temperature ?? 0.2,
        max_tokens: Math.min(options.maxTokens ?? 512, 512)
      }),
      signal: AbortSignal.timeout(90_000)
    });
    if (!response.ok) throw new ModelRuntimeError('CHILD_FAILED', `local runtime returned HTTP ${response.status}`);
    const payload = await response.json().catch(() => {
      throw new ModelRuntimeError('CHILD_FAILED', 'local runtime returned non-JSON');
    }) as { choices?: Array<{ message?: { content?: string } }>; usage?: { completion_tokens?: number } };
    const text = payload.choices?.[0]?.message?.content ?? '';
    const tokens = payload.usage?.completion_tokens;
    const result: { text: string; modelId: string; tokens?: number; timingMs: number } = { text, modelId: id, timingMs: Date.now() - started };
    if (tokens !== undefined) result.tokens = tokens;
    return result;
  }

  async chatStream(
    id: string,
    messages: Array<{ role: string; content: string }>,
    onDelta: (delta: string) => void,
    signal: AbortSignal,
    options: { maxTokens?: number; temperature?: number } = {}
  ): Promise<void> {
    const model = this.models.get(id);
    if (!model) throw new ModelRuntimeError('CHILD_FAILED', 'model is not allowlisted');
    if (!this.processes.has(id)) {
      // Adopt externally-started servers (same bridge as chat()).
      const external = await this.verifyEndpointModel(id, 3000).catch(() => ({ ready: false as const }));
      if (!external.ready) throw new ModelRuntimeError('NOT_READY', 'start this model before chatting');
    }
    const warmed = await this.warmup(id);
    if (!warmed) throw new ModelRuntimeError('NOT_READY', 'model still warming up; try again in a few seconds');
    const response = await fetch(`${model.endpoint}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model.model,
        messages,
        temperature: options.temperature ?? 0.2,
        max_tokens: Math.min(options.maxTokens ?? 512, 512),
        stream: true
      }),
      signal
    });
    if (!response.ok || response.body === null) throw new ModelRuntimeError('CHILD_FAILED', `local runtime returned HTTP ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const raw = line.slice(5).trim();
        if (raw.length === 0 || raw === '[DONE]') continue;
        try {
          const chunk = JSON.parse(raw) as { choices?: Array<{ delta?: { content?: string } }> };
          const delta = chunk.choices?.[0]?.delta?.content ?? '';
          if (delta.length > 0) onDelta(delta);
        } catch {
          // skip malformed upstream frames
        }
      }
    }
  }

  async ingest(filePath: string): Promise<{ id: string; name: string; endpoint: string; context_tokens: number; quant: string; sha256: string; fit: ModelFitReportT }> {
    const absolute = path.resolve(filePath);
    if (!absolute.toLowerCase().endsWith('.gguf')) throw new Error('only .gguf files can be ingested');
    const stat = await fs.stat(absolute).catch(() => {
      throw new Error(`model file was not found at ${absolute}`);
    });
    if (!stat.isFile()) throw new Error('model path is not a file');
    const info = await probeGguf(absolute);
    if (!ALLOWED_ARCHITECTURES.includes(info.architecture)) throw new Error(`unsupported GGUF architecture: ${info.architecture}`);
    if (info.chatTemplate === null) throw new Error('this GGUF has no tokenizer.chat_template; serving it would silently fall back to llama-2 formatting (gibberish). Rejecting for safety.');

    const { freeRamBytes } = await probeHardware();
    const fit = fitModel(info, stat.size, freeRamBytes, absolute);

    const statAfter = await fs.stat(absolute);
    const cachedHash = this.hashCache.get(absolute);
    let digestHex: string;
    if (cachedHash !== undefined && cachedHash.mtimeMs === statAfter.mtimeMs && cachedHash.size === statAfter.size) {
      digestHex = cachedHash.hash;
    } else {
      const hash = crypto.createHash('sha256');
      await new Promise<void>((resolve, reject) => {
        const stream = createReadStream(absolute);
        stream.on('data', chunk => hash.update(chunk));
        stream.on('end', () => resolve());
        stream.on('error', reject);
      });
      digestHex = hash.digest('hex');
      this.hashCache.set(absolute, { mtimeMs: statAfter.mtimeMs, size: statAfter.size, hash: digestHex });
    }

    const base = path.basename(absolute).replace(/\.gguf$/i, '');
    const id = `${base}-${digestHex.slice(0, 8)}`.toLowerCase();
    if (this.models.has(id)) {
      const existing = this.models.get(id)!;
      return {
        id,
        name: existing.name,
        endpoint: existing.endpoint,
        context_tokens: existing.context_tokens,
        quant: fit.quant,
        sha256: digestHex,
        fit
      };
    }
    const port = await allocateFreePort();
    const endpoint = `http://127.0.0.1:${port}/v1`;
    const entry: ModelEntry = {
      id,
      name: info.name || base,
      status: 'ready',
      roles: ['chat'],
      endpoint,
      model: path.basename(absolute),
      artifact_uri: `local://${path.basename(absolute)}`,
      context_tokens: fit.contextLength,
      ingested: true,
      file: absolute,
      fileSize: statAfter.size
    };
    this.models.set(id, entry);
    await this.persistIngested();
    this.logger?.info('model ingested', { id, endpoint, context: fit.contextLength, quant: fit.quant });

    return {
      id,
      name: entry.name,
      endpoint,
      context_tokens: fit.contextLength,
      quant: fit.quant,
      sha256: digestHex,
      fit
    };
  }

  private async persistIngested(): Promise<void> {
    const ingested = [...this.models.values()]
      .filter(model => model.ingested === true)
      .map(model => ({
        id: model.id,
        name: model.name,
        status: model.status,
        roles: model.roles,
        endpoint: model.endpoint,
        model: model.model,
        artifact_uri: model.artifact_uri,
        context_tokens: model.context_tokens,
        file: model.file,
        file_size: model.fileSize,
        ingested: true
      }));
    await fs.mkdir(path.dirname(this.ingestedPath), { recursive: true }).catch(() => {});
    await fs.writeFile(this.ingestedPath, JSON.stringify(ingested, null, 2), 'utf8');
  }
}

async function allocateFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('failed to allocate a free port'));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

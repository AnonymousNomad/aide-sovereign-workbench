import { promises as fs, existsSync, createReadStream, readFileSync } from 'node:fs';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import { probeGguf } from './gguf.ts';
import { fitModel } from './model-fit.ts';
import { probeHardware } from './hardware.ts';
import { estimateTokens } from './history-fit.ts';
import type { ModelFitReportT } from '../../../common/contracts/models.ts';

export class ModelRuntimeError extends Error {
  readonly code: 'NOT_READY' | 'CONFLICT' | 'CHILD_FAILED';
  constructor(code: 'NOT_READY' | 'CONFLICT' | 'CHILD_FAILED', message: string) {
    super(message);
    this.code = code;
  }
}

export const RAM_GUARD_BYTES = 2 * 1024 ** 3;

// W6 convergence: binary llama-server is the verified engine path on Windows
// (python llama_cpp.server spawn hangs under node on this class of machine;
// see AGENT_NOTES 2026-08-24/25). Resolution order mirrors the legacy manager:
// env override -> workspace runtime dir -> known local install.
const SAMPLER_FLAGS: Record<string, string> = {
  temperature: '--temp', top_k: '--top-k', top_p: '--top-p', min_p: '--min-p',
  repeat_penalty: '--repeat-penalty', mirostat: '--mirostat',
  mirostat_tau: '--mirostat-tau', mirostat_eta: '--mirostat-eta', seed: '--seed'
};

function readProfileSidecar(file: string): { samplers?: Record<string, number>; runtime?: Record<string, number | boolean> } {
  try {
    return JSON.parse(readFileSync(`${file}.profile.json`, 'utf8'));
  } catch {
    return {};
  }
}

function resolveLlamaBinary(workspace: string): string | null {
  const exe = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
  const candidates = [
    process.env.AIDE_LLAMA_SERVER,
    path.join(workspace, 'runtime', exe),
    'E:\\llama-cpp\\llama-server.exe'
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find(candidate => existsSync(candidate)) ?? null;
}

function samplerArgs(profile: ReturnType<typeof readProfileSidecar>): string[] {
  const args: string[] = [];
  for (const [key, flag] of Object.entries(SAMPLER_FLAGS)) {
    const value = profile.samplers?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) args.push(flag, String(value));
  }
  const runtime = profile.runtime || {};
  if (Number.isFinite(runtime.ngl as number)) args.push('-ngl', String(runtime.ngl));
  if (runtime.flash_attn === 1 || runtime.flash_attn === true) args.push('-fa');
  return args;
}

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
  private readonly servedCtx = new Map<string, number>();

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
    // Engine availability = binary serving path OR python fallback. Binary is
    // the verified primary; conflating this with the python probe alone
    // mislabeled RUNNING binary engines as merely "installed".
    const engineAvailable = resolveLlamaBinary(this.workspace) !== null || this.pythonReady;
    return {
      runtime: engineAvailable,
      models: [...this.models.values()].map(model => {
        const artifactAvailable = model.file.length > 0 && existsSync(model.file);
        let modelStatus = model.status;
        if (artifactAvailable && model.status !== 'ready' && engineAvailable) modelStatus = 'ready';
        const setup: string[] = [];
        if (!engineAvailable) setup.push('no engine available: install llama-server binary (runtime/ or E:\\llama-cpp) or set AIDE_PYTHON to a Python 3.10 interpreter with llama-cpp-python');
        if (modelStatus === 'ready' && !artifactAvailable) setup.push(`model file was not found at ${model.file}`);
        const entry: Record<string, unknown> = {
          id: model.id,
          name: model.name,
          status: this.processes.has(model.id) ? 'running' : modelStatus,
          declared_status: modelStatus,
          endpoint: model.endpoint,
          runtime_available: engineAvailable,
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
    // Binary llama-server first (verified engine path); Python llama_cpp.server
    // remains a fallback for hosts without the binary.
    const llamaBinary = resolveLlamaBinary(this.workspace);
    if (llamaBinary) {
      const endpointUrl = new URL(model.endpoint);
      const profile = readProfileSidecar(model.file);
      const binaryArgs = [
        '-m', model.file,
        '--host', '127.0.0.1',
        '--port', String(endpointUrl.port || 8080),
        '--ctx-size', String(model.context_tokens || 2048),
        '--threads', '4',
        '--parallel', '1',
        '--log-disable',
        '--prio', '-1',
        ...samplerArgs(profile)
      ];
      const alreadyUpBinary = await this.verifyEndpointModel(id).catch(async () => {
        if (await this.endpointPortOpen(model)) {
          return { ready: false as const, status: 'conflict' as const, served_models: [] as never[], error: `port ${this.endpointPort(model).port} occupied by foreign server` };
        }
        return { ready: false as const, status: '' as const, served_models: [] as never[] };
      });
      if (alreadyUpBinary.ready) return { id, status: 'running', endpoint: model.endpoint };
      if (alreadyUpBinary.status === 'conflict') {
        const from = model.endpoint;
        const port = await allocateFreePort();
        model.endpoint = `http://127.0.0.1:${port}/v1`;
        this.logger?.warn('model endpoint occupied by a foreign server; relocating to a free port', { id, from, to: model.endpoint, error: alreadyUpBinary.error ?? 'unknown occupant' });
        if (model.ingested === true) await this.persistIngested();
        endpointUrl.port = String(port);
        binaryArgs[5] = String(port);
      }
      // Doctrine (aide-engine-lifecycle-doctrine): re-check memory right
      // before spawn — the gate above ran before endpoint verification and a
      // concurrent engine load can have consumed RAM since. A killed engine
      // releases commit asynchronously; spawning a multi-GB mmap load into
      // that transient hole causes commit exhaustion and machine-wide thrash
      // (reproduced 2026-08-27).
      if ((await probeHardware()).freeRamBytes < RAM_GUARD_BYTES) {
        await this.waitForMemoryDrain();
      }
      for (let attempt = 1; attempt <= 2; attempt++) {
        const child = this.spawnChild(llamaBinary, binaryArgs, { stdio: ['ignore', 'ignore', 'pipe'], detached: true });
        this.processes.set(id, child);
        this.onStatusChange(id, 'starting');
        const stderrLog = path.join(this.workspace, '.aide', 'logs', `engine-${id}.err.log`);
        await fs.mkdir(path.dirname(stderrLog), { recursive: true }).catch(() => {});
        let stderrTail = '';
        child.stderr?.on('data', chunk => { stderrTail = (stderrTail + String(chunk)).slice(-8192); });
        child.once('exit', (code, signal) => {
          this.processes.delete(id);
          this.warmed.delete(id);
          void fs.appendFile(stderrLog, `${stderrTail}[exit code=${code} signal=${signal}]\n`).catch(() => {});
          this.onStatusChange(id, 'stopped');
        });
        // Early-exit guard: the lethal window is the first seconds of load.
        const early = await new Promise<{ code: number | null; signal: NodeJS.Signals | null } | null>(resolve => {
          const timer = setTimeout(() => resolve(null), 8000);
          child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
        });
        if (early === null) break; // survived the danger window
        if (attempt === 2) {
          throw new ModelRuntimeError('CHILD_FAILED', `${model.name} engine exited immediately (code ${early.code}${early.signal ? `, signal ${early.signal}` : ''}). stderr tail: ${stderrTail.slice(-400) || '(empty — likely killed externally; audit the machine for /IM kill logic; see .aide/logs/engine-' + id + '.err.log)'}`);
        }
        this.logger?.warn('engine died early; draining memory and retrying once', { id, code: early.code, signal: early.signal });
        await this.waitForMemoryDrain();
      }
      return { id, status: 'starting', endpoint: model.endpoint };
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

  // Doctrine (aide-engine-lifecycle-doctrine): a killed engine releases its
  // commit charge asynchronously; spawning a replacement model load before
  // that drain caused commit exhaustion, machine-wide thrash and the silent
  // exit-code-1 deaths (2026-08-27). Poll until the floor is actually free.
  private async waitForMemoryDrain(minFreeBytes: number = RAM_GUARD_BYTES, timeoutMs = 20_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let last = minFreeBytes;
    while (Date.now() < deadline) {
      last = (await probeHardware()).freeRamBytes;
      if (last >= minFreeBytes) return;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new ModelRuntimeError('NOT_READY', `Memory did not recover after stopping engines (${Math.round(last / 1048576)} MB free, need ${Math.round(minFreeBytes / 1048576)} MB). Close heavy applications and try again.`);
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
    if (child.exitCode === null) {
      // Windows: child.kill() cannot reap engines that ignore signals or hold
      // grandchildren; taskkill /T tree-kills the whole process tree (same
      // proven repair as the legacy model-manager orphan fix).
      if (process.platform === 'win32' && child.pid) {
        await new Promise<void>(resolve => {
          execFile('taskkill', ['/PID', String(child.pid), '/F', '/T'], () => resolve());
        });
        await Promise.race([waitExit, new Promise<void>(resolve => setTimeout(resolve, 3000))]);
      } else {
        child.kill('SIGKILL');
      }
    }
    return { id, status: 'stopped' };
  }

  async stopAll(): Promise<void> {
    for (const id of [...this.processes.keys()]) await this.stop(id);
  }

  // Effective context = what the engine ACTUALLY serves (llama-server clamps
  // n_ctx to train ctx for some artifacts). Cached from /props (served at
  // engine ROOT, not under /v1); falls back to the manifest's declared
  // context_tokens until first successful read (legacy parity).
  getEffectiveContext(id: string): number | null {
    const cached = this.servedCtx.get(id);
    if (cached !== undefined) return cached;
    const declared = Number(this.models.get(id)?.context_tokens);
    return Number.isFinite(declared) && declared > 0 ? declared : null;
  }
  async refreshServedContext(id: string): Promise<void> {
    const model = this.models.get(id);
    if (!model) return;
    try {
      const base = model.endpoint.replace(/\/v1\/?$/, '');
      const response = await fetch(`${base}/props`, { signal: AbortSignal.timeout(3000) });
      if (!response.ok) return;
      const props = await response.json() as { default_generation_settings?: { n_ctx?: number } };
      const nCtx = Number(props?.default_generation_settings?.n_ctx);
      if (Number.isFinite(nCtx) && nCtx > 0) this.servedCtx.set(id, nCtx);
    } catch {
      /* endpoint not up yet — keep previous value */
    }
  }

  // Effective context budget for an upcoming completion: what the engine
  // ACTUALLY serves (clamped n_ctx) minus the completion reserve. Manifest
  // context_tokens can overstate the served window (llama-server clamps to
  // train ctx for some artifacts), which produced hard HTTP-400 overflows in
  // the 2026-08-28 capability audit (C1/D1 empty-output aborts). Callers fit
  // history against THIS number, never the declared manifest value.
  getEffectiveBudget(id: string, reserveTokens: number): number | null {
    const model = this.models.get(id);
    if (!model) return null;
    const served = this.servedCtx.get(id);
    const context = served ?? (Number.isFinite(model.context_tokens) && model.context_tokens > 0 ? model.context_tokens : null);
    if (context === null) return null;
    const budget = Math.floor(context - reserveTokens);
    return budget > 0 ? budget : null;
  }

  // Retry a failed completion once with history re-fit to the effective
  // window. llama.cpp rejects an overflowing prompt with HTTP 400; without
  // this rescue the router surfaced a 504 with zero output (audit B3/G1).
  // The newest user turn is always preserved; oldest history is dropped.
  private refitForOverflow(id: string, messages: Array<{ role: string; content: string }>, reserveTokens: number): Array<{ role: string; content: string }> | null {
    const budget = this.getEffectiveBudget(id, reserveTokens);
    if (budget === null) return null;
    const newest = messages[messages.length - 1];
    if (newest === undefined) return null;
    const kept: Array<{ role: string; content: string }> = [];
    let used = estimateTokens(newest.content);
    if (used > budget) {
      // Single oversized turn: hard-truncate its head, keep the tail.
      const keepChars = budget * 4;
      kept.push({ role: newest.role, content: newest.content.slice(Math.max(0, newest.content.length - keepChars)) });
      return kept;
    }
    for (let index = messages.length - 2; index >= 0; index--) {
      const message = messages[index]!;
      const cost = estimateTokens(message.content);
      if (used + cost > budget) continue;
      kept.unshift(message);
      used += cost;
    }
    return kept;
  }

  async chat(id: string, messages: Array<{ role: string; content: string }>, options: { maxTokens?: number; temperature?: number; timeoutMs?: number } = {}): Promise<{ text: string; modelId: string; tokens?: number; timingMs: number }> {
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
    const attemptRequest = async (payloadMessages: Array<{ role: string; content: string }>): Promise<Response> =>
      fetch(`${model.endpoint}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model.model,
          messages: payloadMessages,
          temperature: options.temperature ?? 0.2,
          max_tokens: Math.min(options.maxTokens ?? 512, 512)
        }),
        signal: AbortSignal.timeout(Math.min(options.timeoutMs ?? 90_000, 300_000))
      });
    let response = await attemptRequest(messages);
    if (response.status === 400) {
      // Overflow rescue: the engine rejected the prompt (llama.cpp returns
      // HTTP 400 when prompt + max_tokens exceed the served window). Re-fit
      // history against the effective context and retry ONCE — never surface
      // an empty-output 504 when the newest turn itself fits.
      const reserve = Math.min(options.maxTokens ?? 512, 512);
      const refit = this.refitForOverflow(id, messages, reserve);
      if (refit !== null && refit.length < messages.length) {
        this.logger?.warn('completion overflowed served context; retrying with refit history', { id, messages: messages.length, refit: refit.length });
        response = await attemptRequest(refit);
      }
    }
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
    const attemptRequest = async (payloadMessages: Array<{ role: string; content: string }>): Promise<Response> =>
      fetch(`${model.endpoint}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model.model,
          messages: payloadMessages,
          temperature: options.temperature ?? 0.2,
          max_tokens: Math.min(options.maxTokens ?? 512, 512),
          stream: true
        }),
        signal
      });
    let response = await attemptRequest(messages);
    if (response.status === 400) {
      // Overflow rescue (same semantics as chat()): refit to the effective
      // window and retry once. Streaming requests overflowed the audit's
      // 3072 window hardest — scaffold + long prompt + 512 reserve.
      const reserve = Math.min(options.maxTokens ?? 512, 512);
      const refit = this.refitForOverflow(id, messages, reserve);
      if (refit !== null && refit.length < messages.length) {
        this.logger?.warn('stream overflowed served context; retrying with refit history', { id, messages: messages.length, refit: refit.length });
        response = await attemptRequest(refit);
      }
    }
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

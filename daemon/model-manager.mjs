import { promises as fs } from 'node:fs';
import { existsSync, createWriteStream, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import { scoreCandidate } from '../harness/gates.mjs';

const GRAMMAR_DIR = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..', 'grammar');
const grammarCache = new Map();

export function loadGrammar(name) {
  if (grammarCache.has(name)) return grammarCache.get(name);
  try {
    const content = readFileSync(path.join(GRAMMAR_DIR, `${name}.gbnf`), 'utf8');
    grammarCache.set(name, content);
    return content;
  } catch {
    return null;
  }
}

// Backend auto-select per aide-backend-autoselect skill: probe candidate
// binaries with --list-devices; empty output means a CPU-only build whose GPU
// flags would be silently ignored.
const BACKEND_ENV_KEYS = {
  vulkan: 'AIDE_LLAMA_SERVER_VULKAN',
  cuda: 'AIDE_LLAMA_SERVER_CUDA',
  rocm: 'AIDE_LLAMA_SERVER_ROCM'
};

function parseListDevices(stdout) {
  return stdout.split('\n')
    .map(line => line.replace(/\r$/, '').trim())
    .filter(line => /^[A-Za-z]+\d+:\s+.+\(/.test(line))
    .map(line => {
      const selector = line.split(':')[0].trim();
      return { selector: selector, backend: selector.replace(/\d+$/, '') };
    });
}

// P7 process-hygiene law: never spawn a model server into memory pressure.
const FREE_RAM_FLOOR_BYTES = Math.floor(2.5 * 1024 * 1024 * 1024);

export class ModelManager {
  constructor({ manifestPath, modelDir, binaryPath, modelPath = '', spawnProcess = spawn, pythonServer = false } = {}) {
    this.manifestPath = manifestPath;
    this.modelDir = path.resolve(modelDir);
    this.binaryPath = binaryPath;
    this.modelPath = modelPath;
    this.spawnProcess = spawnProcess;
    this.pythonServer = pythonServer;
    this.pythonReady = false;
    this.pythonCmd = null;
    this.lastProbeAt = 0;
    this.pythonProbe = null;
    this.models = new Map();
    this.processes = new Map();
    this.warmed = new Set();
    this.servedCtx = new Map();
    this.backendCaps = new Map();
  }

  // Effective context = what the SERVED engine reports (/props n_ctx), which
  // llama.cpp may clamp to the GGUF's training context; falls back to declared.
  getEffectiveContext(id) {
    const served = this.servedCtx.get(id);
    if (served !== undefined) return served;
    return Number(this.models.get(id)?.context_tokens) || 4096;
  }

  async refreshServedContext(id) {
    const model = this.models.get(id);
    if (!model?.endpoint) return null;
    try {
      const response = await fetch(`${model.endpoint}/props`, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json();
      const nCtx = Number(data?.default_generation_settings?.n_ctx);
      if (Number.isFinite(nCtx) && nCtx > 0) this.servedCtx.set(id, nCtx);
    } catch { /* probe is best-effort */ }
    return this.servedCtx.get(id) ?? null;
  }

  profilePath(id) {
    const model = this.models.get(id);
    if (!model?.artifact_uri) return null;
    return path.join(this.modelDir, `${model.artifact_uri.replace('local://', '')}.profile.json`);
  }

  loadProfile(id) {
    const model = this.models.get(id);
    if (!model) return {};
    if (model.profile) return model.profile;
    try {
      model.profile = JSON.parse(readFileSync(this.profilePath(id), 'utf8'));
    } catch { model.profile = {}; }
    return model.profile;
  }

  async saveProfile(id, patch) {
    const model = this.models.get(id);
    if (!model) throw new Error('model is not allowlisted');
    const SAMPLER_KEYS = ['temperature', 'top_k', 'top_p', 'min_p', 'mirostat', 'mirostat_tau', 'mirostat_eta', 'repeat_penalty', 'seed'];
    const RUNTIME_KEYS = ['ngl', 'flash_attn', 'backend'];
    const PRESETS = {
      precise: { temperature: 0.1, min_p: 0.05, repeat_penalty: 1.05, seed: 0 },
      balanced: { temperature: 0.7, top_p: 0.9, min_p: 0.05 },
      creative: { temperature: 1.0, top_p: 0.95, min_p: 0.03 },
      mirostat: { mirostat: 2, mirostat_tau: 5.0, mirostat_eta: 0.1 }
    };
    const base = this.loadProfile(id);
    let next;
    if (patch.preset && PRESETS[patch.preset]) next = { ...base, preset: patch.preset, samplers: { ...PRESETS[patch.preset] } };
    else if (patch.samplers && typeof patch.samplers === 'object') {
      for (const [key, value] of Object.entries(patch.samplers)) {
        if (!SAMPLER_KEYS.includes(key)) { const e = new Error(`unknown sampler key: ${key}`); e.code = 'VALIDATION'; throw e; }
        if (typeof value !== 'number' || !Number.isFinite(value)) { const e = new Error(`sampler ${key} must be a finite number`); e.code = 'VALIDATION'; throw e; }
      }
      next = { ...base, preset: patch.preset || 'custom', samplers: patch.samplers };
    } else if (patch.runtime && typeof patch.runtime === 'object') {
      for (const [key, value] of Object.entries(patch.runtime)) {
        if (!RUNTIME_KEYS.includes(key)) { const e = new Error(`unknown runtime key: ${key}`); e.code = 'VALIDATION'; throw e; }
        if (key === 'backend' ? typeof value !== 'string' : typeof value !== 'number' || !Number.isFinite(value)) { const e = new Error(`runtime ${key} has invalid type`); e.code = 'VALIDATION'; throw e; }
      }
      next = { ...this.loadProfile(id), runtime: patch.runtime };
    } else { const e = new Error('profile requires preset, samplers or runtime'); e.code = 'VALIDATION'; throw e; }
    model.profile = next;
    const target = this.profilePath(id);
    if (target) await fs.writeFile(target, JSON.stringify(next, null, 2)).catch(() => {});
    return next;
  }

  // Backend selection: profile.runtime.backend picks among configured binaries
  // (e.g. a Vulkan build vs CUDA build of llama-server). Verified research on
  // GTX 1060: Vulkan wins token-generation on Pascal even though CUDA wins
  // prompt-processing (llama.cpp issue #19817). A candidate with an EMPTY
  // --list-devices result is CPU-only and is skipped for that family.
  probeBackend(binaryPath) {
    if (this.backendCaps.has(binaryPath)) return Promise.resolve(this.backendCaps.get(binaryPath));
    return new Promise(resolve => {
      const timer = setTimeout(() => { this.backendCaps.set(binaryPath, []); resolve([]); }, 10_000);
      execFile(binaryPath, ['--list-devices'], { windowsHide: true, timeout: 9_000 }, (error, stdout) => {
        clearTimeout(timer);
        if (error && !stdout) { this.backendCaps.set(binaryPath, []); return resolve([]); }
        const devices = parseListDevices(String(stdout || ''));
        this.backendCaps.set(binaryPath, devices);
        resolve(devices);
      });
    });
  }

  loadBackendsConfig() {
    if (this.backendsConfig) return this.backendsConfig;
    try {
      const cfgPath = path.join(path.dirname(this.manifestPath), '..', '.aide', 'backends.json');
      this.backendsConfig = JSON.parse(readFileSync(cfgPath, 'utf8'));
    } catch { this.backendsConfig = {}; }
    return this.backendsConfig;
  }

  async resolveBinaryFor(profile) {
    const backend = profile?.runtime?.backend;
    if (!backend) return this.binaryPath;
    const family = String(backend).toLowerCase();
    const envKey = BACKEND_ENV_KEYS[family];
    const fromFile = this.loadBackendsConfig()[family];
    const candidate = fromFile || (envKey ? process.env[envKey] : null);
    if (!candidate || !existsSync(candidate)) return this.binaryPath;
    const devices = await this.probeBackend(candidate);
    if (profile.runtime.device) {
      const known = devices.some(device => device.selector === profile.runtime.device);
      if (known) return { path: candidate, device: profile.runtime.device };
      return this.binaryPath;
    }
    if (devices.length === 0) return this.binaryPath;
    return { path: candidate, device: devices[0].selector };
  }

  runtimeArgs(profile) {
    const args = [];
    const runtime = profile?.runtime || {};
    if (Number.isFinite(runtime.ngl)) args.push('-ngl', String(runtime.ngl));
    if (runtime.flash_attn === 1 || runtime.flash_attn === true) args.push('-fa');
    return args;
  }

  samplerArgs(profile) {
    const FLAGS = { temperature: '--temp', top_k: '--top-k', top_p: '--top-p', min_p: '--min-p', repeat_penalty: '--repeat-penalty', mirostat: '--mirostat', mirostat_tau: '--mirostat-tau', mirostat_eta: '--mirostat-eta', seed: '--seed' };
    const args = [];
    const samplers = profile?.samplers || {};
    for (const [key, flag] of Object.entries(FLAGS)) {
      const value = samplers[key];
      if (typeof value === 'number' && Number.isFinite(value)) args.push(flag, String(value));
    }
    return args;
  }

  probePython() {
    if (!this.pythonServer || this.pythonReady) return Promise.resolve(this.pythonReady);
    if (this.pythonProbe) return this.pythonProbe;
    const candidates = [];
    const explicit = process.env.AIDE_PYTHON;
    if (explicit) candidates.push({ interp: explicit, args: ['-E'] });
    candidates.push({ interp: 'py', args: ['-3.10', '-E'] });
    candidates.push({ interp: 'py', args: ['-3', '-E'] });
    candidates.push({ interp: 'E:\\Python310\\python.exe', args: ['-E'] });
    this.lastProbeAt = Date.now();
    const probeCandidate = candidate => new Promise(resolve => {
      let settled = false;
      let timer = null;
      const finish = ready => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(ready);
      };
      let child;
      try {
        child = spawn(candidate.interp, [...candidate.args, '-c', 'import llama_cpp'], { stdio: 'ignore', windowsHide: true });
      } catch {
        finish(false);
        return;
      }
      timer = setTimeout(() => { child.kill(); finish(false); }, 5000);
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
    })().finally(() => { this.pythonProbe = null; });
    return this.pythonProbe;
  }

  async load() {
    const manifest = JSON.parse(await fs.readFile(this.manifestPath, 'utf8'));
    this.models = new Map(manifest.models.map(model => [model.id, model]));
    return manifest;
  }

  status() {
    if (this.pythonServer && !this.pythonReady && !this.pythonProbe && Date.now() - this.lastProbeAt > 5000) this.probePython();
    const runtimeAvailable = this.pythonServer
      ? this.pythonReady
      : Boolean(this.binaryPath && existsSync(this.binaryPath));
    const runtimeProbePending = this.pythonServer && !this.pythonReady && Boolean(this.pythonProbe);
    return [...this.models.values()].map(model => {
      const artifact = this.modelPath || (model.artifact_uri?.startsWith('local://')
        ? path.resolve(this.modelDir, model.artifact_uri.replace('local://', ''))
        : null);
      const artifactAvailable = Boolean(artifact && existsSync(artifact));
      // Promote to ready if artifact exists locally and runtime is available
      let modelStatus = model.status;
      if (artifactAvailable && model.status !== 'ready' && runtimeAvailable) {
        modelStatus = 'ready';
      }
      const setup = [];
      if (!runtimeAvailable && !runtimeProbePending) {
        if (this.pythonServer) setup.push('fix Python runtime: set AIDE_PYTHON or ensure `py -3.10 -E -c "import llama_cpp"` succeeds');
        else setup.push('install llama-server and set AIDE_LLAMA_SERVER');
      }
      if (modelStatus === 'ready' && !artifactAvailable) setup.push(`set AIDE_MODEL_PATH to a GGUF file or install the model file in ${this.modelDir}`);
      return {
        id: model.id,
        name: model.name,
        status: this.processes.has(model.id) ? 'running' : modelStatus,
        declared_status: modelStatus,
        endpoint: model.endpoint,
        runtime_available: runtimeAvailable,
        artifact_available: artifactAvailable,
        artifact_path: artifact || '',
        served_context_tokens: this.servedCtx.get(model.id) ?? null,
        profile: this.loadProfile(model.id),
        setup_required: setup.length > 0 && modelStatus === 'ready',
        setup_message: runtimeProbePending ? 'Checking the local Python runtime…' : setup.join('; ')
      };
    });
  }

  get(id) {
    return this.models.get(id);
  }

  expectedModelIds(model) {
    const artifactName = model.artifact_uri?.startsWith('local://')
      ? path.basename(model.artifact_uri.replace('local://', ''))
      : '';
    const values = [
      model.id,
      model.model,
      artifactName,
      this.modelPath ? path.basename(this.modelPath) : '',
      this.modelPath ? path.resolve(this.modelPath) : '',
      artifactName ? path.resolve(this.modelDir, artifactName) : ''
    ].filter(Boolean).map(value => String(value).toLowerCase());
    return [...new Set(values)];
  }

  servedModelMatches(model, servedId) {
    const served = String(servedId || '').toLowerCase();
    if (!served) return false;
    return this.expectedModelIds(model).some(expected =>
      served === expected ||
      served.endsWith(`/${expected}`) ||
      served.endsWith(`\\${expected}`)
    );
  }

  endpointPort(model) {
    const endpoint = new URL(model.endpoint);
    return { host: endpoint.hostname || '127.0.0.1', port: Number(endpoint.port || (endpoint.protocol === 'https:' ? 443 : 80)) };
  }

  async endpointPortOpen(model, timeoutMs = 1000) {
    const { host, port } = this.endpointPort(model);
    return new Promise(resolve => {
      const socket = net.createConnection({ host, port });
      const done = open => {
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

  async verifyEndpointModel(id, timeoutMs = 5000) {
    const model = this.models.get(id);
    if (!model) throw new Error('model is not allowlisted');
    const response = await fetch(`${model.endpoint}/models`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      return { id, ready: false, status: 'not-ready', endpoint: model.endpoint, http_status: response.status };
    }
    const payload = await response.json().catch(() => ({}));
    const servedModels = Array.isArray(payload.data) ? payload.data.map(item => item.id).filter(Boolean) : [];
    const expected = this.expectedModelIds(model);
    const matched = servedModels.some(servedId => this.servedModelMatches(model, servedId));
    if (!matched) {
      return {
        id,
        ready: false,
        status: 'conflict',
        endpoint: model.endpoint,
        served_models: servedModels,
        expected_models: expected,
        error: `port ${this.endpointPort(model).port} is serving ${servedModels.join(', ') || 'an unknown model'}, not ${model.id}`
      };
    }
    return { id, ready: true, status: 'running', endpoint: model.endpoint, served_models: servedModels };
  }

  async chat(id, messages, options = {}) {
    const model = this.models.get(id);
    if (!model) throw new Error('model is not allowlisted');
    if (!['ready', 'experimental'].includes(model.status) && !this.processes.has(id)) throw new Error('start this model before chatting');
    const verified = await this.verifyEndpointModel(id, Math.min(Number(options.timeout_ms) || 90_000, 5000));
    if (!verified.ready) throw new Error(verified.error || 'local runtime is not serving the selected model');

    // Gated Best-of-N (harness v2.2): N temperature-jittered samples scored by
    // mechanical gates; first clean candidate wins (early stopping); otherwise
    // lowest-penalty candidate ships with honest meta.
    const n = Math.min(Math.max(Number(options.n) || 1, 1), 4);
    const baseTemp = Number.isFinite(options.temperature) ? options.temperature : 0.2;
    let best = null;
    let bestVerdict = null;
    const log = [];
    for (let attempt = 0; attempt < n; attempt++) {
      const temperature = attempt === 0 ? baseTemp : Math.min(baseTemp + attempt * 0.25, 1.2);
      const chatBody = { ...(model.model ? { model: model.model } : {}), messages, temperature, max_tokens: Math.min(Number(options.max_tokens) || 512, 512) };
      if (options.grammar) {
        const g = loadGrammar(options.grammar);
        if (g) chatBody.grammar = g;
      }
      const response = await fetch(`${model.endpoint}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(chatBody),
        signal: AbortSignal.timeout(Number(options.timeout_ms) || 90_000)
      });
      if (!response.ok) throw new Error(`local runtime returned HTTP ${response.status}`);
      const json = await response.json();
      const text = json.choices?.[0]?.message?.content ?? '';
      const verdict = scoreCandidate(text);
      log.push({ attempt, temperature, pass: verdict.pass, penalty: verdict.penalty });
      if (!best || verdict.penalty < bestVerdict.penalty) { best = { json, text }; bestVerdict = verdict; }
      if (verdict.pass) break;
    }
    return { ...best.json, gated: { n: log.length, picked: log.findIndex(g => g.pass), all_passed: log.every(g => g.pass), log } };
  }

  async waitReady(id, timeoutMs = 30_000) {
    const model = this.models.get(id); if (!model) throw new Error('model is not allowlisted');
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const result = await this.verifyEndpointModel(id, 5000);
        if (result.ready && (await this.warmup(id))) return true;
        if (result.status === 'conflict') throw new Error(result.error);
      } catch (error) {
        if (error.message?.includes('is serving')) throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error(`${model.name} did not become ready within ${timeoutMs}ms`);
  }

  async warmup(id) {
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
        if (response.ok) { this.warmed.add(id); return true; }
      } catch { /* server still loading context; retry */ }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    return false;
  }

  async isReady(id, timeoutMs = 5000) {
    try {
      const verified = await this.verifyEndpointModel(id, timeoutMs);
      if (!verified.ready) return verified;
      if (!(await this.warmup(id))) {
        return { id, ready: false, status: 'warming', endpoint: verified.endpoint, error: 'model is serving metadata but not yet ready to generate (warming up)' };
      }
      return verified;
    } catch (error) {
      const model = this.models.get(id);
      if (!model) throw new Error('model is not allowlisted');
      if (await this.endpointPortOpen(model)) {
        return {
          id,
          ready: false,
          status: 'conflict',
          endpoint: model.endpoint,
          error: `port ${this.endpointPort(model).port} is occupied but did not return a verifiable /v1/models response for ${model.id}: ${error.message}`
        };
      }
      return { id, ready: false, status: 'not-ready', endpoint: model.endpoint, error: error.message };
    }
  }

  async start(id) {
    const model = this.models.get(id);
    if (!model) throw new Error('model is not allowlisted');
    if (this.processes.has(id)) return { id, status: 'running', endpoint: model.endpoint };
    const relArtifact = model.artifact_uri.replace('local://', '');
    const file = this.modelPath
      ? path.resolve(this.modelPath)
      : path.resolve(this.modelDir, relArtifact);
    if (!this.modelPath && !file.startsWith(`${path.resolve(this.modelDir)}${path.sep}`)) throw new Error('model path escaped model directory');
    await fs.access(file).catch(() => { throw new Error(`Local model setup required: model file was not found at ${file}.`); });
    const endpoint = new URL(model.endpoint);
    if (this.pythonServer) {
      if (!this.pythonReady) await this.probePython();
      if (!this.pythonReady) throw new Error('Local model setup required: no Python with llama_cpp found. Set AIDE_PYTHON to a Python 3.10 interpreter with llama-cpp-python installed (tried AIDE_PYTHON, `py -3.10 -E`, `py -3 -E`, E:\\Python310\\python.exe).');
      const alreadyUp = await this.verifyEndpointModel(id).catch(async error => {
        if (await this.endpointPortOpen(model)) {
          return {
            ready: false,
            status: 'conflict',
            error: `port ${this.endpointPort(model).port} is occupied but did not return a verifiable /v1/models response for ${model.id}: ${error.message}`
          };
        }
        return null;
      });
      if (alreadyUp?.ready) return { id, status: 'running', endpoint: model.endpoint, served_models: alreadyUp.served_models };
      if (alreadyUp?.status === 'conflict') throw new Error(alreadyUp.error);
      const args = [...this.pythonCmd.args, '-m', 'llama_cpp.server', '--model', file, '--host', '127.0.0.1', '--port', String(endpoint.port || 8080), '--n_ctx', String(model.context_tokens || 2048), '--n_gpu_layers', '0', '--logits_all', 'false'];
      const child = this.spawnProcess(this.pythonCmd.interp, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      this.processes.set(id, child);
      const stderrLog = path.resolve(this.modelDir, '..', 'logs', `model-${id}.err.log`);
      child.stderr?.pipe(createWriteStream(stderrLog, { flags: 'a' }));
      child.once('exit', (code, signal) => {
        this.processes.delete(id);
        fs.appendFile(stderrLog, `[exit code=${code} signal=${signal}]\n`).catch(() => {});
      });
      return { id, status: 'starting', endpoint: model.endpoint };
    }
    if (!this.binaryPath) throw new Error('Local model setup required: install llama-server and set AIDE_LLAMA_SERVER.');
    await fs.access(this.binaryPath).catch(() => { throw new Error(`Local model setup required: llama-server was not found at ${this.binaryPath}.`); });
    // Floor gate. If we are below the floor but we MANAGE running engines,
    // stopping them is a legitimate way to free memory; an unmanaged external
    // engine is not ours to kill, so refuse with the actionable message.
    const freeRamBefore = os.freemem();
    const hadManagedEngines = this.processes.size > 0;
    if (freeRamBefore < FREE_RAM_FLOOR_BYTES && !hadManagedEngines) {
      throw new Error(`Not enough free memory to start ${model.name} (${Math.round(freeRamBefore / 1048576)} MB free, need ${Math.round(FREE_RAM_FLOOR_BYTES / 1048576)} MB). Stop another running engine (STOP ENGINE button) or wait for heavy jobs to finish, then try again.`);
    }
    if (hadManagedEngines) await this.stopAll();
    // LAW: a freshly killed engine does not return its commit charge to the OS
    // instantly. Spawning a multi-GB mmap load into that transient hole causes
    // commit exhaustion: the engine dies with exit code 1 and ZERO stderr, and
    // the whole machine thrashes (2026-08-27: cipher 4 GB q8_0 vs resident
    // qwen reproduced both the wedge and the silent death live; llama.cpp
    // issue #26822 shows the same silent-failure family on Windows). Never
    // spawn until memory has actually drained.
    if (hadManagedEngines || freeRamBefore < FREE_RAM_FLOOR_BYTES) {
      const drained = await this.waitForMemoryDrain();
      if (!drained.drained) {
        throw new Error(`Memory did not recover after stopping engines (${Math.round(drained.freeRam / 1048576)} MB free, need ${Math.round(FREE_RAM_FLOOR_BYTES / 1048576)} MB). Close heavy applications and try again.`);
      }
    }
    // LAW: never re-add --no-mmap. In this VMware-SVGA/Pascal-WDDM environment
    // the monolithic private-memory read wedges or silently exits the engine at
    // heavy-init (2026-08-27); default mmap paging streams weights into VRAM in
    // ~72s and binds HTTP normally (proof: logs/iso-mmap.err.log vs every
    // --no-mmap attempt dying with zero stderr).
    // ngl comes ONLY from profile runtimeArgs (ngl:999 in profiles). Never
    // hardcode '-ngl' here too — it duplicated the profile flag and emitted
    // llama.cpp 'DEPRECATED: argument -ngl specified multiple times' plus
    // 'common_fit_params: failed to fit params ... n_gpu_layers already set by
    // user to 999, abort'. No-profile models fall back to llama.cpp 'auto' fit.
    const args = ['-m', file, '--host', '127.0.0.1', '--port', String(endpoint.port || 8080), '--ctx-size', String(model.context_tokens || 2048), '--threads', '4', '--parallel', '1', '--no-warmup', '--prio', '-1', '--jinja', ...this.samplerArgs(this.loadProfile(id)), ...this.runtimeArgs(this.loadProfile(id))];
    // LoRA adapter hot-load: apply fine-tuned weights alongside base at inference
    if (model.lora_adapter) {
      const loraAbs = path.isAbsolute(model.lora_adapter) ? model.lora_adapter : path.resolve(this.modelDir, '..', model.lora_adapter);
      if (existsSync(loraAbs)) args.push('--lora', loraAbs);
    }
    const resolved = await this.resolveBinaryFor(this.loadProfile(id));
    const binaryForRun = typeof resolved === 'string' ? resolved : resolved.path;
    if (typeof resolved === 'object' && resolved.device) args.push('--device', resolved.device);
    console.error(`[backend] ${id} -> ${binaryForRun}${typeof resolved === 'object' && resolved.device ? ` device=${resolved.device}` : ''} | cfg=${JSON.stringify(this.loadBackendsConfig())} | profile=${JSON.stringify(this.loadProfile(id))}`);
    // Detached: own process group -> immune to console Ctrl+C events that
    // killed engines with STATUS_CONTROL_C_EXIT when unrelated tool calls
    // timed out (2026-08-25, exit code 3221225786).
    // Ensure binary directory is set as cwd so Windows DLL search finds backend DLLs (e.g. ggml-vulkan.dll)
    const binaryDir = path.dirname(binaryForRun);
    const stderrLog = path.resolve(this.modelDir, '..', 'logs', `engine-${id}.err.log`);
    // Early-exit guard with one retry. The lethal window is the first seconds
    // of load: under memory/VRAM contention the engine dies with exit code 1
    // and empty stderr (2026-08-27 live reproduction). If it survives 8s it is
    // past the danger window and waitReady() takes over readiness gating.
    let child = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      child = this.spawnProcess(binaryForRun, args, { cwd: binaryDir, stdio: ['ignore', 'ignore', 'pipe'], detached: true });
      child.stderr?.pipe(createWriteStream(stderrLog, { flags: 'a' }));
      this.processes.set(id, child);
      child.once('exit', (code, signal) => {
        this.processes.delete(id);
        fs.appendFile(stderrLog, `[exit code=${code} signal=${signal}]\n`).catch(() => {});
      });
      const early = await new Promise(resolve => {
        const timer = setTimeout(() => resolve(null), 8000);
        child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
      });
      if (!early) break; // survived the danger window
      if (attempt === 2) {
        throw new Error(`${model.name} engine exited immediately (code ${early.code}${early.signal ? `, signal ${early.signal}` : ''}). See logs/engine-${id}.err.log. On this machine the dominant cause is memory or device contention while another engine holds RAM/VRAM — free resources (STOP ENGINE) and try again.`);
      }
      console.error(`[backend] ${id} engine died early (code ${early.code}); draining memory and retrying once`);
      await this.waitForMemoryDrain();
    }
    return { id, status: 'starting', endpoint: model.endpoint };
  }

  async register({ filename, repo_id = '', quant_label = '', context_tokens } = {}) {
    const rel = String(filename || '');
    if (!/\.gguf$/i.test(rel)) throw new Error('only .gguf artifacts can be registered');
    if (rel.includes('\\') || rel.startsWith('/') || rel.split('/').some(seg => !seg || seg === '.' || seg === '..')) {
      throw new Error('filename must be a relative path of safe segments');
    }
    const file = path.resolve(this.modelDir, rel);
    if (!file.startsWith(`${path.resolve(this.modelDir)}${path.sep}`)) throw new Error('path escaped model directory');
    await fs.access(file).catch(() => { throw new Error(`artifact not found in models directory: ${rel}`); });
    const id = path.basename(rel).replace(/\.gguf$/i, '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
    if (this.models.has(id)) {
      const existing = this.models.get(id);
      return { id: existing.id, status: existing.status, endpoint: existing.endpoint, existing: true };
    }
    const used = new Set([...this.models.values()].map(m => {
      try { return Number(new URL(m.endpoint).port); } catch { return 0; }
    }));
    let port = 8090;
    while (used.has(port) && port < 8199) port += 1;
    const entry = { id, name: path.basename(rel).replace(/\.gguf$/i, ''), status: 'ready', endpoint: `http://127.0.0.1:${port}/v1`, artifact_uri: `local://${rel}`, model: rel, context_tokens: Number(context_tokens) || 2048 };
    if (repo_id) entry.repo_id = repo_id;
    if (quant_label) entry.quant_label = quant_label;
    this.models.set(id, entry);
    try {
      const manifest = JSON.parse(await fs.readFile(this.manifestPath, 'utf8'));
      if (Array.isArray(manifest.models) && !manifest.models.some(m => m.id === id)) {
        manifest.models.push(entry);
        await fs.writeFile(this.manifestPath, JSON.stringify(manifest, null, 2));
      }
    } catch { /* runtime has it this session; manifest persist is best-effort */ }
    return { id, status: 'ready', endpoint: entry.endpoint };
  }

  async stop(id) {
    const model = this.models.get(id);
    const child = this.processes.get(id);
    if (child) {
      child.kill('SIGTERM');
      this.processes.delete(id);
      return { id, status: 'stopped' };
    }
    // Orphaned server from a previous daemon life: free its port directly.
    const port = model?.endpoint ? new URL(model.endpoint).port : null;
    if (!port) return { id, status: 'not-running' };
    const freed = await this.freePort(port);
    return { id, status: freed ? 'stopped' : 'not-running' };
  }

  async freePort(port) {
    const target = `:${port} `;
    const out = await new Promise(resolve => {
      execFile('netstat', ['-ano'], { windowsHide: true }, (error, stdout) => resolve(error ? '' : String(stdout)));
    });
    const pids = [...new Set(out.split('\n')
      .map(line => line.replace(/\s+/g, ' ').trim())
      .filter(line => line.startsWith('TCP') && line.includes(target) && line.includes('LISTENING'))
      .map(line => line.split(' ').pop())
      .filter(pid => /^\d+$/.test(pid)))];
    for (const pid of pids) {
      await new Promise(resolve => { execFile('taskkill', ['/F', '/PID', pid], { windowsHide: true }, () => resolve()); });
    }
    return pids.length > 0;
  }

  // Poll until the OS actually reports the floor as free. A killed engine
  // releases its commit charge asynchronously; spawning a replacement model
  // load before that drain is what produced the silent exit-code-1 deaths
  // (see LAW comment in start()).
  async waitForMemoryDrain(minFreeBytes = FREE_RAM_FLOOR_BYTES, timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs;
    let last = os.freemem();
    while (Date.now() < deadline) {
      last = os.freemem();
      if (last >= minFreeBytes) return { drained: true, freeRam: last };
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    return { drained: false, freeRam: last };
  }
  async stopAll() {
    for (const id of [...this.processes.keys()]) await this.stop(id);
  }
}

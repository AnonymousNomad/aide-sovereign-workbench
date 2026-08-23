import { promises as fs } from 'node:fs';
import { existsSync, createWriteStream } from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';

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
        ? path.resolve(this.modelDir, path.basename(model.artifact_uri.replace('local://', '')))
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
    const payload = { messages, temperature: 0.2, max_tokens: Math.min(Number(options.max_tokens) || 512, 512) };
    if (model.model) payload.model = model.model;
    const response = await fetch(`${model.endpoint}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(Number(options.timeout_ms) || 90_000)
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`local runtime returned HTTP ${response.status}: ${detail.slice(0, 400)}`);
    }
    return response.json();
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
    const freeRam = os.freemem();
    if (freeRam < FREE_RAM_FLOOR_BYTES) {
      throw new Error(`Not enough free memory to start ${model.name} (${Math.round(freeRam / 1048576)} MB free, need ${Math.round(FREE_RAM_FLOOR_BYTES / 1048576)} MB). Stop another running engine (STOP ENGINE button) or wait for heavy jobs to finish, then try again.`);
    }
    await this.stopAll();
    const args = ['-m', file, '--host', '127.0.0.1', '--port', String(endpoint.port || 8080), '--ctx-size', String(model.context_tokens || 2048), '--threads', '4', '--parallel', '1', '--log-disable', '--prio', '-1'];
    const child = this.spawnProcess(this.binaryPath, args, { stdio: 'ignore' });
    this.processes.set(id, child);
    child.once('exit', () => this.processes.delete(id));
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

  async stopAll() {
    for (const id of [...this.processes.keys()]) await this.stop(id);
  }
}

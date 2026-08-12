import http from 'node:http';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ModelManager } from './model-manager.mjs';
import { CommunityStore } from '../community/store.mjs';
import { LspManager } from './lsp-manager.mjs';
import { DapManager } from './dap-manager.mjs';
import { WorkspaceManager } from './workspace-manager.mjs';
import { TrainingManager } from './training-manager.mjs';
import { ReplayStore } from './replay-store.mjs';
import { ArenaManager } from './arena-manager.mjs';
import { buildBlueprint } from '../blueprint/graph.mjs';
import { TutorManager } from '../academy/tutor-manager.mjs';

const HOST = '127.0.0.1';
const PORT = Number(process.env.AIDE_DAEMON_PORT || 4777);
const WORKSPACE = path.resolve(process.env.AIDE_WORKSPACE || process.cwd());
const MODEL_DIR = path.resolve(process.env.AIDE_MODEL_DIR || path.join(WORKSPACE, 'models'));
const MANIFEST = path.join(WORKSPACE, 'models', 'manifest.json');
const modelManager = new ModelManager({ manifestPath: MANIFEST, modelDir: MODEL_DIR, binaryPath: process.env.AIDE_LLAMA_SERVER || '/root/runtime/llama-b10333/llama-server' });
await modelManager.load().catch(() => {});
const communityStore = new CommunityStore(path.join(WORKSPACE, 'community', 'store.json'));
await communityStore.load().catch(() => {});
const lspManager = new LspManager({ manifestPath: path.join(WORKSPACE, 'languages', 'manifest.json'), workspace: WORKSPACE });
await lspManager.load().catch(() => {});
const dapManager = new DapManager({ manifestPath: path.join(WORKSPACE, 'debuggers', 'manifest.json'), workspace: WORKSPACE, pythonPath: process.env.AIDE_PYTHON || '' });
await dapManager.load().catch(() => {});
const workspaceManager = new WorkspaceManager(WORKSPACE);
const trainingManager = new TrainingManager({ manifestPath: path.join(WORKSPACE, 'training', 'manifest.json'), workspace: WORKSPACE });
await trainingManager.load().catch(() => {});
const replayStore = new ReplayStore(path.join(WORKSPACE, 'replays', 'store.json'));
await replayStore.load().catch(() => {});
const arenaManager = new ArenaManager({ modelManager, manifestPath: MANIFEST, suitePath: path.join(WORKSPACE, 'benchmarks', 'manifest.json') });
const tutorManager = new TutorManager({ coursesDir: path.join(WORKSPACE, 'academy', 'courses'), progressPath: path.join(WORKSPACE, 'academy', 'progress.json') });
await tutorManager.load().catch(() => {});

function json(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': 'http://127.0.0.1:4173',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  response.end(payload);
}

async function body(request) {
  let data = '';
  for await (const chunk of request) {
    data += chunk;
    if (Buffer.byteLength(data) > 16 * 1024) throw new Error('request too large');
  }
  return data ? JSON.parse(data) : {};
}

function runGit(args) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: WORKSPACE, timeout: 5000, maxBuffer: 256 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr.trim() || error.message));
      else resolve(stdout);
    });
  });
}

async function workspaceSummary() {
  const entries = await fs.readdir(WORKSPACE, { withFileTypes: true });
  return entries.filter(entry => !entry.name.startsWith('.')).slice(0, 200).map(entry => ({
    name: entry.name,
    kind: entry.isDirectory() ? 'directory' : 'file'
  }));
}

const server = http.createServer(async (request, response) => {
  if (request.method === 'OPTIONS') return json(response, 204, {});
  try {
    if (request.method === 'GET' && request.url === '/health') {
      return json(response, 200, { ok: true, service: 'aide-local-daemon', host: HOST, workspace: WORKSPACE });
    }
    if (request.method === 'GET' && request.url === '/api/workspace') {
      return json(response, 200, { workspace: WORKSPACE, entries: await workspaceSummary() });
    }
    if (request.method === 'GET' && request.url === '/api/blueprint') {
      return json(response, 200, buildBlueprint({ entries: await workspaceSummary(), models: modelManager.status(), training: trainingManager.status() }));
    }
    if (request.method === 'GET' && request.url === '/api/academy') return json(response, 200, { courses: tutorManager.catalog() });
    if (request.method === 'GET' && request.url.startsWith('/api/academy/session')) {
      const courseId = new URL(request.url, 'http://127.0.0.1').searchParams.get('course') || undefined;
      return json(response, 200, tutorManager.session(courseId));
    }
    if (request.method === 'POST' && request.url === '/api/academy/complete') {
      const input = await body(request);
      return json(response, 200, await tutorManager.complete(input.courseId, input.lessonId, input.reflection));
    }
    if (request.method === 'GET' && request.url.startsWith('/api/file?')) {
      const relativePath = new URL(request.url, 'http://127.0.0.1').searchParams.get('path');
      return json(response, 200, { path: relativePath, content: await workspaceManager.read(relativePath) });
    }
    if (request.method === 'POST' && request.url === '/api/file/write') {
      const input = await body(request);
      return json(response, 200, await workspaceManager.write(input.path, input.content, input.approved));
    }
    if (request.method === 'POST' && request.url === '/api/patch/apply') {
      const input = await body(request);
      return json(response, 200, await workspaceManager.applyPatch(input.patch, input.approved));
    }
    if (request.method === 'GET' && request.url === '/api/git/status') {
      try {
        return json(response, 200, { workspace: WORKSPACE, status: await runGit(['status', '--short']) });
      } catch (error) {
        return json(response, 200, { workspace: WORKSPACE, status: '', unavailable: error.message });
      }
    }
    if (request.method === 'GET' && request.url === '/api/models/status') {
      return json(response, 200, { models: modelManager.status() });
    }
    if (request.method === 'GET' && request.url === '/api/community') {
      return json(response, 200, communityStore.list());
    }
    if (request.method === 'GET' && request.url === '/api/lsp/status') {
      return json(response, 200, { servers: lspManager.status() });
    }
    if (request.method === 'GET' && request.url === '/api/dap/status') {
      return json(response, 200, { adapters: dapManager.status() });
    }
    if (request.method === 'GET' && request.url === '/api/training/status') {
      return json(response, 200, trainingManager.status());
    }
    if (request.method === 'GET' && request.url === '/api/replays') return json(response, 200, replayStore.list());
    if (request.method === 'POST' && request.url === '/api/replays') return json(response, 201, { replay: await replayStore.add(await body(request)) });
    if (request.method === 'POST' && request.url === '/api/arena/run') return json(response, 200, await arenaManager.run((await body(request)).approved));
    if (request.method === 'POST' && request.url === '/api/training/start') {
      const input = await body(request);
      return json(response, 200, trainingManager.start(input.id, input.approved));
    }
    if (request.method === 'POST' && request.url === '/api/training/stop') {
      return json(response, 200, trainingManager.stop());
    }
    if (request.method === 'POST' && request.url === '/api/dap/start') {
      return json(response, 200, await dapManager.start((await body(request)).id));
    }
    if (request.method === 'POST' && request.url === '/api/dap/request') {
      const input = await body(request);
      return json(response, 200, await dapManager.request(input.id, input.request));
    }
    if (request.method === 'POST' && request.url === '/api/dap/stop') {
      return json(response, 200, await dapManager.stop((await body(request)).id));
    }
    if (request.method === 'POST' && request.url === '/api/lsp/start') {
      return json(response, 200, await lspManager.start((await body(request)).id));
    }
    if (request.method === 'POST' && request.url === '/api/lsp/request') {
      const input = await body(request);
      return json(response, 200, await lspManager.request(input.id, input.message));
    }
    if (request.method === 'POST' && request.url === '/api/lsp/notify') {
      const input = await body(request);
      return json(response, 200, lspManager.notify(input.id, input.message));
    }
    if (request.method === 'POST' && request.url === '/api/lsp/stop') {
      return json(response, 200, await lspManager.stop((await body(request)).id));
    }
    if (request.method === 'POST' && request.url === '/api/community/items') {
      const input = await body(request);
      return json(response, 201, { item: await communityStore.add(input.type, input.item) });
    }
    if (request.method === 'PUT' && request.url === '/api/community/items') {
      const input = await body(request);
      return json(response, 200, { item: await communityStore.update(input.type, input.index, input.item) });
    }
    if (request.method === 'DELETE' && request.url === '/api/community/items') {
      const input = await body(request);
      return json(response, 200, { item: await communityStore.remove(input.type, input.index) });
    }
    if (request.method === 'POST' && request.url === '/api/models/start') {
      return json(response, 200, await modelManager.start((await body(request)).id));
    }
    if (request.method === 'POST' && request.url === '/api/models/stop') {
      const id = (await body(request)).id;
      return json(response, 200, id ? await modelManager.stop(id) : (await modelManager.stopAll(), { status: 'stopped' }));
    }
    return json(response, 404, { error: 'not found' });
  } catch (error) {
    return json(response, 500, { error: 'local daemon error' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`AIDE local daemon listening on http://${HOST}:${PORT}`);
  console.log(`workspace: ${WORKSPACE}`);
});

import http from 'node:http';
import { execFile } from 'node:child_process';
import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
import { LearnerState } from '../academy/learner-state.mjs';
import { PluginManager } from '../plugins/manager.mjs';
import { Operator } from './operator.mjs';
import { TaskManager } from '../tasks/manager.mjs';
import { SessionStore } from '../session/store.mjs';
import { ArtifactStore } from '../artifacts/store.mjs';
import { ProviderManager } from '../providers/manager.mjs';
import { WorkflowManager } from './workflow.mjs';
import { HandoffManager } from './handoff.mjs';
import { buildScaffold, injectScaffold, composeDriftReminder, estimateTokens, HARNESS_VERSION } from '../harness/scaffold.mjs';

const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function matchMask(filePath, mask) {
  if (!mask) return true;
  const patterns = mask.split(',').map(p => p.trim()).filter(Boolean);
  if (!patterns.length) return true;
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return patterns.some(function(pattern) {
    const glob = esc(pattern).replace(/\*/g, '.*').replace(/\?/g, '.');
    return new RegExp('^' + glob + '$', 'i').test(filePath);
  });
}

const HOST = '127.0.0.1';
const PORT = Number(process.env.AIDE_DAEMON_PORT || 4777);
const AIDE_HOME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACE = path.resolve(process.env.AIDE_WORKSPACE || AIDE_HOME);
const STATE_DIR = path.join(WORKSPACE, '.aide');
const MODEL_DIR = path.resolve(process.env.AIDE_MODEL_DIR || path.join(AIDE_HOME, 'models'));
const MANIFEST = path.join(AIDE_HOME, 'models', 'manifest.json');
const workspaceConfig = async relative => {
  const candidate = path.join(WORKSPACE, relative);
  try { await fs.access(candidate); return candidate; } catch { return path.join(AIDE_HOME, relative); }
};
const llamaBinary = process.env.AIDE_LLAMA_SERVER
  || [path.join(AIDE_HOME, 'runtime', 'llama-server' + (process.platform === 'win32' ? '.exe' : '')), 'E:\\llama-cpp\\llama-server.exe'].find(candidate => existsSync(candidate))
  || path.join(AIDE_HOME, 'runtime', 'llama-server' + (process.platform === 'win32' ? '.exe' : ''));
// Binary serving is the verified mode on this machine (python llama_cpp.server spawn hangs under node-spawn; direct llama-server.exe is proven). See AGENT_NOTES 2026-08-24.
const modelManager = new ModelManager({ manifestPath: MANIFEST, modelDir: MODEL_DIR, binaryPath: llamaBinary, modelPath: process.env.AIDE_MODEL_PATH || '', pythonServer: false });
await modelManager.load().catch(() => {});
const communityStore = new CommunityStore(path.join(STATE_DIR, 'community-store.json'));
await communityStore.load().catch(() => {});
const lspManager = new LspManager({ manifestPath: path.join(AIDE_HOME, 'languages', 'manifest.json'), workspace: WORKSPACE, home: AIDE_HOME });
await lspManager.load().catch(() => {});
const dapManager = new DapManager({ manifestPath: path.join(AIDE_HOME, 'debuggers', 'manifest.json'), workspace: WORKSPACE, pythonPath: process.env.AIDE_PYTHON || '' });
await dapManager.load().catch(() => {});
const workspaceManager = new WorkspaceManager(WORKSPACE);
const trainingManager = new TrainingManager({ manifestPath: path.join(AIDE_HOME, 'training', 'manifest.json'), workspace: WORKSPACE });
await trainingManager.load().catch(() => {});
const replayStore = new ReplayStore(path.join(STATE_DIR, 'replays.json'));
await replayStore.load().catch(() => {});
const arenaManager = new ArenaManager({ modelManager, manifestPath: MANIFEST, suitePath: path.join(AIDE_HOME, 'benchmarks', 'manifest.json') });
const learnerState = new LearnerState({ statePath: path.join(STATE_DIR, 'learner-state.json') });
await learnerState.load().catch(() => {});
const tutorManager = new TutorManager({ coursesDir: path.join(AIDE_HOME, 'academy', 'courses'), progressPath: path.join(STATE_DIR, 'academy-progress.json'), pythonPath: process.env.AIDE_PYTHON || '', learnerState });
await tutorManager.load().catch(() => {});
const pluginManager = new PluginManager({ pluginsDir: path.join(WORKSPACE, 'plugins'), statePath: path.join(STATE_DIR, 'plugins.json'), presetsPath: path.join(AIDE_HOME, 'plugins', 'presets.json') });
await pluginManager.load().catch(() => {});
const operator = new Operator({ modelManager, workspaceManager, gitStatus: () => runGit(['status', '--short']).catch(() => '') });
const taskManager = new TaskManager({ manifestPath: await workspaceConfig('tasks/manifest.json'), workspace: WORKSPACE });
await taskManager.load().catch(() => {});
const sessionStore = new SessionStore(path.join(STATE_DIR, 'session.json'));
await sessionStore.load().catch(() => {});
const artifactStore = new ArtifactStore(path.join(STATE_DIR, 'artifacts'));
const providerManager = new ProviderManager(await workspaceConfig('providers/manifest.json'));
await providerManager.load().catch(() => {});
const workflowManager = new WorkflowManager({ modelManager, workspaceManager, artifactStore });
const handoffManager = new HandoffManager({ modelManager, workspaceManager, artifactStore });

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

function errorStatus(error) {
  return /Local model setup required|model file was not found|llama-server was not found/i.test(error?.message || '') ? 503 : 500;
}

async function body(request) {
  let data = '';
  for await (const chunk of request) {
    data += chunk;
    if (Buffer.byteLength(data) > 5 * 1024 * 1024) throw new Error('request too large');
  }
  return data ? JSON.parse(data) : {};
}

const WORKSPACE_URI = pathToFileURL(path.join(WORKSPACE, 'placeholder')).href.slice(0, -'placeholder'.length);
const WORKSPACE_PLACEHOLDER = 'file:///workspace/';
const WORKSPACE_PLACEHOLDER_RE = /^file:\/\/\/workspace\/?/;
const toRealUri = placeholder => WORKSPACE_PLACEHOLDER_RE.test(placeholder) ? pathToFileURL(path.join(WORKSPACE, placeholder.slice(WORKSPACE_PLACEHOLDER.length))).href : placeholder;
const toPlaceholderUri = real => real.startsWith(WORKSPACE_URI) ? WORKSPACE_PLACEHOLDER + real.slice(WORKSPACE_URI.length) : real;
const rewriteIncoming = message => {
  if (!message || typeof message !== 'object') return message;
  const params = message.params || {};
  if (params.rootUri) params.rootUri = toRealUri(params.rootUri);
  if (params.textDocument?.uri) params.textDocument.uri = toRealUri(params.textDocument.uri);
  return message;
};

function runGit(args) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: WORKSPACE, timeout: 5000, maxBuffer: 256 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo' } }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr.trim() || error.message));
      else resolve(stdout);
    });
  });
}

function parseGitStatus(raw) {
  const records = raw.split('\0').filter(Boolean);
  const header = records.shift() || '';
  const branchMatch = /^##\s+([^\.\s]+)(?:\.\.([^\s]+))?(?:\s+\[([^\]]+)\])?/.exec(header);
  const tracking = branchMatch?.[2] || '';
  const counts = branchMatch?.[3] || '';
  const ahead = Number(/ahead (\d+)/.exec(counts)?.[1] || 0);
  const behind = Number(/behind (\d+)/.exec(counts)?.[1] || 0);
  const files = records.filter(record => record.length >= 3).map(record => {
    const index = record[0];
    const worktree = record[1];
    const rawPath = record.slice(3);
    const rename = rawPath.lastIndexOf(' -> ');
    return {
      path: rename >= 0 ? rawPath.slice(rename + 4) : rawPath,
      original_path: rename >= 0 ? rawPath.slice(0, rename) : '',
      index,
      worktree,
      kind: index !== ' ' ? index : worktree
    };
  });
  return { branch: branchMatch?.[1] || '', tracking, ahead, behind, files, raw: records.join('\0') };
}

async function gitStatusSummary() {
  const raw = await runGit(['status', '--porcelain=v1', '-z', '--branch']);
  const summary = parseGitStatus(raw);
  return { ...summary, status: await runGit(['status', '--short']) };
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
    if (request.method === 'GET' && request.url === '/api/workspace/tree') {
      return json(response, 200, { workspace: WORKSPACE, tree: await workspaceManager.tree() });
    }
    if (request.method === 'GET' && request.url === '/api/blueprint') {
      return json(response, 200, buildBlueprint({ entries: await workspaceSummary(), models: modelManager.status(), training: trainingManager.status() }));
    }
    if (request.method === 'GET' && request.url === '/api/models') {
      const manifest = JSON.parse(await fs.readFile('models/manifest.json', 'utf8'));
      return json(response, 200, { models: manifest.models });
    }
    if (request.method === 'POST' && request.url === '/api/model/start') {
      const input = await body(request);
      const modelId = input.id;
      const model = modelManager.get(modelId);
      if (!model) throw new Error('model not allowlisted');
      return json(response, 200, await modelManager.start(modelId));
    }
    if (request.method === 'POST' && request.url === '/api/model/stop') {
      const input = await body(request);
      const modelId = input.id;
      return json(response, 200, modelManager.stop(modelId));
    }
    if (request.method === 'GET' && request.url === '/api/model/status') {
      return json(response, 200, modelManager.status());
    }
    if (request.method === 'GET' && request.url.startsWith('/api/model/ready?')) {
      const id = new URL(request.url, 'http://127.0.0.1').searchParams.get('id');
      return json(response, 200, await modelManager.isReady(id));
    }
    if (request.method === 'GET' && request.url === '/api/academy') return json(response, 200, { courses: tutorManager.catalog() });
    if (request.method === 'GET' && request.url === '/api/plugins') return json(response, 200, { api_version: '1', plugins: pluginManager.list() });
    if (request.method === 'GET' && request.url === '/api/plugins/presets') return json(response, 200, { api_version: '1', presets: pluginManager.presets() });
    if (request.method === 'POST' && request.url === '/api/plugins/trust') {
      const input = await body(request);
      return json(response, 200, { api_version: '1', plugins: await pluginManager.setTrust(input.id, input.trusted === true) });
    }
    if (request.method === 'POST' && request.url === '/api/plugins/execute') {
      const input = await body(request);
      return json(response, 200, { result: await pluginManager.execute(input.id, input.payload || {}) });
    }
    if (request.method === 'POST' && request.url === '/api/plugins/scaffold') {
      const input = await body(request);
      if (input.approved !== true) throw new Error('explicit approval required');
      return json(response, 201, { api_version: '1', plugins: await pluginManager.scaffold(input.id) });
    }
    if (request.method === 'GET' && request.url.startsWith('/api/academy/session')) {
      const courseId = new URL(request.url, 'http://127.0.0.1').searchParams.get('course') || undefined;
      return json(response, 200, tutorManager.session(courseId));
    }
    if (request.method === 'POST' && request.url === '/api/academy/complete') {
      const input = await body(request);
      return json(response, 200, await tutorManager.complete(input.courseId, input.lessonId, input.reflection));
    }
    if (request.method === 'POST' && request.url === '/api/academy/check') { const input = await body(request); return json(response, 200, await tutorManager.check(input.courseId, input.lessonId)); }
    if (request.method === 'GET' && request.url.startsWith('/api/academy/certificate?')) {
      const courseId = new URL(request.url, 'http://127.0.0.1').searchParams.get('course');
      return json(response, 200, tutorManager.certificate(courseId));
    }
    if (request.method === 'GET' && request.url.startsWith('/api/file?')) {
      const relativePath = new URL(request.url, 'http://127.0.0.1').searchParams.get('path');
      const absolute = workspaceManager.resolve(relativePath);
      const stat = await fs.stat(absolute).catch(() => null);
      if (!stat) throw new Error(`file not found: ${relativePath}`);
      if (stat.size > 1024 * 1024) return json(response, 200, { path: relativePath, too_large: true, size: stat.size });
      return json(response, 200, { path: relativePath, content: await workspaceManager.read(relativePath), size: stat.size });
    }
    if (request.method === 'POST' && request.url === '/api/file/write') {
      const input = await body(request);
      return json(response, 200, await workspaceManager.write(input.path, input.content, input.approved));
    }
    if (request.method === 'GET' && request.url.startsWith('/api/search?')) {
      const params = new URL(request.url, 'http://127.0.0.1').searchParams;
      const query = String(params.get('q') || '').trim();
      if (!query || query.length > 200) throw new Error('search query is required');
      const useRegex = params.get('regex') === '1';
      const caseInsensitive = params.get('icase') === '1';
      const wholeWord = params.get('word') === '1';
      const fileMask = params.get('mask') || '';
      const mode = caseInsensitive ? 'i' : '';
      const pattern = useRegex ? query : escapeRegExp(query);
      let regex;
      try {
        regex = new RegExp(wholeWord ? '\\b' + pattern + '\\b' : pattern, mode);
      } catch (error) {
        throw new Error('invalid search pattern: ' + error.message);
      }
      const results = [];
      const excludes = ['node_modules', 'target', '.git', 'dist', 'build', 'assets', '.aide', 'logs', 'legacy-shell-backup'].filter(name => !params.get('include-' + name));
      await (async function walk(dir) {
        for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
          if (entry.name.startsWith('.') || excludes.includes(entry.name)) continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) { if (results.length < 400) await walk(full); continue; }
          const relative = path.relative(WORKSPACE, full).split(path.sep).join('/');
          if (fileMask && !matchMask(relative, fileMask)) continue;
          const stat = await fs.stat(full);
          if (stat.size > 512 * 1024) continue;
          const text = await fs.readFile(full, 'utf8').catch(() => '');
          const hits = [];
          text.split('\n').forEach((line, index) => { if (regex.test(line)) hits.push({ line: index + 1, text: line.replace(/\r$/, '').slice(0, 300) }); });
          if (hits.length) results.push({ path: relative, hits });
        }
      })(WORKSPACE);
      return json(response, 200, { query, results, total: results.reduce((sum, file) => sum + file.hits.length, 0), regex: useRegex, caseInsensitive, wholeWord, fileMask });
    }
    if (request.method === 'POST' && request.url === '/api/search/replace') {
      const input = await body(request);
      const query = String(input.query || '').trim();
      if (!query || query.length > 200) throw new Error('search query is required');
      if (input.approved !== true) throw new Error('explicit approval required for workspace replace');
      const replacement = String(input.replacement ?? '');
      const useRegex = input.regex === true;
      const caseInsensitive = input.icase === true;
      const wholeWord = input.word === true;
      const fileMask = input.mask || '';
      const mode = caseInsensitive ? 'i' : '';
      const pattern = useRegex ? query : escapeRegExp(query);
      let regex;
      try { regex = new RegExp(wholeWord ? '\\b' + pattern + '\\b' : pattern, mode); } catch (error) { throw new Error('invalid search pattern: ' + error.message); }
      const excludes = ['node_modules', 'target', '.git', 'dist', 'build'];
      const globalPattern = new RegExp(useRegex ? query : escapeRegExp(query), caseInsensitive ? 'gi' : 'g');
      let filesChanged = 0; let occurrences = 0;
      await (async function walk(dir) {
        for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
          if (entry.name.startsWith('.') || excludes.includes(entry.name)) continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) { if (occurrences < 20000) await walk(full); continue; }
          const relative = path.relative(WORKSPACE, full).split(path.sep).join('/');
          if (fileMask && !matchMask(relative, fileMask)) continue;
          const stat = await fs.stat(full);
          if (stat.size > 512 * 1024) continue;
          let text = await fs.readFile(full, 'utf8').catch(() => null);
          if (text === null) continue;
          if (!regex.test(text)) continue;
          const changed = text.replace(globalPattern, replacement);
          if (changed === text) continue;
          const count = (text.match(globalPattern) || []).length;
          await workspaceManager.write(relative, changed, true);
          filesChanged++; occurrences += count;
        }
      })(WORKSPACE);
      return json(response, 200, { files_changed: filesChanged, occurrences });
    }
    if (request.method === 'POST' && request.url === '/api/terminal/run') {
      const input = await body(request);
      if (input.approved !== true) throw new Error('explicit approval required');
      const program = String(input.program || '').toLowerCase();
      const args = Array.isArray(input.args) ? input.args.map(String) : [];
      if (args.length > 24) throw new Error('terminal command has too many arguments');
      if (program === 'echo') return json(response, 200, { code: 0, stdout: `${args.join(' ')}${os.EOL}`, stderr: '' });
      if (program === 'pwd') return json(response, 200, { code: 0, stdout: `${WORKSPACE}${os.EOL}`, stderr: '' });
      if (program === 'ls' || program === 'dir') {
        const target = args[0] ? workspaceManager.resolve(args[0]) : WORKSPACE;
        const entries = await fs.readdir(target, { withFileTypes: true });
        return json(response, 200, { code: 0, stdout: entries.map(entry => `${entry.isDirectory() ? '<DIR>' : '     '} ${entry.name}`).join(os.EOL) + os.EOL, stderr: '' });
      }
      if (program === 'cat' || program === 'type') {
        if (!args[0]) throw new Error(`${program} requires a workspace-relative file path`);
        return json(response, 200, { code: 0, stdout: await workspaceManager.read(args[0]), stderr: '' });
      }
      const allowed = new Set(['node', 'npm', 'npx', 'git', 'py', 'python', 'python3', 'cargo', 'rustc']);
      if (!allowed.has(program)) throw new Error('terminal command is not allowlisted');
      const result = await new Promise(resolve => execFile(program, args, { cwd: WORKSPACE, timeout: 30_000, maxBuffer: 512 * 1024, env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_PATH: process.env.NODE_PATH } }, (error, stdout, stderr) => resolve({ code: error?.code ?? 0, stdout, stderr })));
      return json(response, 200, result);
    }
    if (request.method === 'POST' && request.url === '/api/patch/apply') {
      const input = await body(request);
      return json(response, 200, await workspaceManager.applyPatch(input.patch, input.approved));
    }
    if (request.method === 'GET' && request.url === '/api/git/status') {
      try {
        return json(response, 200, { workspace: WORKSPACE, ...(await gitStatusSummary()) });
      } catch (error) {
        return json(response, 200, { workspace: WORKSPACE, status: '', unavailable: error.message });
      }
    }
    if (request.method === 'GET' && request.url.startsWith('/api/git/diff')) {
      try {
        const diffPath = new URL(request.url, `http://${HOST}:${PORT}`).searchParams.get('path') || '.';
        if (path.isAbsolute(diffPath) || diffPath.includes('..')) throw new Error('unsafe Git path');
        return json(response, 200, { path: diffPath === '.' ? '' : diffPath, diff: await runGit(['diff', '--no-ext-diff', '--', diffPath]) });
      }
      catch (error) { return json(response, 200, { diff: '', unavailable: error.message }); }
    }
    if (request.method === 'GET' && request.url === '/api/git/log') {
      try { return json(response, 200, { log: await runGit(['log', '--oneline', '--decorate', '-12']) }); }
      catch (error) { return json(response, 200, { log: '', unavailable: error.message }); }
    }
    if (request.method === 'POST' && request.url === '/api/git/stage') {
      const input = await body(request);
      if (input.approved !== true || !Array.isArray(input.paths) || !input.paths.length) throw new Error('approved file paths are required');
      if (input.paths.some(item => typeof item !== 'string' || item.startsWith('/') || item.includes('..'))) throw new Error('unsafe Git path');
      return json(response, 200, { staged: await runGit(['add', '--', ...input.paths]) });
    }
    if (request.method === 'POST' && request.url === '/api/git/commit') {
      const input = await body(request);
      if (input.approved !== true) throw new Error('explicit approval required');
      const message = String(input.message || '').trim();
      if (!message || message.length > 200) throw new Error('commit message is required');
      const committed = await runGit(['commit', '-m', message]);
      // Ship telemetry v0: intent -> verified-commit record (outcome latency foundation).
      await fs.mkdir(path.join(WORKSPACE, '.aide', 'metrics'), { recursive: true }).catch(() => {});
      await fs.appendFile(path.join(WORKSPACE, '.aide', 'metrics', 'ships.log'), JSON.stringify({ at: new Date().toISOString(), intent: String(input.intent || '').slice(0, 200), message: message.slice(0, 200) }) + '\n').catch(() => {});
      return json(response, 200, { committed });
    }
    if (request.method === 'GET' && request.url === '/api/git/branches') {
      const out = await runGit(['branch', '--format=%(refname:short)']);
      const current = (await runGit(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
      return json(response, 200, { branches: out.split('\n').map(b => b.trim()).filter(Boolean), current });
    }
    if (request.method === 'POST' && request.url === '/api/git/checkout') {
      const input = await body(request);
      const branch = String(input.branch || '').trim();
      if (!/^[\w./-]+$/.test(branch)) throw new Error('invalid branch name');
      const summary = await gitStatusSummary();
      const dirty = summary.files.filter(f => !String(f.status || '').includes('?'));
      if (dirty.length) throw new Error(`${dirty.length} uncommitted change(s) — commit or SHIP before switching branches`);
      return json(response, 200, { switched: await runGit(['checkout', branch]) !== undefined, branch });
    }
    if (request.method === 'GET' && request.url.startsWith('/api/git/log')) {
      const count = Math.min(Math.max(Number(new URL(request.url, 'http://127.0.0.1').searchParams.get('n')) || 15, 1), 100);
      let out = '';
      try { out = await runGit(['log', `--max-count=${count}`, '--date=iso-local', '--pretty=format:%h%x09%ad%x09%an%x09%s']); }
      catch (error) { return json(response, 200, { commits: [], unavailable: /ambiguous|does not have any commits|unknown revision/i.test(error.message) ? 'no commits yet' : error.message }); }
      const commits = out.split('\n').map(line => { const [hash, date, author, ...rest] = line.split('\t'); return { hash, date, author: author || '', subject: rest.join('\t') }; }).filter(c => c.hash);
      return json(response, 200, { commits });
    }
    if (request.method === 'POST' && request.url === '/api/git/push') {
      const input = await body(request);
      if (input.approved !== true) throw new Error('explicit approval required — push uploads your commits to the remote');
      const branch = String(input.branch || '').trim() || 'main';
      await fs.mkdir(path.join(WORKSPACE, '.aide', 'logs'), { recursive: true }).catch(() => {});
      await fs.appendFile(path.join(WORKSPACE, '.aide', 'logs', 'egress.log'), JSON.stringify({ action: 'git.push', remote: input.remote || 'origin', branch, at: new Date().toISOString() }) + '\n').catch(() => {});
      const out = await runGit(['push', input.remote || 'origin', `${branch}:${branch}`]);
      return json(response, 200, { pushed: true, output: String(out).slice(0, 400) });
    }
    if (request.method === 'GET' && request.url === '/api/tasks') return json(response, 200, { tasks: taskManager.list(), active: taskManager.status() });
    if (request.method === 'POST' && request.url === '/api/tasks/run') return json(response, 200, taskManager.run((await body(request)).id));
    if (request.method === 'POST' && request.url === '/api/tasks/stop') return json(response, 200, taskManager.stop());
    if (request.method === 'GET' && request.url === '/api/tasks/status') return json(response, 200, taskManager.status());
    if (request.method === 'GET' && request.url === '/api/session') return json(response, 200, await sessionStore.load());
    if (request.method === 'PUT' && request.url === '/api/session') return json(response, 200, await sessionStore.save(await body(request)));
    if (request.method === 'GET' && request.url === '/api/artifacts') return json(response, 200, { artifacts: await artifactStore.list() });
    if (request.method === 'GET' && request.url === '/api/models/status') {
      return json(response, 200, { models: modelManager.status() });
    }
    if (request.method === 'GET' && request.url === '/api/providers') return json(response, 200, { providers: providerManager.list() });
    if (request.method === 'POST' && request.url === '/api/providers/chat') { const input = await body(request); return json(response, 200, await providerManager.chat(input.providerId, input.messages || [], input)); }
    if (request.method === 'POST' && request.url === '/api/chat') {
      const input = await body(request);
      void modelManager.refreshServedContext(input.modelId).catch(() => {});
      const effective = modelManager.getEffectiveContext(input.modelId);
      const wantHarness = input.harness !== false;
      const t0 = performance.now();
      if (wantHarness && effective >= 1024) {
        const scaffold = buildScaffold({ contextTokens: effective });
        let messages = injectScaffold(input.messages || [], scaffold);
        // Drift hook (collaborator input 2026-08-25): re-inject PART A when the
        // transcript passes half the served window — small models drift before
        // they run out of context.
        const approxTokens = estimateTokens(messages);
        let drift = false;
        if (approxTokens > effective * 0.5) {
          messages = [...messages.slice(0, -1), { role: 'system', content: composeDriftReminder() }, ...messages.slice(-1)];
          drift = true;
        }
        const composeMs = Math.round((performance.now() - t0) * 100) / 100;
        const result = await modelManager.chat(input.modelId, messages, input);
        return json(response, 200, { ...result, harness: { injected: true, tier: scaffold.tier, bytes: scaffold.bytes, version: HARNESS_VERSION, served_context_tokens: effective, drift_reinjected: drift, approx_prompt_tokens: approxTokens, compose_ms: composeMs } });
      }
      // Harness explicitly disabled (battery A/B) or served window too small
      // for the scaffold (tiny GGUFs clamp to train ctx): bare passthrough.
      const result = await modelManager.chat(input.modelId, input.messages || [], input);
      return json(response, 200, { ...result, harness: { injected: false, reason: wantHarness ? `served context ${effective} below 1024` : 'disabled by request', served_context_tokens: effective } });
    }
    if (request.method === 'POST' && request.url === '/api/models/profile') {
      const input = await body(request);
      return json(response, 200, await modelManager.saveProfile(String(input.id), input));
    }
    if (request.method === 'POST' && request.url === '/api/operator') {
      const input = await body(request); const result = await operator.run(input);
      const audit = await artifactStore.add({ kind: 'operator-session', status: result.approval_required ? 'awaiting-approval' : 'answered', mode: result.mode, model_id: result.modelId, proposed_tools: result.proposed_tools, tools_executed: result.tools_executed, source_exported: false });
      return json(response, 200, { ...result, audit });
    }
    if (request.method === 'POST' && request.url === '/api/workflow/plan') return json(response, 200, await workflowManager.planAndPropose(await body(request)));
    if (request.method === 'POST' && request.url === '/api/workflow/apply') return json(response, 200, await workflowManager.apply(await body(request)));
    if (request.method === 'POST' && request.url === '/api/handoff/propose') return json(response, 200, await handoffManager.propose(await body(request)));
    if (request.method === 'POST' && request.url === '/api/handoff/continue') return json(response, 200, await handoffManager.continue(await body(request)));
    if (request.method === 'GET' && request.url === '/api/community') {
      return json(response, 200, communityStore.list());
    }
    if (request.method === 'GET' && request.url === '/api/lsp/status') {
      return json(response, 200, { servers: lspManager.status() });
    }
    if (request.method === 'GET' && request.url === '/api/diagnostics') return json(response, 200, { diagnostics: [...taskManager.problemsList(), ...lspManager.diagnosticsList().map(item => ({ ...item, uri: toPlaceholderUri(item.uri) }))] });
    if (request.method === 'GET' && request.url.startsWith('/api/diagnostics?clear=')) {
      const uri = new URL(request.url, 'http://127.0.0.1').searchParams.get('clear');
      lspManager.clearDiagnostics(uri);
      taskManager.clearProblemUri(uri);
      return json(response, 200, { cleared: uri });
    }
    if (request.method === 'GET' && request.url === '/api/dap/status') {
      return json(response, 200, { adapters: dapManager.status() });
    }
    if (request.method === 'GET' && request.url.startsWith('/api/dap/state?')) {
      const id = new URL(request.url, 'http://127.0.0.1').searchParams.get('id');
      return json(response, 200, dapManager.state(id));
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
      return json(response, 200, await lspManager.request(input.id, rewriteIncoming(input.message)));
    }
    if (request.method === 'POST' && request.url === '/api/lsp/notify') {
      const input = await body(request);
      return json(response, 200, lspManager.notify(input.id, rewriteIncoming(input.message)));
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
    if (request.method === 'POST' && request.url === '/api/models/register') {
      const input = await body(request);
      return json(response, 200, await modelManager.register(input));
    }
    if (request.method === 'POST' && request.url === '/api/models/import') {
      const input = await body(request);
      const sourcePath = String(input.source_path || '');
      if (!sourcePath) throw new Error('source_path is required');
      const filename = path.basename(sourcePath);
      const dest = path.join(MODEL_DIR, filename);
      if (!dest.startsWith(`${MODEL_DIR}${path.sep}`)) throw new Error('path escaped model directory');
      await fs.copyFile(sourcePath, dest);
      const stat = await fs.stat(dest);
      return json(response, 200, { ...(await modelManager.register({ filename, repo_id: 'manual', context_tokens: input.context_tokens })), bytes: stat.size });
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
    console.error(`[aide] ${request.method} ${request.url}: ${error.message}`);
    return json(response, errorStatus(error), { error: error.message || 'local daemon error' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`AIDE local daemon listening on http://${HOST}:${PORT}`);
  console.log(`workspace: ${WORKSPACE}`);
});

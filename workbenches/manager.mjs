// Workbench bundle manager (Stage 1). Doctrine: fail-closed composition.
// validate() resolves every plugin/skill/model reference against the real
// registries BEFORE install; unknown ids never install. install() writes
// state with every component DISABLED and every MCP server UNTRUSTED.
// Trust is a separate, explicit, per-server action. Online (offline: false)
// MCP servers additionally require egress consent before they can be
// trusted (opt-in online doctrine).

import path from 'node:path';
import { promises as fs } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const BUNDLES_DIR = here;
const SKILLS_REGISTRY = path.resolve(here, '..', 'skills', 'registry.json');
const MODEL_MANIFEST = path.resolve(here, '..', 'models', 'manifest.json');
const PLUGIN_PRESETS = path.resolve(here, '..', 'plugins', 'presets.json');

export class WorkbenchValidationError extends Error {
  constructor(message, issues) {
    super(message);
    this.name = 'WorkbenchValidationError';
    this.issues = issues;
  }
}

export class WorkbenchTrustError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'WorkbenchTrustError';
    this.detail = detail;
  }
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    if (fallback !== undefined) return fallback;
    return null;
  }
}

// ---- Effective-filesystem containment (mirrors the accepted eval-export /
// modelhub / experts doctrine). Lexical joins are not sufficient: every read,
// write, and remove must prove the effective target stays inside the canonical
// workbench state root, and link-like or hard-linked state objects fail closed.

function isContained(candidateReal, rootReal) {
  return candidateReal === rootReal || candidateReal.startsWith(`${rootReal}${path.sep}`);
}

// Deepest-existing-ancestor real resolution: non-existent leaf segments cannot
// contain a reparse object and are appended lexically after resolving.
async function realResolve(target) {
  const absolute = path.resolve(target);
  const missing = [];
  let current = absolute;
  for (;;) {
    try {
      const real = await fs.realpath(current);
      return path.join(real, ...missing.reverse());
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

// Catalog bundle identity is trusted, but it is still validated defensively
// before being used as a filename: it must be a single safe path segment.
const BUNDLE_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
function assertBundleId(id) {
  if (typeof id !== 'string' || !BUNDLE_ID_RE.test(id)) {
    throw new WorkbenchValidationError(`invalid workbench id: ${typeof id === 'string' ? JSON.stringify(id.slice(0, 64)) : typeof id}`);
  }
  return id;
}

// Canonical state root: <workspace>/.aide/workbenches must resolve inside the
// real workspace. A pre-existing root junction to an outside directory fails
// closed before any read, write, or remove.
async function canonicalStateRoot(workspace) {
  const workspaceReal = await realResolve(workspace);
  const root = path.join(workspace, '.aide', 'workbenches');
  const rootReal = await realResolve(root);
  if (!isContained(rootReal, workspaceReal)) {
    throw new WorkbenchValidationError('workbench state root resolves outside the canonical workspace');
  }
  return { root, rootReal };
}

// Single state-file resolver. Consumers receive a path only after lexical
// containment under the canonical root has been proven; the filename suffix is
// always server-derived from the validated catalog identity.
async function resolveStateFile(workspace, bundleId) {
  const id = assertBundleId(bundleId);
  const { root } = await canonicalStateRoot(workspace);
  const file = path.join(root, `${id}.json`);
  const rel = path.relative(root, file);
  if (rel === '' || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new WorkbenchValidationError('workbench state path escapes the state root');
  }
  return file;
}

// Existing state objects must be plain single-link regular files. Symlinks,
// junctions/reparse redirects, directories, special objects, and hard-linked
// aliases fail closed (uniform policy for read, write destination, and
// remove target). Missing leaves are proven via their deepest existing
// ancestor so a junctioned parent cannot redirect any operation.
async function assertSafeStateObject(workspace, file, what) {
  const { rootReal } = await canonicalStateRoot(workspace);
  const info = await fs.lstat(file).catch(() => null);
  if (info === null) {
    const pendingReal = await realResolve(file);
    if (!isContained(pendingReal, rootReal)) {
      throw new WorkbenchValidationError(`workbench state target resolves outside the state root (${what})`);
    }
    return false;
  }
  if (info.isSymbolicLink()) throw new WorkbenchValidationError(`refusing link-like workbench state object (${what})`);
  if (!info.isFile()) throw new WorkbenchValidationError(`refusing non-file workbench state object (${what})`);
  if (typeof info.nlink === 'number' && info.nlink > 1) {
    throw new WorkbenchValidationError(`refusing hard-linked workbench state object (${what})`);
  }
  const real = await fs.realpath(file);
  if (!isContained(real, rootReal)) {
    throw new WorkbenchValidationError(`workbench state object resolves outside the state root (${what})`);
  }
  return true;
}

async function assertContainedReal(workspace, target, what) {
  const { rootReal } = await canonicalStateRoot(workspace);
  const targetReal = await realResolve(target);
  if (!isContained(targetReal, rootReal)) {
    throw new WorkbenchValidationError(`${what} resolves outside the workbench state root`);
  }
  return targetReal;
}

async function loadState(workspace, id) {
  const file = await resolveStateFile(workspace, id);
  await assertSafeStateObject(workspace, file, 'load');
  return readJson(file, null);
}

// Publication doctrine: fresh exclusive temp file in the verified parent, full
// content, parent recheck, destination-object check, atomic rename. A
// pre-existing hardlink or symlink destination is never written through.
async function saveState(workspace, id, state) {
  const file = await resolveStateFile(workspace, id);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await assertSafeStateObject(workspace, file, 'save destination');
  const tempPath = path.join(path.dirname(file), `.wb-state-${process.pid}-${randomBytes(8).toString('hex')}.tmp`);
  await assertSafeStateObject(workspace, tempPath, 'state temp file');
  let handle = null;
  try {
    handle = await fs.open(tempPath, 'wx');
    await handle.writeFile(JSON.stringify(state, null, 2), 'utf8');
    await handle.close();
    handle = null;
    await assertContainedReal(workspace, path.dirname(file), 'state parent');
    await assertSafeStateObject(workspace, file, 'save destination');
    await fs.rename(tempPath, file);
  } catch (error) {
    if (handle !== null) await handle.close().catch(() => {});
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function removeState(workspace, id) {
  const file = await resolveStateFile(workspace, id);
  const existed = await assertSafeStateObject(workspace, file, 'remove target');
  if (existed) await fs.rm(file, { force: true });
}

// Locate a bundle by its declared id (files are named after the id, but the
// id inside the JSON is authoritative).
async function findBundle(id) {
  const names = await fs.readdir(BUNDLES_DIR).catch(() => []);
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const candidate = await readJson(path.join(BUNDLES_DIR, name));
    if (candidate && candidate.id === id) return candidate;
  }
  return null;
}

function recommendedPairs(bundle) {
  if (!bundle.recommended_models || typeof bundle.recommended_models !== 'object') return [];
  return Object.entries(bundle.recommended_models).map(([role, model]) => ({ role: String(role), model: String(model) }));
}

export class WorkbenchManager {
  constructor(options = {}) {
    this.workspace = options.workspace;
    this.logger = options.logger ?? null;
    // Opt-in online doctrine: trusting an offline:false MCP server requires an
    // explicit consent signal from the host (wired to the egress consent gate
    // in buildRoutes). No function or non-true return => no consent (fail closed).
    this.egressConsent = typeof options.egressConsent === 'function' ? options.egressConsent : null;
    this.#cache = {};
  }

  #cache;

  async #bundles() {
    const names = await fs.readdir(BUNDLES_DIR).catch(() => []);
    const bundles = [];
    for (const name of names.sort()) {
      if (!name.endsWith('.json')) continue;
      const bundle = await readJson(path.join(BUNDLES_DIR, name));
      if (bundle && typeof bundle.id === 'string' && typeof bundle.name === 'string') bundles.push(bundle);
    }
    return bundles;
  }

  // Registry ids are read once per manager instance. Skills resolve against
  // skills/registry.json (skills[].name), plugins against plugins/presets.json
  // ([].id), models against BOTH manifest packs and runtime model ids.
  async #registryIds() {
    if (this.#cache.ids === undefined) {
      const skills = await readJson(SKILLS_REGISTRY, { skills: [] });
      const presets = await readJson(PLUGIN_PRESETS, []);
      const manifest = await readJson(MODEL_MANIFEST, {});
      this.#cache.ids = {
        skills: new Set((Array.isArray(skills.skills) ? skills.skills : []).map(s => String(s.name ?? '')).filter(Boolean)),
        plugins: new Set((Array.isArray(presets) ? presets : []).map(p => String(p.id ?? '')).filter(Boolean)),
        models: new Set([
          ...((Array.isArray(manifest.packs) ? manifest.packs : []).map(m => String(m.id ?? '')).filter(Boolean)),
          ...((Array.isArray(manifest.models) ? manifest.models : []).map(m => String(m.id ?? '')).filter(Boolean))
        ])
      };
    }
    return this.#cache.ids;
  }

  // validate() NEVER mutates anything: it only reports unresolved references.
  // An empty issues array is the only license to install.
  async #validate(bundle) {
    const issues = [];
    const ids = await this.#registryIds();
    for (const id of bundle.plugins ?? []) {
      if (!ids.plugins.has(String(id))) issues.push(`plugin not found in presets: ${id}`);
    }
    for (const id of bundle.skills ?? []) {
      if (!ids.skills.has(String(id))) issues.push(`skill not found in registry: ${id}`);
    }
    for (const pair of recommendedPairs(bundle)) {
      if (!ids.models.has(pair.model)) issues.push(`recommended model not found in manifest: ${pair.role}=${pair.model}`);
    }
    const seen = new Set();
    for (const server of bundle.mcp_servers ?? []) {
      const name = String(server.name ?? '');
      if (name.length === 0) { issues.push('mcp server missing name'); continue; }
      if (seen.has(name)) issues.push(`duplicate mcp server name: ${name}`);
      seen.add(name);
      if (server.transport === 'stdio' && !server.command) issues.push(`stdio mcp server missing command: ${name}`);
      if (server.transport === 'http' && !server.url) issues.push(`http mcp server missing url: ${name}`);
      if (typeof server.offline !== 'boolean') issues.push(`mcp server missing offline flag: ${name}`);
    }
    return issues;
  }

  // __APPEND__

  async list() {
    const ids = await this.#registryIds();
    const out = [];
    for (const bundle of await this.#bundles()) {
      const issues = await this.#validate(bundle);
      const state = await loadState(this.workspace, bundle.id);
      out.push({
        id: bundle.id,
        name: bundle.name,
        version: String(bundle.version ?? '0.0.0'),
        description: String(bundle.description ?? '').slice(0, 500),
        installed: state !== null,
        enabled: state?.enabled === true,
        plugins_count: Array.isArray(bundle.plugins) ? bundle.plugins.length : 0,
        skills_count: Array.isArray(bundle.skills) ? bundle.skills.length : 0,
        mcp_count: Array.isArray(bundle.mcp_servers) ? bundle.mcp_servers.length : 0,
        online_mcp_count: (bundle.mcp_servers ?? []).filter(s => s.offline === false).length,
        validated: issues.length === 0,
        issues: issues.map(i => String(i).slice(0, 300))
      });
    }
    return { workbenches: out };
  }

  async get(id) {
    const bundle = await findBundle(String(id));
    if (!bundle) return null;
    const issues = await this.#validate(bundle);
    const state = await loadState(this.workspace, bundle.id);
    const servers = (bundle.mcp_servers ?? []).map(s => ({
      name: String(s.name),
      transport: s.transport === 'http' ? 'http' : 'stdio',
      ...(s.command ? { command: String(s.command) } : {}),
      ...(Array.isArray(s.args) ? { args: s.args.map(a => String(a)) } : {}),
      ...(s.url ? { url: String(s.url) } : {}),
      offline: s.offline === false ? false : true,
      trusted: state?.mcp_trusted?.[String(s.name)] === true
    }));
    return {
      workbench: {
        id: bundle.id,
        name: bundle.name,
        version: String(bundle.version ?? '0.0.0'),
        description: String(bundle.description ?? '').slice(0, 500),
        offline_by_default: bundle.defaults?.offline !== false,
        installed: state !== null,
        enabled: state?.enabled === true,
        plugins: (bundle.plugins ?? []).map(p => ({ id: String(p), enabled: state?.plugins_enabled?.[String(p)] === true })),
        skills: (bundle.skills ?? []).map(s => ({ id: String(s), enabled: state?.skills_enabled?.[String(s)] === true })),
        mcp_servers: servers,
        recommended_models: recommendedPairs(bundle),
        setup: (Array.isArray(bundle.setup) ? bundle.setup : []).map(s => String(s).slice(0, 400)),
        validated: issues.length === 0,
        issues: issues.map(i => String(i).slice(0, 300))
      }
    };
  }

  async install(id) {
    const bundle = await findBundle(String(id));
    if (!bundle) throw new WorkbenchValidationError(`workbench not found: ${id}`, [`workbench not found: ${id}`]);
    const issues = await this.#validate(bundle);
    if (issues.length > 0) {
      throw new WorkbenchValidationError(`workbench ${id} failed validation`, issues.map(i => String(i).slice(0, 300)));
    }
    const state = {
      id: bundle.id,
      version: String(bundle.version ?? '0.0.0'),
      installed_at: new Date().toISOString(),
      enabled: false,
      plugins_enabled: {},
      skills_enabled: {},
      mcp_trusted: {}
    };
    await saveState(this.workspace, bundle.id, state);
    return this.get(bundle.id);
  }

  // Trust is per-server, explicit, and never granted implicitly by install.
  // Enabling trust also enables the bundle (a trusted server is useless in a
  // disabled bundle). Online servers additionally require egress consent.
  async setTrust(id, serverName, trusted) {
    const bundle = await findBundle(String(id));
    if (!bundle) throw new WorkbenchValidationError(`workbench not found: ${id}`, [`workbench not found: ${id}`]);
    const state = await loadState(this.workspace, bundle.id);
    if (state === null) throw new WorkbenchValidationError(`workbench ${id} is not installed`, [`workbench ${id} is not installed`]);
    const server = (bundle.mcp_servers ?? []).find(s => String(s.name) === String(serverName));
    if (!server) throw new WorkbenchValidationError(`mcp server ${serverName} not in workbench ${id}`, [`mcp server ${serverName} not in workbench ${id}`]);
    if (trusted === true && server.offline === false) {
      if (!this.egressConsent || this.egressConsent(serverName) !== true) {
        throw new WorkbenchTrustError(`egress consent required to trust online server ${serverName}`, {
          code: 'CONSENT_REQUIRED',
          server: String(serverName)
        });
      }
    }
    state.mcp_trusted = state.mcp_trusted ?? {};
    if (trusted === true) {
      state.mcp_trusted[String(serverName)] = true;
      state.enabled = true;
    } else {
      delete state.mcp_trusted[String(serverName)];
    }
    await saveState(this.workspace, bundle.id, state);
    return this.get(bundle.id);
  }

  async uninstall(id) {
    const bundle = await findBundle(String(id));
    if (!bundle) throw new WorkbenchValidationError(`workbench not found: ${id}`, [`workbench not found: ${id}`]);
    await removeState(this.workspace, bundle.id);
    return { removed: bundle.id };
  }
}


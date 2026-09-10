import { type Route } from '../server.ts';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { GitService } from '../../../node/src/services/git-service.mjs';
import {
  ResidentSummaryResponse,
  ResidentContextResponse,
  ResidentPushSummaryResponse,
  ResidentDecisionsResponse,
  type ResidentSummaryT,
  type ResidentConditionT,
  type ResidentContextT,
  type ResidentPushSummaryT,
  type ResidentDecisionT,
  type ResidentProjectTypeT
} from '../../../common/contracts/resident.ts';

// Resident Assistant v0 — the quiet, dependable in-workspace layer.
// Observe -> classify -> prepare -> recommend. NEVER acts: this service has
// zero mutating routes (no write/push/install/run). Action authority stays
// with the existing capability routes and the approval hierarchy unchanged.
//
// Reuse map (per the collaborator directive §2): GitService (git.ts uses the
// same class this file does), LspManager.status (existing LSP infra), and
// ModelRuntime.status are all passed in as optional probes so tests can run
// this service on pure stubs. Deterministic rules first; no model dependency.
//
// §4 pre-push: ADVISORY ONLY. Verdicts here never block a push.

export type ResidentProbes = {
  modelStatus?: () => Promise<{ runtime: boolean; models: Array<Record<string, unknown>> }>;
  lspStatus?: () => Promise<Array<{ languageId: string; status: string }>>;
};

export type ResidentService = {
  summary(): Promise<ResidentSummaryT>;
  context(): Promise<ResidentContextT>;
  pushSummary(): Promise<ResidentPushSummaryT>;
  decisions(): ResidentDecisionT[];
};

export type ResidentOptions = {
  onSummary?: (summary: ResidentSummaryT) => void | Promise<void>;
};

const LSP_OK = new Set(['available', 'running', 'starting']);

function fileExists(root: string, name: string): Promise<boolean> {
  return fs
    .access(path.join(root, name))
    .then(() => true)
    .catch(() => false);
}

export function renderResidentContext(context: ResidentContextT): string {
  const lines = [
    `project: ${context.projectType}`,
    `workspace: ${context.workspace}`,
    `git: ${context.git_status}`,
    `model: ${context.model_status}`,
    ''
  ];
  if (context.changed_files.length) {
    lines.push('changed files:', ...context.changed_files.slice(0, 25).map(f => `  - ${f}`), '');
  }
  if (context.diagnostics.length) {
    lines.push('diagnostics:', ...context.diagnostics.map(d => `  - ${d}`), '');
  }
  if (context.conditions.length) {
    lines.push('conditions:', ...context.conditions.map(c => `  - ${c}`), '');
  }
  return lines.join('\n');
}

async function detectProject(workspace: string): Promise<{ projectType: ResidentProjectTypeT; hasTestScript: boolean; deps: ResidentSummaryT['deps'] }> {
  const has = (name: string) => fileExists(workspace, name);

  // package.json drives the default project-type verdict (JS/TS).
  let projectType: ResidentProjectTypeT = 'unknown';
  let hasTestScript = false;
  let dependencies = 0;
  let devDependencies = 0;

  if (await has('package.json')) {
    let pkg: { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {};
    try {
      pkg = JSON.parse(await fs.readFile(path.join(workspace, 'package.json'), 'utf8'));
    } catch {
      pkg = {};
    }
    const scripts = pkg.scripts ?? {};
    hasTestScript = Object.keys(scripts).some(name => /^(test|check|verify)(:|\b)/.test(name));
    dependencies = pkg.dependencies ? Object.keys(pkg.dependencies).length : 0;
    devDependencies = pkg.devDependencies ? Object.keys(pkg.devDependencies).length : 0;
    if (await has('tsconfig.json')) projectType = 'typescript';
    else if (projectType === 'unknown') projectType = 'javascript';
  }

  // Stronger signals override the JS default (rare, deterministic, cheap).
  if (projectType === 'unknown' && (await has('Cargo.toml'))) projectType = 'rust';
  if (projectType === 'unknown' && (await has('pyproject.toml'))) projectType = 'python';
  if (projectType === 'unknown' && (await has('go.mod'))) projectType = 'go';
  if (projectType === 'unknown') {
    try {
      const names = await fs.readdir(workspace);
      if (names.some(n => n.endsWith('.sln') || n.endsWith('.csproj'))) projectType = 'csharp';
      else if (names.some(n => n.endsWith('.java'))) projectType = 'java';
    } catch { /* unreadable workspace: stay unknown */ }
  }

  const lockfiles = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb'];
  const hasLockfile = await Promise.all(lockfiles.map(has)).then(found => found.some(Boolean));

  return {
    projectType,
    hasTestScript,
    deps: { has_manifest: projectType === 'typescript' || projectType === 'javascript', dependencies, dev_dependencies: devDependencies, has_lockfile: hasLockfile, action: dependencies + devDependencies > 0 && !hasLockfile ? 'npm install' : null }
  };
}

export function createResidentService(workspace: string, probes: ResidentProbes = {}, options: ResidentOptions = {}): ResidentService {
  const git = new GitService({ workspace });
  const decisions: ResidentDecisionT[] = [];
  let lastSummary: ResidentSummaryT | null = null;

  async function gitState(): Promise<ResidentSummaryT['git']> {
    const empty: ResidentSummaryT['git'] = { git_repo: false, branch: null, upstream: null, ahead: 0, behind: 0, changes: 0, conflicts: 0, clean: true };
    try {
      const status = await git.status();
      const changes = Array.isArray(status.changes) ? status.changes : [];
      const conflicts = changes.filter(c => (c as { conflict?: boolean }).conflict === true).length;
      return {
        git_repo: true,
        branch: typeof status.branch === 'string' ? status.branch : null,
        upstream: typeof status.upstream === 'string' ? status.upstream : null,
        ahead: Number(status.ahead ?? 0),
        behind: Number(status.behind ?? 0),
        changes: changes.length,
        conflicts,
        clean: changes.length === 0
      };
    } catch {
      return empty;
    }
  }

  async function modelState(): Promise<ResidentSummaryT['model']> {
    try {
      const status = probes.modelStatus ? await probes.modelStatus() : { runtime: false, models: [] as Array<Record<string, unknown>> };
      const models = Array.isArray(status.models) ? status.models : [];
      const readyCount = models.filter(m => m.status === 'ready' || m.status === 'running').length;
      const running = models.some(m => m.status === 'running');
      const artifactAvailable = models.some(m => m.artifact_available === true);
      return { runtime_available: status.runtime === true, running, ready_count: readyCount, artifact_available: artifactAvailable };
    } catch {
      return { runtime_available: false, running: false, ready_count: 0, artifact_available: false };
    }
  }

  async function lspState(): Promise<ResidentSummaryT['lsp']> {
    try {
      const servers = probes.lspStatus ? await probes.lspStatus() : [];
      return { available: servers.length > 0 && servers.every(s => LSP_OK.has(s.status)), servers };
    } catch {
      return { available: false, servers: [] };
    }
  }

  function conditions(ctx: { project: Awaited<ReturnType<typeof detectProject>>; git: ResidentSummaryT['git']; model: ResidentSummaryT['model']; lsp: ResidentSummaryT['lsp'] }): ResidentConditionT[] {
    const out: ResidentConditionT[] = [];
    const { project, git: g, model, lsp } = ctx;

    if (project.projectType === 'unknown') {
      out.push({
        id: 'project.not_detected',
        severity: 'info',
        message: 'No recognized project manifest was found in the workspace.',
        recommendation: 'Open a folder that contains a package.json, Cargo.toml, pyproject.toml, or go.mod.',
        workflow: 'setup',
        evidence: workspace
      });
    }

    // §3 dependency observer (AIDE-native Dependabot framework, first pass):
    // manifest-vs-lockfile drift and dependency-load signal. Observation only.
    if (project.deps.has_manifest) {
      const total = project.deps.dependencies + project.deps.dev_dependencies;
      if (total === 0) {
        out.push({
          id: 'deps.empty',
          severity: 'info',
          message: 'package.json declares no dependencies yet.',
          recommendation: 'Install at least the runtime deps before building.',
          workflow: 'setup'
        });
      }
      if (total > 0 && !project.deps.has_lockfile) {
        out.push({
          id: 'deps.lockfile_missing',
          severity: 'warn',
          message: `${total} dependencies declared but no lockfile is committed (package-lock.json, yarn.lock, …).`,
          recommendation: project.deps.action ?? 'Commit a lockfile so builds are reproducible.',
          workflow: 'dependency'
        });
      }
      if (total >= 30) {
        out.push({
          id: 'deps.many',
          severity: 'info',
          message: `${total} direct dependencies observed — ready for dependency health tracking.`,
          recommendation: 'The Resident Assistant tracks dependency health as an observation layer.',
          workflow: 'dependency',
          evidence: `${total} direct deps`
        });
      }
    }

    if (!model.runtime_available) {
      out.push({
        id: 'model.runtime_missing',
        severity: 'warn',
        message: 'No local model engine was detected (llama-server or llama-cpp-python).',
        recommendation: 'Run the AIDE doctor, then install a llama-server binary or the Python fallback.',
        workflow: 'setup'
      });
    } else if (model.ready_count === 0) {
      out.push({
        id: 'model.artifact_missing',
        severity: 'warn',
        message: 'Model engine available but no model artifact is loaded.',
        recommendation: 'Add a GGUF model in the Model Hub or start one from the model status view.',
        workflow: 'setup'
      });
    }

    if (!lsp.available && project.projectType !== 'unknown') {
      out.push({
        id: 'lsp.unavailable',
        severity: 'warn',
        message: 'Language servers are not available for this project.',
        recommendation: 'Check the LSP status; a language server may need an explicit start.',
        workflow: 'setup'
      });
    }

    if (!g.git_repo) {
      out.push({
        id: 'git.not_a_repo',
        severity: 'info',
        message: 'This workspace is not a git repository.',
        recommendation: 'Run git init to track the project, or open a git-backed folder.',
        workflow: 'git'
      });
    } else {
      if (g.conflicts > 0) {
        out.push({
          id: 'git.conflicts',
          severity: 'error',
          message: `${g.conflicts} merge conflict${g.conflicts === 1 ? '' : 's'} are blocking a forward commit.`,
          recommendation: 'Resolve the conflicted files before continuing.',
          workflow: 'git'
        });
      }
      if (g.changes > 0) {
        out.push({
          id: 'git.changes',
          severity: 'warn',
          message: `${g.changes} uncommitted change${g.changes === 1 ? '' : 's'} in the working tree.`,
          recommendation: 'Review the diff, then stage and commit when ready.',
          workflow: 'git'
        });
      }
    }

    if (!project.hasTestScript) {
      out.push({
        id: 'tests.no_script',
        severity: 'info',
        message: 'No test/check script is declared in package.json.',
        recommendation: 'Add a "test" script so the assistant can report test health.',
        workflow: 'plan'
      });
    }

    return out.slice(0, 40);
  }

  function verdict(conditionsList: ResidentConditionT[]): 'ready' | 'attention' {
    return conditionsList.some(c => c.severity === 'error' || c.severity === 'warn') ? 'attention' : 'ready';
  }

  function recommendation(ctx: { project: Awaited<ReturnType<typeof detectProject>>; git: ResidentSummaryT['git']; model: ResidentSummaryT['model']; lsp: ResidentSummaryT['lsp'] }, conditionsList: ResidentConditionT[], status: 'ready' | 'attention'): { text: string; workflow: string | null } {
    if (status === 'ready') {
      const project = ctx.project.projectType === 'unknown' ? 'Unknown' : ctx.project.projectType;
      const line =
        `AIDE is ready. Project: ${project}. ` +
        `Git: ${ctx.git.git_repo ? (ctx.git.clean ? 'clean' : `${ctx.git.changes} changes`) : 'not a repo'}. ` +
        `LSP: ${ctx.lsp.available ? 'available' : 'unavailable'}. ` +
        `Tests: ${ctx.project.hasTestScript ? 'script present' : 'no script'}. ` +
        `Local model: ${ctx.model.runtime_available ? (ctx.model.ready_count > 0 ? 'available' : 'engine ready, no artifact') : 'unavailable'}. ` +
        `Workspace health: good. What would you like to build?`;
      return { text: line, workflow: null };
    }
    const top = conditionsList.find(c => c.severity === 'error' || c.severity === 'warn');
    const count = conditionsList.filter(c => c.severity === 'error' || c.severity === 'warn').length;
    const text = top
      ? `AIDE found ${count} item${count === 1 ? '' : 's'} needing attention. ${top.message} Next: ${top.recommendation}`
      : 'AIDE needs a look before continuing.';
    return { text, workflow: top?.workflow ?? null };
  }

  async function runSummary(): Promise<ResidentSummaryT> {
    const [project, g, model, lsp] = await Promise.all([detectProject(workspace), gitState(), modelState(), lspState()]);
    const ctx = { project, git: g, model, lsp };
    const conditionsList = conditions(ctx);
    const status = verdict(conditionsList);
    const rec = recommendation(ctx, conditionsList, status);
    const summary: ResidentSummaryT = {
      generated_at: Date.now(),
      status,
      projectType: project.projectType,
      workspace,
      nodeVersion: process.version,
      git: g,
      lsp,
      model,
      deps: project.deps,
      hasTestScript: project.hasTestScript,
      conditions: conditionsList,
      recommendation: rec.text,
      workflow: rec.workflow
    };
    lastSummary = summary;
    for (const c of conditionsList.filter(x => x.severity !== 'info')) {
      const entry: ResidentDecisionT = { ts: Date.now(), id: c.id, severity: c.severity, message: c.message, recommendation: c.recommendation, workflow: c.workflow };
      const existing = decisions.findIndex(d => d.id === entry.id);
      if (existing >= 0) decisions[existing] = entry;
      else decisions.push(entry);
    }
    while (decisions.length > 100) decisions.shift();
    if (typeof options.onSummary === 'function') {
      // Fire-and-forget: advisory observations must never delay the
      // read-only surface (R2: armor/fail-closed component isolation).
      void Promise.resolve().then(() => options.onSummary!(summary)).catch(() => {});
    }
    return summary;
  }

  async function changedFiles(): Promise<string[]> {
    if (!lastSummary?.git.git_repo) return [];
    try {
      const status = await git.status();
      const changes = (Array.isArray(status.changes) ? status.changes : []) as Array<{ path: string; staged?: boolean }>;
      return changes.slice(0, 25).map(c => c.path);
    } catch {
      return [];
    }
  }

  return {
    async summary() {
      try {
        return await runSummary();
      } catch (error) {
        // Fail-closed: never throw a raw error out of the read-only surface.
        return {
          generated_at: Date.now(),
          status: 'attention',
          projectType: 'unknown',
          workspace,
          nodeVersion: process.version,
          git: { git_repo: false, branch: null, upstream: null, ahead: 0, behind: 0, changes: 0, conflicts: 0, clean: true },
          lsp: { available: false, servers: [] },
          model: { runtime_available: false, running: false, ready_count: 0, artifact_available: false },
          deps: { has_manifest: false, dependencies: 0, dev_dependencies: 0, has_lockfile: false, action: null },
          hasTestScript: false,
          conditions: [{ id: 'resident.probe_failure', severity: 'error', message: `Workspace probe failed: ${String((error as Error)?.message ?? error).slice(0, 200)}`, recommendation: 'Check daemon logs for the failing probe.', workflow: 'debug' }],
          recommendation: 'AIDE could not probe the workspace. See daemon logs.',
          workflow: 'debug'
        };
      }
    },
    async context() {
      const summary = lastSummary ?? (await runSummary());
      const files = await changedFiles();
      const conditionsText = summary.conditions.filter(c => c.severity !== 'info').map(c => `[${c.severity}] ${c.message}`).slice(0, 15);
      const context: ResidentContextT = {
        generated_at: Date.now(),
        projectType: summary.projectType,
        workspace,
        git_status: summary.git.git_repo ? `${summary.git.branch ?? 'detached'}, ${summary.git.changes} changed, ${summary.git.ahead} ahead / ${summary.git.behind} behind` : 'not a git repo',
        changed_files: files,
        diagnostics: [],
        conditions: conditionsText,
        workflows_available: ['setup', 'git', 'dependency', 'debug', 'plan', 'code', 'review'],
        model_status: summary.model.runtime_available ? `engine available (${summary.model.ready_count} ready)` : 'engine unavailable',
        approx_tokens: Math.ceil((JSON.stringify(contextPayloadForTokens(summary, files, conditionsText)).length) / 4)
      };
      return context;
    },
    async pushSummary() {
      const summary = await runSummary();
      const g = summary.git;
      const push: ResidentPushSummaryT = {
        repo: g.git_repo,
        branch: g.branch,
        ahead: g.ahead,
        behind: g.behind,
        changed_files: await changedFiles(),
        changed_count: g.changes,
        staged_count: g.git_repo ? await gitStagedCount(git) : 0,
        diagnostics_errors: 0,
        test_script_present: summary.hasTestScript,
        risky_changes: g.git_repo && g.conflicts > 0 ? ['merge conflicts unresolved'] : [],
        generated_artifacts: (await changedFiles()).filter(f => /(^|\/)(node_modules|dist|out|build|\.cache)\//.test(f) || /\.log$/.test(f)).slice(0, 25),
        verdict: 'READY',
        reasons: []
      };
      if (!g.git_repo) {
        push.verdict = 'ATTENTION_REQUIRED';
        push.reasons.push('workspace is not a git repository');
      }
      if (!push.branch) {
        push.verdict = 'ATTENTION_REQUIRED';
        push.reasons.push('no current branch (detached or unborn HEAD)');
      }
      if (g.conflicts > 0) {
        push.verdict = 'ATTENTION_REQUIRED';
        push.reasons.push(`${g.conflicts} conflict(s) unresolved`);
      }
      if (g.behind > 0) {
        push.verdict = 'ATTENTION_REQUIRED';
        push.reasons.push(`branch is ${g.behind} commit(s) behind ${g.branch ?? 'upstream'}`);
      }
      if (!push.test_script_present) {
        push.reasons.push('no test/check script declared');
      }
      if (g.git_repo && !g.upstream && g.ahead === 0 && g.changes === 0) {
        push.verdict = 'ATTENTION_REQUIRED';
        push.reasons.push('no upstream remote configured for this branch');
      }
      if (g.git_repo && g.upstream === null && g.ahead === 0 && g.changes > 0) {
        push.verdict = 'ATTENTION_REQUIRED';
        push.reasons.push('no upstream remote configured; working tree changes not committed yet');
      }
      if (g.ahead === 0 && g.changes === 0 && g.git_repo && g.upstream) {
        push.verdict = 'ATTENTION_REQUIRED';
        push.reasons.push('no unpushed commits on this branch');
      }
      if (g.ahead === 0 && g.changes > 0 && g.git_repo && g.upstream) {
        push.verdict = 'ATTENTION_REQUIRED';
        push.reasons.push('working tree changes are not committed yet');
      }
      return push;
    },
    decisions() {
      return [...decisions];
    }
  };
}

function contextPayloadForTokens(summary: ResidentSummaryT, files: string[], conditionsText: string[]): string {
  const git = summary.git.git_repo ? `${summary.git.branch ?? 'detached'}:${summary.git.changes}ch/${summary.git.ahead}a${summary.git.behind}b` : 'no-git';
  return `${summary.projectType}|${git}|${summary.deps.dependencies}deps|${files.join(',')}|${conditionsText.join('|')}|${summary.model.runtime_available}`;
}

function gitStagedCount(git: GitService): Promise<number> {
  return git
    .run(['diff', '--cached', '--name-only'])
    .then(r => (r.stdout ? r.stdout.split('\n').filter(l => l.trim().length > 0).length : 0))
    .catch(() => 0);
}

// Read-only surface. ADVISORY ONLY — nothing here mutates workspace state.
export function routesForResident(service: ResidentService): Route[] {
  return [
    {
      method: 'GET',
      path: '/api/resident/summary',
      response: ResidentSummaryResponse,
      handler: async () => ({ summary: await service.summary() })
    },
    {
      method: 'GET',
      path: '/api/resident/context',
      response: ResidentContextResponse,
      handler: async () => ({ context: await service.context() })
    },
    {
      method: 'GET',
      path: '/api/resident/push-summary',
      response: ResidentPushSummaryResponse,
      handler: async () => ({ push: await service.pushSummary() })
    },
    {
      method: 'GET',
      path: '/api/resident/decisions',
      response: ResidentDecisionsResponse,
      handler: async () => ({ decisions: service.decisions() })
    }
  ];
}
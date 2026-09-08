import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type http from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ArchServer } from '../../node/src/server.ts';
import { createResidentService } from '../../node/src/routes/resident.ts';

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-resident-'));
let server: ArchServer;
let httpServer: http.Server;
let base: string;

type Envelope<T> = { ok: boolean; data?: T; error?: { code: string; message: string } };
async function get<T>(pathName: string): Promise<{ status: number; body: Envelope<T> }> {
  const response = await fetch(`${base}${pathName}`);
  return { status: response.status, body: (await response.json()) as Envelope<T> };
}

type Summary = {
  status: 'ready' | 'attention';
  projectType: string;
  git: { git_repo: boolean; branch: string | null; changes: number; clean: boolean };
  model: { runtime_available: boolean; running: boolean; ready_count: number };
  lsp: { available: boolean; servers: Array<{ languageId: string; status: string }> };
  deps: { has_manifest: boolean; dependencies: number; dev_dependencies: number; has_lockfile: boolean; action: string | null };
  hasTestScript: boolean;
  conditions: Array<{ id: string; severity: string; message: string; recommendation: string }>;
  recommendation: string;
};

before(async () => {
  // A believable TypeScript workspace: manifest + tsconfig + lockfile + committed base.
  await fs.writeFile(
    path.join(workspace, 'package.json'),
    JSON.stringify({ name: 'resident-fixture', scripts: { test: 'node --test' }, dependencies: { zod: '^3.0.0' }, devDependencies: { typescript: '^5.0.0' } }, null, 2)
  );
  await fs.writeFile(path.join(workspace, 'tsconfig.json'), '{}');
  await fs.writeFile(path.join(workspace, 'package-lock.json'), '{}');

  server = new ArchServer(workspace, path.join(workspace, 'arch-test.log'));
  const { buildRoutes } = await import('../../node/src/openapi.ts');
  const routes = await buildRoutes(workspace, 'test', {});
  for (const route of routes) server.route(route);
  httpServer = await server.listen(0);
  const address = httpServer.address();
  assert.ok(address && typeof address === 'object');
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>(resolve => httpServer.close(() => resolve()));
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await fs.rm(workspace, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!['EBUSY', 'ENOTEMPTY', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
});

// Pure service unit tests (no HTTP, injected probes) — the §10 "dependable,
// deterministic" core of the Resident Assistant.
test('resident arch: healthy workspace yields READY with the §11 acceptance statement', async () => {
  const { createResidentService } = await import('../../node/src/routes/resident.ts');
  const service = createResidentService(workspace, {
    modelStatus: async () => ({ runtime: true, models: [{ status: 'running', artifact_available: true }] }),
    lspStatus: async () => [{ languageId: 'typescript', status: 'running' }]
  });
  const summary = await service.summary();
  assert.equal(summary.status, 'ready');
  assert.equal(summary.projectType, 'typescript');
  assert.ok(summary.deps.has_lockfile, 'lockfile must be detected');
  assert.ok(summary.hasTestScript, 'test script must be detected');
  assert.match(summary.recommendation, /^AIDE is ready/);
  assert.ok(summary.recommendation.includes('What would you like to build?'));
  assert.equal(summary.conditions.filter(c => c.severity !== 'info').length, 0);
});

test('resident arch: failing probes fail closed (never throws, honest degraded flags)', async () => {
  const { createResidentService } = await import('../../node/src/routes/resident.ts');
  const service = createResidentService(workspace, {
    modelStatus: async () => { throw new Error('no engine'); },
    lspStatus: async () => { throw new Error('no lsp'); }
  });
  const summary = await service.summary();
  assert.equal(summary.model.runtime_available, false);
  assert.equal(summary.lsp.available, false);
  assert.ok(summary.conditions.some(c => c.id === 'model.runtime_missing'));
  assert.ok(summary.conditions.some(c => c.id === 'lsp.unavailable'));
  assert.equal(summary.status, 'attention');
});

test('resident arch: §3 dependency observer flags missing lockfile as a warn, never info-noise', async () => {
  const noLock = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-resident-nolock-'));
  try {
    await fs.writeFile(
      path.join(noLock, 'package.json'),
      JSON.stringify({ name: 'nolock', dependencies: { a: '^1.0.0', b: '^2.0.0', c: '^3.0.0' } }, null, 2)
    );
    const { createResidentService } = await import('../../node/src/routes/resident.ts');
    const service = createResidentService(noLock);
    const summary = await service.summary();
    const lock = summary.conditions.find(c => c.id === 'deps.lockfile_missing');
    assert.ok(lock, 'missing-lockfile condition must exist');
    assert.equal(lock?.severity, 'warn');
    assert.ok(lock?.recommendation.includes('npm install'));
    assert.equal(summary.status, 'attention');
  } finally {
    await fs.rm(noLock, { recursive: true, force: true });
  }
});

// §4 pre-push advisory: deterministic, ADVISORY ONLY (read-only route).
test('resident arch: push-summary advisory verdict is derived, never blocks', async () => {
  const service = createResidentService(workspace, {
    modelStatus: async () => ({ runtime: true, models: [{ status: 'running', artifact_available: true }] }),
    lspStatus: async () => [{ languageId: 'typescript', status: 'running' }]
  });
  // Fixture workspace is not a git repo → advisory must say ATTENTION_REQUIRED
  // while still returning 200 (advisory only, no throw, no block).
  const push = await service.pushSummary();
  assert.equal(push.repo, false);
  assert.equal(push.verdict, 'ATTENTION_REQUIRED');
  assert.ok(push.reasons.length > 0);
});

// §4 verdict triage: ahead>0 (committed, unpushed) => READY; ahead=0+clean =>
// no unpushed commits; ahead=0+dirty => uncommitted working tree. Real git repo.
test('resident arch: push-summary verdict triage over a real git repo', async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-resident-repo-'));
  const execFile = (await import('node:child_process')).execFile;
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  const git = (args: string[]) => run('git', args, { cwd: repo });
  await git(['init', '-b', 'main']);
  await git(['config', 'user.email', 'aide@test.local']);
  await git(['config', 'user.name', 'AIDE Test']);
  await fs.writeFile(path.join(repo, 'package.json'), JSON.stringify({ name: 'repo', scripts: { test: 'node --test' } }, null, 2));
  await git(['add', '.']);
  await git(['commit', '-m', 'base']);
  const readyService = createResidentService(repo, {
    modelStatus: async () => ({ runtime: true, models: [{ status: 'running', artifact_available: true }] }),
    lspStatus: async () => []
  });
  const ready = await readyService.pushSummary();
  assert.equal(ready.verdict, 'ATTENTION_REQUIRED', 'clean repo with no upstream must say no remote');
  assert.ok(ready.reasons.some(r => r.includes('no upstream')));

  const origin = path.join(repo, '..', `aide-resident-origin-${path.basename(repo)}`);
  await fs.mkdir(origin, { recursive: true });
  try {
    await git(['init', '-b', 'main', '--bare', origin]);
    await git(['remote', 'add', 'origin', origin]);
    await git(['push', '-u', 'origin', 'main']);
  } catch (err) {
    assert.fail(`git remote setup failed: ${String(err)}`);
  }
  await fs.writeFile(path.join(repo, 'app.ts'), 'export const x = 1;\n');
  await git(['add', '.']);
  await git(['commit', '-m', 'feat: app']);
  const dirtyService = createResidentService(repo, {
    modelStatus: async () => ({ runtime: true, models: [{ status: 'running', artifact_available: true }] }),
    lspStatus: async () => []
  });
  const committed = await dirtyService.pushSummary();
  assert.equal(committed.verdict, 'READY', 'unpushed commits must be READY');

  await git(['push', 'origin', 'main']);
  await fs.writeFile(path.join(repo, 'note.txt'), 'uncommitted\n');
  const workingTree = await dirtyService.pushSummary();
  assert.equal(workingTree.verdict, 'ATTENTION_REQUIRED', 'dirty tree ahead=0 must flag uncommitted changes');
  assert.ok(workingTree.reasons.some(r => r.includes('not committed')));

  await git(['reset', '--hard', 'HEAD']);
  await git(['clean', '-fd']);
  const clean = await dirtyService.pushSummary();
  assert.equal(clean.verdict, 'ATTENTION_REQUIRED', 'clean ahead=0 pushed repo must say nothing new');
  assert.ok(clean.reasons.some(r => r.includes('no unpushed commits')));

  try {
    await fs.rm(repo, { recursive: true, force: true });
  } catch { /* ok */ }
});

test('resident HTTP: summary route returns the workspace readiness envelope', async () => {
  const res = await get<{ summary: Summary }>('/api/resident/summary');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.ok(res.body.data && res.body.data.summary.recommendation.length > 0);
  assert.ok(Array.isArray(res.body.data.summary.conditions));
});

test('resident HTTP: context route returns a compact, bounded primary-model context bundle', async () => {
  const res = await get<{ context: { projectType: string; changed_files: string[]; conditions: string[]; approx_tokens: number; workflows_available: string[] } }>('/api/resident/context');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.ok(res.body.data && res.body.data.context.approx_tokens > 0);
  assert.ok(Array.isArray(res.body.data.context.conditions));
  assert.ok(Array.isArray(res.body.data.context.changed_files));
  assert.ok(res.body.data.context.workflows_available.includes('setup'));
});

test('resident HTTP: decisions route reports the observation journal (evidence/telemetry)', async () => {
  const decisions = await get<{ decisions: Array<{ id: string; severity: string }> }>('/api/resident/decisions');
  assert.equal(decisions.status, 200);
  assert.equal(decisions.body.ok, true);
  assert.ok(Array.isArray(decisions.body.data?.decisions));
});

test('resident HTTP: push-summary is a 200 advisory (READY or ATTENTION_REQUIRED, never an error)', async () => {
  const push = await get<{ push: { verdict: 'READY' | 'ATTENTION_REQUIRED'; repo: boolean; reasons: string[] } }>('/api/resident/push-summary');
  assert.equal(push.status, 200);
  assert.equal(push.body.ok, true);
  assert.ok(['READY', 'ATTENTION_REQUIRED'].includes(push.body.data?.push.verdict ?? ''));
});

test('resident arch: facade route map routes /api/resident to the TS stack', async () => {
  const mapPath = path.resolve(import.meta.dirname, '..', '..', 'common', 'facade-route-map.json');
  const map = JSON.parse(await fs.readFile(mapPath, 'utf8'));
  assert.equal(map.prefixes['/api/resident'], 'ts');
});
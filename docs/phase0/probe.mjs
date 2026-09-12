// Audit-only reproduction. No model inference, product edits, or external network.
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSkillsLoader } from '../../node/src/services/skills-loader.mjs';
import { buildRoutes } from '../../node/src/openapi.ts';
import { ArchServer } from '../../node/src/server.ts';
import { createFacade, loadRouteMap } from '../../scripts/facade.mjs';
import { call } from '../../browser/src/services/api.ts';
import { HealthResponse } from '../../common/contracts/health.ts';
import { ModelRuntime } from '../../node/src/services/model-runtime.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const report = { date: new Date().toISOString(), node: process.version, pid: process.pid, freeMemoryBytes: os.freemem(), observations: [], cleanup: {} };
const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-phase0-audit-'));
const marker = 'PHASE0_SKILL_SENTINEL';
let server;
let facade;
const received = [];
const events = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function eventually(fn) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await pause(25);
  }
  throw new Error('audit observation deadline exceeded');
}
function pickTarget(map, pathname) {
  if (map.exact[pathname]) return map.exact[pathname];
  const found = Object.entries(map.prefixes).filter(([prefix]) => pathname === prefix || pathname.startsWith(prefix + '/')).sort((a, b) => b[0].length - a[0].length);
  return found[0]?.[1] ?? 'legacy';
}
const savedEmbeddingUrl = process.env.AIDE_EMBEDDINGS_URL;
delete process.env.AIDE_EMBEDDINGS_URL;
try {
  await fs.mkdir(path.join(workspace, 'skills/packs/audit-sentinel'), { recursive: true });
  await fs.writeFile(path.join(workspace, 'skills/packs/audit-sentinel/SKILL.md'), `# ${marker}\nAudit skill: alpha beta gamma.\n`);
  await fs.writeFile(path.join(workspace, 'skills/registry.json'), JSON.stringify({ skills: [{ name: 'audit-sentinel', title: 'alpha beta gamma', description: 'alpha beta gamma', category: 'audit', path: 'skills/packs/audit-sentinel/SKILL.md' }] }));
  const candidate = createSkillsLoader({ skillsRoot: workspace });
  const loader = await candidate;
  const direct = await loader('alpha beta gamma');
  assert.ok(candidate instanceof Promise);
  assert.ok(direct.includes(marker));
  report.observations.push({ id: 'skills-factory', factoryType: typeof candidate, isPromise: true, resolvedType: typeof loader, directLoaderIncludesSentinel: true });

  const arch = new ArchServer(workspace, path.join(workspace, 'audit.log'));
  const fixtureManifest = path.join(workspace, 'empty-models.json');
  await fs.writeFile(fixtureManifest, JSON.stringify({ models: [] }));
  const runtime = new ModelRuntime({ workspace, manifestPath: fixtureManifest, ingestedPath: path.join(workspace, 'empty-ingested.json'), modelDir: workspace });
  await runtime.load();
  const originalPublish = arch.events.publish.bind(arch.events);
  arch.events.publish = (channel, body) => { events.push({ channel, body }); return originalPublish(channel, body); };
  const routes = await buildRoutes(workspace, 'phase0-audit', {
    skillsRoot: workspace,
    modelRuntime: runtime,
    events: arch.events,
    agentChatFn: async messages => {
      received.push(structuredClone(messages));
      return '<attempt_completion>\n<result>audit observation complete</result>\n</attempt_completion>';
    }
  });
  for (const route of routes) arch.route(route);
  const map = await loadRouteMap(path.join(root, 'common/facade-route-map.json'));
  const routeInventory = routes.map(route => ({ method: route.method, path: route.path, raw: route.raw === true, target: pickTarget(map, route.path) }));
  report.routeInventory = routeInventory;
  report.routeCounts = { registered: routes.length, uniqueOperations: new Set(routes.map(r => `${r.method} ${r.path}`)).size, facadeTs: routeInventory.filter(r => r.target === 'ts').length, facadeLegacy: routeInventory.filter(r => r.target === 'legacy').length, prefixes: Object.keys(map.prefixes).length, exact: Object.keys(map.exact).length };
  report.duplicateOperations = routeInventory.filter((r, i, a) => a.findIndex(t => t.method === r.method && t.path === r.path) !== i);
  server = await arch.listen(0);
  const archPort = server.address().port;
  // Both targets refer to the isolated TS fixture. No legacy daemon is launched.
  facade = await createFacade({ routeMap: map, targets: { ts: { host: '127.0.0.1', port: archPort }, legacy: { host: '127.0.0.1', port: archPort } } });
  const facadePort = facade.server.address().port;
  report.ports = { arch: archPort, facade: facadePort, fixedProductPortsUsed: false };
  const base = `http://127.0.0.1:${facadePort}`;
  const directHealth = await call(`http://127.0.0.1:${archPort}/api/health`, { schema: HealthResponse });
  assert.equal(directHealth.version, 'phase0-audit');
  let facadeClientError;
  try { await call(`${base}/api/health`, { schema: HealthResponse }); }
  catch (error) { facadeClientError = { code: error.code, message: error.message }; }
  assert.equal(facadeClientError?.code, 'BAD_RESPONSE');
  report.observations.push({ id: 'browser-facade-envelope', directClientAccepted: true, facadeClientError });

  const response = await fetch(`${base}/api/agent/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task: 'alpha beta gamma', mode: 'plan', chat_source: 'local' }), signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 200);
  const { session_id: id } = await response.json();
  assert.ok(id);
  const status = await eventually(async () => {
    const res = await fetch(`${base}/api/agent/status?id=${id}`, { signal: AbortSignal.timeout(10000) });
    const body = await res.json();
    return ['done', 'error', 'aborted'].includes(body.state) ? body : null;
  });
  const verificationPath = path.join(workspace, '.aide/verifications', `${id}.verification.json`);
  const verification = await eventually(async () => {
    try { return JSON.parse(await fs.readFile(verificationPath, 'utf8')); } catch { return null; }
  });
  await eventually(async () => {
    try { JSON.parse(await fs.readFile(path.join(workspace, '.aide/trajectories', `${id}.traj.json`), 'utf8')); return true; } catch { return false; }
  });
  const present = received.some(messages => messages.some(m => m.content.includes(marker)));
  assert.equal(present, false);
  assert.equal(status.state, 'done');
  report.observations.push({ id: 'production-skill-injection', path: 'real buildRoutes -> ArchServer -> createFacade -> agent route -> agent-loop -> captured chatFn', injectedModel: 'scripted capture only; no model inference', state: status.state, modelCalls: received.length, sentinelInModelContext: present, emittedSkillError: events.some(e => /skill.*(error|fail)|(error|fail).*skill/i.test(JSON.stringify(e))) });
  report.observations.push({ id: 'completion-without-code-tests', mode: 'plan', verdict: verification.verdict, checks: verification.execution.checks, results: verification.execution.results, limitation: 'A completion-only plan receives a code-change verifier stamp; this is not evidence of code correctness.' });
  const actResponse = await fetch(`${base}/api/agent/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task: 'alpha beta gamma: create requested-result.js exporting add and run its tests', mode: 'act', chat_source: 'local' }), signal: AbortSignal.timeout(10000) });
  assert.equal(actResponse.status, 200);
  const act = await actResponse.json();
  const actVerification = await eventually(async () => {
    try { return JSON.parse(await fs.readFile(path.join(workspace, '.aide/verifications', `${act.session_id}.verification.json`), 'utf8')); } catch { return null; }
  });
  const requestedFileExists = await fs.access(path.join(workspace, 'requested-result.js')).then(() => true, () => false);
  assert.equal(requestedFileExists, false);
  assert.equal(actVerification.verdict.passed, true);
  report.observations.push({ id: 'act-false-verification', requestedFileExists, mode: 'act', verdict: actVerification.verdict, results: actVerification.execution.results, modelReply: 'completion only, no tools', conclusion: 'Requested code absent and no tests executed, yet verifier reports verified.' });

  // Negative approval probe writes only inside the disposable audit fixture.
  const unapproved = await fetch(`${base}/api/agent/tool`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'write_file', approved: false, arguments: { path: 'approval-probe.txt', content: 'audit-only sentinel', approved: 'false' } }), signal: AbortSignal.timeout(10000) });
  const unapprovedBody = await unapproved.json();
  const unapprovedFile = await fs.readFile(path.join(workspace, 'approval-probe.txt'), 'utf8').catch(() => null);
  report.observations.push({ id: 'direct-tool-approval', requestApproved: false, argumentApproved: 'false', status: unapproved.status, body: unapprovedBody, fileWritten: unapprovedFile === 'audit-only sentinel' });
  report.acceptance = 'Audit reproductions confirmed. Product defects remain. Not a local-model or GUI acceptance result.';
} catch (error) {
  report.unexpectedError = { name: error.name, message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  if (facade) await facade.close();
  if (server) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  if (savedEmbeddingUrl === undefined) delete process.env.AIDE_EMBEDDINGS_URL;
  else process.env.AIDE_EMBEDDINGS_URL = savedEmbeddingUrl;
  // Preserve isolated state for audit review; no recursive cleanup operation.
  report.cleanup = { facadeClosed: !facade || !facade.server.listening, archClosed: !server || !server.listening, backgroundChildrenStartedByProbe: false, serviceChildProbes: 'RgService may run synchronous rg --version; no model start or command tool requested', fixtureRetained: workspace };
  await fs.mkdir(path.join(here, 'evidence'), { recursive: true });
  await fs.writeFile(path.join(here, 'evidence/runtime-probe-extended.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...report, routeInventory: undefined }, null, 2));
}

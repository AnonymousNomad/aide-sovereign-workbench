// tests/arch/expert-serve-wirein.test.ts (cline/T4, 2026-09-01)
// Serve-side wire-in for diff-risk-gate + request-intent-classifier.
// Pattern: ONE aggregated test() (same as agent-expert-advisory.test.ts —
// the repo's runner-proven shape; per-test() files have hung under the
// concurrent T1 batch runner on this box). Verifies: allocate->featurize->
// infer shape, correct classes on probes, NOT_FOUND on uncovered domains,
// zod-strict bodies and response enums on the two new routes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { ArchServer } from '../../node/src/server.ts';
import { routesForAuthority } from '../../node/src/routes/authority.ts';
import { pairFixture } from './authority-fixture.ts';

const require = createRequire(import.meta.url);
const { createExpertRegistry } = require('../../harness/micro-experts.mjs');
const { taskRouterFeatures, diffRiskFeatures, requestIntentFeatures } = require('../../harness/expert-featurizers.mjs');

const DIFF_TEXTS: Array<[string, string]> = [
  ['+  eval(userInput);', 'block'],
  ['-  const safe = sanitize(input);\n+  fetch(userUrl + secret);', 'block'],
  ['+  const config = loadEnv();', 'review'],
  ['+  const realm = config.realm;', 'review'],
  ['+  // clarify comment\n   console.log(1);', 'low'],
  ['+  return result;', 'low']
];
const MSG_TEXTS: Array<[string, string]> = [
  ['restart the engine on port 8084', 'system'],
  ['stop the daemon', 'system'],
  ['schedule the client meeting', 'business'],
  ['update the budget roadmap', 'business'],
  ['fix the parser bug', 'code'],
  ['build the export endpoint', 'code']
];
const INTENT_TEXTS: Array<[string, string]> = [
  ['why does the parser crash on this input', 'debug'],
  ['what does this error trace mean', 'debug'],
  ['which module returns the token', 'question'],
  ['how does the facade route this request', 'question'],
  ['plan the migration steps for the new module', 'plan'],
  ['outline the rollout order for this change', 'plan'],
  ['implement the export endpoint and add tests', 'code'],
  ['build the parser fix and run the battery', 'code']
];

function makeRng(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('expert serve wire-in: diff-risk + classify-request advisory routes', async () => {
  // Lazy-load with explicit error surfacing (whole-file child crashes under
  // the batch runner are otherwise reported as bare 'test failed').
  const mod = require('../../node/src/routes/experts.ts') as Record<string, any>;
  const { createExpertsService, routesForExperts } = mod;
  assert.equal(typeof createExpertsService, 'function');
  assert.equal(typeof routesForExperts, 'function');

  // Train both experts into a temp workspace (battery-canonical shape).
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-serve-'));
  const registry = createExpertRegistry({ workspace: dir });
  for (const [name, domain, role, featurizer, corpus] of [
    ['diff-risk-gate', 'agent.proposal.diff', 'gate', diffRiskFeatures, DIFF_TEXTS],
    ['request-intent-classifier', 'telegram.message', 'classify', requestIntentFeatures, MSG_TEXTS],
    ['task-intent-router', 'orchestrator.intent', 'router', taskRouterFeatures, INTENT_TEXTS]
  ] as Array<[string, string, string, (t: string) => Record<string, number>, Array<[string, string]>]>) {
    const rows: Array<{ features: Record<string, number>; label: string; role: string; domain: string }> = [];
    for (let i = 0; i < 120; i++) {
      const [text, label] = corpus[i % corpus.length] as [string, string];
      rows.push({ features: featurizer(text), label, role, domain });
    }
    const orig = Math.random;
    Math.random = makeRng(7);
    let manifest;
    try { manifest = registry.trainFromRows(rows); }
    finally { Math.random = orig; }
    manifest.name = name; manifest.domain = domain; manifest.role = role;
    await registry.save(manifest);
  }
  const service = createExpertsService(dir);
  const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-serve-empty-'));
  const emptyService = createExpertsService(emptyDir);

  // 1. diffRisk: correct advisory class per probe
  for (const [text, expected] of DIFF_TEXTS) {
    const r = await service.diffRisk(text);
    assert.equal(r.expert, 'diff-risk-gate');
    assert.equal(r.risk, expected, `diff: ${JSON.stringify(text)}`);
    assert.ok(r.confidence >= 0 && r.confidence <= 1);
  }
  // 2. classifyRequest: correct advisory class per probe
  for (const [text, expected] of MSG_TEXTS) {
    const r = await service.classifyRequest(text);
    assert.equal(r.expert, 'request-intent-classifier');
    assert.equal(r.intent, expected, `msg: ${JSON.stringify(text)}`);
    assert.ok(r.confidence >= 0 && r.confidence <= 1);
  }
  // 2b. intent: correct advisory phase per probe (read-only advisory surface)
  for (const [text, expected] of INTENT_TEXTS) {
    const r = await service.intent(text);
    assert.equal(r.expert, 'task-intent-router');
    assert.equal(r.phase, expected, `intent: ${JSON.stringify(text)}`);
    assert.ok(r.confidence >= 0 && r.confidence <= 1);
  }
  // 3. Uncovered domain -> NOT_FOUND (upstream callers fail silent/advisory)
  await assert.rejects(() => emptyService.diffRisk('+ eval(userInput);'), /no micro-expert covers agent\.proposal\.diff/);
  await assert.rejects(() => emptyService.classifyRequest('stop the daemon'), /no micro-expert covers telegram\.message/);
  // 4. Route surface: two new zod-strict advisory routes with correct enums
  const routes = routesForExperts(service);
  const paths = routes.map((r: any) => `${r.method} ${r.path}`);
  assert.ok(paths.includes('POST /api/experts/diff-risk'), paths.join(', '));
  assert.ok(paths.includes('POST /api/experts/classify-request'), paths.join(', '));
  const diffRoute = routes.find((r: any) => r.path === '/api/experts/diff-risk');
  const clsRoute = routes.find((r: any) => r.path === '/api/experts/classify-request');
  assert.throws(() => diffRoute.body.parse({ diff: 'x', extra: 1 }));
  assert.throws(() => clsRoute.body.parse({ message: 'x', extra: 1 }));
  assert.deepEqual([...diffRoute.response.shape.risk.options].sort(), ['block', 'low', 'review']);
  assert.deepEqual([...clsRoute.response.shape.intent.options].sort(), ['business', 'code', 'system']);

  // 5. HTTP authority: micro-expert training requires an approved exact
  //    capability.execute operation bound to the full training rows.
  const server = new ArchServer(dir, path.join(dir, 'serve-wirein.log'));
  try {
    for (const route of routesForAuthority()) server.route(route);
    for (const route of routesForExperts(service)) server.route(route);
    const httpServer = await server.listen(0);
    const address = httpServer.address();
    assert.ok(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}`;
    const owner = await pairFixture(server, base);

    const rows: Array<{ features: Record<string, number>; label: string; role: string; domain: string }> = [];
    for (let i = 0; i < 24; i++) {
      const [text, label] = DIFF_TEXTS[i % DIFF_TEXTS.length] as [string, string];
      rows.push({ features: diffRiskFeatures(text), label, role: 'gate', domain: 'agent.proposal.diff' });
    }
    const trainBody = { rows };

    const anonymous = await fetch(`${base}/api/experts/train`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(trainBody)
    });
    assert.equal(anonymous.status, 403, 'anonymous actor rejected');

    const noApproval = await owner.request('/api/experts/train', { method: 'POST', body: JSON.stringify(trainBody) });
    assert.equal(noApproval.status, 409, 'paired actor without approval fails');

    const headers = await owner.approve('POST', '/api/experts/train', trainBody, 'task:expert-train');
    const changedAttempt = await owner.request('/api/experts/train', { method: 'POST', headers, body: JSON.stringify({ rows: rows.slice(0, 20) }) });
    assert.equal(changedAttempt.status, 409, 'changed training rows cannot reuse approval');

    const applied = await owner.request('/api/experts/train', { method: 'POST', headers, body: JSON.stringify(trainBody) });
    assert.equal(applied.status, 200);
    const appliedBody = (await applied.json()) as { data: { name: string; params: number } };
    assert.ok(appliedBody.data.name.length > 0);
    const manifestRaw = await fs.readFile(path.join(dir, '.aide', 'experts', `${appliedBody.data.name}.json`), 'utf8');
    const token = owner.headers.Authorization.slice(7);
    assert.ok(!manifestRaw.includes(token) && !manifestRaw.includes(owner.actorId), 'expert manifest must not serialize authority material');
    assert.ok(!manifestRaw.includes(headers['X-AIDE-Operation']), 'expert manifest must not serialize operation ids');

    const replay = await owner.request('/api/experts/train', { method: 'POST', headers, body: JSON.stringify(trainBody) });
    assert.equal(replay.status, 409, 'consumed training approval cannot replay');

    // 6. Advisory reads are enrolled authority routes: paired actors reach the
    //    exact bound operation without an approval header (capability.read),
    //    anonymous callers are rejected before any service code runs.
    const advisoryCases: Array<[string, unknown]> = [
      ['/api/experts/diff-risk', { diff: '+  eval(userInput);' }],
      ['/api/experts/classify-request', { message: 'stop the daemon' }],
      ['/api/experts/intent', { message: 'plan the migration steps for the new module' }],
      ['/api/experts/infer', { name: 'diff-risk-gate', features: diffRiskFeatures('+  eval(userInput);') }]
    ];
    for (const [pathname, payload] of advisoryCases) {
      const anon = await fetch(`${base}${pathname}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(5000)
      });
      assert.equal(anon.status, 403, `${pathname} anonymous rejected`);
      const paired = await owner.request(pathname, { method: 'POST', body: JSON.stringify(payload) });
      assert.equal(paired.status, 200, `${pathname} paired read accepted without approval`);
    }

    httpServer.closeAllConnections();
    await new Promise<void>(resolve => httpServer.close(() => resolve()));
  } finally {
    server.authority.control.close();
    server.events.close();
  }
});

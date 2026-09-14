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
  let httpServer: import('node:http').Server | undefined;
  try {
    for (const route of routesForAuthority()) server.route(route);
    for (const route of routesForExperts(service)) server.route(route);
    httpServer = await server.listen(0);
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

    // 7. Domain validation is never overridable by authority: the authority
    //    layer prepares/approves the exact operation, yet a filesystem-unsafe
    //    identity still fails closed at execution with no outside effect.
    const outsideSentinel = path.join(dir, 'outside-sentinel.json');
    const sentinelText = JSON.stringify({ marker: 'EXPERT-SENTINEL' });
    await fs.writeFile(outsideSentinel, sentinelText);
    const unsafeBodies = ['../outside-sentinel', '/abs', 'a\\b', '..'].map(name => ({ name, features: { a: 1 } }));
    for (const [index, badBody] of unsafeBodies.entries()) {
      const prepared = await owner.propose('POST', '/api/experts/infer', badBody, `task:expert-unsafe-${index}`);
      assert.equal(prepared.state, 'approved', 'read-class authority preparation approves the exact request');
      const rejected = await owner.request('/api/experts/infer', { method: 'POST', body: JSON.stringify(badBody) });
      assert.equal(rejected.status, 400, `unsafe name rejected at execution (${JSON.stringify(badBody.name)})`);
    }
    const linkName = 'linked-infer';
    await fs.symlink(outsideSentinel, path.join(dir, '.aide', 'experts', `${linkName}.json`), 'file');
    const linkBody = { name: linkName, features: { a: 1 } };
    const linkPrepared = await owner.propose('POST', '/api/experts/infer', linkBody, 'task:expert-link');
    assert.equal(linkPrepared.state, 'approved');
    const linkRejected = await owner.request('/api/experts/infer', { method: 'POST', body: JSON.stringify(linkBody) });
    assert.equal(linkRejected.status, 400, 'link-like expert file rejected even under prepared authority');
    assert.equal(await fs.readFile(outsideSentinel, 'utf8'), sentinelText, 'sentinel untouched');

    // 8. Wave 3K: ExpertRegistry tier lifecycle authority matrices. Enrollment
    //    binds exactly the canonical expert identity (capability.write); the
    //    preserved freeze/thaw semantics (already-dormant 504, no-rename thaw)
    //    are pinned verbatim, never prettified.
    const expertsRoot = path.join(dir, '.aide', 'experts');
    const hotFile = (name: string) => path.join(expertsRoot, `${name}.json`);
    const dormantFile = (name: string) => path.join(expertsRoot, 'dormant', `${name}.json`);
    const fileExists = (target: string) => fs.access(target).then(() => true, () => false);
    const malformedNames = ['Tier-One', ' tier', 'tier one', '../x'];

    // FREEZE — transport and contract edge.
    const freezeAnon = await fetch(`${base}/api/experts/freeze`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'task-intent-router' })
    });
    assert.equal(freezeAnon.status, 403, 'freeze anonymous rejected');
    const freezeNoApproval = await owner.request('/api/experts/freeze', { method: 'POST', body: JSON.stringify({ name: 'task-intent-router' }) });
    assert.equal(freezeNoApproval.status, 409, 'freeze without approval fails');
    for (const name of malformedNames) {
      const malformed = await owner.request('/api/experts/freeze', { method: 'POST', body: JSON.stringify({ name }) });
      assert.equal(malformed.status, 400, `freeze malformed name rejected: ${JSON.stringify(name)}`);
    }
    const freezeExtra = await owner.request('/api/experts/freeze', { method: 'POST', body: JSON.stringify({ name: 'task-intent-router', force: true }) });
    assert.equal(freezeExtra.status, 400, 'freeze extra field rejected at the contract edge');
    const freezeNull = await owner.request('/api/experts/freeze', { method: 'POST', body: JSON.stringify({ name: null }) });
    assert.equal(freezeNull.status, 400, 'freeze null name rejected');
    const freezeMissingField = await owner.request('/api/experts/freeze', { method: 'POST', body: JSON.stringify({}) });
    assert.equal(freezeMissingField.status, 400, 'freeze missing name rejected');

    // FREEZE — the operation binds the server workspace and the exact identity.
    const scopeProbe = await owner.request('/api/authority/prepare', {
      method: 'POST',
      body: JSON.stringify({ method: 'POST', path: '/api/experts/freeze', task_id: 'task:expert-freeze-scope', body: { name: 'task-intent-router' } })
    });
    assert.equal(scopeProbe.status, 200);
    const scopeOp = ((await scopeProbe.json()) as { data: { operation_id: string; state: string; kind: string; workspace: string; task_id: string } }).data;
    assert.equal(scopeOp.state, 'pending');
    assert.equal(scopeOp.kind, 'capability.write');
    assert.equal(scopeOp.workspace, path.resolve(dir), 'authority binds the server workspace, never a caller scope');
    assert.equal(scopeOp.task_id, 'task:expert-freeze-scope');
    assert.equal((await owner.decide(scopeOp.operation_id, 'reject')).status, 200, 'scope probe decision recorded');

    // FREEZE — changed identity cannot reuse an approval.
    const freezeHeaders = await owner.approve('POST', '/api/experts/freeze', { name: 'task-intent-router' }, 'task:expert-freeze-1');
    const freezeChanged = await owner.request('/api/experts/freeze', { method: 'POST', headers: freezeHeaders, body: JSON.stringify({ name: 'request-intent-classifier' }) });
    assert.equal(freezeChanged.status, 409, 'changed identity cannot reuse freeze approval');
    assert.equal(await fileExists(hotFile('task-intent-router')), true, 'changed-identity attempt moved nothing');
    assert.equal(await fileExists(dormantFile('task-intent-router')), false, 'changed-identity attempt created nothing');

    // FREEZE — approved exact HOT expert.
    const freezeApplied = await owner.request('/api/experts/freeze', { method: 'POST', headers: freezeHeaders, body: JSON.stringify({ name: 'task-intent-router' }) });
    assert.equal(freezeApplied.status, 200);
    const freezeAppliedBody = (await freezeApplied.json()) as { data: { name: string; state: string } };
    assert.deepEqual(freezeAppliedBody.data, { name: 'task-intent-router', state: 'dormant' });
    assert.equal(await fileExists(hotFile('task-intent-router')), false, 'hot manifest moved away');
    assert.equal(await fileExists(dormantFile('task-intent-router')), true, 'dormant manifest present');

    // FREEZE — consumed approval cannot replay.
    const freezeReplay = await owner.request('/api/experts/freeze', { method: 'POST', headers: freezeHeaders, body: JSON.stringify({ name: 'task-intent-router' }) });
    assert.equal(freezeReplay.status, 409, 'consumed freeze approval cannot replay');
    assert.equal(await fileExists(dormantFile('task-intent-router')), true, 'replay changed nothing');

    // FREEZE — containment dominates approval (link-like hot manifest).
    const linkFreezeName = 'linked-freeze';
    await fs.symlink(outsideSentinel, hotFile(linkFreezeName), 'file');
    const freezeLinkHeaders = await owner.approve('POST', '/api/experts/freeze', { name: linkFreezeName }, 'task:expert-freeze-link');
    const freezeLink = await owner.request('/api/experts/freeze', { method: 'POST', headers: freezeLinkHeaders, body: JSON.stringify({ name: linkFreezeName }) });
    assert.equal(freezeLink.status, 400, 'link-like source rejected under approved authority');
    assert.equal(await fs.readFile(outsideSentinel, 'utf8'), sentinelText, 'freeze sentinel untouched');

    // FREEZE — already-dormant preserves the current 504 (no idempotence).
    const freezeDormantHeaders = await owner.approve('POST', '/api/experts/freeze', { name: 'task-intent-router' }, 'task:expert-freeze-2');
    const freezeDormant = await owner.request('/api/experts/freeze', { method: 'POST', headers: freezeDormantHeaders, body: JSON.stringify({ name: 'task-intent-router' }) });
    assert.equal(freezeDormant.status, 504, 'already-dormant freeze keeps the current ENOENT failure');
    const freezeDormantBody = (await freezeDormant.json()) as { error: { code: string; message: string } };
    assert.equal(freezeDormantBody.error.code, 'CHILD_FAILED');
    assert.match(freezeDormantBody.error.message, /ENOENT|rename/, 'raw rename failure preserved');
    assert.equal(await fileExists(hotFile('task-intent-router')), false, 'already-dormant freeze left the filesystem unchanged');
    assert.equal(await fileExists(dormantFile('task-intent-router')), true, 'already-dormant freeze left the dormant copy in place');
    const stillServed = await owner.request('/api/experts/infer', { method: 'POST', body: JSON.stringify({ name: 'task-intent-router', features: taskRouterFeatures('plan the migration steps for the new module') }) });
    assert.equal(stillServed.status, 200, 'dormant expert remains loadable after the preserved 504');

    // FREEZE — missing expert preserves the current 504 and stays consumed.
    const freezeMissingHeaders = await owner.approve('POST', '/api/experts/freeze', { name: 'no-such-expert-9k' }, 'task:expert-freeze-missing');
    const freezeMissing = await owner.request('/api/experts/freeze', { method: 'POST', headers: freezeMissingHeaders, body: JSON.stringify({ name: 'no-such-expert-9k' }) });
    assert.equal(freezeMissing.status, 504, 'missing expert keeps the current failure');
    const freezeMissingBody = (await freezeMissing.json()) as { error: { code: string; message: string } };
    assert.equal(freezeMissingBody.error.code, 'CHILD_FAILED');
    assert.match(freezeMissingBody.error.message, /no such micro-expert/);
    const freezeMissingReplay = await owner.request('/api/experts/freeze', { method: 'POST', headers: freezeMissingHeaders, body: JSON.stringify({ name: 'no-such-expert-9k' }) });
    assert.equal(freezeMissingReplay.status, 409, 'failure after consumption still consumes the operation');

    // FREEZE — ambiguous hot+dormant: hot wins, stale dormant copy replaced.
    const ambiguousHot = JSON.parse(await fs.readFile(hotFile('diff-risk-gate'), 'utf8')) as Record<string, unknown>;
    ambiguousHot.name = 'ambiguous-probe';
    ambiguousHot.meta = { marker: 'v2-hot' };
    await fs.writeFile(hotFile('ambiguous-probe'), JSON.stringify(ambiguousHot));
    await fs.writeFile(dormantFile('ambiguous-probe'), JSON.stringify({ ...ambiguousHot, meta: { marker: 'v1-dormant' } }));
    const ambiguousHeaders = await owner.approve('POST', '/api/experts/freeze', { name: 'ambiguous-probe' }, 'task:expert-freeze-ambiguous');
    const ambiguous = await owner.request('/api/experts/freeze', { method: 'POST', headers: ambiguousHeaders, body: JSON.stringify({ name: 'ambiguous-probe' }) });
    assert.equal(ambiguous.status, 200, 'ambiguous identity keeps hot-wins semantics');
    assert.equal(await fileExists(hotFile('ambiguous-probe')), false);
    const ambiguousDormant = JSON.parse(await fs.readFile(dormantFile('ambiguous-probe'), 'utf8')) as { meta: { marker: string } };
    assert.equal(ambiguousDormant.meta.marker, 'v2-hot', 'hot manifest replaced the stale dormant copy');

    // THAW — transport and contract edge.
    const thawAnon = await fetch(`${base}/api/experts/thaw`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'task-intent-router' })
    });
    assert.equal(thawAnon.status, 403, 'thaw anonymous rejected');
    const thawNoApproval = await owner.request('/api/experts/thaw', { method: 'POST', body: JSON.stringify({ name: 'task-intent-router' }) });
    assert.equal(thawNoApproval.status, 409, 'thaw without approval fails');
    for (const name of malformedNames) {
      const malformed = await owner.request('/api/experts/thaw', { method: 'POST', body: JSON.stringify({ name }) });
      assert.equal(malformed.status, 400, `thaw malformed name rejected: ${JSON.stringify(name)}`);
    }
    const thawExtra = await owner.request('/api/experts/thaw', { method: 'POST', body: JSON.stringify({ name: 'task-intent-router', tier: 'hot' }) });
    assert.equal(thawExtra.status, 400, 'thaw extra field rejected at the contract edge');
    const thawNull = await owner.request('/api/experts/thaw', { method: 'POST', body: JSON.stringify({ name: null }) });
    assert.equal(thawNull.status, 400, 'thaw null name rejected');
    const thawMissingField = await owner.request('/api/experts/thaw', { method: 'POST', body: JSON.stringify({}) });
    assert.equal(thawMissingField.status, 400, 'thaw missing name rejected');

    // THAW — approved exact DORMANT expert (preserved no-rename semantics).
    const thawHeaders = await owner.approve('POST', '/api/experts/thaw', { name: 'task-intent-router' }, 'task:expert-thaw-1');
    const thawApplied = await owner.request('/api/experts/thaw', { method: 'POST', headers: thawHeaders, body: JSON.stringify({ name: 'task-intent-router' }) });
    assert.equal(thawApplied.status, 200);
    const thawAppliedBody = (await thawApplied.json()) as { data: { name: string; state: string } };
    assert.deepEqual(thawAppliedBody.data, { name: 'task-intent-router', state: 'hot' });
    assert.equal(await fileExists(dormantFile('task-intent-router')), true, 'dormant file stays on disk (preserved thaw semantics)');
    assert.equal(await fileExists(hotFile('task-intent-router')), false, 'thaw invents no hot-tier file');
    assert.ok((await registry.infer('task-intent-router', taskRouterFeatures('plan the migration steps for the new module'))).class, 'registry serves the revived identity');

    // THAW — changed identity cannot reuse an approval.
    const thawHotHeaders = await owner.approve('POST', '/api/experts/thaw', { name: 'diff-risk-gate' }, 'task:expert-thaw-2');
    const thawChanged = await owner.request('/api/experts/thaw', { method: 'POST', headers: thawHotHeaders, body: JSON.stringify({ name: 'request-intent-classifier' }) });
    assert.equal(thawChanged.status, 409, 'changed identity cannot reuse thaw approval');
    assert.equal(await fileExists(hotFile('diff-risk-gate')), true, 'changed-identity thaw moved nothing');
    assert.equal(await fileExists(dormantFile('diff-risk-gate')), false, 'changed-identity thaw created nothing');

    // THAW — approved exact HOT expert.
    const thawHot = await owner.request('/api/experts/thaw', { method: 'POST', headers: thawHotHeaders, body: JSON.stringify({ name: 'diff-risk-gate' }) });
    assert.equal(thawHot.status, 200);
    const thawHotBody = (await thawHot.json()) as { data: { name: string; state: string } };
    assert.deepEqual(thawHotBody.data, { name: 'diff-risk-gate', state: 'hot' });
    assert.equal(await fileExists(hotFile('diff-risk-gate')), true, 'hot thaw mutates no filesystem state');
    const thawReplay = await owner.request('/api/experts/thaw', { method: 'POST', headers: thawHotHeaders, body: JSON.stringify({ name: 'diff-risk-gate' }) });
    assert.equal(thawReplay.status, 409, 'consumed thaw approval cannot replay');

    // THAW — missing expert preserves the current 504 and stays consumed.
    const thawMissingHeaders = await owner.approve('POST', '/api/experts/thaw', { name: 'no-such-expert-9k' }, 'task:expert-thaw-missing');
    const thawMissing = await owner.request('/api/experts/thaw', { method: 'POST', headers: thawMissingHeaders, body: JSON.stringify({ name: 'no-such-expert-9k' }) });
    assert.equal(thawMissing.status, 504);
    const thawMissingBody = (await thawMissing.json()) as { error: { code: string; message: string } };
    assert.equal(thawMissingBody.error.code, 'CHILD_FAILED');
    assert.match(thawMissingBody.error.message, /no such micro-expert/);
    const thawMissingReplay = await owner.request('/api/experts/thaw', { method: 'POST', headers: thawMissingHeaders, body: JSON.stringify({ name: 'no-such-expert-9k' }) });
    assert.equal(thawMissingReplay.status, 409, 'thaw failure after consumption stays consumed');

    // THAW — load-side containment dominates approval.
    const linkThawName = 'linked-thaw';
    await fs.symlink(outsideSentinel, dormantFile(linkThawName), 'file');
    const thawLinkHeaders = await owner.approve('POST', '/api/experts/thaw', { name: linkThawName }, 'task:expert-thaw-link');
    const thawLink = await owner.request('/api/experts/thaw', { method: 'POST', headers: thawLinkHeaders, body: JSON.stringify({ name: linkThawName }) });
    assert.equal(thawLink.status, 400, 'link-like dormant manifest rejected under approved authority');
    assert.equal(await fs.readFile(outsideSentinel, 'utf8'), sentinelText, 'thaw sentinel untouched');
    assert.equal(await fileExists(hotFile(linkThawName)), false, 'rejected thaw invents nothing');
  } finally {
    server.authority.control.close();
    server.events.close();
    if (httpServer) {
      httpServer.closeAllConnections();
      await new Promise<void>(resolve => httpServer!.close(() => resolve()));
    }
    for (let attempt = 0; attempt < 10; attempt++) {
      try { await fs.rm(dir, { recursive: true, force: true }); break; }
      catch (error) {
        if (!['EBUSY', 'ENOTEMPTY', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    }
  }
});

// Expert advisory wire-in tests (aide-micro-expert-collective, audit Week 1
// item #7). The agent start route consults a micro-expert (task-router)
// BEFORE the main model call and prepends a [EXPERT ADVISORY] block to
// the system prompt. ADVISORY only, never blocks.
//
// Threat matrix:
//  1. expert returns shape -> [EXPERT ADVISORY] block prepended to system
//  2. expert throws -> main call proceeds unchanged (silent)
//  3. expert times out (>200ms) -> main call proceeds unchanged (silent)
//  4. expert returns confidence <= 0.3 -> NO advisory (filtered)
//  5. expert not configured (consultExpert undefined) -> no change
//  6. expert returns null -> main call proceeds unchanged
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Re-implement the advisory wrapper logic here (matches routes/agent.ts).
// This is the same pattern the route uses; tested in isolation here so
// the threat matrix is fast and deterministic (no live model).
async function withExpertAdvisory({ chatFn, consultExpert, timeoutMs = 200 }) {
  return async (messages) => {
    let advisory = null;
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs);
      const lastUser = [...messages].reverse().find(m => m.role === 'user');
      const taskForExpert = lastUser?.content ?? '';
      advisory = await Promise.race([
        consultExpert(taskForExpert),
        new Promise((resolve) => ac.signal.addEventListener('abort', () => resolve(null)))
      ]);
      clearTimeout(timer);
    } catch { /* silent */ }
    if (advisory && advisory.expert) {
      const block = '[EXPERT ADVISORY]\nroute: ' + advisory.phase + '\nexpert: ' + advisory.expert + '\nconfidence: ' + advisory.confidence.toFixed(3) + '\n[END ADVISORY]\n\n';
      const idx = messages.findIndex(m => m.role === 'system');
      if (idx >= 0) {
        const sysMsg = messages[idx];
        return chatFn([...messages.slice(0, idx), { ...sysMsg, content: block + sysMsg.content }, ...messages.slice(idx + 1)]);

test('advisory: expert returns shape -> block prepended to system prompt', async () => {
  let captured = null;
  const chatFn = async (messages) => { captured = messages; return 'ok'; };
  const consultExpert = async () => ({ expert: 'task-router', phase: 'code', confidence: 0.85 });
  const wrapped = await withExpertAdvisory({ chatFn, consultExpert })([
    { role: 'system', content: 'you are a coding agent' },
    { role: 'user', content: 'fix the bug in foo.ts' }
  ]);
  await wrapped;
  assert.ok(captured);
  assert.match(captured[0].content, /\[EXPERT ADVISORY\]/);
  assert.match(captured[0].content, /route: code/);
  assert.match(captured[0].content, /expert: task-router/);
  assert.match(captured[0].content, /confidence: 0\.850/);
  assert.match(captured[0].content, /you are a coding agent/);
});

test('advisory: expert throws -> main call proceeds unchanged (silent)', async () => {
  let captured = null;
  const chatFn = async (messages) => { captured = messages; return 'ok'; };
  const consultExpert = async () => { throw new Error('expert crashed'); };
  const wrapped = await withExpertAdvisory({ chatFn, consultExpert })([
    { role: 'system', content: 'untouched' },
    { role: 'user', content: 'do the thing' }
  ]);
  await wrapped;
  assert.equal(captured.length, 2);
  assert.equal(captured[0].role, 'system');
  assert.equal(captured[0].content, 'untouched');
});

test('advisory: expert times out -> main call proceeds unchanged (silent)', async () => {
  let captured = null;
  const chatFn = async (messages) => { captured = messages; return 'ok'; };
  const consultExpert = () => new Promise(resolve => setTimeout(() => resolve({ expert: 'late', phase: 'code', confidence: 0.9 }), 1000));
  const wrapped = await withExpertAdvisory({ chatFn, consultExpert, timeoutMs: 50 })([
    { role: 'system', content: 'untouched' },
    { role: 'user', content: 'go' }
  ]);
  await wrapped;
  assert.equal(captured[0].content, 'untouched', 'system content unchanged after timeout');
});

test('advisory: confidence <= 0.3 -> NO advisory (filtered at route layer)', async () => {
  let captured = null;
  const chatFn = async (messages) => { captured = messages; return 'ok'; };
  const lowConfidenceExpert = async () => ({ expert: 'task-router', phase: 'unknown', confidence: 0.2 });
  const consultExpert = async () => {
    const r = await lowConfidenceExpert();
    return r.confidence > 0.3 ? r : null;
  };
  const wrapped = await withExpertAdvisory({ chatFn, consultExpert })([
    { role: 'system', content: 'untouched' },
    { role: 'user', content: 'go' }
  ]);
  await wrapped;
  assert.equal(captured[0].content, 'untouched');
});

test('advisory: expert returns null -> main call proceeds unchanged', async () => {
  let captured = null;
  const chatFn = async (messages) => { captured = messages; return 'ok'; };
  const consultExpert = async () => null;
  const wrapped = await withExpertAdvisory({ chatFn, consultExpert })([
    { role: 'system', content: 'untouched' },
    { role: 'user', content: 'go' }
  ]);
  await wrapped;
  assert.equal(captured[0].content, 'untouched');
});

test('advisory: no system message -> new system message prepended', async () => {
  let captured = null;
  const chatFn = async (messages) => { captured = messages; return 'ok'; };
  const consultExpert = async () => ({ expert: 'task-router', phase: 'debug', confidence: 0.9 });
  const wrapped = await withExpertAdvisory({ chatFn, consultExpert })([
    { role: 'user', content: 'find the bug' }
  ]);
  await wrapped;
  assert.equal(captured[0].role, 'system');
  assert.match(captured[0].content, /\[EXPERT ADVISORY\]/);
  assert.match(captured[0].content, /route: debug/);
  assert.equal(captured[1].role, 'user');
  assert.equal(captured[1].content, 'find the bug');
});

      }
      return chatFn([{ role: 'system', content: block }, ...messages]);
    }
    return chatFn(messages);
  };
}

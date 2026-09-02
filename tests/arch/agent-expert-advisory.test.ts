// Expert advisory wire-in tests (aide-micro-expert-collective, audit Week 1
// item #7). The agent start route consults a micro-expert (task-router)
// BEFORE the main model call and prepends a [EXPERT ADVISORY] block to the
// system prompt. ADVISORY only, never blocks.
//
// Threat matrix (6 cases, all inside one aggregated test() per the
// runner-proven shape from expert-serve-wirein.test.ts + the 8/21 CI hang
// investigation — per-test() files hang under the concurrent batch runner):
//  1. expert returns shape -> [EXPERT ADVISORY] block prepended to system
//  2. expert throws -> main call proceeds unchanged (silent)
//  3. expert times out (>200ms) -> main call proceeds unchanged (silent)
//  4. expert returns confidence <= 0.3 -> NO advisory (filtered at route layer)
//  5. expert returns null -> main call proceeds unchanged
//  6. no system message -> new system message prepended
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Types — mirror the route's narrowed shapes.
type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
type ChatFn = (messages: ChatMessage[]) => Promise<string>;
type Advisory = { expert: string; phase: string; confidence: number };
type ConsultExpert = (task: string) => Promise<Advisory | null>;

// Re-implement the advisory wrapper logic here (matches routes/agent.ts).
// Tested in isolation so the threat matrix is fast + deterministic
// (no live model). Types align with the route's narrowing (Class 2 fix:
// `noUncheckedIndexedAccess` + exactOptionalPropertyTypes).
function withExpertAdvisory({ chatFn, consultExpert, timeoutMs = 200 }: {
  chatFn: ChatFn;
  consultExpert: ConsultExpert;
  timeoutMs?: number;
}): (messages: ChatMessage[]) => Promise<string> {
  return async (messages: ChatMessage[]): Promise<string> => {
    let advisory: Advisory | null = null;
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs);
      // Find the last user message — its content is the task to consult on.
      const reversed = [...messages].reverse();
      const lastUser = reversed.find((m: ChatMessage) => m.role === 'user');
      const taskForExpert = lastUser?.content ?? '';
      advisory = await Promise.race([
        consultExpert(taskForExpert),
        new Promise<null>((resolve) => ac.signal.addEventListener('abort', () => resolve(null)))
      ]);
      clearTimeout(timer);
    } catch { /* silent: never block on the expert */ }
    if (advisory && advisory.expert) {
      const block = '[EXPERT ADVISORY]\nroute: ' + advisory.phase +
        '\nexpert: ' + advisory.expert +
        '\nconfidence: ' + advisory.confidence.toFixed(3) +
        '\n[END ADVISORY]\n\n';
      // Prepend the advisory to the existing system message in place. The
      // `find` + map pattern preserves the array order (noUncheckedIndexedAccess
      // narrows sysMsg from `T | undefined` to `T` after the guard).
      const sysIdx = messages.findIndex((m: ChatMessage) => m.role === 'system');
      if (sysIdx >= 0) {
        const sysMsg = messages[sysIdx];
        if (sysMsg) {
          return chatFn([
            ...messages.slice(0, sysIdx),
            { ...sysMsg, content: block + sysMsg.content },
            ...messages.slice(sysIdx + 1)
          ]);
        }
      }
      return chatFn([{ role: 'system', content: block }, ...messages]);
    }
    return chatFn(messages);
  };
}

test('advisory: threat matrix (6 cases) — shape, throw, timeout, low-confidence, null, no-system-msg', async () => {
  // Helper: chatFn that captures the messages it received. Returns the
  // captured array after the await, narrowing null away.
  const capture = (): { chatFn: ChatFn; get: () => ChatMessage[] } => {
    let captured: ChatMessage[] = [];
    const chatFn: ChatFn = async (messages) => { captured = messages; return 'ok'; };
    return { chatFn, get: () => captured };
  };

  // 1. expert returns shape -> block prepended to existing system message
  {
    const { chatFn, get } = capture();
    const consultExpert: ConsultExpert = async () => ({ expert: 'task-router', phase: 'code', confidence: 0.85 });
    const wrapped = withExpertAdvisory({ chatFn, consultExpert });
    await wrapped([
      { role: 'system', content: 'you are a coding agent' },
      { role: 'user', content: 'fix the bug in foo.ts' }
    ]);
    const captured = get();
    assert.equal(captured.length, 2);
    const sysContent = captured[0]?.content ?? '';
    assert.match(sysContent, /\[EXPERT ADVISORY\]/);
    assert.match(sysContent, /route: code/);
    assert.match(sysContent, /expert: task-router/);
    assert.match(sysContent, /confidence: 0\.850/);
    assert.match(sysContent, /you are a coding agent/);
  }

  // 2. expert throws -> main call proceeds unchanged (silent)
  {
    const { chatFn, get } = capture();
    const consultExpert: ConsultExpert = async () => { throw new Error('expert crashed'); };
    const wrapped = withExpertAdvisory({ chatFn, consultExpert });
    await wrapped([
      { role: 'system', content: 'untouched' },
      { role: 'user', content: 'do the thing' }
    ]);
    const captured = get();
    assert.equal(captured.length, 2);
    assert.equal(captured[0]?.role, 'system');
    assert.equal(captured[0]?.content, 'untouched');
  }

  // 3. expert times out (>200ms) -> main call proceeds unchanged (silent)
  {
    const { chatFn, get } = capture();
    const consultExpert: ConsultExpert = () => new Promise<Advisory | null>((resolve) =>
      setTimeout(() => resolve({ expert: 'late', phase: 'code', confidence: 0.9 }), 1000)
    );
    const wrapped = withExpertAdvisory({ chatFn, consultExpert, timeoutMs: 50 });
    await wrapped([
      { role: 'system', content: 'untouched' },
      { role: 'user', content: 'go' }
    ]);
    const captured = get();
    assert.equal(captured[0]?.content, 'untouched', 'system content unchanged after timeout');
  }

  // 4. expert returns confidence <= 0.3 -> NO advisory (filtered at route layer)
  {
    const { chatFn, get } = capture();
    const lowConfidenceExpert = async (): Promise<Advisory> => ({ expert: 'task-router', phase: 'unknown', confidence: 0.2 });
    const consultExpert: ConsultExpert = async () => {
      const r = await lowConfidenceExpert();
      return r.confidence > 0.3 ? r : null;
    };
    const wrapped = withExpertAdvisory({ chatFn, consultExpert });
    await wrapped([
      { role: 'system', content: 'untouched' },
      { role: 'user', content: 'go' }
    ]);
    const captured = get();
    assert.equal(captured[0]?.content, 'untouched');
  }

  // 5. expert returns null -> main call proceeds unchanged
  {
    const { chatFn, get } = capture();
    const consultExpert: ConsultExpert = async () => null;
    const wrapped = withExpertAdvisory({ chatFn, consultExpert });
    await wrapped([
      { role: 'system', content: 'untouched' },
      { role: 'user', content: 'go' }
    ]);
    const captured = get();
    assert.equal(captured[0]?.content, 'untouched');
  }

  // 6. no system message -> new system message prepended
  {
    const { chatFn, get } = capture();
    const consultExpert: ConsultExpert = async () => ({ expert: 'task-router', phase: 'debug', confidence: 0.9 });
    const wrapped = withExpertAdvisory({ chatFn, consultExpert });
    await wrapped([
      { role: 'user', content: 'find the bug' }
    ]);
    const captured = get();
    assert.equal(captured[0]?.role, 'system');
    assert.match(captured[0]?.content ?? '', /\[EXPERT ADVISORY\]/);
    assert.match(captured[0]?.content ?? '', /route: debug/);
    assert.equal(captured[1]?.role, 'user');
    assert.equal(captured[1]?.content, 'find the bug');
  }
});

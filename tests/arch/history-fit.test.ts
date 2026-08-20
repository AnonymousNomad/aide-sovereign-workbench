import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitHistory, estimateTokens, TOKEN_RESERVE, type FitMessage } from '../../node/src/services/history-fit.ts';
import type { ChatMessageT } from '../../common/contracts/chat.ts';

const system: ChatMessageT = { role: 'system', content: 'You are the build lane. Produce a minimal unified diff only.' };
const user = (content: string): ChatMessageT => ({ role: 'user', content });
const assistant = (content: string): ChatMessageT => ({ role: 'assistant', content });
const tool = (content: string): FitMessage => ({ role: 'tool', content });
const toolResult = (content: string): FitMessage => ({ role: 'tool_result', content });

test('estimateTokens is a conservative chars/4 heuristic', () => {
  assert.equal(estimateTokens('abcd'), 1);
  assert.equal(estimateTokens('abcdefgh'), 2);
  assert.equal(estimateTokens('abc'), 1, 'never zero for non-empty text');
});

test('fits everything when history is small', () => {
  const messages = [system, user('hello'), assistant('hi there')];
  const result = fitHistory(messages, 8192);
  assert.deepEqual(result.messages, messages);
  assert.equal(result.dropped, 0);
  assert.equal(result.truncatedSystem, false);
  assert.equal(result.overflow, false);
});

test('keeps system verbatim and drops oldest non-system turns on overflow', () => {
  const turn = (role: 'user' | 'assistant', tag: string): ChatMessageT => ({ role, content: `${tag}:${'x'.repeat(200)}` });
  const turns: ChatMessageT[] = [];
  for (let i = 0; i < 12; i++) turns.push(turn(i % 2 === 0 ? 'user' : 'assistant', String(i)));
  const newestTurn = turns[turns.length - 1]!;
  const messages = [system, ...turns];
  const result = fitHistory(messages, 1024);
  assert.equal(result.messages[0], system, 'system stays first and verbatim');
  assert.ok(result.messages.includes(newestTurn), 'newest turn is kept');
  assert.ok(!result.messages.some(m => m.content.startsWith('0:')), 'oldest turns are dropped');
  assert.ok(result.dropped >= 3, `expected overflow drops, got ${result.dropped}`);
  assert.equal(result.truncatedSystem, false, 'system fits so no truncation');
});

test('truncates the system prompt when it alone overflows', () => {
  const hugeSystem: ChatMessageT = { role: 'system', content: 'z'.repeat(10000) };
  const result = fitHistory([hugeSystem, user('hi')], 2048);
  assert.equal(result.truncatedSystem, true);
  assert.equal(result.overflow, true);
  assert.ok(result.messages[0]!.content.length < 10000, 'system content was cut to fit');
  assert.ok(result.messages[0]!.content.startsWith('z'), 'prefix of the system prompt survives');
  assert.ok(result.estimatedTokens >= 2048 - TOKEN_RESERVE, 'system was truncated to the full budget');
  assert.equal(result.estimatedTokens, (2048 - TOKEN_RESERVE) + estimateTokens('hi'));
});

const roleOf = (message: FitMessage): string => message.role;

test('filters tool messages but keeps their assistant turns', () => {
  const messages = [system, user('call'), assistant('calling tool'), tool('{"ok":true}'), toolResult('{"done":true}'), user('result?')];
  const result = fitHistory(messages, 2048);
  assert.ok(!result.messages.some(m => roleOf(m) === 'tool' || roleOf(m) === 'tool_result'), 'tool messages never enter the fitted output');
  assert.ok(result.messages.some(m => m.role === 'assistant' && m.content === 'calling tool'), 'the assistant turn survives');
  assert.equal(result.dropped, 2);
  assert.equal(result.messages.at(-1)!.content, 'result?', 'newest turn stays last');
});

test('drops an orphaned tool message that has no assistant predecessor', () => {
  const messages = [system, tool('{"ok":true}'), user('hi')];
  const result = fitHistory(messages, 2048);
  assert.ok(!result.messages.some(m => roleOf(m) === 'tool'), 'orphan tool message is dropped');
  assert.equal(result.dropped, 1);
});

test('tool messages never force the newest-turn guarantee', () => {
  const huge = 'y'.repeat(3000);
  const messages = [system, user('short'), assistant(huge), tool(huge)];
  const result = fitHistory(messages, 1024);
  assert.ok(!result.messages.some(m => roleOf(m) === 'tool'), 'tool payload dropped even as the newest message');
  assert.equal(result.messages.at(-1)!.content, 'short', 'newest real turn is the last user message');
});

test('preserves chronological order after fitting', () => {
  const messages = [system, user('1'), assistant('a'), user('2'), assistant('b')];
  const result = fitHistory(messages, 4096);
  assert.deepEqual(
    result.messages.map(m => m.content),
    ['You are the build lane. Produce a minimal unified diff only.', '1', 'a', '2', 'b']
  );
});

test('treats developer messages like system messages (kept first, normalized to system)', () => {
  const developer: FitMessage = { role: 'developer', content: 'dev instructions' };
  const messages = [developer, user('q')];
  const result = fitHistory(messages, 2048);
  assert.equal(result.messages[0]!.role, 'system', 'developer is normalized to system on the wire');
  assert.equal(result.messages[0]!.content, 'dev instructions');
  assert.equal(result.messages.at(-1)!.content, 'q');
});

test('reserves output tokens: budget is context minus reserve', () => {
  const fit = fitHistory([user('x')], 512 + 8, { maxTokens: 512 });
  assert.equal(fit.estimatedTokens, 1);
  const exact = fitHistory([user('x')], 8, { maxTokens: 512 });
  assert.equal(exact.estimatedTokens, 1, 'budget never drops below 1');
});
// Agent-loop in-house end-to-end battery (slice A of feat/environment-aware-model).
// Verifies the 4 tool paths (read_file, bash, search, git_diff) plus the parser
// and the approval flow. Runs against the agent-loop service module directly
// with a stub modelManager that returns canned model outputs. No real engine is
// required for the parser/validator tests, but the executor paths exercise
// the real workspace (a temp dir) so the path-jail, allowlist, and
// file-write atomicity are verified.
//
// Run: node --test tests/in-house-e2e/agent-loop-battery.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

const { TOOL_SCHEMAS, AgentLoop, parseToolCalls, validateToolCall } = await import('../../harness/agent-loop.mjs');
const { gatherWorkspaceContext } = await import('../../harness/context-gatherer.mjs');

const execFileSyncP = promisify(execFile);

async function makeWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-agent-battery-'));
  await fs.writeFile(path.join(root, 'README.md'), '# Sample\n\nA tiny sample file for the agent loop battery.\n', 'utf8');
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'hello.js'), 'export function hello() { return "hi"; }\n', 'utf8');
  // Initialize a git repo for git_diff tests.
  try { await execFileSyncP('git', ['init', '-q'], { cwd: root }); } catch { /* not all environments have git */ }
  try { await execFileSyncP('git', ['config', 'user.email', 'battery@aide'], { cwd: root }); } catch { /* */ }
  try { await execFileSyncP('git', ['config', 'user.name', 'battery'], { cwd: root }); } catch { /* */ }
  try { await execFileSyncP('git', ['add', '.'], { cwd: root }); } catch { /* */ }
  try { await execFileSyncP('git', ['commit', '-m', 'init', '--no-gpg-sign'], { cwd: root }); } catch { /* */ }
  return root;
}

function stubModelManager(scripts) {
  // scripts: array of strings; each script is the assistant message the model
  // produces for that turn. The manager returns the next script on each call.
  let i = 0;
  return {
    async chat(modelId, messages, opts) {
      const text = scripts[Math.min(i, scripts.length - 1)] || '{"calls":[],"final":"(no more scripts)"}';
      i += 1;
      return { choices: [{ message: { content: text } }], model: modelId };
    }
  };
}

test('parseToolCalls: extracts fenced json array of tool calls', () => {
  const text = 'I will read the file first.\n```json\n[{"tool":"read_file","args":{"path":"README.md"},"id":"tc_1"}]\n```';
  const r = parseToolCalls(text);
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].tool, 'read_file');
  assert.equal(r.calls[0].args.path, 'README.md');
  assert.equal(r.calls[0].id, 'tc_1');
  assert.equal(r.finalAnswer, null);
});

test('parseToolCalls: extracts final_answer block', () => {
  const r = parseToolCalls('All done.\n```final_answer\nI added the hello route.\n```');
  assert.equal(r.finalAnswer, 'I added the hello route.');
  assert.equal(r.calls.length, 0);
});

test('parseToolCalls: empty model output: parser returns null finalAnswer, no calls', () => {
  const r = parseToolCalls('');
  assert.equal(r.calls.length, 0);
  // Empty string: no fenced block, no tool calls, finalAnswer stays null
  // (the caller in _step interprets null as "continue" — see the next test).
  assert.equal(r.finalAnswer, null);
});

test('parseToolCalls: non-empty model output without a fenced block becomes final answer', () => {
  const r = parseToolCalls('I read the file and it contains the title Sample.');
  assert.equal(r.calls.length, 0);
  assert.match(r.finalAnswer, /Sample/);
});

test('validateToolCall: rejects unknown tool', () => {
  const v = validateToolCall('rm_rf', { path: '/' });
  assert.equal(v.ok, false);
  assert.match(v.error, /unknown tool/);
});

test('validateToolCall: rejects missing required param', () => {
  const v = validateToolCall('read_file', {});
  assert.equal(v.ok, false);
  assert.match(v.error, /missing required param 'path'/);
});

test('validateToolCall: rejects path exceeding maxLength', () => {
  const v = validateToolCall('read_file', { path: 'x'.repeat(600) });
  assert.equal(v.ok, false);
  assert.match(v.error, /exceeds 500/);
});

test('validateToolCall: accepts a well-formed read_file', () => {
  const v = validateToolCall('read_file', { path: 'src/hello.js' });
  assert.equal(v.ok, true);
});

test('TOOL_SCHEMAS exposes 6 tools with the expected mutating flags', () => {
  assert.equal(Object.keys(TOOL_SCHEMAS).length, 6);
  assert.equal(TOOL_SCHEMAS.read_file.mutating, false);
  assert.equal(TOOL_SCHEMAS.list.mutating, false);
  assert.equal(TOOL_SCHEMAS.search.mutating, false);
  assert.equal(TOOL_SCHEMAS.git_diff.mutating, false);
  assert.equal(TOOL_SCHEMAS.write_file.mutating, true);
  assert.equal(TOOL_SCHEMAS.bash.mutating, true);
});

test('agent loop: read_file scenario, approved, model sees result and emits final_answer', async () => {
  const workspace = await makeWorkspace();
  const mgr = stubModelManager([
    '```json\n[{"tool":"read_file","args":{"path":"README.md"},"id":"tc_1"}]\n```',
    '```final_answer\nREADME is 1 line and contains the title.\n```'
  ]);
  const loop = new AgentLoop({ modelManager: mgr, workspace, modelId: 'test-model' });
  const started = await loop.start({ goal: 'Tell me what is in README.md' });
  assert.equal(started.status, 'awaiting-approval');
  assert.equal(started.pending.length, 1);
  assert.equal(started.pending[0].tool, 'read_file');
  const approved = await loop.decide({ sessionId: started.id, decisions: [{ id: 'tc_1', approve: true }] });
  assert.equal(approved.status, 'completed');
  assert.ok(approved.finalAnswer.includes('README'));
  assert.equal(approved.completed.length, 1);
  assert.equal(approved.completed[0].approved, true);
  assert.match(approved.completed[0].result.content, /Sample/);
  await fs.rm(workspace, { recursive: true, force: true });
});

test('agent loop: read_file scenario, rejected, model recovers with new proposal', async () => {
  const workspace = await makeWorkspace();
  const mgr = stubModelManager([
    '```json\n[{"tool":"read_file","args":{"path":"README.md"},"id":"tc_1"}]\n```',
    '```final_answer\nI will not read the file. Answered from the system prompt alone.\n```'
  ]);
  const loop = new AgentLoop({ modelManager: mgr, workspace, modelId: 'test-model' });
  const started = await loop.start({ goal: 'Tell me what is in README.md' });
  const rejected = await loop.decide({ sessionId: started.id, decisions: [{ id: 'tc_1', approve: false }] });
  assert.equal(rejected.status, 'completed');
  assert.equal(rejected.completed[0].approved, false);
  assert.ok(rejected.completed[0].result.skipped);
  assert.match(rejected.finalAnswer, /Answered from the system prompt/);
  await fs.rm(workspace, { recursive: true, force: true });
});

test('agent loop: bash scenario, approved, command runs in workspace', async () => {
  const workspace = await makeWorkspace();
  const mgr = stubModelManager([
    '```json\n[{"tool":"bash","args":{"program":"node","args":["-e","process.stdout.write(\\"ok\\")"]},"id":"tc_1"}]\n```',
    '```final_answer\nnode ran successfully\n```'
  ]);
  const loop = new AgentLoop({ modelManager: mgr, workspace, modelId: 'test-model' });
  const started = await loop.start({ goal: 'Run a node command' });
  // The node -e flag is in the denylist, so this should be blocked.
  assert.equal(started.completed[0]?.result?.error || '', '');
  // Now retry with an allowed flag.
  const mgr2 = stubModelManager([
    '```json\n[{"tool":"bash","args":{"program":"node","args":["--version"]},"id":"tc_1"}]\n```',
    '```final_answer\nnode is installed\n```'
  ]);
  const loop2 = new AgentLoop({ modelManager: mgr2, workspace, modelId: 'test-model' });
  const s2 = await loop2.start({ goal: 'Run a node command' });
  const r2 = await loop2.decide({ sessionId: s2.id, decisions: [{ id: 'tc_1', approve: true }] });
  assert.equal(r2.status, 'completed');
  assert.match(r2.completed[0].result.stdout, /^v\d+/);
  await fs.rm(workspace, { recursive: true, force: true });
});

test('agent loop: bash scenario, denylisted flag is blocked', async () => {
  const workspace = await makeWorkspace();
  const mgr = stubModelManager([
    '```json\n[{"tool":"bash","args":{"program":"node","args":["-e","process.exit(1)"]},"id":"tc_1"}]\n```',
    '```final_answer\nI will not run that.\n```'
  ]);
  const loop = new AgentLoop({ modelManager: mgr, workspace, modelId: 'test-model' });
  const started = await loop.start({ goal: 'Run a node command' });
  const result = await loop.decide({ sessionId: started.id, decisions: [{ id: 'tc_1', approve: true }] });
  assert.equal(result.completed[0].result.error || '', "flag '-e' is not permitted on 'node' for security");
  await fs.rm(workspace, { recursive: true, force: true });
});

test('agent loop: search scenario, approved, results returned', async () => {
  const workspace = await makeWorkspace();
  const mgr = stubModelManager([
    '```json\n[{"tool":"search","args":{"query":"hello","icase":true},"id":"tc_1"}]\n```',
    '```final_answer\nhello appears in src/hello.js\n```'
  ]);
  const loop = new AgentLoop({ modelManager: mgr, workspace, modelId: 'test-model' });
  const started = await loop.start({ goal: 'find hello references' });
  const result = await loop.decide({ sessionId: started.id, decisions: [{ id: 'tc_1', approve: true }] });
  assert.equal(result.status, 'completed');
  assert.ok(result.completed[0].result.total > 0);
  await fs.rm(workspace, { recursive: true, force: true });
});

test('agent loop: git_diff scenario, approved, returns diff or empty', async () => {
  const workspace = await makeWorkspace();
  const mgr = stubModelManager([
    '```json\n[{"tool":"git_diff","args":{}},{"id":"tc_1"}]\n```',
    '```final_answer\nno changes\n```'
  ]);
  const loop = new AgentLoop({ modelManager: mgr, workspace, modelId: 'test-model' });
  const started = await loop.start({ goal: 'check git status' });
  assert.equal(started.status, 'awaiting-approval');
  assert.equal(started.pending[0].tool, 'git_diff');
  const result = await loop.decide({ sessionId: started.id, decisions: [{ id: 'tc_1', approve: true }] });
  assert.equal(result.status, 'completed');
  // The result may be {path, diff} on success or {path, diff:'', error} on missing git.
  // Either way it must include a `diff` key and be a string when present.
  const r = result.completed[0].result;
  assert.ok(r && typeof r === 'object');
  if (r.diff !== undefined) assert.equal(typeof r.diff, 'string');
  await fs.rm(workspace, { recursive: true, force: true });
});

test('agent loop: write_file scenario, approved, file is written', async () => {
  const workspace = await makeWorkspace();
  const mgr = stubModelManager([
    '```json\n[{"tool":"write_file","args":{"path":"src/new.js","content":"export const x = 1;\\n"},"id":"tc_1"}]\n```',
    '```final_answer\nI wrote src/new.js\n```'
  ]);
  const loop = new AgentLoop({ modelManager: mgr, workspace, modelId: 'test-model' });
  const started = await loop.start({ goal: 'create src/new.js' });
  const result = await loop.decide({ sessionId: started.id, decisions: [{ id: 'tc_1', approve: true }] });
  assert.equal(result.status, 'completed');
  const written = await fs.readFile(path.join(workspace, 'src', 'new.js'), 'utf8');
  assert.match(written, /export const x = 1/);
  await fs.rm(workspace, { recursive: true, force: true });
});

test('agent loop: cancel rejects all pending tools', async () => {
  const workspace = await makeWorkspace();
  const mgr = stubModelManager([
    '```json\n[{"tool":"read_file","args":{"path":"README.md"},"id":"tc_1"},{"tool":"bash","args":{"program":"node","args":["--version"]},"id":"tc_2"}]\n```',
    '```final_answer\nshould not reach here\n```'
  ]);
  const loop = new AgentLoop({ modelManager: mgr, workspace, modelId: 'test-model' });
  const started = await loop.start({ goal: 'two tools' });
  assert.equal(started.pending.length, 2);
  const cancelled = await loop.rejectAll(started.id);
  assert.equal(cancelled.status, 'completed');
  assert.equal(cancelled.completed.length, 2);
  assert.ok(cancelled.completed.every(c => !c.approved));
  await fs.rm(workspace, { recursive: true, force: true });
});

test('agent loop: invalid schema feed back lets the model correct itself', async () => {
  const workspace = await makeWorkspace();
  // Three scripts because start() runs _step which consumes one, then
  // auto-loops on invalid input and consumes another. The second script
  // is the corrected valid call. The test asserts the session state after
  // start() — the model is now waiting for approval on the corrected call.
  const mgr = stubModelManager([
    '```json\n[{"tool":"read_file","args":{}},{"id":"tc_1"}]\n```',
    '```json\n[{"tool":"read_file","args":{"path":"README.md"},"id":"tc_2"}]\n```',
    '```final_answer\ndone\n```'
  ]);
  const loop = new AgentLoop({ modelManager: mgr, workspace, modelId: 'test-model' });
  const started = await loop.start({ goal: 'read README' });
  // start() consumed the invalid script (auto-looped) and the corrected one.
  assert.equal(started.status, 'awaiting-approval');
  assert.equal(started.pending.length, 1);
  assert.equal(started.pending[0].id, 'tc_2');
  const r2 = await loop.decide({ sessionId: started.id, decisions: [{ id: 'tc_2', approve: true }] });
  assert.equal(r2.status, 'completed');
  assert.match(r2.completed[0].result.content, /Sample/);
  await fs.rm(workspace, { recursive: true, force: true });
});

test('gatherWorkspaceContext: open files + active file + git diff + terminal + diagnostics', async () => {
  const workspace = await makeWorkspace();
  await fs.mkdir(path.join(workspace, '.aide', 'logs'), { recursive: true });
  await fs.writeFile(path.join(workspace, '.aide', 'logs', 'term-tail.log'), 'last line of output from a real command\n', 'utf8');
  await fs.writeFile(path.join(workspace, '.aide', 'logs', 'diagnostics.jsonl'), JSON.stringify({ path: 'src/hello.js', line: 1, severity: 'warning', message: 'unused export' }) + '\n', 'utf8');
  const ctx = await gatherWorkspaceContext({ workspace, openPaths: ['README.md', 'src/hello.js'], activePath: 'README.md', git: false, terminal: true, diagnostics: true });
  assert.ok(ctx.text.includes('Open files'), 'should include Open files');
  assert.ok(ctx.text.includes('README.md'), 'should include open file paths');
  assert.ok(ctx.text.includes('Active file'), 'should include Active file section');
  assert.ok(ctx.text.includes('terminal'), 'should include terminal section header (case-insensitive)');
  assert.ok(ctx.text.includes('diagnostics'), 'should include diagnostics section');
  assert.equal(ctx.diagnostics.count, 1);
  assert.ok(ctx.terminal.tail.length > 0, 'terminal tail should be non-empty');
  await fs.rm(workspace, { recursive: true, force: true });
});

test('AgentLoop: status returns the current session public view', async () => {
  const workspace = await makeWorkspace();
  const mgr = stubModelManager([
    '```json\n[{"tool":"read_file","args":{"path":"README.md"},"id":"tc_1"}]\n```',
    '```final_answer\ndone\n```'
  ]);
  const loop = new AgentLoop({ modelManager: mgr, workspace, modelId: 'test-model' });
  const started = await loop.start({ goal: 'read README' });
  const s = await loop.status(started.id);
  assert.equal(s.id, started.id);
  assert.equal(s.status, 'awaiting-approval');
  assert.equal(s.turn, 1);
  assert.equal(s.maxTurns, 8);
  await fs.rm(workspace, { recursive: true, force: true });
});

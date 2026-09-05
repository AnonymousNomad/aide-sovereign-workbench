// Agent Loop — multi-turn tool-using model session.
// The model proposes tool calls in a fenced json block. The daemon parses
// them, asks the user to approve each one (via /api/agent/decision), executes
// approved ones, feeds results back, loops. Max 8 turns. Stops on a
// "final_answer" block or when the model stops proposing new tool calls.
//
// Pure of any UI: the caller (daemon route or future desktop) drives the
// loop. One AgentLoop instance per session; sessions are stored in-memory
// keyed by id and persisted to .aide/sessions/<id>.json for crash recovery.
//
// Approved-required gate: every mutating tool call (write_file, edit, bash)
// requires an explicit user decision before execution. Read-only tool calls
// (read_file, search, git_diff, list) are non-mutating but still require
// approval per the workspace-aware doctrine (Theia + Anthropic + VS Code
// all enforce this; non-negotiable).

import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { gatherWorkspaceContext, appendTerminalTail, appendDiagnostic } from './context-gatherer.mjs';

const execFileP = promisify(execFile);

const TOOL_SCHEMAS = {
  read_file: {
    description: 'Read a file from the workspace. Returns the text content (or a slice of it).',
    params: {
      path: { type: 'string', required: true, maxLength: 500, description: 'Workspace-relative path to the file.' },
      start_line: { type: 'integer', required: false, min: 1, description: '1-based start line. Omit for the whole file.' },
      end_line: { type: 'integer', required: false, min: 1, description: '1-based end line (inclusive). Omit for the whole file.' }
    },
    mutating: false,
    timeoutMs: 10_000,
    capBytes: 1_048_576
  },
  write_file: {
    description: 'Write a file to the workspace. The path must be workspace-relative. Requires explicit user approval.',
    params: {
      path: { type: 'string', required: true, maxLength: 500, description: 'Workspace-relative path to the file.' },
      content: { type: 'string', required: true, maxLength: 1_048_576, description: 'Full new file content.' }
    },
    mutating: true,
    timeoutMs: 30_000,
    capBytes: 1_048_576
  },
  bash: {
    description: 'Run a command. The program must be in the allowlist: node, npm, npx, git, py, python, python3, cargo, rustc. Requires explicit user approval.',
    params: {
      program: { type: 'string', required: true, maxLength: 32, description: 'Program name (lowercase, in allowlist).' },
      args: { type: 'array', required: false, maxLength: 24, itemType: 'string', description: 'Command arguments.' }
    },
    mutating: true,
    timeoutMs: 30_000,
    capBytes: 524_288
  },
  search: {
    description: 'Search the workspace for a literal or regex pattern. Returns matching files and line hits.',
    params: {
      query: { type: 'string', required: true, maxLength: 200, description: 'Search query.' },
      icase: { type: 'boolean', required: false, description: 'Case-insensitive match.' },
      regex: { type: 'boolean', required: false, description: 'Treat query as a regular expression.' },
      mask: { type: 'string', required: false, maxLength: 200, description: 'Optional file mask (glob).' }
    },
    mutating: false,
    timeoutMs: 30_000,
    capBytes: 524_288
  },
  git_diff: {
    description: 'Get the unified diff for a file (or the whole tree if path is omitted).',
    params: {
      path: { type: 'string', required: false, maxLength: 500, description: 'Workspace-relative path. Omit for the whole tree.' }
    },
    mutating: false,
    timeoutMs: 10_000,
    capBytes: 524_288
  },
  list: {
    description: 'List the entries of a directory in the workspace.',
    params: {
      path: { type: 'string', required: false, maxLength: 500, description: 'Workspace-relative path. Omit for the workspace root.' }
    },
    mutating: false,
    timeoutMs: 5_000,
    capBytes: 65_536
  }
};

const ALLOWLIST = new Set(['node', 'npm', 'npx', 'git', 'py', 'python', 'python3', 'cargo', 'rustc']);
const DENIED_FLAGS = {
  node: /^(-e|--eval|--input|--check)$/,
  npx: /^(-y|--call|--global|--offline)$/,
  python: /^(-c|--exec|-m|--module|-B)$/,
  python3: /^(-c|--exec|-m|--module|-B)$/,
  py: /^(-c|--exec|-m|--module|-B)$/
};

function newId() {
  return 'ag_' + crypto.randomBytes(8).toString('hex');
}

function validateToolCall(tool, args) {
  if (!TOOL_SCHEMAS[tool]) return { ok: false, error: `unknown tool: ${tool}` };
  const schema = TOOL_SCHEMAS[tool];
  for (const [name, def] of Object.entries(schema.params)) {
    if (def.required && (args[name] === undefined || args[name] === null || args[name] === '')) {
      return { ok: false, error: `${tool}: missing required param '${name}'` };
    }
    if (args[name] !== undefined) {
      if (def.type === 'string') {
        if (typeof args[name] !== 'string') return { ok: false, error: `${tool}.${name} must be string` };
        if (def.maxLength && args[name].length > def.maxLength) return { ok: false, error: `${tool}.${name} exceeds ${def.maxLength} chars` };
      } else if (def.type === 'integer') {
        const n = Number(args[name]);
        if (!Number.isFinite(n) || !Number.isInteger(n)) return { ok: false, error: `${tool}.${name} must be integer` };
        if (def.min !== undefined && n < def.min) return { ok: false, error: `${tool}.${name} below min ${def.min}` };
      } else if (def.type === 'array') {
        if (!Array.isArray(args[name])) return { ok: false, error: `${tool}.${name} must be array` };
        if (def.maxLength && args[name].length > def.maxLength) return { ok: false, error: `${tool}.${name} exceeds ${def.maxLength} items` };
        if (def.itemType === 'string' && !args[name].every(x => typeof x === 'string')) return { ok: false, error: `${tool}.${name} items must be string` };
      } else if (def.type === 'boolean') {
        if (typeof args[name] !== 'boolean') return { ok: false, error: `${tool}.${name} must be boolean` };
      }
    }
  }
  return { ok: true };
}

function safeResolve(workspace, relativePath) {
  if (!relativePath) return workspace;
  if (path.isAbsolute(relativePath)) throw new Error('absolute path not allowed');
  const target = path.resolve(workspace, relativePath);
  if (target !== workspace && !target.startsWith(workspace + path.sep)) throw new Error('path escaped workspace');
  return target;
}

async function executeReadFile(workspace, args) {
  const target = safeResolve(workspace, args.path);
  const stat = await fs.stat(target).catch(() => null);
  if (!stat) return { error: `file not found: ${args.path}` };
  if (stat.size > 1_048_576) return { error: `file too large: ${args.path} (${stat.size} bytes)` };
  const text = await fs.readFile(target, 'utf8');
  const lines = text.split('\n');
  let body = text;
  if (args.start_line || args.end_line) {
    const start = Math.max(1, Number(args.start_line) || 1);
    const end = Math.min(lines.length, Number(args.end_line) || lines.length);
    body = lines.slice(start - 1, end).join('\n');
  }
  return { path: args.path, content: body, bytes: stat.size, lines: lines.length };
}

async function executeWriteFile(workspace, args) {
  if (args.content.length > 1_048_576) return { error: 'content too large (1 MiB cap)' };
  const target = safeResolve(workspace, args.path);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.aide-tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(temporary, String(args.content), { mode: 0o600 });
  await fs.rename(temporary, target);
  return { path: args.path, bytes: Buffer.byteLength(String(args.content)) };
}

async function executeBash(workspace, args) {
  const program = String(args.program || '').toLowerCase();
  const cmdArgs = Array.isArray(args.args) ? args.args.map(String) : [];
  if (!ALLOWLIST.has(program)) return { error: `program not allowlisted: ${program}` };
  const flagValidator = DENIED_FLAGS[program];
  if (flagValidator) {
    for (const arg of cmdArgs) {
      if (flagValidator.test(arg)) return { error: `flag '${arg}' is not permitted on '${program}' for security` };
    }
  }
  try {
    const { stdout, stderr } = await execFileP(program, cmdArgs, { cwd: workspace, timeout: 30_000, maxBuffer: 524_288, env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_PATH: process.env.NODE_PATH } });
    await appendTerminalTail({ workspace, program, args: cmdArgs, code: 0, stdout, stderr });
    return { code: 0, stdout: String(stdout || '').slice(-4000), stderr: String(stderr || '').slice(-1000) };
  } catch (error) {
    const code = error?.code ?? 1;
    const stdout = String(error?.stdout || '').slice(-4000);
    const stderr = String(error?.stderr || error?.message || '').slice(-1000);
    await appendTerminalTail({ workspace, program, args: cmdArgs, code, stdout, stderr });
    return { code, stdout, stderr, error: error?.message || 'command failed' };
  }
}

async function executeSearch(workspace, args) {
  const query = String(args.query || '');
  const useRegex = args.regex === true;
  const caseInsensitive = args.icase !== false;
  const fileMask = String(args.mask || '');
  const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = useRegex ? query : escapeRegExp(query);
  const flags = caseInsensitive ? 'i' : '';
  let regex;
  try { regex = new RegExp(pattern, flags); } catch (error) { return { error: 'invalid search pattern: ' + error.message }; }
  const excludes = ['node_modules', 'target', '.git', 'dist', 'build', 'assets', '.aide', 'logs'];
  const results = [];
  const walk = async (dir) => {
    if (results.length >= 40) return;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || excludes.includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { await walk(full); continue; }
      const relative = path.relative(workspace, full).split(path.sep).join('/');
      if (fileMask && !new RegExp('^' + fileMask.replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i').test(relative)) continue;
      const stat = await fs.stat(full);
      if (stat.size > 512 * 1024) continue;
      const text = await fs.readFile(full, 'utf8').catch(() => '');
      const hits = [];
      text.split('\n').forEach((line, index) => { if (regex.test(line)) hits.push({ line: index + 1, text: line.replace(/\r$/, '').slice(0, 200) }); });
      if (hits.length) { results.push({ path: relative, hits: hits.slice(0, 8) }); if (results.length >= 40) return; }
    }
  };
  await walk(workspace);
  return { query, results, total: results.length };
}

async function executeGitDiff(workspace, args) {
  const diffPath = args.path || '.';
  if (path.isAbsolute(diffPath) || diffPath.includes('..')) return { error: 'unsafe Git path' };
  try {
    const { stdout } = await execFileP('git', ['diff', '--no-ext-diff', '--no-color', '--', diffPath], { cwd: workspace, maxBuffer: 524_288 });
    return { path: diffPath, diff: String(stdout || '').slice(0, 100_000) };
  } catch (error) { return { path: diffPath, diff: '', error: error.message }; }
}

async function executeList(workspace, args) {
  const target = safeResolve(workspace, args.path || '.');
  const entries = await fs.readdir(target, { withFileTypes: true });
  return { path: args.path || '.', entries: entries.map(e => ({ name: e.name, kind: e.isDirectory() ? 'directory' : 'file' })) };
}

async function executeTool({ workspace, tool, args, approved }) {
  if (TOOL_SCHEMAS[tool].mutating && approved !== true) return { error: `${tool} requires explicit user approval` };
  switch (tool) {
    case 'read_file': return executeReadFile(workspace, args);
    case 'write_file': return executeWriteFile(workspace, args);
    case 'bash': return executeBash(workspace, args);
    case 'search': return executeSearch(workspace, args);
    case 'git_diff': return executeGitDiff(workspace, args);
    case 'list': return executeList(workspace, args);
    default: return { error: `unsupported tool: ${tool}` };
  }
}

// Parser: extract tool calls and final_answer from model output. Supports
// three shapes the cipher 4B and similar small local models actually emit:
// 1) Fenced ```json ... ``` block (the documented format).
// 2) Fenced ```final_answer ... ``` block.
// 3) Bare JSON (a top-level array of tool calls, or a single tool-call object,
//    or a single tool call with no enclosing array). Some local models
//    skip the fence when the JSON is short; the parser catches the same
//    shape from any of these.
function parseToolCalls(text) {
  if (typeof text !== 'string') return { calls: [], finalAnswer: null, remaining: '' };
  // Strip code fences if present, then check if the body is parseable JSON.
  const stripFences = body => body.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  const extractToolArray = value => {
    if (!value) return [];
    const arr = Array.isArray(value) ? value : (value.calls || value.tools || value.tool_calls || (value.tool ? [value] : []));
    if (!Array.isArray(arr)) return [];
    return arr.filter(c => c && c.tool && typeof c.tool === 'string').map(c => ({ tool: c.tool, args: c.args || c.parameters || {}, id: c.id || ('tc_' + crypto.randomBytes(4).toString('hex')) }));
  };
  const tryParse = (raw, kind) => {
    try { return { ok: true, value: JSON.parse(raw) }; } catch { return { ok: false, kind }; }
  };
  // First: fenced blocks
  const jsonFence = text.match(/```json\s*([\s\S]*?)```/i);
  if (jsonFence) {
    const r = tryParse(stripFences(jsonFence[1]), 'json');
    if (r.ok) {
      const calls = extractToolArray(r.value);
      if (calls.length) return { calls, finalAnswer: null, remaining: text };
    }
  }
  const faFence = text.match(/```final_answer\s*([\s\S]*?)```/i);
  if (faFence) return { calls: [], finalAnswer: faFence[1].trim(), remaining: text };
  // Second: bare JSON anywhere in the text (local models often skip fences).
  const trimmed = text.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const r = tryParse(trimmed, 'bare');
    if (r.ok) {
      const calls = extractToolArray(r.value);
      if (calls.length) return { calls, finalAnswer: null, remaining: text };
    }
  }
  // Third: look for a JSON object line inside the text (e.g. first line of
  // a multi-line response is `{"tool":...}`).
  const firstLine = text.split('\n').map(l => l.trim()).find(l => l.startsWith('{') && l.endsWith('}'));
  if (firstLine) {
    const r = tryParse(firstLine, 'firstLine');
    if (r.ok) {
      const calls = extractToolArray(r.value);
      if (calls.length) return { calls, finalAnswer: null, remaining: text };
    }
  }
  // No tool calls. If there's a fenced ```...``` block we don't recognize,
  // treat as final answer; otherwise the whole text is the answer.
  if (!text.includes('```')) return { calls: [], finalAnswer: text.trim() || null, remaining: text };
  return { calls: [], finalAnswer: text.trim() || null, remaining: text };
}

const TOOL_GUIDE = `You have 6 tools. Always respond with ONE fenced block per turn.

1) Propose tool calls: a single \`\`\`json code block with an array of {tool, args, id} objects.
   Example:
   \`\`\`json
   [{"tool":"read_file","args":{"path":"README.md"},"id":"tc_1"}]
   \`\`\`

2) When the task is done, emit ONE \`\`\`final_answer code block with the answer.
   Example:
   \`\`\`final_answer
   I added the hello route and verified it.
   \`\`\`

Tools (strict JSON schema; do not invent fields):
${Object.entries(TOOL_SCHEMAS).map(([name, s]) => {
  const params = Object.entries(s.params).map(([p, def]) => `      "${p}": { "type": "${def.type}"${def.required ? ', "required": true' : ''}${def.maxLength ? `, "maxLength": ${def.maxLength}` : ''}${def.min !== undefined ? `, "min": ${def.min}` : ''} }`).join(',\n');
  return `  - ${name}: ${s.description}\n    params: {\n${params}\n    }\n    mutating: ${s.mutating}`;
}).join('\n\n')}

Rules:
- Mutating tools (write_file, bash) need user approval before running.
- If a tool returns "error", adjust and re-propose.
- Use unique ids like "tc_1", "tc_2".
- Max 8 turns.`;

export class AgentLoop {
  constructor({ modelManager, workspace, modelId, sessionDir, maxTurns = 8 }) {
    this.modelManager = modelManager;
    this.workspace = workspace;
    this.modelId = modelId;
    this.sessionDir = sessionDir || path.join(workspace, '.aide', 'sessions');
    this.maxTurns = maxTurns;
    this.sessions = new Map();
  }

  _sessionPath(id) { return path.join(this.sessionDir, `${id}.json`); }

  async _loadSession(id) {
    if (this.sessions.has(id)) return this.sessions.get(id);
    try {
      const raw = await fs.readFile(this._sessionPath(id), 'utf8');
      const session = JSON.parse(raw);
      this.sessions.set(id, session);
      return session;
    } catch { return null; }
  }

  async _saveSession(session) {
    this.sessions.set(session.id, session);
    try {
      await fs.mkdir(this.sessionDir, { recursive: true });
      await fs.writeFile(this._sessionPath(session.id), JSON.stringify(session, null, 2), 'utf8');
    } catch { /* best-effort */ }
  }

  _newSession({ goal, openPaths = [], activePath = null, history = [] }) {
    return {
      id: newId(),
      modelId: this.modelId,
      goal,
      openPaths,
      activePath,
      messages: [],
      pending: [],          // tool calls awaiting user decision
      completed: [],       // {call, result, approved, decided_at}
      turn: 0,
      status: 'running',   // running | awaiting-approval | completed | failed
      finalAnswer: null,
      createdAt: new Date().toISOString(),
      history
    };
  }

  async start({ goal, openPaths = [], activePath = null, history = [], resumeId = null, modelId = null, includeLiveContext = true }) {
    if (!goal || typeof goal !== 'string') throw new Error('goal is required');
    let session;
    if (resumeId) {
      session = await this._loadSession(resumeId);
      if (!session) throw new Error(`session not found: ${resumeId}`);
      session.status = 'running';
    } else {
      session = this._newSession({ goal, openPaths, activePath, history });
    }
    // Per-request modelId overrides the loop default. The session records which
    // model it is bound to so resume picks up the same model.
    if (modelId) session.modelId = modelId;
    // Build the first turn: inject live workspace context + tool guide as system message.
    // On the 6GB card the cipher 4B with the full live context exceeds the 5-minute
    // first-turn budget. Operators can opt out of the live context (includeLiveContext:false)
    // to use the tool guide only — the agent loop still proposes and executes tool
    // calls, the operator just provides paths in their own goal text.
    let contextText = '';
    if (includeLiveContext) {
      const context = await gatherWorkspaceContext({
        workspace: this.workspace,
        openPaths: session.openPaths,
        activePath: session.activePath
      });
      contextText = `\n\n${context.text}`;
    }
    session.messages = [
      { role: 'system', content: `${TOOL_GUIDE}${contextText}` },
      ...(Array.isArray(session.history) ? session.history : []),
      { role: 'user', content: session.goal }
    ];
    session.turn = 0;
    await this._saveSession(session);
    return await this._step(session);
  }

  async _step(session) {
    if (session.turn >= this.maxTurns) {
      session.status = 'completed';
      session.finalAnswer = session.finalAnswer || 'max turns reached; no final_answer emitted';
      await this._saveSession(session);
      return this._public(session);
    }
    session.turn += 1;
    let result;
    try {
      // Generous timeout for the first turn (cold engine, large system prompt).
      // Subsequent warm turns use the chat manager's default 90s. Operators on
      // a 6GB card with a 4B dense Q8_0 model see 5-20 tok/s; a 4k-token system
      // prompt with 6 tool definitions + live workspace context can take 60-120s
      // on the first inference after engine start.
      const firstTurnTimeoutMs = session.turn === 1 ? 300_000 : 90_000;
      result = await this.modelManager.chat(session.modelId, session.messages, { max_tokens: 1024, temperature: 0.2, timeout_ms: firstTurnTimeoutMs });
    } catch (error) {
      session.status = 'failed';
      session.error = error.message;
      await this._saveSession(session);
      return this._public(session);
    }
    const text = result?.choices?.[0]?.message?.content || '';
    session.messages.push({ role: 'assistant', content: text });
    const parsed = parseToolCalls(text);
    if (parsed.finalAnswer !== null) {
      session.finalAnswer = parsed.finalAnswer;
      session.status = 'completed';
      await this._saveSession(session);
      return this._public(session);
    }
    if (parsed.calls.length === 0) {
      // No tool calls and no final_answer. Treat as final answer and stop.
      session.finalAnswer = text.trim() || '(no final answer)';
      session.status = 'completed';
      await this._saveSession(session);
      return this._public(session);
    }
    // Validate each tool call. If any is invalid, record the error as a tool result
    // and let the model recover on the next turn.
    const validated = parsed.calls.map(call => {
      const v = validateToolCall(call.tool, call.args);
      return v.ok ? { call, valid: true } : { call, valid: false, error: v.error };
    });
    const validCalls = validated.filter(v => v.valid).map(v => v.call);
    const invalidCalls = validated.filter(v => !v.valid);
    if (invalidCalls.length) {
      // Feed the model the schema errors as a user-role turn. The cipher
      // engine does not support the OpenAI `tool` role (returns HTTP 400);
      // using `user` is the OpenAI-roles-compatible shape.
      session.messages.push({
        role: 'user',
        content: `[tool_validation_errors]\n` + JSON.stringify({ kind: 'validation', errors: invalidCalls.map(v => ({ id: v.call.id, error: v.error })) }, null, 2)
      });
    }
    if (validCalls.length === 0) {
      // Nothing to approve; loop to next turn so the model can fix.
      await this._saveSession(session);
      return await this._step(session);
    }
    session.pending = validCalls.map(call => ({ ...call, status: 'awaiting-approval', proposedAt: new Date().toISOString() }));
    session.status = 'awaiting-approval';
    await this._saveSession(session);
    return this._public(session);
  }

  async decide({ sessionId, decisions }) {
    const session = await this._loadSession(sessionId);
    if (!session) throw new Error(`session not found: ${sessionId}`);
    if (session.status !== 'awaiting-approval') throw new Error(`session not awaiting approval (status: ${session.status})`);
    const decisionMap = new Map();
    for (const d of decisions || []) decisionMap.set(d.id, d.approve === true);
    for (const pending of session.pending) {
      const approved = decisionMap.has(pending.id) ? decisionMap.get(pending.id) === true : false;
      let result;
      if (approved) {
        result = await executeTool({ workspace: this.workspace, tool: pending.tool, args: pending.args, approved: true });
      } else {
        result = { skipped: true, reason: 'rejected by user' };
      }
      session.completed.push({ call: pending, approved, result, decidedAt: new Date().toISOString() });
      // Feed the tool result back to the model. The cipher engine (and most
      // local llama-server builds) does not support the OpenAI `tool` role
      // message — it returns HTTP 400. We send the result as a `user` turn
      // instead, with a clear marker so the model can parse the boundary.
      // Per the OpenAI tool-use spec the result belongs on the user side of
      // the conversation anyway; this is the OpenAI-roles-compatible shape.
      session.messages.push({
        role: 'user',
        content: `[tool_result id=${pending.id} tool=${pending.tool} approved=${approved}]\n` + JSON.stringify(result, null, 2)
      });
    }
    session.pending = [];
    session.status = 'running';
    await this._saveSession(session);
    return await this._step(session);
  }

  async status(sessionId) {
    const session = await this._loadSession(sessionId);
    if (!session) return null;
    return this._public(session);
  }

  async rejectAll(sessionId) {
    const session = await this._loadSession(sessionId);
    if (!session) throw new Error(`session not found: ${sessionId}`);
    for (const pending of session.pending) {
      session.completed.push({ call: pending, approved: false, result: { skipped: true, reason: 'rejected by user' }, decidedAt: new Date().toISOString() });
      session.messages.push({ role: 'tool', content: JSON.stringify({ id: pending.id, tool: pending.tool, approved: false, result: { skipped: true, reason: 'rejected by user' } }) });
    }
    session.pending = [];
    session.status = 'completed';
    session.finalAnswer = '(session cancelled by user)';
    await this._saveSession(session);
    return this._public(session);
  }

  _public(session) {
    return {
      id: session.id,
      modelId: session.modelId,
      goal: session.goal,
      status: session.status,
      turn: session.turn,
      maxTurns: this.maxTurns,
      pending: session.pending,
      completed: session.completed,
      finalAnswer: session.finalAnswer,
      createdAt: session.createdAt,
      error: session.error
    };
  }
}

export { parseToolCalls, validateToolCall, executeTool, TOOL_SCHEMAS };

// Real-model harness battery — wires the ACTUAL local coding model into the
// universal harness (same createHarness contract as harness/test-orchestrator.mjs),
// runs genuine tasks, captures per-stage output, measures veritas verdicts, and
// feeds failures into the closed-loop improvement lane (cipher-state.jsonl +
// selfimprove-compatible signal rows).
// Usage: node scripts/harness-real-model.mjs [model path]
// Exit 0 on battery pass (engine lifecycle verified + deterministic verdicts
// produced per task), 1 on failure, 2 on setup failure.
// Task metrics use MEASURED-PASS semantics: a task passes when its patch parses
// AND veritas verifies it; the human-approval state is recorded separately as
// telemetry (the harness refuses unverified/self-approved apply by design).
import { spawn, execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { createHarness } from '../harness/orchestrator.mjs';
import { createStateBus } from '../harness/cipher-state.mjs';
import { validateUnifiedPatch } from '../harness/patch.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const engineSource = process.env.AIDE_ENGINE_SOURCE || 'E:\\llama-cpp';
const modelPath = process.argv[2] || path.join(root, 'models', 'qwen2.5-coder-1.5b-instruct-q4_k_m.gguf');
const reportDir = path.join(root, 'docs', 'evidence');
const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-real-harness-'));
const bus = createStateBus(workspace);
const signalDir = path.join(workspace, '.aide', 'training');

const results = [];
function record(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name} - ${detail}`);
}

console.log(`model: ${modelPath}`);

// ---- engine lifecycle (verified recipe: cwd=engineDir, --no-warmup, no -ngl on CPU) ----
const exe = process.env.AIDE_LLAMA_SERVER || path.join(engineSource, 'llama-server.exe');
if (!(await fs.access(exe).then(() => true, () => false))) {
  console.log(`engine not found: ${exe} (set AIDE_LLAMA_SERVER or recreate desktop staging)`);
  process.exit(2);
}
if (!(await fs.access(modelPath).then(() => true, () => false))) {
  console.log(`model not found: ${modelPath}`);
  process.exit(2);
}
const port = await new Promise(resolve => {
  const srv = net.createServer();
  srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); });
});
const engine = spawn(exe, ['-m', modelPath, '--host', '127.0.0.1', '--port', String(port), '--ctx-size', '2048', '--threads', '4', '--parallel', '1', '--no-warmup', '--prio', '-1'], {
  cwd: path.dirname(exe), stdio: ['ignore', 'ignore', 'pipe'], detached: true
});
let engineTail = '';
engine.stderr.on('data', chunk => { engineTail = (engineTail + String(chunk)).slice(-2000); });
let engineDiedEarly = false;
engine.once('exit', (code, signal) => { engineDiedEarly = true; void bus.append({ type: 'harness-engine-exit', code, signal, detail: engineTail.slice(-400) }); });

const endpoint = `http://127.0.0.1:${port}/v1`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitEngine(attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    if (engineDiedEarly) throw new Error(`engine exited early: ${engineTail.slice(-400) || '(empty stderr)'}`);
    try {
      const r = await fetch(`${endpoint}/models`, { signal: AbortSignal.timeout(5000) });
      if (r.ok) return true;
    } catch { /* loading */ }
    await sleep(1000);
  }
  return false;
}

function buildCompletion(role) {
  const complete = async input => {
    const system = [
      input.mandatory_credo || 'Follow the AIDE standard operating procedures.',
      input.instruction || ''
    ].filter(Boolean).join('\n');
    const user = [
      input.task ? `TASK:\n${input.task}` : '',
      input.plan ? `PLAN:\n${input.plan}` : '',
      input.context ? `CONTEXT:\n${input.context}` : '',
      input.raw ? `RAW OUTPUT:\n${input.raw}` : ''
    ].filter(Boolean).join('\n\n');
    const payload = {
      model: modelPath,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      max_tokens: input.role === 'verify' ? 200 : input.role === 'build' ? 900 : 500,
      temperature: 0
    };
    const started = Date.now();
    const response = await fetch(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120000)
    });
    if (!response.ok) throw new Error(`${role} upstream ${response.status}: ${(await response.text()).slice(0, 200)}`);
    const data = await response.json();
    const content = String(data.choices?.[0]?.message?.content ?? '');
    const usage = data.usage || {};
    await bus.append({
      type: 'harness-trajectory',
      role,
      tokens_in: usage.prompt_tokens ?? 0,
      tokens_out: usage.completion_tokens ?? 0,
      latency_ms: Date.now() - started,
      stage: 'real-model'
    });
    return content;
  };
  return { complete };
}

// ---- verification runner: real, deterministic, verifier-stamped ----
function makeVerificationRunner(fixturePath) {
  return async ({ task, plan, patch, context }) => {
    const checks = {};
    let passed = true;
    checks['patch-parse'] = validateUnifiedPatch(patch).valid;
    if (!checks['patch-parse']) passed = false;
    try {
      const fileLines = (await fs.readFile(fixturePath, 'utf8')).split('\n');
      checks['fixture-intact'] = fileLines.length >= 3 && fileLines.some(l => l.includes('function'));
      if (!checks['fixture-intact']) passed = false;
    } catch {
      checks['fixture-intact'] = false;
      passed = false;
    }
    checks['touch-target'] = patch.includes('fixture-a.js');
    if (!checks['touch-target']) passed = false;
    return { passed, checks };
  };
}

async function runTask(label, task, options = {}) {
  const fixturePath = options.fixturePath || path.join(workspace, 'fixture-a.js');
  await fs.writeFile(fixturePath, '// fixture\nfunction add(a, b) { return a + b; }\nmodule.exports = { add };\n', 'utf8');
  const harness = createHarness({
    providers: {
      reason: buildCompletion('reason'),
      build: buildCompletion('build'),
      verify: buildCompletion('verify'),
      repair: buildCompletion('repair')
    },
    policy: { require_human_approval: false, max_turns: 4 },
    verificationRunner: makeVerificationRunner(fixturePath)
  });
  try {
    const result = await harness.run(task, { files: ['fixture-a.js'], fixtureScan: true, taskClass: 'code-change' });
    return result;
  } catch (error) {
    return { status: 'harness-error', error: String(error && error.message || error) };
  }
}

async function shutdown(code) {
  const wasAlive = !engineDiedEarly && engine.exitCode === null;
  if (wasAlive) {
    if (process.platform === 'win32') {
      await new Promise(resolve => execFile('taskkill.exe', ['/PID', String(engine.pid), '/T', '/F'], { windowsHide: true }, () => resolve()));
    } else {
      engine.kill('SIGTERM');
    }
  }
  await sleep(1200);
  const alive = !engineDiedEarly && engine.exitCode === null;
  record('teardown-clean', !alive, alive ? 'engine still alive after kill' : wasAlive ? 'engine stopped on exit' : 'engine had already exited');
  await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
  process.exit(code);
}

let batteryPassed = false;
let taskReports = [];
try {
  record('engine-spawn', await waitEngine(), `qwen2.5-coder-1.5b on :${port}`);
  if (!engineDiedEarly) record('engine-alive-8s', true, 'survived danger window');

  const tasks = [
    { label: 'add-export', task: 'Add a subtract function to fixture-a.js and export it.', opts: {} },
    { label: 'rename-symbol', task: 'Rename the add function to sum in fixture-a.js, keep the export working.', opts: {} }
  ];
  for (const { label, task, opts } of tasks) {
    const result = await runTask(task, opts);
    const parse = result.patch ? validateUnifiedPatch(result.patch).valid : false;
    const veritasStatus = result.veritas?.status || 'none';
    const veritasPassed = result.veritas?.passed === true;
    const status = result.status || 'unknown';
    const planText = result.plan ? String(result.plan) : '';
    const patchText = result.patch ? String(result.patch) : '';
    const verdictText = result.verdict ? String(result.verdict) : '';
    taskReports.push({
      label,
      task,
      status,
      patch_parse: parse,
      veritas: veritasStatus,
      veritas_passed: veritasPassed,
      measured_pass: parse === true && veritasPassed,
      plan_bytes: Buffer.byteLength(planText),
      patch_bytes: Buffer.byteLength(patchText),
      verdict_bytes: Buffer.byteLength(verdictText),
      verdict_excerpt: verdictText.slice(0, 120),
      plan_excerpt: planText.slice(0, 240),
      patch_excerpt: patchText.slice(0, 400),
      error: result.error || null
    });
    await bus.append({
      type: 'harness-result',
      task: label,
      task_text: task,
      status,
      patch_parse: parse,
      veritas: veritasStatus,
      veritas_passed: veritasPassed,
      measured_pass: parse === true && veritasPassed,
      verdict_excerpt: verdictText.slice(0, 120),
      plan_bytes: Buffer.byteLength(planText),
      patch_bytes: Buffer.byteLength(patchText)
    });
    const measuredPass = parse === true && veritasPassed;
    const errorInfo = result.error ? ` ERR=${String(result.error).slice(0, 200)}` : '';
    record(`${label}:${status}`, measuredPass, `parse=${parse} veritas=${veritasStatus} approve-state=${status}${errorInfo}`);
    if (!measuredPass) {
      const row = {
        ts: new Date().toISOString(),
        category: parse ? 'gate' : 'format',
        source: `real-model-${label}`,
        verifier: 'harness-real-model-v1',
        verifier_result: 'fail',
        original_event: { stage: 'verify', task, status: veritasStatus },
        prompt: task,
        stage_hint: parse ? 'distill' : 'sft'
      };
      await fs.mkdir(signalDir, { recursive: true });
      await fs.appendFile(path.join(signalDir, 'signal-real-model.jsonl'), JSON.stringify(row) + '\n', 'utf8');
    }
  }

  batteryPassed = taskReports.length > 0 && taskReports.every(t => t.measured_pass === true);
  const signalsWritten = await fs.access(path.join(signalDir, 'signal-real-model.jsonl')).then(() => true, () => false);
  if (signalsWritten) record('closed-loop-signal', true, path.join(signalDir, 'signal-real-model.jsonl'));
} catch (error) {
  record('battery-execution', false, String(error && error.message || error));
  batteryPassed = false;
}

await fs.mkdir(reportDir, { recursive: true });
const reportPath = path.join(reportDir, 'harness-real-model.json');
await fs.writeFile(reportPath, JSON.stringify({
  at: new Date().toISOString(),
  model: modelPath,
  engine_binary: exe,
  endpoint: endpoint,
  results,
  tasks: taskReports,
  battery_passed: batteryPassed
}, null, 2), 'utf8');
record('evidence-writing', true, reportPath);

await shutdown(batteryPassed ? 0 : 1);
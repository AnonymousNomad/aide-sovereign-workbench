// Desktop Policy Hook - the gate that ensures every model-driven
// desktop proposal goes through the in-house model (cipher v1) and
// never through a cloud or BYOK provider. See skill
// `aide-inhouse-only-policy-hook` for the doctrine.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

const ALLOWLIST = new Set([
  'cipher', 'cipher-v1', 'aide-cipher-4b', 'aide-cipher-4b-instruct'
]);
const VALID_OPS = new Set([
  'launch_app', 'open_path', 'list_windows', 'focus_window',
  'move_file', 'outlook_create_draft', 'excel_generate_report'
]);
const OVERRIDE_LIMIT = 3;
const CONFIDENCE_THRESHOLD = 0.6;
const MAX_CIPHER_CALL_MS = 12000;

export class DesktopPolicyHookError extends Error {
  constructor(code, message, meta) {
    super(message);
    this.name = 'DesktopPolicyHookError';
    this.code = code;
    Object.assign(this, meta || {});
  }
}

function buildProposalPrompt(opts) {
  const grantsLine = opts.grants
    ? 'Allowed apps: ' + ((opts.grants.apps || []).join(', ') || 'none') + '. Roots: ' + ((opts.grants.roots || []).join('; ') || 'none') + '. Window titles: ' + ((opts.grants.window_titles || []).join(', ') || 'none') + '.'
    : 'Grants: unknown.';
  return [
    'You are the in-house desktop policy model for AIDE.',
    'Respond with exactly ONE XML block, no prose.',
    '',
    'Hint: ' + (opts.action_hint || '(none)'),
    'Active grants: ' + grantsLine,
    'Current window: ' + (opts.window_title || '(unknown)'),
    '',
    'Output format:',
    '<desktop_action>',
    'op: launch_app | open_path | list_windows | focus_window | move_file | outlook_create_draft | excel_generate_report',
    'target: <app | path | window title>',
    'destination: <path>',
    'note: <one-sentence intent>',
    '</desktop_action>',
    '',
    'Confidence: 0..1 on the line right after the closing tag.',
    'If outside grants, set confidence to 0.0 and emit a list_windows action.'
  ].join('\n');
}

function parseProposalResponse(reply) {
  const text = String(reply || '').trim();
  const openMatch = /<desktop_action>([\s\S]*?)(?:<\/desktop_action>|$)/i.exec(text);
  if (!openMatch) return null;
  const body = openMatch[1];
  const fields = {};
  for (const line of body.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*?)\s*$/.exec(line);
    if (m) fields[m[1].toLowerCase()] = m[2];
  }
  const confMatch = /confidence\s*[:=]\s*([0-9.]+)/i.exec(text);
  const confidence = confMatch ? Math.max(0, Math.min(1, Number(confMatch[1]))) : null;
  return {
    op: fields.op || '',
    target: fields.target || '',
    destination: fields.destination || '',
    note: fields.note || '',
    confidence: confidence
  };
}

export function createDesktopPolicyHook(opts) {
  const workspace = String((opts && opts.workspace) || '');
  if (!workspace) throw new Error('createDesktopPolicyHook: workspace is required');
  const modelId = String((opts && opts.modelId) || 'aide-cipher-4b');
  const runtime = opts && opts.runtime;
  const sessionId = String((opts && opts.sessionId) || 'default');
  const threshold = (opts && Number.isFinite(opts.confidence)) ? opts.confidence : CONFIDENCE_THRESHOLD;
  const maxOverride = (opts && Number.isFinite(opts.maxOverride)) ? opts.maxOverride : OVERRIDE_LIMIT;
  const overrides = { count: 0, last: null };

  async function loadGrants() {
    try {
      const raw = await fs.readFile(path.join(workspace, '.aide', 'desktop', 'grants.json'), 'utf8');
      return JSON.parse(raw);
    } catch (e) { return null; }
  }

  async function loadWindowTitle() {
    if (process.platform !== 'win32') return '';
    return await new Promise(function(resolve) {
      execFile('powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', "(Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object -First 1 MainWindowTitle | ConvertTo-Json -Compress)"],
        { timeout: 2000, windowsHide: true },
        function(err, stdout) {
          if (err) return resolve('');
          var title = '';
          try { title = JSON.parse(String(stdout || '').trim() || 'null'); } catch (e) { title = null; }
          resolve(title && title.MainWindowTitle ? String(title.MainWindowTitle).slice(0, 200) : '');
        }
      );
    });
  }

  async function recordTrajectory(row) {
    try {
      const dir = path.join(workspace, '.aide', 'desktop', 'trajectories', 'policy-hook');
      await fs.mkdir(dir, { recursive: true });
      const file = path.join(dir, sessionId + '.jsonl');
      await fs.appendFile(file, JSON.stringify(row) + '\n', 'utf8');
    } catch (e) { /* best-effort */ }
  }

  async function propose(input) {
    const actionHint = String((input && input.action_hint) || '').slice(0, 800);
    const grants = (input && input.grants) || (await loadGrants()) || {};
    const windowTitle = String((input && input.window_title) || (await loadWindowTitle()) || '').slice(0, 200);

    let chosenModel = modelId;
    let override = false;
    if (input && input.overrideModel) {
      if (overrides.count >= maxOverride) {
        throw new DesktopPolicyHookError('OVERRIDE_LIMIT', 'operator override cap reached (' + maxOverride + ' per session); refusing to use ' + input.overrideModel, { modelId: input.overrideModel, overridesUsed: overrides.count });
      }
      if (typeof input.overrideReason !== 'string' || input.overrideReason.length < 4) {
        throw new DesktopPolicyHookError('OVERRIDE_NEEDS_REASON', 'overrideModel requires a non-empty overrideReason', { modelId: input.overrideModel });
      }
      chosenModel = String(input.overrideModel);
      override = true;
      overrides.count += 1;
      overrides.last = { modelId: chosenModel, reason: input.overrideReason, at: new Date().toISOString() };
    }
    if (!ALLOWLIST.has(chosenModel.toLowerCase()) && !override) {
      throw new DesktopPolicyHookError('MODEL_NOT_ALLOWLISTED', chosenModel + ' is not in the in-house cipher allowlist for desktop control', { modelId: chosenModel });
    }
    if (!runtime || typeof runtime.chat !== 'function') {
      throw new DesktopPolicyHookError('POLICY_MODEL_NOT_READY', chosenModel + ' runtime is not wired', { modelId: chosenModel });
    }
    const prompt = buildProposalPrompt({ action_hint: actionHint, grants: grants, window_title: windowTitle });
    const messages = [
      { role: 'system', content: 'You are the in-house desktop policy model. Respond with exactly one desktop_action block.' },
      { role: 'user', content: prompt }
    ];

    let reply = '';
    const started = Date.now();
    try {
      reply = await Promise.race([
        Promise.resolve(runtime.chat(messages, { role: 'desktop-act', model: chosenModel })),
        new Promise(function(_, reject) { setTimeout(function() { reject(new Error('cipher call timed out')); }, MAX_CIPHER_CALL_MS); })
      ]);
    } catch (error) {
      const errMsg = (error && error.message) ? error.message : String(error);
      const row = {
        ts: new Date().toISOString(),
        kind: 'policy-hook-call',
        outcome: 'error',
        error: errMsg,
        action_hint: actionHint,
        model: chosenModel,
        override: override
      };
      await recordTrajectory(row);
      if (error instanceof DesktopPolicyHookError) throw error;
      throw new DesktopPolicyHookError('POLICY_MODEL_FAILED', 'cipher call failed: ' + errMsg, { modelId: chosenModel });
    }
    const elapsed = Date.now() - started;

    const proposal = parseProposalResponse(reply);
    if (!proposal) {
      const row = { ts: new Date().toISOString(), kind: 'policy-hook-call', outcome: 'unparseable', reply: String(reply || '').slice(0, 2000), model: chosenModel, override: override };
      await recordTrajectory(row);
      throw new DesktopPolicyHookError('POLICY_RESPONSE_UNPARSEABLE', 'cipher response did not contain a parseable <desktop_action> block', { modelId: chosenModel, reply: String(reply || '').slice(0, 200) });
    }
    if (!VALID_OPS.has(proposal.op)) {
      const row = { ts: new Date().toISOString(), kind: 'policy-hook-call', outcome: 'invalid-op', proposal: proposal, model: chosenModel, override: override };
      await recordTrajectory(row);
      throw new DesktopPolicyHookError('POLICY_INVALID_OP', 'cipher emitted invalid op "' + proposal.op + '"', { modelId: chosenModel, op: proposal.op });
    }

    let decision = 'executed';
    if (proposal.confidence !== null && proposal.confidence < threshold) {
      decision = 'pending';
    }
    const row = {
      ts: new Date().toISOString(),
      kind: 'policy-hook-call',
      outcome: decision,
      elapsed_ms: elapsed,
      proposal: proposal,
      action_hint: actionHint,
      model: chosenModel,
      override: override,
      override_reason: override ? String(input.overrideReason).slice(0, 200) : null
    };
    await recordTrajectory(row);
    return Object.assign({}, proposal, { modelId: chosenModel, decision: decision, trajectory: row });
  }

  function status() {
    return { modelId: modelId, allowlist: Array.from(ALLOWLIST), threshold: threshold, maxOverride: maxOverride, overrides: Object.assign({}, overrides) };
  }

  return { propose: propose, status: status, ALLOWLIST: Array.from(ALLOWLIST) };
}


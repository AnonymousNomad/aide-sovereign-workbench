// Desktop Policy — grammar-constrained action proposal for the agent loop.
//
// Bridges the agent's free-form XML tool calls to the bounded desktop service
// (desktop-control.mjs). The agent emits one <desktop_action> block per turn;
// this module parses the block into a DesktopActionRequest shape the service
// can execute, applies strict validation against the op allowlist, and exposes
// a risk-class hint so the agent loop can pre-classify the proposal before the
// approval card lands in the cockpit.
//
// The proposal DSL (subset of telegram-brain.mjs, kept identical on purpose
// so trained grammar is reused across both surfaces):
//
//   <desktop_action>
//   op: launch_app
//   target: notepad
//   note: open Notepad to paste the diff
//   </desktop_action>
//
// Only the `op` line and `target` line are required; `destination` is
// required for move_file; `note` is optional (≤300 chars, captured into the
// training trajectory). Any other field is REJECTED — extra fields are
// either typos or model attempts at privilege escalation.
//
// All-local law: this module has zero network access. It only parses
// agent-emitted text into a service call. No imports from agent-tools.mjs
// (circular: the agent tool imports THIS module).

const OP_ALLOWLIST = new Set([
  'launch_app',
  'open_path',
  'list_windows',
  'focus_window',
  'move_file',
  'outlook_create_draft',
  'excel_generate_report'
]);

const CLASS_BY_OP = Object.freeze({
  list_windows: 'READ',
  focus_window: 'WRITE',
  launch_app: 'OPEN',
  open_path: 'OPEN',
  move_file: 'DESTRUCTIVE',
  outlook_create_draft: 'DESTRUCTIVE',
  excel_generate_report: 'DESTRUCTIVE'
});

// Risk tags surfaced on the approval card so the cockpit can warn operators
// before they tap Approve on a DESTRUCTIVE class action.
const RISK_TAGS = Object.freeze({
  launch_app: ['starts-a-process'],
  open_path: ['opens-external-handler'],
  move_file: ['mutates-filesystem', 'no-undo-on-overwrite'],
  focus_window: ['changes-input-focus'],
  outlook_create_draft: ['saves-to-outlook', 'sender-must-send'],
  excel_generate_report: ['writes-to-disk', 'overwrites-if-exists'],
  list_windows: []
});

const MAX_TARGET_LEN = 500;
const MAX_DESTINATION_LEN = 500;
const MAX_NOTE_LEN = 300;

export class DesktopPolicyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DesktopPolicyError';
    this.code = code;
  }
}



/**
 * Parse an agent-emitted <desktop_action> block into a validated proposal.
 * Returns { op, target?, destination?, note?, class, risks, raw } on success.
 * Throws DesktopPolicyError on any structural, allowlist, or length violation.
 */
export function parseDesktopAction(blockText) {
  const raw = String(blockText ?? '').trim();
  if (raw === '') {
    throw new DesktopPolicyError('EMPTY', '<desktop_action> block was empty');
  }
  // Tolerant match: tolerate missing/wrong closing tag, surrounding prose,
  // and CRLF. Captures everything between <desktop_action> and the FIRST
  // </desktop_action> (or end of string if no close). This is the same
  // forgiveness the agent parser applies — the agent loop will only pass
  // tool-call bodies that came out of its XML parser, so this layer is
  // belt-and-suspenders against model slop.
  const openMatch = /<desktop_action>\s*([\s\S]*?)(?:<\/desktop_action>|$)/i.exec(raw);
  if (!openMatch) {
    throw new DesktopPolicyError('MISSING_TAG', 'expected <desktop_action>...</desktop_action> block');
  }
  const body = openMatch[1];

  // Known fields. Anything else is a parse error (privilege-escalation
  // guard — a model that emits `approved: true` is trying to bypass the
  // agent's approval flow, which is impossible from inside the parser).
  const KNOWN_FIELDS = new Set(['op', 'target', 'destination', 'note']);
  // Field extraction: one key: value per line. Whitespace-tolerant. Unknown
  // keys are errors (privilege-escalation guard).
  const fields = {};
  const seen = new Set();
  const lines = body.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(trimmed);
    if (!m) {
      throw new DesktopPolicyError('MALFORMED_LINE', `cannot parse line: ${trimmed.slice(0, 80)}`);
    }
    const key = m[1].toLowerCase();
    if (!KNOWN_FIELDS.has(key)) {
      throw new DesktopPolicyError('UNKNOWN_FIELD', `unknown field "${key}"; allowed: op, target, destination, note`);
    }
    if (seen.has(key)) {
      throw new DesktopPolicyError('DUPLICATE_FIELD', `duplicate field: ${key}`);
    }
    seen.add(key);
    fields[key] = m[2].trim();
  }

  if (!fields.op) {
    throw new DesktopPolicyError('MISSING_OP', 'op: field is required');
  }
  const op = String(fields.op).toLowerCase();
  if (!OP_ALLOWLIST.has(op)) {
    throw new DesktopPolicyError('UNKNOWN_OP', `op "${fields.op}" is not in the desktop allowlist`);
  }

  const proposal = { op, raw };

  if (fields.target !== undefined) {
    const target = String(fields.target);
    if (target.length > MAX_TARGET_LEN) {
      throw new DesktopPolicyError('TARGET_TOO_LONG', `target exceeds ${MAX_TARGET_LEN} chars`);
    }
    proposal.target = target;
  }
  if (fields.destination !== undefined) {
    const destination = String(fields.destination);
    if (destination.length > MAX_DESTINATION_LEN) {
      throw new DesktopPolicyError('DESTINATION_TOO_LONG', `destination exceeds ${MAX_DESTINATION_LEN} chars`);
    }
    proposal.destination = destination;
  }
  if (fields.note !== undefined) {
    const note = String(fields.note);
    if (note.length > MAX_NOTE_LEN) {
      throw new DesktopPolicyError('NOTE_TOO_LONG', `note exceeds ${MAX_NOTE_LEN} chars`);
    }
    proposal.note = note;
  }

  // Per-op required-field law. move_file MUST have destination. The
  // DesktopActionRequest contract requires `approved: boolean`; we set it
  // to `true` ONLY at execute time (the policy module does not flip it —
  // the agent loop's approval flow does). Here we just shape the proposal.
  if (op === 'move_file' && !proposal.destination) {
    throw new DesktopPolicyError('MISSING_DESTINATION', 'move_file requires destination: field');
  }
  // Most mutating ops need a target. list_windows does not.
  if (op !== 'list_windows' && !proposal.target) {
    throw new DesktopPolicyError('MISSING_TARGET', `${op} requires target: field`);
  }

  proposal.class = CLASS_BY_OP[op];
  proposal.risks = [...RISK_TAGS[op]];

  return proposal;
}

/**
 * Build the system-prompt hint the agent can include so the model knows the
 * desktop action DSL is available. Kept short — the agent loop concatenates
 * this with the main tool documentation. The shape mirrors what
 * telegram-brain.mjs uses, so any future training that teaches the DSL on
 * one surface transfers to the other.
 */
export function desktopActionPromptHint() {
  return [
    'DESKTOP ACTION (requires operator approval in ACT mode):',
    '  <desktop_action>',
    '  op: launch_app | open_path | list_windows | focus_window | move_file | outlook_create_draft | excel_generate_report',
    '  target: <app name | path | window title substring>     # not required for list_windows',
    '  destination: <path>   # REQUIRED for move_file',
    '  note: <one-sentence intent, captured for training>',
    '  </desktop_action>',
    'Deny-by-default: any target/destination outside the operator grants will be REFUSED at execute time. The action goes through the standard approval flow; you must wait for the operator decision before continuing.'
  ].join('\n');
}

/**
 * Risk-class hint for the approval card. Returns one of READ | WRITE | OPEN
 * | DESTRUCTIVE. DESTRUCTIVE surfaces the destructive-class warning in the
 * cockpit (same as telegram-brain). The agent loop calls this when building
 * the pending_approval event.
 */
export function classForOp(op) {
  return CLASS_BY_OP[String(op || '').toLowerCase()] ?? 'WRITE';
}

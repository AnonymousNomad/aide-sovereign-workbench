// Harness scaffold v2 — layered composer per aide-harness-prompt-scaffolding +
// credocore v1.1.0 (aide-credo-guardrail). Pure function of inputs: the same
// request always yields byte-identical output (train/serve consistency law).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HARNESS_VERSION = '2.1.0';
export const CREDO_VERSION = '1.1.0';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CREDOCORE_PATH = path.join(ROOT, 'common', 'harness', 'credocore.md');

const FORMAT_CONTRACT = [
  'Output discipline: when asked for code, emit complete runnable code or SEARCH/REPLACE blocks with full paths - never prose wrapped around code.',
  'Never invent APIs, flags, or files; match the project\'s existing conventions.',
  'Keep changes minimal and reviewable; state how to verify them (test/build command).'
];

const TASK_SOP = {
  coding: [
    'Task SOP (coding): restate the goal in one line before solving.',
    'Prefer the smallest change that satisfies the request.',
    'Check edge cases and failure paths before declaring done.',
    'If a gate fails: stop, surface honestly, fix the cause, rerun.'
  ],
  planning: [
    'Task SOP (planning): produce numbered steps with acceptance criteria per step.',
    'Name risks with mitigations; flag unknowns as unknowns - do not paper over them.',
    'Sequence work so each step is independently verifiable.'
  ],
  utility: [
    'Task SOP (utility): answer directly first, then add only load-bearing detail.',
    'Cite where each fact came from this session, or label it unverified.'
  ]
};

function parseCredocore() {
  const text = readFileSync(CREDOCORE_PATH, 'utf8');
  const sections = {};
  const headerRe = /^# PART ([A-B])( FULL| COMPACT)? — .*/gm;
  let match;
  const marks = [];
  while ((match = headerRe.exec(text)) !== null) {
    const key = `PART ${match[1]}${match[2] ? ' ' + match[2].trim() : ''}`;
    marks.push({ key, start: headerRe.lastIndex });
  }
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? text.indexOf(`# PART`, marks[i].start) : text.length;
    sections[marks[i].key] = text.slice(marks[i].start, end).trim();
  }
  return { sections, versionMatch: /credocore v([\d.]+)/.exec(text) };
}

let cache = null;
function credocore() {
  if (!cache) cache = parseCredocore();
  return cache;
}

function countInstructions(block) {
  return block.split('\n').filter(line => line.trim().length > 0 && !line.startsWith('#')).length;
}

export function composeScaffold({ effectiveContextTokens = 4096, taskFamily = 'coding' } = {}) {
  const { sections, versionMatch } = credocore();
  const strong = effectiveContextTokens >= 8192;
  const capLines = strong ? 150 : 24;
  const capBytes = strong ? 6144 : 640;

  // Effectiveness-battery result (2026-08-25, smollm2-360M): the compact
  // credo+rules layer scored NEGATIVE (-3/20) on sub-1B models — instruction
  // dilution is real (IFScale). Micro tier = 3-line operating layer only;
  // the full Code+Lens rendering is reserved for strong-budget models.
  if (!strong) {
    const micro = [
      'You are an expert software engineer working inside AIDE.',
      'Answer exactly what is asked - nothing else.',
      'When writing code: complete and runnable, no placeholders.'
    ];
    const system = `[AIDE harness ${HARNESS_VERSION} | tier:micro | ctx:${effectiveContextTokens}]\n${micro.join('\n')}`;
    return { system, tier: 'micro', bytes: Buffer.byteLength(system), version: HARNESS_VERSION, budget: { cap_lines: capLines, used_lines: 3, cap_bytes: capBytes, used_bytes: Buffer.byteLength(system) }, dropped: [] };
  }

  const A = sections['PART A'];
  const lensKey = 'PART B FULL';
  const sop = TASK_SOP[taskFamily] || TASK_SOP.coding;

  const dropped = [];
  let blocks = [
    { name: 'A', body: A },
    { name: 'FORMAT', body: FORMAT_CONTRACT.join('\n') },
    { name: lensKey, body: sections[lensKey] },
    { name: 'TASK_SOP', body: sop.join('\n') }
  ];

  const measure = bs => ({
    bytes: Buffer.byteLength(bs.map(b => b.body).join('\n')),
    lines: bs.reduce((sum, b) => sum + countInstructions(b.body), 0)
  });

  let m = measure(blocks);
  while ((m.bytes > capBytes || m.lines > capLines) && blocks.length > 1) {
    const victim = [...blocks].reverse().find(b => b.name !== 'A');
    dropped.push({ section: victim.name, reason: 'budget' });
    blocks = blocks.filter(b => b !== victim);
    m = measure(blocks);
  }

  const header = `[AIDE harness ${HARNESS_VERSION} | credo ${versionMatch ? versionMatch[1] : CREDO_VERSION} | tier:${strong ? 'full' : 'compact'} | ctx:${effectiveContextTokens}]`;
  const system = `${header}\n${blocks.map(b => b.body).join('\n\n')}`;

  return {
    system,
    tier: 'full',
    bytes: Buffer.byteLength(system),
    version: HARNESS_VERSION,
    budget: { cap_lines: capLines, used_lines: m.lines, cap_bytes: capBytes, used_bytes: m.bytes },
    dropped
  };
}

// L3.5 layer: live workspace context (open files, active file, git diff,
// terminal tail, diagnostics). Composed by the agent loop or by callers
// who want a model that sees the user's real working state. Cap: 4k
// chars (~1k tokens). The live context is dynamic per turn and never
// goes into the cached scaffold (which is byte-deterministic). Caller
// passes the string returned by context-gatherer.gatherWorkspaceContext().
export function injectLiveContext(systemPrompt, liveContextText) {
  if (!liveContextText) return systemPrompt;
  // Live context goes AFTER the static scaffold and BEFORE the first user
  // message. The chat route composes the order; this helper just stamps the
  // marker.
  return `${systemPrompt}\n\n${liveContextText}`;
}

export function injectScaffold(messages, scaffold) {
  const msgs = Array.isArray(messages) ? [...messages] : [];
  if (msgs.length > 0 && msgs[0]?.role === 'system') {
    msgs[0] = { ...msgs[0], content: `${scaffold.system}\n\n${String(msgs[0].content ?? '')}`.trim() };
  } else {
    msgs.unshift({ role: 'system', content: scaffold.system });
  }
  return msgs;
}

export function buildScaffold({ contextTokens = 4096, taskFamily = 'coding' } = {}) {
  const composed = composeScaffold({ effectiveContextTokens: contextTokens, taskFamily });
  return { system: composed.system, tier: composed.tier, bytes: composed.bytes, version: HARNESS_VERSION };
}

// Drift hook: compact PART-A-only reminder for long transcripts. Trigger
// threshold is decided by the caller (50% of served context is the default
// policy); this returns the deterministic reminder text.
export function composeDriftReminder() {
  const { sections } = credocore();
  return `[AIDE harness drift-check]\n${sections['PART A']}`;
}

export function estimateTokens(messages) {
  return (messages || []).reduce((sum, m) => sum + Math.ceil(String(m?.content || '').length / 4), 0);
}

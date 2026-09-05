// Skill envelope schema (v1) - the chassis's vocabulary for "what is a skill".
// Pure data: parses a SKILL.md frontmatter and body, validates the strict
// shape, and exposes the metadata the orchestrator fingerprints. This is
// capability 1 of the chassis plan (C1 of the 5-slice research).
//
// Hard rules (v1):
// - Frontmatter is required. The body is optional markdown.
// - Required fields: name, version, category, applies_to, tools_required, sop.
// - Optional fields: depends_on, incompatible_with, output_format,
//   input_template, examples, failure_modes, success_metrics,
//   deprecated_since, replaced_by, default_model_hint, timeout_ms.
// - name: lowercase letters, digits, hyphens; 1-64 chars; matches ^/[a-z0-9][a-z0-9-]{0,63}$/
// - version: strict semver MAJOR.MINOR.PATCH (no pre-release, no build metadata).
// - category: one of a fixed allowlist (see CATEGORIES).
// - applies_to: at least one non-empty string trigger.
// - tools_required: at least one tool name; each must be in the TOOLS allowlist.
// - sop: between 3 and 25 numbered instruction lines, or a freeform block between 20 and 600 chars.
// - body: max 6 KiB (6144 bytes UTF-8). Body is read but not interpreted here.
// - deprecated_since: a non-empty string. When set, replaced_by should also be set (warn if not).
// - replaced_by: a valid skill name if set.
//
// All errors are returned as { ok: false, error: '...', field: '...' } so the
// orchestrator can surface precise problems to the operator.

import { Buffer } from 'node:buffer';

export const SKILL_BODY_MAX_BYTES = 6 * 1024;
export const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const SKILL_VERSION_RE = /^[0-9]+\.[0-9]+\.[0-9]+$/;

// v1 tool allowlist - matches the tools the agent loop already exposes
// (harness/agent-loop.mjs TOOL_SCHEMAS). New tools must be added to BOTH
// the agent loop and this allowlist.
export const TOOLS = Object.freeze([
  'read_file',
  'write_file',
  'bash',
  'search',
  'git_diff',
  'list'
]);

// v1 category allowlist - aligned with the existing 14 categories in
// skills/registry.json plus a few additions for the chassis.
export const CATEGORIES = Object.freeze([
  'general',
  'discipline',
  'academy',
  'aide-core',
  'architecture',
  'aide-ops',
  'build-series',
  'cloud-handoff',
  'parity',
  'phase-legacy',
  'training-ecosystem',
  'training-pipeline',
  'post-training',
  'web-builder',
  'review',
  'debug',
  'test',
  'refactor',
  'document',
  'search',
  'release',
  'security',
  'performance'
]);

const FRONTMATTER_RE = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/;

function parseFrontmatter(raw) {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) return { ok: false, error: 'frontmatter missing (file must start with --- ... ---)', field: 'frontmatter', errors: [] };
  const block = match[1];
  // Minimal YAML-ish parser. Supports:
  // - simple key: value
  // - block scalars (key: | or key: >): value is the next indented block
  // - flow lists (key: [a, b, c]) and block lists (key:\n  - a\n  - b)
  // - multi-line map items inside a block list (  key: value inside - a)
  const lines = block.split(/\r?\n/);
  const map = {};
  let currentListKey = null;
  let blockScalarKey = null;
  let blockScalarIndent = null;
  let blockScalarValue = '';
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '') {
      if (blockScalarKey) blockScalarValue += '\n';
      else if (currentListKey) continue;
      continue;
    }
    // Block-scalar continuation
    if (blockScalarKey) {
      const indent = line.match(/^(\s*)/)[1].length;
      if (blockScalarIndent === null) {
        blockScalarIndent = indent;
        blockScalarValue = line.slice(indent);
        continue;
      }
      if (indent >= blockScalarIndent) {
        blockScalarValue += '\n' + line.slice(blockScalarIndent);
        continue;
      }
      map[blockScalarKey] = blockScalarValue.replace(/^\n/, '');
      blockScalarKey = null;
      blockScalarIndent = null;
      blockScalarValue = '';
    }
    // List continuation: a line starting with "  - " (or "\t- ")
    if (line.startsWith('  - ') || line.startsWith('\t- ')) {
      if (!currentListKey) return { ok: false, error: `list item without key at: ${line}`, field: 'frontmatter', errors: [] };
      if (!Array.isArray(map[currentListKey])) map[currentListKey] = [];
      const itemContent = line.replace(/^\s*-\s+/, '');
      // If the item is a "key: value" pair, parse as a map so subsequent
      // continuation lines can add more fields to the same object.
      const colon = itemContent.indexOf(':');
      if (colon > 0) {
        const k = itemContent.slice(0, colon).trim();
        const v = itemContent.slice(colon + 1).trim();
        map[currentListKey].push({ [k]: parseValue(v) });
      } else {
        map[currentListKey].push(parseValue(itemContent));
      }
      continue;
    }
    // Continuation of a list item as a map: "  key: value" (indented at or
    // past 2 spaces, but NOT starting with "  - ").
    if (currentListKey && /^\s{2,}\S/.test(line) && !line.startsWith('  - ') && !line.startsWith('\t- ')) {
      const last = map[currentListKey][map[currentListKey].length - 1];
      if (last && typeof last === 'object' && !Array.isArray(last)) {
        const colon = line.indexOf(':');
        if (colon < 0) return { ok: false, error: `expected "key: value" in list map at: ${line}`, field: 'frontmatter', errors: [] };
        const k = line.slice(0, colon).trim();
        const v = line.slice(colon + 1).trim();
        last[k] = v;
        continue;
      }
    }
    // New key
    const colon = line.indexOf(':');
    if (colon < 0) return { ok: false, error: `expected "key: value" at: ${line}`, field: 'frontmatter', errors: [] };
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (value === '|' || value === '>') {
      blockScalarKey = key;
      blockScalarIndent = null;
      blockScalarValue = '';
      currentListKey = null;
      continue;
    }
    if (value === '') {
      // start of a block list (key:\n  - a\n  - b)
      currentListKey = key;
      map[key] = [];
      continue;
    }
    currentListKey = null;
    map[key] = parseValue(value);
  }
  if (blockScalarKey) map[blockScalarKey] = blockScalarValue.replace(/^\n/, '');
  return { ok: true, map, errors: [] };
}

function parseValue(value) {
  if (value === '') return [];
  // Flow list: [a, b, c]
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    if (inner === '') return [];
    return inner.split(',').map(s => s.trim());
  }
  return value;
}

function isNonEmptyString(v) { return typeof v === 'string' && v.length > 0; }
function isStringArray(v) { return Array.isArray(v) && v.every(x => isNonEmptyString(x)); }

function validate(map, declaredName) {
  const errors = [];
  const required = ['name', 'version', 'category', 'applies_to', 'tools_required', 'sop'];
  for (const key of required) {
    if (map[key] === undefined) errors.push({ field: key, error: 'required field missing' });
  }
  if (map.name !== undefined) {
    if (typeof map.name !== 'string' || !SKILL_NAME_RE.test(map.name)) errors.push({ field: 'name', error: 'name must match /^[a-z0-9][a-z0-9-]{0,63}$/' });
    if (declaredName !== undefined && map.name !== declaredName) errors.push({ field: 'name', error: `frontmatter name "${map.name}" does not match directory name "${declaredName}"` });
  }
  if (map.version !== undefined) {
    if (typeof map.version !== 'string' || !SKILL_VERSION_RE.test(map.version)) errors.push({ field: 'version', error: 'version must be strict semver MAJOR.MINOR.PATCH' });
  }
  if (map.category !== undefined) {
    if (typeof map.category !== 'string' || !CATEGORIES.includes(map.category)) errors.push({ field: 'category', error: `category must be one of: ${CATEGORIES.join(', ')}` });
  }
  if (map.applies_to !== undefined && !isStringArray(map.applies_to)) {
    errors.push({ field: 'applies_to', error: 'applies_to must be a non-empty array of strings' });
  } else if (Array.isArray(map.applies_to) && map.applies_to.length < 1) {
    errors.push({ field: 'applies_to', error: 'applies_to must have at least one trigger' });
  }
  if (map.tools_required !== undefined) {
    if (!isStringArray(map.tools_required)) errors.push({ field: 'tools_required', error: 'tools_required must be a non-empty array of strings' });
    else if (!map.tools_required.every(t => TOOLS.includes(t))) errors.push({ field: 'tools_required', error: `every tool must be in: ${TOOLS.join(', ')}` });
    else if (map.tools_required.length < 1) errors.push({ field: 'tools_required', error: 'tools_required must have at least one tool' });
  }
  if (map.depends_on !== undefined && !isStringArray(map.depends_on)) {
    errors.push({ field: 'depends_on', error: 'depends_on must be an array of strings' });
  }
  if (map.incompatible_with !== undefined && !isStringArray(map.incompatible_with)) {
    errors.push({ field: 'incompatible_with', error: 'incompatible_with must be an array of strings' });
  }
  if (map.examples !== undefined && !Array.isArray(map.examples)) {
    errors.push({ field: 'examples', error: 'examples must be an array' });
  } else if (Array.isArray(map.examples)) {
    for (let i = 0; i < map.examples.length; i += 1) {
      const ex = map.examples[i];
      if (!ex || typeof ex !== 'object') { errors.push({ field: `examples[${i}]`, error: 'each example must be an object' }); continue; }
      if (typeof ex.input !== 'string') errors.push({ field: `examples[${i}].input`, error: 'input must be a string' });
      if (typeof ex.output !== 'string') errors.push({ field: `examples[${i}].output`, error: 'output must be a string' });
    }
  }
  if (map.failure_modes !== undefined) {
    if (!Array.isArray(map.failure_modes)) errors.push({ field: 'failure_modes', error: 'failure_modes must be an array' });
    else for (let i = 0; i < map.failure_modes.length; i += 1) {
      const fm = map.failure_modes[i];
      if (!fm || typeof fm !== 'object') errors.push({ field: `failure_modes[${i}]`, error: 'each failure_mode must be an object' });
      else if (typeof fm.condition !== 'string' || typeof fm.recovery !== 'string') errors.push({ field: `failure_modes[${i}]`, error: 'each failure_mode needs {condition:string, recovery:string}' });
    }
  }
  if (map.sop !== undefined) {
    if (typeof map.sop !== 'string' || map.sop.length < 20 || map.sop.length > 600) {
      errors.push({ field: 'sop', error: 'sop must be a string between 20 and 600 characters' });
    }
  }
  if (map.deprecated_since !== undefined && !isNonEmptyString(map.deprecated_since)) {
    errors.push({ field: 'deprecated_since', error: 'deprecated_since must be a non-empty string when set' });
  }
  if (map.replaced_by !== undefined) {
    if (!isNonEmptyString(map.replaced_by)) errors.push({ field: 'replaced_by', error: 'replaced_by must be a non-empty string' });
    else if (!SKILL_NAME_RE.test(map.replaced_by)) errors.push({ field: 'replaced_by', error: 'replaced_by must match the skill name pattern' });
  }
  if (map.deprecated_since && !map.replaced_by) {
    errors.push({ field: 'replaced_by', error: 'deprecated_since is set but replaced_by is missing' });
  }
  if (map.timeout_ms !== undefined) {
    const n = Number(map.timeout_ms);
    if (!Number.isInteger(n) || n < 100 || n > 600_000) {
      errors.push({ field: 'timeout_ms', error: 'timeout_ms must be an integer between 100 and 600000' });
    } else {
      map.timeout_ms = n;
    }
  }
  return errors;
}

function extractBody(raw) {
  const m = FRONTMATTER_RE.exec(raw);
  if (!m) return { ok: false, error: 'frontmatter missing' };
  const body = raw.slice(m[0].length);
  const bytes = Buffer.byteLength(body, 'utf8');
  if (bytes > SKILL_BODY_MAX_BYTES) {
    return { ok: false, error: `body is ${bytes} bytes, max is ${SKILL_BODY_MAX_BYTES}` };
  }
  return { ok: true, body };
}

export function parseSkill({ raw, declaredName } = {}) {
  if (typeof raw !== 'string') return { ok: false, error: 'raw must be a string', field: 'input', errors: [] };
  const fm = parseFrontmatter(raw);
  if (!fm.ok) return fm;
  const errors = validate(fm.map, declaredName);
  if (errors.length) return { ok: false, error: errors.map(e => `${e.field}: ${e.error}`).join('; '), field: errors[0].field, errors };
  const body = extractBody(raw);
  if (!body.ok) return body;
  return {
    ok: true,
    name: fm.map.name,
    version: fm.map.version,
    category: fm.map.category,
    appliesTo: fm.map.applies_to,
    toolsRequired: fm.map.tools_required,
    dependsOn: fm.map.depends_on || [],
    incompatibleWith: fm.map.incompatible_with || [],
    outputFormat: fm.map.output_format || null,
    inputTemplate: fm.map.input_template || null,
    sop: fm.map.sop,
    examples: fm.map.examples || [],
    failureModes: fm.map.failure_modes || [],
    successMetrics: fm.map.success_metrics || null,
    deprecatedSince: fm.map.deprecated_since || null,
    replacedBy: fm.map.replaced_by || null,
    defaultModelHint: fm.map.default_model_hint || null,
    timeoutMs: fm.map.timeout_ms || null,
    body: body.body,
    fingerprint: computeFingerprint(fm.map),
    errors: []
  };
}

export function computeFingerprint(map) {
  // Stable, deterministic, short. Used by the orchestrator + Helix.
  // Includes only routing-relevant fields; not the body (which is large
  // and changes per revision).
  const parts = [
    String(map.name || ''),
    String(map.version || ''),
    String(map.category || ''),
    Array.isArray(map.applies_to) ? map.applies_to.slice().sort().join('|') : '',
    Array.isArray(map.tools_required) ? map.tools_required.slice().sort().join('|') : '',
    String(map.sop || '')
  ];
  return parts.join('::');
}

export function skillFingerprintString(parsed) {
  return parsed.fingerprint || computeFingerprint(parsed);
}

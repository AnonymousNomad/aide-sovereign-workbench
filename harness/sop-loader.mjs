// SOP loader (v1) - reads Standard Operating Procedures from `sops/*.md`.
// Used by the orchestrator (slice C3+C4) to inject L0 universal laws
// into every WorkflowBundle. Pure I/O + cache + parse, no LLM.
//
// SOP file format: YAML frontmatter + body. Required frontmatter fields
// match the chassis v1 envelope: name, version, category, applies_to,
// tools_required, sop. The body is a long-form explanation, surfaced to
// the operator in the bundle card.
//
// All chassis layers consume SOPs through this loader. The orchestrator
// composes L0 (the SOP body) into the system prompt. The Helix retriever
// (slice C5) filters SOPs by `applies_to` to pre-load relevant examples.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseSkill } from './skill-schema.mjs';

const SOP_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

function pathInside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function defaultRoots(workspace) {
  const project = path.resolve(workspace || process.cwd());
  return [...new Set([
    path.join(project, 'sops'),
    path.join(project, '.aide', 'sops'),
    path.resolve(project, 'harness', 'sops'),
    path.resolve(project, 'docs', 'sops')
  ].filter(Boolean).map(root => path.resolve(root)))];
}

export function createSopLoader({ workspace = process.cwd(), roots } = {}) {
  const sopRoots = roots || defaultRoots(workspace);
  const cache = new Map();
  const errors = [];

  function readSopFile(sopName) {
    if (!SOP_NAME_RE.test(sopName)) return { ok: false, error: `invalid sop name: ${sopName}`, errors: [] };
    if (cache.has(sopName)) return cache.get(sopName);
    for (const root of sopRoots) {
      const sopPath = path.join(root, `${sopName}.md`);
      if (!pathInside(root, sopPath)) continue;
      if (!existsSync(sopPath)) continue;
      let stat;
      try { stat = statSync(sopPath); } catch { continue; }
      if (!stat.isFile()) continue;
      let raw;
      try { raw = readFileSync(sopPath, 'utf8'); } catch { continue; }
      const parsed = parseSkill({ raw, declaredName: sopName });
      if (!parsed.ok) {
        const result = { ok: false, error: parsed.error, field: parsed.field, errors: parsed.errors || [], path: sopPath };
        cache.set(sopName, result);
        errors.push({ sop: sopName, path: sopPath, error: parsed.error, field: parsed.field });
        return result;
      }
      const enriched = { ...parsed, path: sopPath, root, kind: 'sop' };
      cache.set(sopName, enriched);
      return enriched;
    }
    return { ok: false, error: `sop not found: ${sopName}`, errors: [], searched: sopRoots.map(r => path.join(r, `${sopName}.md`)) };
  }

  function listAvailable() {
    const found = new Set();
    for (const root of sopRoots) {
      if (!existsSync(root)) continue;
      let entries;
      try { entries = readdirSync(root, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (e.isFile() && e.name.endsWith('.md')) {
          const base = e.name.replace(/\.md$/, '');
          if (SOP_NAME_RE.test(base)) found.add(base);
        }
      }
    }
    return [...found];
  }

  function clearCache() { cache.clear(); }

  return { readSopFile, listAvailable, clearCache, roots: sopRoots, getErrors: () => errors.slice() };
}

export { SOP_NAME_RE };


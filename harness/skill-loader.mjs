// Skill loader (v1) - reads a skill from a directory and returns the parsed
// envelope + body. Used by the orchestrator (slice C3) and the Helix
// retriever (slice C5). Pure I/O + cache, no LLM.
//
// The loader is intentionally narrow: parse the file, validate the envelope,
// cap the body, cache the parsed result. Routing decisions live in
// harness/orchestrator.mjs (slice C3); close-match decisions live in
// harness/helix-retrieval.mjs (slice C5). This file is just I/O.
//
// Skill directory layout:
//   <root>/<skill-name>/SKILL.md
// where <root> is one of:
//   - <workspace>/skills/packs/         (project-local packs)
//   - <workspace>/.agents/skills/        (AGENTS.md convention)
//   - <workspace>/.github/skills/        (GitHub convention)
//   - <workspace>/.claude/skills/        (Claude Code convention)
//   - <workspace>/.cursor/skills/        (Cursor convention)
//   - <workspace>/.codex/skills/         (Codex convention)
//   - $AIDE_SKILLS_ROOT                   (user override)
//   - <home>/.agents/skills/              (user home)

import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseSkill, SKILL_BODY_MAX_BYTES } from './skill-schema.mjs';

const DEFAULT_MAX_TOTAL_BYTES = 60 * 1024;
const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

function pathInside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function defaultRoots(workspace) {
  const project = path.resolve(workspace || process.cwd());
  const userRoots = process.env.AIDE_SKILLS_ROOT ? [process.env.AIDE_SKILLS_ROOT] : [path.join(os.homedir(), '.agents', 'skills')];
  return [...new Set([
    path.join(project, 'skills', 'packs'),
    path.join(project, '.agents', 'skills'),
    path.join(project, '.github', 'skills'),
    path.join(project, '.claude', 'skills'),
    path.join(project, '.cursor', 'skills'),
    path.join(project, '.codex', 'skills'),
    ...userRoots
  ].filter(Boolean).map(root => path.resolve(root)))];
}

export function createSkillLoader({ workspace = process.cwd(), roots } = {}) {
  const skillRoots = roots || defaultRoots(workspace);
  const cache = new Map();  // absolute path -> parsed skill (or {ok:false,...})
  const errors = [];        // collected parse errors for the operator UI

  function readSkillFile(skillDir) {
    if (!SKILL_NAME_RE.test(skillDir)) return { ok: false, error: `invalid skill name: ${skillDir}`, errors: [] };
    if (cache.has(skillDir)) return cache.get(skillDir);
    for (const root of skillRoots) {
      const skillPath = path.join(root, skillDir, 'SKILL.md');
      if (!pathInside(root, skillPath)) continue;
      if (!existsSync(skillPath)) continue;
      let stat;
      try { stat = statSync(skillPath); } catch { continue; }
      if (!stat.isFile()) continue;
      let raw;
      try { raw = readFileSync(skillPath, 'utf8'); } catch { continue; }
      const parsed = parseSkill({ raw, declaredName: skillDir });
      if (!parsed.ok) {
        const result = { ok: false, error: parsed.error, field: parsed.field, errors: parsed.errors || [], path: skillPath };
        cache.set(skillDir, result);
        errors.push({ skill: skillDir, path: skillPath, error: parsed.error, field: parsed.field });
        return result;
      }
      // Stable reference for cache hits.
      const enriched = { ...parsed, path: skillPath, root };
      cache.set(skillDir, enriched);
      return enriched;
    }
    return { ok: false, error: `skill not found: ${skillDir}`, errors: [], searched: skillRoots.map(r => path.join(r, skillDir, 'SKILL.md')) };
  }

  function listAvailable() {
    const found = new Set();
    for (const root of skillRoots) {
      if (!existsSync(root)) continue;
      let entries;
      try { entries = readdirSync(root, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (e.isDirectory() && SKILL_NAME_RE.test(e.name)) found.add(e.name);
      }
    }
    return [...found];
  }

  function clearCache() { cache.clear(); }

  return { readSkillFile, listAvailable, clearCache, roots: skillRoots, getErrors: () => errors.slice() };
}

export { SKILL_BODY_MAX_BYTES, DEFAULT_MAX_TOTAL_BYTES };

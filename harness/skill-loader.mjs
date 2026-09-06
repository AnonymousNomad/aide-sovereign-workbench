import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseSkill } from './skill-schema.mjs';

const DEFAULT_MAX_TOTAL_BYTES = 60 * 1024;
const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

function pathInside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function defaultRoots(workspace) {
  const project = path.resolve(workspace || process.cwd());
  // Chassis v1 layout: <workspace>/skills/<name>/SKILL.md (each skill is its
  // own directory). Legacy layout: <workspace>/skills/packs/<name>/SKILL.md
  // (kept for backwards compat with the 182-skill registry.json catalog).
  // The loader walks both; each subdir with a SKILL.md inside is a skill.
  const userRoots = process.env.AIDE_SKILLS_ROOT ? [process.env.AIDE_SKILLS_ROOT] : [path.join(os.homedir(), '.agents', 'skills')];
  return [...new Set([
    path.join(project, 'skills'),
    path.join(project, 'skills', 'packs'),
    path.join(project, '.aide', 'skills'),
    path.resolve(project, 'harness', 'skills'),
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
  const cache = new Map();
  const errors = [];

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
      const enriched = { ...parsed, path: skillPath, root, kind: 'skill' };
      cache.set(skillDir, enriched);
      return enriched;
    }
    return { ok: false, error: `skill not found: ${skillDir}`, errors: [], searched: skillRoots.flatMap(r => [`${r}/${skillDir}/SKILL.md`]) };
  }

  function listAvailable() {
    const found = new Set();
    for (const root of skillRoots) {
      if (!existsSync(root)) continue;
      let entries;
      try { entries = readdirSync(root, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (e.isDirectory() && SKILL_NAME_RE.test(e.name)) {
          // Confirm SKILL.md exists inside (skip empty directories).
          const skillFile = path.join(root, e.name, 'SKILL.md');
          if (existsSync(skillFile)) found.add(e.name);
        }
      }
    }
    return [...found];
  }

  function clearCache() { cache.clear(); }

  return { readSkillFile, listAvailable, clearCache, roots: skillRoots, getErrors: () => errors.slice() };
}

export { SKILL_NAME_RE, DEFAULT_MAX_TOTAL_BYTES };

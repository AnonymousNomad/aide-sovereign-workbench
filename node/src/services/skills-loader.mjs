// Deterministic skill SOP injector (Mission 1, item 9).
// Reads skills/registry.json, scores each skill against the task
// with a case-insensitive token overlap, keeps top entries above
// MIN_SCORE, and emits a bounded excerpt of each SKILL.md.
// No model involvement; no network.
import { promises as fs } from 'node:fs';
import path from 'node:path';

const MIN_SCORE = 3;
const MAX_SKILLS = 3;
const MAX_EXCERPT = 1200;

export async function createSkillsLoader({ skillsRoot }) {
  const registryPath = path.join(skillsRoot, 'skills', 'registry.json');
  let skills = [];
  let registryError = null;
  try {
    const raw = await fs.readFile(registryPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.skills) || parsed.skills.some(s => !s || typeof s.path !== 'string')) {
      throw new Error('invalid skills registry');
    }
    skills = parsed.skills;
  } catch (error) {
    // Defer the failure to context assembly, so health/status remain usable.
    registryError = new Error(`skill registry failed: ${error.message}`);
  }

  return async function loadSkills(task) {
    if (registryError) throw registryError;
    if (!task || typeof task !== 'string') return '';
    const lower = task.toLowerCase();
    const tokens = new Set(lower.match(/[a-z0-9_/-]{3,}/g) || []);
    const scored = skills.map(skill => {
      const text = `${skill.title ?? ''} ${skill.description ?? ''} ${skill.category ?? ''}`.toLowerCase();
      const textTokens = new Set(text.match(/[a-z0-9_/-]{3,}/g) || []);
      let score = 0;
      for (const t of tokens) if (textTokens.has(t)) score++;
      for (const t of textTokens) if (tokens.has(t)) score += 0.5;
      return { ...skill, score };
    });
    const picked = scored
      .filter(s => s.score >= MIN_SCORE)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_SKILLS);
    const excerpts = await Promise.all(picked.map(async skill => {
      const skillPath = path.join(skillsRoot, skill.path);
      const raw = await fs.readFile(skillPath, 'utf8');
      if (!raw.trim()) throw new Error(`selected skill is empty: ${skill.path}`);
      return String(raw).slice(0, MAX_EXCERPT);
    }));
    return excerpts.filter(Boolean).join('\n\n--- SKILL BOUNDARY ---\n\n');
  };
}

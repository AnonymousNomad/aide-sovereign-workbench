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
  try {
    const raw = await fs.readFile(registryPath, 'utf8');
    const parsed = JSON.parse(raw);
    skills = Array.isArray(parsed?.skills) ? parsed.skills : [];
  } catch {
    // Registry absent or malformed: the model runs with no extra
    // SOP context. Fail-closed, not fatal.
    skills = [];
  }

  return async function loadSkills(task) {
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
      try {
        const raw = await fs.readFile(skillPath, 'utf8');
        return String(raw).slice(0, MAX_EXCERPT);
      } catch {
        return '';
      }
    }));
    return excerpts.filter(Boolean).join('\n\n--- SKILL BOUNDARY ---\n\n');
  };
}

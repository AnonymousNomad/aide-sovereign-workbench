import { promises as fs } from 'node:fs';
import path from 'node:path';

const DAY_MS = 24 * 60 * 60 * 1000;

export class LearnerState {
  constructor({ statePath }) {
    this.statePath = statePath;
    this.state = null;
  }

  async load() {
    await fs.mkdir(path.dirname(this.statePath), { recursive: true });
    let raw;
    try {
      raw = await fs.readFile(this.statePath, 'utf8');
    } catch {
      this.state = this.#empty();
      return this.snapshot();
    }
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.schema_version !== 1 || typeof parsed.skills !== 'object') throw new Error('bad shape');
      this.state = parsed;
    } catch {
      await fs.rename(this.statePath, `${this.statePath}.bak`).catch(() => {});
      this.state = this.#empty();
    }
    return this.snapshot();
  }

  #empty() {
    return { schema_version: 1, updated_at: null, skills: {}, attempts: [] };
  }

  snapshot() {
    return JSON.parse(JSON.stringify(this.state));
  }

  skill(skillId) {
    return this.state.skills[skillId] ?? null;
  }

  async recordAttempt(skillId, { passed, misconceptionTags = [], at = new Date().toISOString() }) {
    if (typeof passed !== 'boolean') throw new Error('passed must be a boolean');
    const entry = this.state.skills[skillId] ?? { mastery: 0.5, attempts: 0, passes: 0, streak: 0, ease: 2.5, interval_days: 0, due_at: at, misconceptions: {} };
    const k = passed ? 0.3 : 0.5;
    entry.mastery = Math.min(1, Math.max(0, entry.mastery + k * ((passed ? 1 : 0) - entry.mastery)));
    entry.attempts += 1;
    if (passed) entry.passes += 1;
    for (const tag of misconceptionTags) {
      if (typeof tag !== 'string' || tag.length === 0 || tag.length > 64) continue;
      entry.misconceptions[tag] = (entry.misconceptions[tag] ?? 0) + 1;
    }
    if (passed) {
      entry.streak += 1;
      entry.ease = Math.min(3.0, entry.ease + 0.1);
      entry.interval_days = entry.streak === 1 ? 1 : entry.streak === 2 ? 3 : Math.round(entry.interval_days * entry.ease);
    } else {
      entry.streak = 0;
      entry.ease = Math.max(1.3, entry.ease - 0.2);
      entry.interval_days = 1;
    }
    entry.due_at = new Date(new Date(at).getTime() + entry.interval_days * DAY_MS).toISOString();
    this.state.skills[skillId] = entry;
    this.state.attempts.push({ skillId, passed, misconceptionTags, at });
    if (this.state.attempts.length > 5000) this.state.attempts = this.state.attempts.slice(-5000);
    this.state.updated_at = new Date().toISOString();
    await this.#save();
    return { skillId, ...entry };
  }

  dueReviews(now = new Date().toISOString()) {
    const t = new Date(now).getTime();
    return Object.entries(this.state.skills)
      .filter(([, e]) => new Date(e.due_at).getTime() <= t)
      .sort((a, b) => new Date(a[1].due_at) - new Date(b[1].due_at))
      .map(([id, e]) => ({ skillId: id, mastery: e.mastery, due_at: e.due_at }));
  }

  async seedFromProgress(progressPath, courseSkillMap) {
    const progress = JSON.parse(await fs.readFile(progressPath, 'utf8'));
    let seeded = 0;
    for (const [courseId, info] of Object.entries(progress)) {
      const completed = Array.isArray(info.completed) ? info.completed : [];
      for (const lessonId of completed) {
        const skillId = courseSkillMap?.[`${courseId}:${lessonId}`] ?? `${courseId}:${lessonId}`;
        const entry = this.state.skills[skillId] ?? { mastery: 0.5, attempts: 0, passes: 0, streak: 0, ease: 2.5, interval_days: 0, due_at: new Date().toISOString(), misconceptions: {} };
        entry.mastery = Math.min(1, entry.mastery + 0.15);
        entry.attempts += 1;
        entry.passes += 1;
        entry.streak += 1;
        this.state.skills[skillId] = entry;
        seeded += 1;
      }
    }
    this.state.updated_at = new Date().toISOString();
    await this.#save();
    return seeded;
  }

  async #save() {
    const temp = `${this.statePath}.tmp`;
    await fs.writeFile(temp, JSON.stringify(this.state, null, 2));
    await fs.rename(temp, this.statePath);
  }
}

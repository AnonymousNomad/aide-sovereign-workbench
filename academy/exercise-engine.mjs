import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export class ExerciseEngine {
  constructor({ exercisesDir, learnerState = null, pythonPath = process.env.AIDE_PYTHON || '' }) {
    this.exercisesDir = exercisesDir;
    this.learnerState = learnerState;
    this.pythonPath = pythonPath;
    this.exercises = [];
  }

  async load() {
    const files = await fs.readdir(this.exercisesDir).catch(() => []);
    const banks = await Promise.all(files.filter(file => file.endsWith('.json')).map(async file =>
      JSON.parse(await fs.readFile(path.join(this.exercisesDir, file), 'utf8'))
    ));
    const seen = new Set();
    this.exercises = banks.flatMap(bank => Array.isArray(bank.exercises) ? bank.exercises : []).filter(exercise => {
      if (seen.has(exercise.id)) return false;
      if (!ExerciseEngine.isValid(exercise)) return false;
      seen.add(exercise.id);
      return true;
    });
    return this.exercises.length;
  }

  static isValid(exercise) {
    return (
      typeof exercise?.id === 'string' && exercise.id.length > 0 && exercise.id.length <= 128 &&
      typeof exercise?.skill_id === 'string' && exercise.skill_id.length > 0 &&
      typeof exercise?.prompt === 'string' && exercise.prompt.length > 0 &&
      typeof exercise?.snippet === 'string' && exercise.snippet.length > 0 &&
      /^[\x20-\x7E]{1,200}$/.test(exercise.snippet) &&
      typeof exercise?.explanation === 'string'
    );
  }

  list() {
    return this.exercises.map(({ answer, explanation, snippet, ...rest }) => rest);
  }

  get(id) {
    const found = this.exercises.find(exercise => exercise.id === id);
    if (!found) return null;
    const { answer, explanation, snippet, ...publicPart } = found;
    return publicPart;
  }

  async #truth(snippet) {
    const payload = `print(${snippet})`;
    const candidates = [
      ...(this.pythonPath ? [{ command: this.pythonPath, prefix: [] }] : []),
      ...(process.platform === 'win32' ? [{ command: 'py', prefix: ['-3'] }] : []),
      { command: 'python3', prefix: [] },
      { command: 'python', prefix: [] }
    ];
    let lastError = null;
    for (const candidate of candidates) {
      try {
        const output = await run(candidate.command, [...candidate.prefix, '-c', payload], { timeout: 15000, maxBuffer: 65536 });
        return output.stdout.replace(/\r/g, '');
      } catch (error) {
        lastError = error;
        const unavailable = error.code === 'ENOENT' || error.code === 9009 || String(error.stderr || '').includes('Python was not found');
        if (!unavailable) throw error;
      }
    }
    throw lastError ?? new Error('no usable Python interpreter found');
  }

  async attempt(id, submission) {
    const exercise = this.exercises.find(item => item.id === id);
    if (!exercise) return { error: 'NOT_FOUND' };
    if (typeof submission !== 'string') return { error: 'BAD_REQUEST' };
    let truth;
    try {
      truth = await this.#truth(exercise.snippet);
    } catch (error) {
      return { error: 'VERIFY_UNAVAILABLE', message: String(error?.message || error) };
    }
    const passed = truth.trim() === submission.trim() && submission.trim().length > 0;
    if (this.learnerState) {
      try {
        await this.learnerState.recordAttempt(exercise.skill_id, {
          passed,
          misconceptionTags: passed ? [] : ['output-mismatch']
        });
      } catch (error) {
        this.lastLearnerHookError = String(error?.message || error);
      }
    }
    return passed
      ? { passed: true, revealed: null }
      : { passed: false, revealed: { answer: truth.trim(), explanation: exercise.explanation ?? '' } };
  }

  next(nowIso) {
    const pool = [...this.exercises].sort((a, b) => a.id.localeCompare(b.id));
    if (pool.length === 0) return null;
    const state = this.learnerState?.snapshot?.() ?? null;
    if (!state) return pool[0].id;
    const due = new Set(this.learnerState.dueReviews(nowIso).map(entry => entry.skillId));
    const scored = pool.map(exercise => {
      const skill = state.skills[exercise.skill_id] ?? null;
      return {
        id: exercise.id,
        due: due.has(exercise.skill_id) ? 0 : 1,
        mastery: skill ? skill.mastery : 0,
        attempts: skill ? skill.attempts : 0
      };
    });
    scored.sort((a, b) => a.due - b.due || a.mastery - b.mastery || a.attempts - b.attempts || a.id.localeCompare(b.id));
    return scored[0]?.id ?? pool[0].id;
  }
}

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { resolveProblemMatcher, MatcherError } from '../node/src/services/problem-matchers.mjs';
import { parseProblems } from '../node/src/services/problem-parser.mjs';

const PROGRAMS = new Set(['node', 'npm', 'npx', 'git', 'python', 'python3', 'cargo', 'rustc']);
const MAX_BUFFER_LINES = 5000;
const SEVERITY_LEVELS = { error: 1, warning: 2, info: 3 };

export class TaskManager {
  constructor({ manifestPath, workspace }) {
    this.manifestPath = manifestPath; this.workspace = workspace; this.tasks = []; this.active = null; this.last = { status: 'idle' };
    this.problems = new Map();
  }
  async load() {
    const manifest = JSON.parse(await fs.readFile(this.manifestPath, 'utf8').catch(() => '{"tasks":[]}'));
    this.tasks = (manifest.tasks || []).filter(task => task.id && PROGRAMS.has(task.program) && Array.isArray(task.args));
    return this.list();
  }
  list() { return this.tasks.map(({ id, label, program, args }) => ({ id, label, program, args, running: this.active?.id === id })); }
  resolveMatchers(task) {
    if (!task.problemMatcher) return [];
    const references = Array.isArray(task.problemMatcher) ? task.problemMatcher : [task.problemMatcher];
    return references.map(reference => {
      try {
        return resolveProblemMatcher(reference);
      } catch (error) {
        if (error instanceof MatcherError) throw new Error(`unknown problem matcher "${reference}"`);
        throw error;
      }
    });
  }
  run(id) {
    if (this.active) throw new Error('another task is already running');
    const task = this.tasks.find(item => item.id === id); if (!task) throw new Error('task is not allowlisted');
    const matchers = this.resolveMatchers(task);
    const child = spawn(task.program, task.args.map(String), { cwd: this.workspace, env: { PATH: process.env.PATH, HOME: process.env.HOME }, stdio: ['ignore', 'pipe', 'pipe'] });
    const result = { id, status: 'running', stdout: '', stderr: '', code: null };
    const parser = matchers.length ? { matchers, lines: [], tails: { stdout: '', stderr: '' } } : null;
    this.active = { id, child, result, parser };
    const feed = (streamName, chunk) => {
      result[streamName] += chunk;
      result[streamName] = result[streamName].slice(-512 * 1024);
      if (!parser) return;
      parser.tails[streamName] += chunk;
      let newlineIndex = parser.tails[streamName].indexOf('\n');
      while (newlineIndex !== -1) {
        parser.lines.push(parser.tails[streamName].slice(0, newlineIndex).replace(/\r$/, ''));
        parser.tails[streamName] = parser.tails[streamName].slice(newlineIndex + 1);
        newlineIndex = parser.tails[streamName].indexOf('\n');
      }
      if (parser.lines.length > MAX_BUFFER_LINES) parser.lines.splice(0, parser.lines.length - MAX_BUFFER_LINES);
    };
    child.stdout.on('data', chunk => feed('stdout', chunk));
    child.stderr.on('data', chunk => feed('stderr', chunk));
    child.on('close', code => {
      if (parser) {
        for (const streamName of ['stdout', 'stderr']) {
          if (parser.tails[streamName]) parser.lines.push(parser.tails[streamName]);
        }
        this.finalizeProblems(task, parser);
      }
      result.code = code; result.status = code === 0 ? 'passed' : 'failed'; this.last = { ...result }; this.active = null;
    });
    return { id, status: 'running' };
  }
  finalizeProblems(task, parser) {
    const fullText = parser.lines.join('\n');
    const merged = [];
    const seen = new Set();
    for (const matcher of parser.matchers) {
      const { problems } = parseProblems(matcher, fullText, { workspaceRoot: this.workspace });
      for (const problem of problems) {
        const key = `${problem.file}|${problem.line}|${problem.column}|${problem.message}`;
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(this.toEntry(problem, task.id));
        }
      }
    }
    this.problems.set(`task:${task.id}`, merged);
  }
  toEntry(problem, taskId) {
    const entry = {
      uri: `file:///workspace/${problem.file}`,
      range: { start: { line: problem.line - 1, column: Math.max(0, (problem.column ?? 1) - 1) } },
      severity: SEVERITY_LEVELS[problem.severity] ?? 1,
      message: problem.message,
      source: `task ${taskId}`
    };
    if (problem.code) entry.code = problem.code;
    return entry;
  }
  problemsList() { return [...this.problems.values()].flat(); }
  clearProblems() { this.problems.clear(); }
  clearProblemUri(uri) {
    for (const [key, entries] of this.problems) {
      const next = entries.filter(entry => entry.uri !== uri);
      if (next.length) this.problems.set(key, next); else this.problems.delete(key);
    }
  }
  stop() { if (!this.active) return { status: 'idle' }; this.active.child.kill('SIGTERM'); return { id: this.active.id, status: 'stopping' }; }
  status() { return this.active ? { ...this.active.result } : { ...this.last }; }
}

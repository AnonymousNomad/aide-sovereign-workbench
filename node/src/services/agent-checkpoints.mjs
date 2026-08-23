import path from 'node:path';
import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';

const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo' };
const DISABLED_SUFFIX = '.aide_git_disabled';
const NESTED_SCAN_DEPTH = 4;

export class CheckpointError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CheckpointError';
  }
}

function git(shadowDir, args) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: shadowDir, env: GIT_ENV, windowsHide: true, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const message = String(stderr || error.message).slice(0, 500);
        reject(new CheckpointError(`git ${args[0]} failed: ${message}`));
      } else {
        resolve(String(stdout));
      }
    });
  });
}

async function findNestedGitDirs(root, depth) {
  const found = [];
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === '.git') {
      found.push(root);
      continue;
    }
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    if (depth > 1) {
      found.push(...await findNestedGitDirs(path.join(root, entry.name), depth - 1));
    }
  }
  return found;
}

export function createCheckpointService({ workspace }) {
  const rootAbs = path.resolve(workspace);
  const shadowDir = path.join(rootAbs, '.aide', 'checkpoints', 'repo');
  let initialized = false;

  async function ensureInit() {
    if (initialized) return;
    await fs.mkdir(shadowDir, { recursive: true });
    const gitDirExists = await fs.stat(path.join(shadowDir, '.git')).then(() => true).catch(() => false);
    if (!gitDirExists) {
      await git(shadowDir, ['init']);
    }
    await git(shadowDir, ['config', 'user.name', 'aide-checkpoints']);
    await git(shadowDir, ['config', 'user.email', 'aide@local']);
    await git(shadowDir, ['config', 'core.worktree', rootAbs]);
    await git(shadowDir, ['config', 'commit.gpgsign', 'false']);
    const excludePath = path.join(shadowDir, '.git', 'info', 'exclude');
    const excludeRules = '.git\n.aide\nnode_modules\n';
    await fs.mkdir(path.dirname(excludePath), { recursive: true }).catch(() => {});
    await fs.writeFile(excludePath, excludeRules, 'utf8').catch(() => {});
    initialized = true;
  }

  async function withNestedReposDisabled(fn) {
    const nested = await findNestedGitDirs(rootAbs, NESTED_SCAN_DEPTH);
    const renamed = [];
    for (const dir of nested) {
      if (dir === rootAbs) continue;
      const from = path.join(dir, '.git');
      const to = from + DISABLED_SUFFIX;
      try {
        await fs.rename(from, to);
        renamed.push({ from, to });
      } catch {}
    }
    try {
      return await fn();
    } finally {
      for (const pair of renamed.reverse()) {
        await fs.rename(pair.to, pair.from).catch(() => {});
      }
    }
  }

  async function commit(message) {
    await ensureInit();
    return withNestedReposDisabled(async () => {
      await git(shadowDir, ['add', '-A', '--']);
      try {
        await git(shadowDir, ['commit', '-m', message.slice(0, 200), '--allow-empty', '--no-verify']);
      } catch (error) {
        if (!/nothing to commit/.test(String(error.message))) throw error;
      }
      const hash = (await git(shadowDir, ['rev-parse', 'HEAD'])).trim();
      return hash;
    });
  }

  async function restore(hash) {
    await ensureInit();
    if (!/^[0-9a-f]{7,40}$/.test(hash)) throw new CheckpointError(`invalid checkpoint hash: ${hash}`);
    await withNestedReposDisabled(async () => {
      await git(shadowDir, ['reset', '--hard', hash]);
      await git(shadowDir, ['clean', '-fd', '-e', '.git', '-e', '.aide', '-e', 'node_modules', ':/']);
    });
  }

  async function headHash() {
    await ensureInit();
    return (await git(shadowDir, ['rev-parse', 'HEAD'])).trim();
  }

  return { commit, restore, headHash, get shadowDir() { return shadowDir; } };
}

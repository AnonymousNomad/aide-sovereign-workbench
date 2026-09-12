import path from 'node:path';
import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { AuthorityError } from './execution-authority.mjs';

const DISABLED_SUFFIX = '.aide_git_disabled';

export class CheckpointError extends Error {
  constructor(message, detail = {}) {
    super(message);
    this.name = 'CheckpointError';
    this.code = 'CHECKPOINT_FAILED';
    this.detail = detail;
  }
}

export function createCheckpointService({ workspace, authority }) {
  const rootAbs = path.resolve(workspace);
  const shadowDir = path.join(rootAbs, '.aide', 'checkpoints', 'repo');
  let tail = Promise.resolve();

  function describe(action, value, taskId) {
    if (!['snapshot', 'restore'].includes(action)) throw new AuthorityError('BAD_REQUEST', 'unknown checkpoint action');
    if (typeof value !== 'string' || (action === 'snapshot' ? !value || value.length > 200 : !/^[0-9a-f]{40}$/.test(value))) {
      throw new AuthorityError('BAD_REQUEST', 'invalid checkpoint message or exact hash');
    }
    return { workspace: rootAbs, taskId, kind: `checkpoint.${action}`,
      args: { body: { action, value, target: rootAbs, store: shadowDir, nested_metadata: 'preserve' } } };
  }

  // Revalidate fixed storage ancestry: a symlink/junction cannot redirect a
  // checkpoint write, initialization, or Git repository outside this workspace.
  async function checkPaths() {
    if (await fs.realpath(rootAbs) !== rootAbs) throw new CheckpointError('checkpoint workspace must be a canonical real path');
    for (const rel of ['.aide', '.aide/checkpoints', '.aide/checkpoints/repo', '.aide/checkpoints/repo/.git']) {
      const stat = await fs.lstat(path.join(rootAbs, rel)).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw new CheckpointError(`unsafe checkpoint storage: ${rel}`);
    }
  }

  async function git(args, guard = () => {}) {
    await checkPaths();
    guard();
    // Do not inherit Git redirection, hooks, signing, or fsmonitor execution.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')));
    Object.assign(env, { GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' });
    return new Promise((resolve, reject) => {
      execFile('git', ['-c', 'core.fsmonitor=false', '-c', `core.hooksPath=${path.join(shadowDir, 'disabled-hooks')}`,
        ...args], { cwd: shadowDir, env, windowsHide: true, maxBuffer: 32 * 1024 * 1024, timeout: 30000 },
      (error, stdout, stderr) => {
        if (error) {
          const failure = new CheckpointError(`git ${args[0]} failed: ${String(stderr || error.message).slice(0, 500)}`);
          failure.exitCode = error.code;
          reject(failure);
        } else resolve(String(stdout));
      });
    });
  }

  async function nestedMetadata(dir = rootAbs) {
    const found = [];
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.name.endsWith(DISABLED_SUFFIX)) throw new CheckpointError(`unresolved nested metadata recovery at ${path.join(dir, entry.name)}`);
      if (entry.name === '.git') {
        if (dir !== rootAbs) {
          if (entry.isSymbolicLink()) throw new CheckpointError('nested Git metadata symlink is not supported');
          found.push(path.join(dir, entry.name));
        }
        continue;
      }
      if (entry.name === '.aide' || entry.name === 'node_modules' || entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) found.push(...await nestedMetadata(path.join(dir, entry.name)));
    }
    return found;
  }

  async function mutate(action, value, execution) {
    if (!authority) throw new AuthorityError('FORBIDDEN', 'checkpoint execution authority required');
    const active = authority.assertExecution(execution, `checkpoint.${action}`,
      describe(action, value, 'binding').args.body);
    if (active.operation.workspace !== rootAbs) throw new AuthorityError('FORBIDDEN', 'checkpoint workspace mismatch');
    authority.claimExecution(execution, `checkpoint.${action}`, active.operation.args.body);
    const guard = () => authority.assertExecution(execution, `checkpoint.${action}`, active.operation.args.body);
    const previous = tail;
    let release;
    tail = new Promise(resolve => { release = resolve; });
    await previous;
    const moved = [];
    const completed = [];
    let mutated = false, result, failure;
    try {
      guard();
      await checkPaths();
      const nested = await nestedMetadata();
      guard();
      // Validate the complete destination set before touching any metadata.
      for (const from of nested) {
        const exists = await fs.lstat(from + DISABLED_SUFFIX).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
        if (exists) throw new CheckpointError(`nested metadata destination exists: ${from + DISABLED_SUFFIX}`);
      }
      if (action === 'restore') {
        // Resolve the requested commit before any worktree mutation.
        const exact = (await git(['rev-parse', '--verify', `${value}^{commit}`], guard)).trim();
        if (exact !== value) throw new CheckpointError('checkpoint hash did not resolve exactly');
        const names = (await git(['ls-tree', '-r', '--name-only', '-z', value], guard)).split('\0');
        if (names.some(name => name.split('/').some(part => part === '.git' || part === '.aide' || part.endsWith(DISABLED_SUFFIX)))) {
          throw new CheckpointError('checkpoint contains protected metadata; refusing unsafe historical restore');
        }
      }
      guard();
      mutated = true; // a failing syscall may have partial effects; never claim rollback
      await fs.mkdir(shadowDir, { recursive: true });
      if (action === 'snapshot') {
        const exists = await fs.stat(path.join(shadowDir, '.git')).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
        if (!exists) await git(['init'], guard);
        for (const [key, value] of [['user.name', 'aide-checkpoints'], ['user.email', 'aide@local'],
          ['core.worktree', rootAbs], ['commit.gpgsign', 'false']]) await git(['config', key, value], guard);
        guard();
        await fs.mkdir(path.join(shadowDir, '.git', 'info'), { recursive: true });
        guard();
        await fs.writeFile(path.join(shadowDir, '.git', 'info', 'exclude'),
          '.git\n.aide\nnode_modules\n*.aide_git_disabled\n', 'utf8');
        completed.push('initialized');
      }
      for (const from of nested) {
        guard();
        await fs.rename(from, from + DISABLED_SUFFIX);
        moved.push({ from, temporary: from + DISABLED_SUFFIX });
      }
      completed.push('nested-metadata-isolated');
      if (action === 'snapshot') {
        await git(['add', '-A', '--'], guard);
        await git(['commit', '-m', value, '--allow-empty', '--no-verify'], guard);
        result = (await git(['rev-parse', 'HEAD'], guard)).trim();
        completed.push('snapshot-created');
      } else {
        await git(['reset', '--hard', value], guard);
        completed.push('worktree-reset');
        await git(['clean', '-fd', '-e', '.git', '-e', '.aide', '-e', 'node_modules', '-e', '*.aide_git_disabled', ':/'], guard);
        completed.push('worktree-cleaned');
      }
      guard();
    } catch (error) { failure = error; }
    finally {
      // Compensate ONLY moves performed by this invocation, even after
      // revocation. This does not authorize a fresh snapshot/restore.
      const restorationErrors = [];
      for (const pair of moved.reverse()) {
        try {
          await fs.mkdir(path.dirname(pair.from), { recursive: true });
          const exists = await fs.lstat(pair.from).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
          if (exists) throw new Error('original metadata target already exists; refusing overwrite');
          await fs.rename(pair.temporary, pair.from);
        } catch (error) {
          restorationErrors.push({ ...pair, error: String(error.message).slice(0, 500) });
        }
      }
      release();
      const detail = { outcome: restorationErrors.length ? 'restoration_failed' : mutated ? 'partially_failed' : 'failed_before_mutation',
        mutated, completed, restoration_errors: restorationErrors,
        cause_code: failure?.code ?? null, cause: failure ? String(failure.message).slice(0, 500) : null };
      if (restorationErrors.length) {
        throw new CheckpointError('nested Git metadata restoration failed; manual recovery required', detail);
      }
      if (failure) {
        if (failure instanceof AuthorityError) {
          failure.detail = { ...(failure.detail ?? {}), checkpoint: detail };
          throw failure;
        }
        throw new CheckpointError(failure.message, detail);
      }
    }
    return result;
  }

  return {
    describe,
    commit: (message, execution) => mutate('snapshot', message, execution),
    restore: (hash, execution) => mutate('restore', hash, execution),
    async headHash() {
      await tail;
      await checkPaths();
      const exists = await fs.stat(path.join(shadowDir, '.git')).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (!exists) return null;
      try { return (await git(['rev-parse', '--verify', '--quiet', 'HEAD'])).trim(); }
      catch (error) { if (error.exitCode === 1) return null; throw error; }
    },
    get shadowDir() { return shadowDir; }
  };
}

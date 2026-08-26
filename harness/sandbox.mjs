// Sandbox Execution Loop — proposals are applied to an isolated staging copy,
// verification commands run against it, only verified diffs reach the user.
// Governing design: aide-sandbox-loop SKILL.md. Zero new deps.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { applySearchReplace } from '../node/src/services/agent-tools.mjs';

const SCRATCH_ROOT = '.aide/scratch';
export const MAX_ATTEMPTS = 3;
const ERROR_TAIL_BYTES = 2048;

function resolveInside(workspace, rel) {
  const root = path.resolve(workspace);
  const target = path.resolve(root, String(rel || ''));
  const r = path.relative(root, target);
  if (!r || r.startsWith('..') || path.isAbsolute(r)) {
    throw Object.assign(new Error(`target escapes workspace: ${rel}`), { code: 'PATH_ESCAPE' });
  }
  return target;
}

export function createSandbox({ workspace }) {
  // materializeScratch: copy ONLY touched files (+ their directory structure)
  // into .aide/scratch/<sessionId>/ preserving relative paths.
  async function materializeScratch(sessionId, targets) {
    if (!sessionId || /[^\w.-]/.test(sessionId)) {
      throw Object.assign(new Error('invalid session id'), { code: 'VALIDATION' });
    }
    const scratchRoot = path.join(workspace, SCRATCH_ROOT, sessionId);
    await fs.mkdir(scratchRoot, { recursive: true });
    const copied = [];
    for (const rel of targets) {
      const src = resolveInside(workspace, rel);
      const dest = resolveInside(scratchRoot, rel);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      try {
        await fs.copyFile(src, dest);
        copied.push(rel);
      } catch (error) {
        if (error.code === 'ENOENT') continue; // new file — created on apply
        throw error;
      }
    }
    return { scratchRoot, copied };
  }

  // applyToScratch: SEARCH/REPLACE blocks applied to scratch copies.
  // patches: [{path, search, replace}] — SAME grammar + implementation as the
  // agent loop's replace_in_file (single-implementation law).
  async function applyToScratch(scratchRoot, patches) {
    const results = [];
    for (const p of patches) {
      const dest = resolveInside(scratchRoot, p.path);
      let content = '';
      try {
        content = await fs.readFile(dest, 'utf8');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      let outcome;
      try {
        outcome = applySearchReplace(content, [{ search: p.search, replace: p.replace }]);
      } catch (error) {
        results.push({ path: p.path, ok: false, reason: error.message?.slice(0, 160) || 'apply error' });
        continue;
      }
      if (!outcome.applied.length) {
        results.push({ path: p.path, ok: false, reason: 'SEARCH block not found' });
        continue;
      }
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, outcome.content, 'utf8');
      results.push({ path: p.path, ok: true, strategy: outcome.applied[0].strategy });
    }
    return { all: results.every(r => r.ok), results };
  }

  // runVerification: sequential commands, cwd=scratchRoot, stop-on-first-fail,
  // flake guard = one rerun of a failing command before declaring FAIL.
  async function runVerification(commands, scratchRoot, { timeoutMs = 120_000 } = {}) {
    for (const cmd of commands) {
      const attempt = await runOne(cmd.cmd, cmd.args || [], scratchRoot, timeoutMs);
      if (attempt.passed) continue;
      const rerun = await runOne(cmd.cmd, cmd.args || [], scratchRoot, timeoutMs);
      if (rerun.passed) {
        return { passed: false, flaked: true, failed_cmd: cmd.cmd, report_tail: attempt.output.slice(-ERROR_TAIL_BYTES) };
      }
      return {
        passed: false,
        flaked: false,
        failed_cmd: cmd.cmd,
        exit_code: attempt.exit_code,
        report_tail: rerun.output.slice(-ERROR_TAIL_BYTES)
      };
    }
    return { passed: true, report_tail: '' };
  }

  function runOne(cmd, args, cwd, timeoutMs) {
    return new Promise(resolve => {
      execFile(cmd, args, { cwd, windowsHide: true, timeout: timeoutMs, maxBuffer: 1024 * 1024 },
        (error, stdout, stderr) => {
          const output = `${stdout}${stderr}`.slice(-ERROR_TAIL_BYTES * 2);
          resolve({ passed: !error, exit_code: error?.code ?? 0, output });
        });
    });
  }

  // Atomic apply to REAL workspace: temp write + rename per file. Partial
  // failure reports exactly which landed.
  async function applyToReal(patches) {
    const appliedFiles = [];
    for (const p of patches) {
      const dest = resolveInside(workspace, p.path);
      const tmp = dest + '.sandbox-tmp';
      try {
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.writeFile(tmp, p.replace, 'utf8');
        await fs.rename(tmp, dest);
        appliedFiles.push(p.path);
      } catch (error) {
        return { ok: false, appliedFiles, failed: p.path, reason: error.message };
      }
    }
    return { ok: true, appliedFiles };
  }

  async function cleanupScratch(sessionId) {
    const dir = path.join(workspace, SCRATCH_ROOT, sessionId);
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }

  async function cleanupAll() {
    await fs.rm(path.join(workspace, SCRATCH_ROOT), { recursive: true, force: true }).catch(() => {});
  }

  return { materializeScratch, applyToScratch, runVerification, applyToReal, cleanupScratch, cleanupAll, _test: { resolveInside } };
}

// Sandbox Flow — composes model proposals with the sandbox execution loop:
// propose -> scratch apply -> verify -> bounded retry w/ error context ->
// verified-or-honest-fail result. Daemon-side; model calls stay server-side.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createSandbox } = require('../harness/sandbox.mjs');

const MAX_ATTEMPTS = 3;
const SYSTEM_SANDBOX = [
  'You produce code changes as SEARCH/REPLACE blocks.',
  'Format each change exactly:',
  '<!-- SR: path/to/file.js -->',
  '<<<<<<< SEARCH',
  'exact existing lines',
  '=======',
  'replacement lines',
  '>>>>>>> REPLACE',
  'If tests failed previously, fix what the error tail indicates.',
  'One proposal only. No prose outside the blocks.'
].join('\n');

function parseProposals(text) {
  const out = [];
  const re = /<!--\s*SR:\s*(.+?)\s*-->\s*<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/g;
  let m;
  while ((m = re.exec(String(text || ''))) !== null) {
    out.push({ path: m[1].trim(), search: m[2], replace: m[3] });
  }
  return out;
}

export function createSandboxFlow({ workspace, chatFn }) {
  // chatFn: async ({system, user}) => text (the primary model)
  const sb = createSandbox({ workspace });
  let sessionCounter = 0;

  async function run({ task, targets, commands, timeoutMs } = {}) {
    const sessionId = `sf-${Date.now()}-${++sessionCounter}`;
    const attempts = [];
    const started = Date.now();
    try {
      await sb.materializeScratch(sessionId, targets);
      let scratchRoot = require('node:path').join(workspace, '.aide', 'scratch', sessionId);
      let lastErrorTail = '';
      let finalPatch = null;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const userMsg = [
          `TASK: ${task}`,
          '',
          lastErrorTail ? `PREVIOUS ATTEMPT FAILED. Verification error tail:\n${lastErrorTail}\nFix accordingly.` : ''
        ].filter(Boolean).join('\n\n');
        const raw = await chatFn({ system: SYSTEM_SANDBOX, user: userMsg });
        const proposals = parseProposals(raw);
        if (!proposals.length) {
          attempts.push({ attempt, passed: false, reason: 'no parseable proposals' });
          continue;
        }
        finalPatch = proposals;
        const applied = await sb.applyToScratch(scratchRoot, proposals);
        const verify = applied.all
          ? await sb.runVerification(commands, scratchRoot, { timeoutMs })
          : { passed: false, report_tail: 'apply failures: ' + applied.results.filter(r => !r.ok).map(r => `${r.path}: ${r.reason}`).join('; ') };
        attempts.push({
          attempt,
          passed: Boolean(verify.passed),
          flaked: verify.flaked ?? false,
          files: proposals.map(p => p.path),
          report_tail: verify.report_tail || ''
        });
        if (verify.passed) {
          return {
            ok: true, verified: true, sessionId, attempts,
            patch: finalPatch,
            wall_ms: Date.now() - started
          };
        }
        lastErrorTail = verify.report_tail || verify.failed_cmd || 'verification failed';
      }
      return { ok: true, verified: false, sessionId, attempts, patch: finalPatch, wall_ms: Date.now() - started };
    } catch (error) {
      return { ok: false, error: error.message?.slice(0, 300), attempts, sessionId };
    } finally {
      await sb.cleanupScratch(sessionId);
    }
  }

  async function approveApply(patch) {
    return sb.applyToReal(patch);
  }

  return { run, approveApply };
}

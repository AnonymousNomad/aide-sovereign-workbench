export const THRESHOLDS = Object.freeze({
  explanation: 0.90,
  'code-change': 0.90,
  'security-or-publish': 0.98,
  'payment-or-identity': 0.98
});

const CHECK_TO_OATH = Object.freeze({
  'path-boundary': 'protect-the-user',
  'secret-scan': 'protect-the-user',
  compile: 'evidence-over-confidence',
  tests: 'evidence-over-confidence',
  'git-diff': 'evidence-over-confidence',
  'patch-parse': 'preserve-the-workspace',
  'manifest-validation': 'carry-knowledge-forward'
});

const OATH_LABELS = Object.freeze({
  'protect-the-user': 'Protect the user',
  'evidence-over-confidence': 'Evidence over confidence',
  'finish-the-procedure': 'Finish the procedure',
  'preserve-the-workspace': 'Preserve the workspace',
  'carry-knowledge-forward': 'Carry knowledge forward'
});

function evidenceLevel(score, threshold) {
  if (score >= threshold) return 'sufficient';
  if (score >= threshold * 0.75) return 'partial';
  if (score > 0) return 'weak';
  return 'missing';
}

export function evaluateVeritas({ taskClass = 'code-change', evidenceScore = 0, checks = {} } = {}) {
  const threshold = THRESHOLDS[taskClass] ?? THRESHOLDS['code-change'];
  const failed = Object.entries(checks).filter(([, result]) => result !== true).map(([name]) => name);
  const score = Math.max(0, Math.min(1, Number(evidenceScore) || 0));
  const passed = score >= threshold && failed.length === 0;
  const failedOaths = [...new Set(failed.map(name => CHECK_TO_OATH[name] || 'finish-the-procedure'))];
  return {
    passed,
    status: passed ? 'verified' : 'abstain-needs-evidence',
    score,
    threshold,
    evidence_level: evidenceLevel(score, threshold),
    failed_checks: failed,
    failed_oaths: failedOaths.map(id => ({ id, label: OATH_LABELS[id] || id })),
    rule: 'Model confidence is not evidence. A failed deterministic gate blocks final output.'
  };
}

export function evaluateExecution({ taskClass = 'code-change', execution } = {}) {
  const evidenceScore = execution?.passed ? 1 : 0;
  return evaluateVeritas({ taskClass, evidenceScore, checks: execution?.checks || {} });
}

export function renderVeritasReport({ taskClass = 'code-change', veritas, execution = null } = {}) {
  const result = veritas || evaluateExecution({ taskClass, execution });
  const lines = [
    '# Veritas Report',
    '',
    `Status: ${result.status}`,
    `Evidence: ${Math.round(result.score * 100)}% observed, ${Math.round(result.threshold * 100)}% required (${result.evidence_level})`,
    `Rule: ${result.rule}`,
    ''
  ];

  if (result.failed_checks.length) {
    lines.push('## Blocking Checks', '');
    for (const check of result.failed_checks) lines.push(`- ${check}`);
    lines.push('');
  }

  if (result.failed_oaths.length) {
    lines.push('## Credo Impact', '');
    for (const oath of result.failed_oaths) lines.push(`- ${oath.label}`);
    lines.push('');
  }

  if (execution?.results?.length) {
    lines.push('## Evidence Ledger', '');
    for (const item of execution.results) {
      const state = item.skipped ? 'skipped' : item.passed ? 'pass' : 'fail';
      const reason = item.reason ? ` (${item.reason})` : '';
      lines.push(`- ${item.name}: ${state}${reason}`);
    }
    lines.push('');
  }

  if (!result.passed) {
    lines.push('## Required Next Proof', '');
    lines.push('- Run or repair every blocking check above.');
    lines.push('- Do not present the work as verified until Veritas returns `verified`.');
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

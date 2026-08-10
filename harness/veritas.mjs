const THRESHOLDS = Object.freeze({
  explanation: 0.90,
  'code-change': 0.90,
  'security-or-publish': 0.98,
  'payment-or-identity': 0.98
});

export function evaluateVeritas({ taskClass = 'code-change', evidenceScore = 0, checks = {} } = {}) {
  const threshold = THRESHOLDS[taskClass] ?? THRESHOLDS['code-change'];
  const failed = Object.entries(checks).filter(([, result]) => result !== true).map(([name]) => name);
  const score = Math.max(0, Math.min(1, Number(evidenceScore) || 0));
  const passed = score >= threshold && failed.length === 0;
  return {
    passed,
    status: passed ? 'verified' : 'abstain-needs-evidence',
    score,
    threshold,
    failed_checks: failed,
    rule: 'Model confidence is not evidence. A failed deterministic gate blocks final output.'
  };
}

export function evaluateExecution({ taskClass = 'code-change', execution } = {}) {
  const evidenceScore = execution?.passed ? 1 : 0;
  return evaluateVeritas({ taskClass, evidenceScore, checks: execution?.checks || {} });
}

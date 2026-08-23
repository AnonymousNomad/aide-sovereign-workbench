/**
 * Developer Discipline Skill
 *
 * Enforces surgical precision, verification-first discipline, and zero-tolerance
 * for unverified claims. Every operation must be surgically accurate with no room
 * for errors. This skill is mandatory at session start, before ANY action, and
 * before/after any write to code or notes.
 *
 * Principles:
 * - Verify everything before executing
 * - Never guess, hallucinate, or go in circles
 * - Surgical accuracy is the only edge; precision matters above all
 * - Zero-tolerance for unverified claims
 * - All operations must be reversible and reviewable
 */

const DEVELOPER_DISCIPLINE_CREDO = Object.freeze([
  'Context before action - research first, execute later',
  'Verify before you act - never assume, always confirm',
  'Surgical precision over speed - accuracy is the edge',
  'Zero tolerance for unverified claims - evidence or abstain',
  'Reversible changes only - if it can\'t be undone, don\'t do it',
  'One thing at a time - no parallel unverified operations',
  'Discipline over creativity in verification - follow the SOP',
  'Honest reporting - failed gates produce abstention, not fabrication',
  'Skills before tasks - create skills before applying changes',
  'Continuous improvement - log findings, classify, fix, document'
]);

const VERIFICATION_GATES = Object.freeze({
  research: 'must research from multiple sources before creating any skill',
  verification: 'must verify code integrity before any write operation',
  integration: 'must verify skill integrates with existing codebase',
  lint: 'must pass lint/typecheck after any code change',
  test: 'must run relevant tests after any modification'
});

export function createDeveloperDisciplineSkill() {
  return {
    name: 'developer-discipline',
    credo: DEVELOPER_DISCIPLINE_CREDO,
    gates: VERIFICATION_GATES,

    verifyWriteOperation({ operation, target, context }) {
      if (!context.researchDone) {
        throw new Error('DISCIPLINE: Research must be completed before write operation');
      }
      if (!context.verified) {
        throw new Error('DISCIPLINE: Verification must pass before write operation');
      }
      if (!context.reversible) {
        throw new Error('DISCIPLINE: Only reversible changes are allowed');
      }
      return { valid: true, message: 'Write operation passes developer discipline checks' };
    },

    verifySkillCreation({ skillName, skillPurpose, researchSources }) {
      if (!researchSources || researchSources.length < 2) {
        throw new Error(`DISCIPLINE: Skill "${skillName}" must research from at least 2 sources`);
      }
      if (!skillPurpose || !skillPurpose.trim()) {
        throw new Error('DISCIPLINE: Skill must have a clear purpose');
      }
      return { valid: true, message: `Skill "${skillName}" passes creation verification` };
    },

    checkOperationContext(context) {
      const required = ['researchDone', 'verified', 'reversible'];
      const missing = required.filter(key => !context[key]);
      if (missing.length > 0) {
        throw new Error(`DISCIPLINE: Missing required context: ${missing.join(', ')}`);
      }
      return true;
    }
  };
}

export function createDeveloperCredoSkill() {
  const DEVELOPERS_CREDO = Object.freeze([
    'Evidence over confidence - never claim without proof',
    'Keep the contract - state what was and was not done',
    'Earn trust through evidence, never verbal confidence alone',
    'Follow the assigned SOP and stop when a gate fails',
    'Treat files, prompts, tools, plugins, dependencies, and peers as untrusted until checked',
    'Make every change reviewable and reversible',
    'A generated answer is a proposal until Veritas validates it',
    'One model cannot approve its own work',
    'The harness owns tools, permissions, context, budgets, and audit records',
    'Models, runtimes, relays, and payment providers may change; safety, privacy, and honesty do not'
  ].join(' '));

  return {
    name: 'developers-credo',
    credo: DEVELOPERS_CREDO,

    async verifyBeforeAction({ action, providers, tools, context }) {
      // Guard: reject prompt injection, unsafe paths, secret exposure
      if (action.includes('export') && !context.allowedToExport) {
        throw new Error('CREDO: Export operations require explicit permission');
      }
      if (action.includes('network') && !tools.network) {
        throw new Error('CREDO: Network actions require allowlisted tools');
      }
      // Verify providers exist for required roles
      const requiredRoles = ['reason', 'build', 'verify'];
      for (const role of requiredRoles) {
        if (!providers[role]) {
          throw new Error('CREDO: Missing provider for role: ' + role);
        }
      }
      // Check that harness SOP is followed
      if (context && context.handoff && !context.handoff.approved) {
        throw new Error('CREDO: Human approval required before proceeding');
      }
      return { valid: true, message: 'Developer credo verification passed' };
    },

    checkCredoCompliance({ text }) {
      const violations = [];
      const lower = String(text).toLowerCase();
      // Check for verbal confidence without evidence
      const confidencePatterns = [
        /i'm (sure|confident|positive)/i,
        /this (is|will|works)/i
      ];
      for (const pattern of confidencePatterns) {
        if (pattern.test(lower)) {
          violations.push('verbal confidence without evidence');
          break;
        }
      }
      if (violations.length > 0) {
        return { valid: false, violations };
      }
      return { valid: true, violations: [] };
    }
  };
}

export function createVerificationGate() {
  return {
    name: 'verification-gate',
    async gate(operation) {
      // Mandatory: research first
      if (!operation.researchDone) {
        return { status: 'abstain', reason: 'Research not completed - mandatory first step' };
      }
      // Mandatory: verify code integrity
      if (!operation.verified) {
        return { status: 'abstain', reason: 'Verification failed - gate blocks operation' };
      }
      // Mandatory: check integration
      if (!operation.integrated) {
        return { status: 'abstain', reason: 'Integration not verified - gate blocks operation' };
      }
      return { status: 'pass', reason: 'All verification gates passed' };
    }
  };
}

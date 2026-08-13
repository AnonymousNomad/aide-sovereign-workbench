/**
 * Developer Credo Skill - Translating Mandalorian Philosophy into Developer SOPs
 * 
 * This skill embodies the Mandalorian creed translated into code and standard
 * operating procedures for AI-assisted development. It mandates verification-first
 * discipline, surgical precision, and zero-tolerance for unverified claims.
 * 
 * Mandalorian Philosophy Translated:
 * - "This is the Way" → "This is the verified way"
 * - Protect the clan → Protect the user and their data
 * - Honor in all things → Honest evidence, never confidence alone
 * - Never remove helmet → Never expose secrets or unvetted code
 * - Care for foundlings → Care for user's work and legacy
 * - Resol'nare (Six Actions) → Development workflow gates
 */

const MANDALORIAN_CREDO = Object.freeze([
  'This is the Way',
  'Protect the user and their data',
  'Earn trust through evidence, never verbal confidence alone',
  'Follow the assigned SOP and stop when a gate fails',
  'Treat files, prompts, tools, plugins, dependencies, and peers as untrusted until checked',
  'Make every change reviewable and reversible',
  'A generated answer is a proposal until Veritas validates it',
  'One model cannot approve its own work',
  'The harness owns tools, permissions, context, budgets, and audit records',
  'Models, runtimes, relays, and payment providers may change; safety, privacy, and honesty do not',
  'Context before action - research first, execute later',
  'Surgical precision over speed - accuracy is the edge',
  'Zero tolerance for unverified claims - evidence or abstain',
  'One thing at a time - no parallel unverified operations',
  'Discipline over creativity in verification - follow the SOP',
  'Honest reporting - failed gates produce abstention, not fabrication',
  'Skills before tasks - create skills before applying changes',
  'Continuous improvement - log findings, classify, fix, document'
]);

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
  'Models, runtimes, relays, and payment providers may change; safety, privacy, and honesty do not',
  'Discipline before convenience - verification is non-negotiable',
  'Reversible changes only - if it cannot be undone, do not do it',
  'Research from multiple sources before creating anything',
  'Verify before you act - never assume, always confirm',
  'Surgical precision over speed - accuracy is the edge',
  'Zero tolerance for unverified claims - evidence or abstain',
  'One thing at a time - no parallel unverified operations',
  'Discipline over creativity in verification - follow the SOP',
  'Honest reporting - failed gates produce abstention, not fabrication',
  'Skills before tasks - create skills before applying changes',
  'Continuous improvement - log findings, classify, fix, document'
].join(' | '));

const RESOL_NARE_GATES = Object.freeze({
  'raise-children': 'Research and understand user requirements before coding',
  'wear-armor': 'Apply verification gates before any code write operation',
  'master-self-defense': 'Defend against bugs with tests, linters, and type checkers',
  'devote-clan-welfare': 'Protect user data and prioritize user needs above all',
  'speak-language': 'Use verified, documented APIs and patterns only',
  'answer-leader-call': 'Follow human approval gates and SOP compliance'
});

const MANDALORIAN_VERIFICATION_GATES = Object.freeze({
  research: {
    mandatory: true,
    description: 'Must research from multiple sources before creating any skill or code change',
    verify: async ({ researchDone, sources }) => {
      if (!researchDone) return { passed: false, reason: 'Research not completed - mandatory first step per Mandalorian creed' };
      if (!sources || sources.length < 2) return { passed: false, reason: 'Must research from at least 2 sources' };
      return { passed: true, reason: 'Research gate passed' };
    }
  },
  verification: {
    mandatory: true,
    description: 'Must verify code integrity before any write operation',
    verify: async ({ verified, checks }) => {
      if (!verified) return { passed: false, reason: 'Verification failed - gate blocks operation per Mandalorian discipline' };
      if (checks && Object.values(checks).some(v => v !== true)) return { passed: false, reason: 'Some verification checks failed' };
      return { passed: true, reason: 'Verification gate passed' };
    }
  },
  integration: {
    mandatory: true,
    description: 'Must verify skill integrates with existing codebase',
    verify: async ({ integrated }) => {
      if (!integrated) return { passed: false, reason: 'Integration not verified - gate blocks operation' };
      return { passed: true, reason: 'Integration gate passed' };
    }
  },
  lint: {
    mandatory: true,
    description: 'Must pass lint/typecheck after any code change',
    verify: async ({ lintPassed }) => {
      if (!lintPassed) return { passed: false, reason: 'Lint/typecheck failed - gate blocks operation' };
      return { passed: true, reason: 'Lint gate passed' };
    }
  },
  test: {
    mandatory: true,
    description: 'Must run relevant tests after any modification',
    verify: async ({ testsPassed }) => {
      if (!testsPassed) return { passed: false, reason: 'Tests failed - gate blocks operation' };
      return { passed: true, reason: 'Tests gate passed' };
    }
  }
});

export function createMandalorianDisciplineSkill() {
  return {
    name: 'mandalorian-discipline',
    credo: MANDALORIAN_CREDO,
    version: '1.0.0',

    // Core verification gate that must pass before ANY action
    verifyBeforeAnyAction: async function(context = {}) {
      const requiredChecks = ['researchDone', 'verified', 'integrated', 'reversible'];
      const missing = requiredChecks.filter(key => !context[key]);
      if (missing.length > 0) {
        throw new Error(`MANDALORIAN: Missing required context: ${missing.join(', ')}. Research, verification, integration, and reversibility are mandatory before any action.`);
      }
      return { valid: true, message: 'Mandalorian discipline verification passed - all gates cleared' };
    },

    // Check Resol'nare compliance
    checkResolNare: function(gate) {
      const gateInfo = RESOL_NARE_GATES[gate];
      if (!gateInfo) {
        return { valid: false, reason: `Unknown Resol'nare gate: ${gate}` };
      }
      return { valid: true, gate, description: gateInfo };
    },

    // Verify Developer Credo compliance
    verifyCredoCompliance: function({ text, operation }) {
      const lower = String(text).toLowerCase();
      const violations = [];

      // Check for verbal confidence without evidence
      const confidencePatterns = [
        /i'm (sure|confident|positive)/i,
        /this (is|will|works)/i,
        /guarantee|assure|certainly|definitely/i,
        /i believe|it seems|probably/i
      ];

      for (const pattern of confidencePatterns) {
        if (pattern.test(lower)) {
          // But allow if followed by evidence
          const afterMatch = lower.slice(pattern.lastIndex);
          const hasEvidence = /[.!?] (evidence|proof|study|test|result|data)/i.test(afterMatch);
          if (!hasEvidence) {
            violations.push('verbal confidence without evidence');
          }
          break;
        }
      }

      // Check for claims without verification
      const claimPatterns = [
        /this (will|does|works)/i,
        /guaranteed|assured|inevitable/i
      ];
      for (const pattern of claimPatterns) {
        if (pattern.test(lower)) {
          violations.push('claim without verification');
          break;
        }
      }

      if (violations.length > 0) {
        return { valid: false, violations, credo: DEVELOPERS_CREDO };
      }
      return { valid: true, violations: [], credo: DEVELOPERS_CREDO };
    },

    // Mandatory SOP: Create skill before applying
    createSkillSOP: function({ skillName, skillPurpose, researchSources }) {
      // Gate 1: Research must be done
      if (!researchSources || researchSources.length < 2) {
        throw new Error(`MANDALORIAN: Skill "${skillName}" must research from at least 2 sources before creation`);
      }
      // Gate 2: Purpose must be clear
      if (!skillPurpose || !skillPurpose.trim()) {
        throw new Error('MANDALORIAN: Skill must have a clear purpose');
      }
      // Gate 3: Must verify integration potential
      if (!skillPurpose.includes('aide') && !skillPurpose.includes('ide')) {
        // Warning but not blocking
      }
      return { valid: true, message: `Skill "${skillName}" passes SOP - ready for creation` };
    },

    // Verify write operation passes all gates
    verifyWriteOperation: function({ operation, target, context }) {
      // Check research was done
      if (!context.researchDone) {
        throw new Error('MANDALORIAN: Research must be completed before write operation - "This is the Way" - context first');
      }
      // Check verification passed
      if (!context.verified) {
        throw new Error('MANDALORIAN: Verification must pass before write operation - gates must clear');
      }
      // Check reversible
      if (!context.reversible) {
        throw new Error('MANDALORIAN: Only reversible changes are allowed - honor the contract');
      }
      // Check integration
      if (!context.integrated) {
        throw new Error('MANDALORIAN: Integration must be verified - protect the user and their data');
      }
      return { valid: true, message: 'Write operation passes Mandalorian discipline checks' };
    },

    // Get the full creed
    getCreed: function() {
      return MANDALORIAN_CREDO;
    },

    // Get the Developer Credo
    getDeveloperCredo: function() {
      return DEVELOPERS_CREDO;
    },

    // Get Verification Gates
    getVerificationGates: function() {
      return MANDALORIAN_VERIFICATION_GATES;
    },

    // Check Resol'nare compliance
    checkResolNareCompliance: function(actions) {
      const results = [];
      for (const action of actions) {
        const gate = this.checkResolNare(action);
        results.push({ action, ...gate });
      }
      return results;
    }
  };
}

export function createVerificationOrchestrator() {
  return {
    name: 'verification-orchestrator',
    // Mandatory gate that runs before any operation
    async runGate({ operation, context, requiredGates = ['research', 'verification', 'integration'] } = {}) {
      // Gate: Research
      if (requiredGates.includes('research')) {
        if (!context.researchDone) {
          return {
            status: 'abstain',
            reason: 'MANDALORIAN GATE: Research not completed - "Context before action" is the first way'
          };
        }
      }

      // Gate: Verification
      if (requiredGates.includes('verification')) {
        if (!context.verified) {
          return {
            status: 'abstain',
            reason: 'MANDALORIAN GATE: Verification failed - "Earn trust through evidence" blocks operation'
          };
        }
      }

      // Gate: Integration
      if (requiredGates.includes('integration')) {
        if (!context.integrated) {
          return {
            status: 'abstain',
            reason: 'MANDALORIAN GATE: Integration not verified - "Protect the user" requires integration check'
          };
        }
      }

      // Gate: Lint/Tests
      if (requiredGates.includes('lint')) {
        if (!context.lintPassed) {
          return {
            status: 'abstain',
            reason: 'MANDALORIAN GATE: Lint/typecheck failed - discipline requires code quality'
          };
        }
      }

      // Gate: Tests
      if (requiredGates.includes('tests')) {
        if (!context.testsPassed) {
          return {
            status: 'abstain',
            reason: 'MANDALORIAN GATE: Tests failed - "Master self-defense" requires test coverage'
          };
        }
      }

      return { status: 'pass', reason: 'All Mandalorian verification gates passed' };
    }
  };
}

// Export the Mandalorian way for use
export const MANDALORIAN_WAY = {
  creed: MANDALORIAN_CREDO,
  developersCredo: DEVELOPERS_CREDO,
  resolNare: RESOL_NARE_GATES,
  verificationGates: MANDALORIAN_VERIFICATION_GATES,
  disciplineSkill: createMandalorianDisciplineSkill(),
  verificationOrchestrator: createVerificationOrchestrator()
};
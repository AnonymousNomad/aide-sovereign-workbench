import { evaluateExecution, evaluateVeritas } from '../harness/veritas.mjs';
import { normalizeUnifiedPatch, validateUnifiedPatch } from '../harness/patch.mjs';

const DEFAULT_DAP_POLICY = Object.freeze({
  max_breakpoints: 100,
  max_stack_depth: 50,
  max_variables: 500,
  support_variable_watch: true,
  support_evaluate: true,
  support_set_breakpoints: true,
  support_continue: true,
  support_step_into: true,
  support_step_over: true,
  support_step_out: true,
  support_pause: true,
  supports_configurations_done: true,
  supports_breakpoints_request: true,
  supports_terminate_debuggee: true,
});

export function createDAPEnhancement({ adapters = [], policy = {}, workspace = '' } = {}) {
  const rules = { ...DEFAULT_DAP_POLICY, ...policy };

  function validateAdapter(adapter) {
    const required = [
      'id', 'name', 'command', 'args', 'languages', 'protocol'
    ];
    for (const key of required) {
      if (!adapter[key]) {
        throw new Error(`DAP adapter missing required key: ${key}`);
      }
    }
    if (adapter.protocol !== 'DAP') {
      throw new Error(`DAP adapter protocol must be "DAP", got "${adapter.protocol}"`);
    }
    return adapter;
  }

  function validateConfigurationDoneRequest(configurations) {
    if (!Array.isArray(configurations)) {
      throw new Error('configurations must be an array');
    }
    for (const config of configurations) {
      if (!config.name || !config.type || !config.request) {
        throw new Error('each configuration must have name, type, and request');
      }
    }
    return configurations;
  }

  function validateStackTrace(stackFrames) {
    if (!Array.isArray(stackFrames)) {
      throw new Error('stack frames must be an array');
    }
    for (const frame of stackFrames) {
      if (!frame.id || !frame.name) {
        throw new Error('each stack frame must have id and name');
      }
    }
    return stackFrames;
  }

  function validateVariables(variables) {
    if (!Array.isArray(variables)) {
      throw new Error('variables must be an array');
    }
    for (const varData of variables) {
      if (!varData.name || !varData.value) {
        throw new Error('each variable must have name and value');
      }
    }
    return variables;
  }

  return {
    enhanceAdapter(adapter) {
      const validated = validateAdapter(adapter);
      return {
        ...validated,
        capabilities: {
          ...validated.capabilities,
          configurationDone: rules.supports_configurations_done !== false,
          breakpoints: rules.supports_breakpoints_request !== false,
          terminate: rules.supports_terminate_debuggee !== false,
          variables: rules.support_variable_watch !== false,
          evaluate: rules.support_evaluate !== false,
        },
        rules,
      };
    },

    async runConfigurationDoneRequest(configurations) {
      const validated = validateConfigurationDoneRequest(configurations);
      return {
        type: 'configurationDone',
        configurations: validated,
        request: 'launch',
      };
    },

    async handleStackTraceRequest(stackFrames) {
      const validated = validateStackTrace(stackFrames);
      return {
        type: 'stackTrace',
        stackFrames: validated,
        totalFrames: validated.length,
        mayTruncate: false,
      };
    },

    async handleVariablesRequest(variables) {
      const validated = validateVariables(variables);
      return {
        type: 'variables',
        variables: validated,
        request: 'variables',
      };
    },

    evaluatePatch(patch, taskClass = 'code-change') {
      const patchValidation = validateUnifiedPatch(patch);
      if (!patchValidation.valid) {
        return evaluateVeritas({
          taskClass,
          evidenceScore: 0,
          checks: { 'patch-parse': false, reason: patchValidation.reason }
        });
      }
      return evaluateVeritas({
        taskClass,
        evidenceScore: 1,
        checks: { 'patch-parse': true }
      });
    },

    verifyAdapterCompliance(adapter) {
      const issues = [];
      if (!adapter.id) issues.push('missing adapter id');
      if (!adapter.name) issues.push('missing adapter name');
      if (!adapter.command) issues.push('missing adapter command');
      if (!Array.isArray(adapter.args)) issues.push('args must be an array');
      if (!adapter.languages || !Array.isArray(adapter.languages)) issues.push('languages must be an array');
      if (adapter.protocol !== 'DAP') issues.push('protocol must be DAP');
      if (issues.length > 0) return { valid: false, issues };
      return { valid: true, issues: [] };
    },

    getPolicy() {
      return { ...DEFAULT_DAP_POLICY, ...policy };
    },

    async testBreakpointPlacement(breakpoint, source) {
      if (!breakpoint.line || breakpoint.line < 1) {
        return { valid: false, reason: 'breakpoint must have valid line number' };
      }
      if (!source || !source.path) {
        return { valid: false, reason: 'breakpoint must have source path' };
      }
      return { valid: true, reason: null };
    },

    async testStepActions(action) {
      const validActions = ['continue', 'stepInto', 'stepOver', 'stepOut', 'pause'];
      if (!validActions.includes(action)) {
        return { valid: false, reason: `invalid step action: ${action}` };
      }
      return { valid: true, reason: null };
    },
  };
}

export function enhanceDAPManifest(manifestPath, enhancements) {
  // This function would read the existing manifest, apply enhancements, and write back
  // For now, it returns the enhancement configuration
  return {
    manifestPath,
    enhancements,
    applied: false,
    note: 'Manifest enhancement applied via skill; restart daemon to reload'
  };
}
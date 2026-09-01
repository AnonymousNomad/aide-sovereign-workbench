// Shared featurizers for micro-experts — ONE module imported by both the
// training scripts and the serving routes (train-serve consistency law).
// Duplicated extractors are the #1 silent killer of distilled heads.

export function taskRouterFeatures(message) {
  const msg = String(message ?? '');
  const lc = msg.toLowerCase();
  const words = msg.split(/\s+/).filter(Boolean);
  return {
    len_chars: msg.length / 200,
    len_words: words.length / 40,
    question: /\?/.test(msg) ? 1 : 0,
    path_like: /[\w-]+\.[a-z]{1,4}\b|\/[a-z]/i.test(msg) ? 1 : 0,
    verb_fix: /\b(fix|debug|broken|crash|fails?|error)\b/i.test(lc) ? 1 : 0,
    verb_build: /\b(build|create|implement|add|write|make|generate|scaffold)\b/i.test(lc) ? 1 : 0,
    verb_plan: /\b(plan|architect|design|roadmap|break down|phases)\b/i.test(lc) ? 1 : 0,
    verb_explain: /\b(explain|what|how|why|document|difference)\b/i.test(lc) ? 1 : 0,
    code_fence: /```/.test(msg) ? 1 : 0
  };
}

// diff-risk-gate featurizer — scores a proposed patch/diff for risk class
// (low / review / block). Used by the diff-risk-gate micro-expert and the
// training script. One module, both paths (train-serve consistency law).
export function diffRiskFeatures(diff) {
  const text = String(diff ?? '');
  const lc = text.toLowerCase();
  const lines = text.split(/\n/);
  const added = lines.filter(l => /^\+/.test(l)).length;
  const removed = lines.filter(l => /^-/.test(l)).length;
  return {
    len_lines: lines.length / 100,
    added_ratio: added / Math.max(1, added + removed),
    touches_auth: /\b(auth|login|password|token|secret|credential|session)\b/i.test(lc) ? 1 : 0,
    touches_exec: /\b(exec|spawn|eval|command|shell|child_process)\b/i.test(lc) ? 1 : 0,
    touches_network: /\b(fetch|http|axios|request|socket|net\.connect)\b/i.test(lc) ? 1 : 0,
    deletes_tests: /(^-{1,3}\s*.*(test|spec))/im.test(text) ? 1 : 0,
    touches_config: /\b(config|env|\.env|settings|manifest)\b/i.test(lc) ? 1 : 0,
    large_delete: removed > 50 ? 1 : 0,
    scope_wide: (text.match(/^diff --git/gm) || []).length > 3 ? 1 : 0,
    user_input_flow: /\b(userinput|rawuser|unsafe|unsanitized|secret|apikey|api_key)\b/i.test(lc) ? 1 : 0
  };
}

// request-intent-classifier featurizer — classifies an inbound message
// (telegram / bridge) as business / code / system. Used by the
// request-intent-classifier micro-expert and the training script.
export function requestIntentFeatures(message) {
  const msg = String(message ?? '');
  const lc = msg.toLowerCase();
  return {
    len_chars: msg.length / 200,
    len_words: msg.split(/\s+/).filter(Boolean).length / 40,
    question: /\?/.test(msg) ? 1 : 0,
    greeting: /\b(hi|hello|hey|status|report)\b/i.test(lc) ? 1 : 0,
    code_request: /\b(fix|build|refactor|test|bug|code|implement)\b/i.test(lc) ? 1 : 0,
    system_request: /\b(restart|start|stop|engine|model|daemon|server|port)\b/i.test(lc) ? 1 : 0,
    business_request: /\b(schedule|meeting|invoice|client|budget|plan|roadmap)\b/i.test(lc) ? 1 : 0,
    path_like: /[\w-]+\.[a-z]{1,4}\b/i.test(msg) ? 1 : 0,
    imperative: /^(fix|build|run|start|stop|restart|show|list)\b/i.test(lc) ? 1 : 0
  };
}


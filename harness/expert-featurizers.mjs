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

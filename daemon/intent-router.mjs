const ROUTES = [
  { mode: 'agent', pattern: /\b(fix|edit|implement|build|create|refactor|debug|run|test|patch|change)\b/i, reason: 'the request implies a workspace change or verification task' },
  { mode: 'plan', pattern: /\b(plan|design|architecture|roadmap|steps|approach|break down)\b/i, reason: 'the request asks for planning before execution' }
];

export function routeIntent(prompt) {
  const text = String(prompt || '').trim();
  if (!text) return { mode: 'ask', reason: 'empty or conversational request' };
  const route = ROUTES.find(candidate => candidate.pattern.test(text));
  return route ? { mode: route.mode, reason: route.reason } : { mode: 'ask', reason: 'the request is informational or conversational' };
}

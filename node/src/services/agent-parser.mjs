const TOOL_NAME = /^[a-z_][a-z0-9_]{1,39}$/;
const PARAM_NAME = /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/;

export class AgentParseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AgentParseError';
    this.code = 'AGENT_PARSE';
  }
}

export function parseToolCalls(text, toolSchemas) {
  if (typeof text !== 'string' || text.length === 0) return [];
  const allowed = new Set(Object.keys(toolSchemas));
  for (const name of allowed) {
    let idx = 0;
    for (;;) {
      idx = text.indexOf(`<${name}>`, idx);
      if (idx === -1) break;
      const close = text.indexOf(`</${name}>`, idx + name.length + 2);
      if (close === -1) {
        throw new AgentParseError(
          `tool call <${name}> is missing its closing </${name}> tag; end every tool call with </${name}>`
        );
      }
      idx = close + name.length + 3;
    }
  }
  const calls = [];
  const blockRe = /<([a-z_][a-z0-9_]{0,39})>([\s\S]*?)<\/\1>/g;
  let match;
  while ((match = blockRe.exec(text)) !== null) {
    const name = match[1];
    const body = match[2];
    if (!allowed.has(name)) {
      throw new AgentParseError(`unknown tool "${name}"; use one of: ${[...allowed].join(', ')}`);
    }
    calls.push({ name, args: parseParams(name, body, toolSchemas[name]) });
  }
  return calls;
}

function parseParams(toolName, body, knownParams) {
  const known = new Set((knownParams ?? []).map(key => key.toLowerCase()));
  const args = {};
  const paramRe = /<([a-zA-Z_][a-zA-Z0-9_]{0,63})>([\s\S]*?)<\/\1>/g;
  let match;
  while ((match = paramRe.exec(body)) !== null) {
    const key = match[1];
    if (!known.has(key.toLowerCase())) continue;
    if (Object.prototype.hasOwnProperty.call(args, key)) {
      throw new AgentParseError(`tool ${toolName}: duplicate parameter "${key}"`);
    }
    args[key] = match[2];
  }
  for (const key of known) {
    const open = body.indexOf(`<${key}>`);
    if (open === -1) continue;
    if (body.indexOf(`</${key}>`, open + key.length + 2) === -1) {
      throw new AgentParseError(
        `tool ${toolName}: parameter <${key}> is missing its closing </${key}> tag`
      );
    }
  }
  return args;
}

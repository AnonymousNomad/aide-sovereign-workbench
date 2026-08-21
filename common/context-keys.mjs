const MAX_EXPR_LENGTH = 512;
const MAX_REGEX_LENGTH = 64;

function tokenize(input) {
  const tokens = [];
  let i = 0;
  while (i < input.length) {
    const char = input[i];
    if (/\s/.test(char)) {
      i += 1;
      continue;
    }
    if ('()'.includes(char)) {
      tokens.push({ type: 'paren', value: char });
      i += 1;
      continue;
    }
    if (input.startsWith('&&', i)) {
      tokens.push({ type: 'op', value: '&&' });
      i += 2;
      continue;
    }
    if (input.startsWith('||', i)) {
      tokens.push({ type: 'op', value: '||' });
      i += 2;
      continue;
    }
    const pair = input.slice(i, i + 2);
    if (pair === '=~' || pair === '==' || pair === '!=') {
      tokens.push({ type: 'op', value: pair });
      i += 2;
      continue;
    }
    if (char === '!') {
      tokens.push({ type: 'not' });
      i += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      const end = input.indexOf(char, i + 1);
      if (end === -1) return null;
      tokens.push({ type: 'str', value: input.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    const match = /^[^\s()!]+/.exec(input.slice(i));
    if (!match) return null;
    tokens.push({ type: 'word', value: match[0] });
    i += match[0].length;
  }
  return tokens;
}

export function evaluateWhen(expression, context) {
  if (!expression || expression === 'true') return true;
  if (expression === 'false') return false;
  if (typeof expression !== 'string' || expression.length > MAX_EXPR_LENGTH) return false;
  const tokens = tokenize(expression);
  if (!tokens || tokens.length === 0) return false;
  let position = 0;
  const peek = () => tokens[position];

  const parseOr = () => {
    let left = truthy(parseAnd());
    while (peek()?.type === 'op' && peek().value === '||') {
      position += 1;
      left = truthy(parseAnd()) || left;
    }
    return left ? 'true' : 'false';
  };

  const parseAnd = () => {
    let left = truthy(parseCompare());
    while (peek()?.type === 'op' && peek().value === '&&') {
      position += 1;
      left = truthy(parseCompare()) && left;
    }
    return left ? 'true' : 'false';
  };

  const parseCompare = () => {
    const left = parseOperand();
    const token = peek();
    if (token?.type === 'op' && ['==', '!=', '=~'].includes(token.value)) {
      position += 1;
      const right = parseOperand();
      if (token.value === '=~') {
        if (right.text === '' || right.text.length > MAX_REGEX_LENGTH) return 'false';
        try {
          return new RegExp(right.text).test(left.text) ? 'true' : 'false';
        } catch {
          return 'false';
        }
      }
      if (token.value === '==') return left.text === right.text && left.known === right.known ? 'true' : 'false';
      return left.text !== right.text || left.known !== right.known ? 'true' : 'false';
    }
    return left.known ? (left.text !== '' && left.text !== 'false' ? 'true' : 'false') : 'false';
  };

  function asTruth(operand) {
    return operand.known && operand.text !== '' && operand.text !== 'false' ? 'true' : 'false';
  }

  function parseOperand() {
    if (peek()?.type === 'not') {
      position += 1;
      const inner = parseOperand();
      return { text: asTruth(inner) === 'true' ? 'false' : 'true', known: true };
    }
    const token = peek();
    if (!token) return { text: '', known: false };
    if (token.type === 'paren' && token.value === '(') {
      position += 1;
      const value = parseOr();
      if (peek()?.value !== ')') throw new Error('unbalanced');
      position += 1;
      return { text: value, known: true };
    }
    if (token.type === 'str') {
      position += 1;
      return { text: token.value, known: true };
    }
    if (token.type === 'word') {
      position += 1;
      const { value } = token;
      if (value === 'true') return { text: 'true', known: true };
      if (value === 'false' || value === 'undefined' || value === 'null') return { text: 'false', known: true };
      if (context && Object.hasOwn(context, value)) {
        const bound = context[value];
        return typeof bound === 'string' ? { text: bound, known: true } : { text: bound ? 'true' : 'false', known: true };
      }
      return { text: value, known: false };
    }
    throw new Error(`unexpected ${String(token.value)}`);
  }

  try {
    const result = parseOr();
    return position >= tokens.length && result === 'true';
  } catch {
    return false;
  }
}

export function impliesWhen(a, b) {
  if (!b || b === 'true') return true;
  if (!a || a === 'true') return false;
  return a === b;
}

function truthy(value) {
  return value === 'true';
}

# Skill: aide-grammar-constrained-generation

# Grammar-Constrained Generation — GBNF Wiring for Structured Outputs

Wire GBNF grammars to llama.cpp model serving for deterministic structured output
(SESEARCH/REPLACE blocks, JSON, code). Eliminates format failures at the decoder level
instead of relying on prompt engineering.

## Architecture

```
User text → model-manager.chat → llama.cpp /completion with grammar →
  structured output → parseSearchReplaceBlocks → apply
```

## Files

- `grammar/sr-proposal.gbnf` — SEARCH/REPLACE proposal grammar (already written)
- `daemon/server.mjs` — model-manager.chat endpoint (needs grammar parameter)
- `node/src/services/model-manager.mjs` — chat function (needs grammar passthrough)

## Wiring Steps

### 1. Add grammar parameter to model-manager.chat

In `daemon/server.mjs`, the `/api/model/chat` handler calls `modelManager.chat(messages, options)`.
Add `grammar` to the options:

```js
const { messages, temperature, max_tokens, grammar } = req.body;
const result = await modelManager.chat(messages, { temperature, max_tokens, grammar });
```

### 2. Pass grammar to llama.cpp endpoint

In `model-manager.mjs`, the `chat()` function calls the llama.cpp `/completion` endpoint.
Add grammar to the request body:

```js
const body = {
  prompt: formattedPrompt,
  n_predict: max_tokens || 2048,
  temperature: temperature || 0.7,
  stream: false,
};
if (grammar) body.grammar = grammar;
```

### 3. Load grammar files

Grammar files live in `grammar/` directory. Load them by name:

```js
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function loadGrammar(name) {
  return readFileSync(join(process.cwd(), 'grammar', `${name}.gbnf`), 'utf8');
}
```

### 4. Apply grammar per-request

In the chat handler, detect when grammar is needed:

```js
// For SEARCH/REPLACE proposals
if (req.body.format === 'search-replace') {
  body.grammar = loadGrammar('sr-proposal');
}
```

## GBNF Grammar Format

```
root   ::= block+
block  ::= search-marker content replace-marker content
search-marker ::= "<<<<<<< SEARCH" "\n"
replace-marker ::= "=======" "\n" ">>>>>>> REPLACE" "\n"
content ::= char*
char   ::= [^\n] | "\n"
```

## Verification

Battery: Run `node scripts/grammar-battery.mjs` (to be created).
Probes: grammar loads, grammar parses, chat accepts grammar param, output matches grammar.

## Pitfalls

- Grammar must be valid GBNF — test with `llama-cli --grammar` before wiring
- Some models don't support grammar约束 — test with the actual model
- Grammar adds latency — only use when structured output is required
- Fallback: if grammar fails, use prompt-based format enforcement

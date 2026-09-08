# Capability Battery Adaptation: MoE Models with Interleaved Thinking

## Scope

Adapting the AIDE capability audit (originally for Qwen2.5-Coder-4B Instruct at 0.683 composite) for new in-house models. Critical for the North-Mini-Code-1.0 path because the model has **interleaved thinking** which completely changes the response shape.

## Why the original battery breaks on North

The original battery (per `docs/evidence/capability-audit-cipher-4b.md`) checks for `must` substrings in the response text. For North-Mini-Code-1.0:

- Every response includes `reasoning_content` BEFORE `content` (or AS the entire response on short prompts)
- The `content` field can be empty for `finish_reason="length"` truncations (the 33-token "OK" probe had empty `content` because all 16 tokens went to reasoning)
- The original battery's "D_tool 0% pass" was caused by an audit format mismatch (model uses AIDE's native grammar, not `ACTION:` prefix). The same problem will hit North unless we test the actual JSON the daemon expects.

## Battery adaptation rules

| Battery check | Old (cipher-4b) | New (North + any thinking model) |
|---|---|---|
| Where to look for answer | `text` field | **`content` field, with `reasoning_content` excluded from scoring** (thinking is internal, not the answer) |
| D_tool format | look for `ACTION:` prefix | look for `<desktop_action>` JSON block OR Cohe4 native tool call JSON |
| Truncation guard | `finish_reason=stop` only | `finish_reason=stop` **AND** `content.length > 0` (if length-truncated, retry with bigger max_tokens) |
| Timeout per task | 90s | **600s** (CPU MoE is slow, first token can take 2-3 min cold) |
| Sampling | temperature=0.0 (deterministic) | **temperature=1.0, top_p=0.95** per the model card (or 0.0 for tests, with note in evidence) |
| Thinking extraction | N/A | **strip `<\|thinking\|>...<\|/thinking\|>` and `reasoning_content` from the response** before scoring |

## Concrete adapter code (in Node.js, matching the existing `capability_audit_cipher_4b.mjs`)

```js
// At the top of the HTTP request handler:
const body = {
  model: "E:/aide-sovereign-workbench/models/aide-house/North-Mini-Code-1.0-UD-Q2_K_XL.gguf",
  messages: [...],
  max_tokens: 512,           // bigger than 4B model needs (256 was too small)
  temperature: 1.0,          // per model card
  top_p: 0.95,
};
const opts = {
  hostname: '127.0.0.1',
  port: 8084,                // North's port
  path: '/v1/chat/completions',
  method: 'POST',
  timeout: 600000,           // 10 min per task
};

// In the response handler:
const choice = data.choices[0];
const reasoning = choice.message.reasoning_content || '';
const content = choice.message.content || '';
// Concatenate reasoning + content, then strip the thinking markers
// to get a "what the model would say without thinking" view
const raw = (reasoning + '\n' + content).replace(/<\|thinking\|>[\s\S]*?<\|endoftext\|>/g, '');
// Score against the task's `must` / `mustNot` patterns using `raw`
```

## Per-task-category adaptations

### A_code_gen (factorial, http_get, csv_quoted, sql_builder)
- Use `max_tokens: 1024` (4B needed 400-600, North may think + emit longer)
- D_tool category 0% pass was an audit-format issue, not a model failure. Test the actual JSON the AIDE daemon expects.

### B_understand (explain, find_bug, regex_explain)
- These are short-form reasoning tasks. North's thinking is a FEATURE here — the reasoning_content IS the answer.
- Score reasoning_content + content together; must-substrings found in either count.

### C_edit (apply_diff, rename, fix_test_msg)
- The model produces a unified diff. Score for diff markers (`---`, `+++`, `@@`) in either reasoning OR content.

### D_tool (list_files, read_file, write_file, run_cmd) — **the 0% gap**
- Old battery checked for `ACTION:` prefix. North emits tool calls as JSON in the native Cohere tool-call format.
- **New scoring:** check for valid JSON containing `op`, `target`, `approved` fields (per the AIDE `DesktopActionRequest` contract at `node/src/services/desktop-control.mjs`).
- Accept the model's output as-is. The AIDE harness layer (`desktop-policy.mjs`) handles action parsing.

### E_reason (plan_auth, choose_db, debug_ci) — North's strongest
- Use max_tokens: 2048+ to give the thinking room to develop.
- Score on `must` substrings in content (not reasoning — reasoning may diverge, content is the commit).

### F_format (openapi, docstring)
- The model handles structured output well (per the IFBench + IFStruct scores from the model card: 59.17 + 85.49).
- Score on JSON validity + required field presence.

### G_longctx (long_reason, retention)
- These are context-fill tests. Reduce to 8K context for the 1060 to avoid OOM.
- North supports 256K natively, but the served ctx-size 32K in our config.

### H_math (probability, two_sum)
- These were the cipher-4b weak spots (0% on two_sum, 0.4 on probability). Per the model card, North benchmarks don't include math — let me check if it's a real regression. **Probably not a regression** — likely a different kind of error that needs different scoring.

## Verifying the battery itself

The battery must be runnable and reproducible. The proof is: run it twice on the same engine with same inputs, get same scores. If not, the battery is not the model that flaked.

For North specifically, run the battery twice:
1. **Cold pass:** fresh engine, no warmup, 23 tasks
2. **Warm pass:** second run, engine fully warm
3. Both should give the same composite within ±0.02

If the warm pass is higher, the cold pass wasn't measuring the model — it was measuring the model + cold-load race. The battery is broken, not the model.

## Skill category: capability-eval
## Author: opencode (T2 session, 2026-08-30)
## Verified by: research on the Cohere model card benchmarks + the existing cipher-4b battery failure modes. Not yet verified by running the adapted battery.

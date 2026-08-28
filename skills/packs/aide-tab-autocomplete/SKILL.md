---
name: aide-tab-autocomplete
description: Inline tab-autocomplete (FIM) for AIDE using the in-box SmolLM2-360M model on a dedicated low-latency engine — single-shot completion at cursor, debounced ghost text in Monaco, accept/reject telemetry, prefix/suffix windowing, keep-warm engine management via the same lifecycle doctrine. This is the #1 daily-use feature of every rival IDE (Cursor Tab, Copilot, Windsurf Tab) and AIDE has ZERO inline-completion code. Use when building tab-completion, ghost text, inline suggestions, FIM prompting, low-latency model serving, completion acceptance analytics, or diagnosing slow/wrong inline suggestions.
---

# Tab Autocomplete — The Feature Operators Touch 500 Times a Day

Born 2026-08-27 gap analysis: `rg -il 'autocomplete|inline.*complet' node/src
app.js` = ZERO hits. Every rival's most-used feature is missing. AIDE already
has the perfect model in-box: models/smollm2-360m-instruct-q8_0.gguf (registered
`smollm2-360m-q8`, endpoint 8082, vulkan profile) — 360M params is exactly the
latency class Copilot/Cursor/Windsurf use for Tab. The editor is Monaco (VS
Code's own) — inline ghost text is `monaco.languages.registerInlineCompletionsProvider`.

## Research base (verified 2026-08-27)

1. Cursor: "context-aware completions" listed as a core research line;
   shadcn quote on cursor.com — "autocompletes when and where you need it" is
   cited as the reason it's worth paying for (retrieved 2026-08-27).
2. Windsurf ships a dedicated "Tab" product page; Copilot equivalents are
   inline completions with ghost text + accept-tab. This is table stakes.
3. FIM (fill-in-the-middle) is the standard serving pattern: send prefix +
   suffix around the cursor, model generates only the middle. llama-server
   supports FIM tokens for SmolLM2 (`<|fim_prefix|>`, `<|fim_suffix|>`,
   `<|fim_middle|>`) — verify per-model in the GGUF template before relying.
4. Latency budget: accepted completions need <350ms first token. The only way
   on this GTX 1060 box: a SMALL dedicated model, GPU-offloaded, warm engine,
   single in-flight request, aggressive debouncing.

## What to do (direct)

1. DEDICATED COMPLETION ENGINE: start smollm2-360m on its own port (8082 is
   already its manifest endpoint) via the EXISTING ModelManager lifecycle — it
   gets the doctrine (drain-wait, early-exit guard) for free. Keep it warm
   while the editor is open; unload on workspace close.
2. SERVING SHAPE: POST /v1/completions (NOT chat), prompt =
   `<|fim_prefix|>{prefix}<|fim_suffix|>{suffix}<|fim_middle|>`, max_tokens 48,
   stop on newline-or-closing-bracket, temperature 0.2, single slot.
3. CONTEXT WINDOWING: prefix = cursor back ~1,500 chars (but whole current
   line always), suffix = cursor forward ~500 chars. Inject 1-3 top symbols
   from the codebase index (aide-context-retrieval-wiring) as a comment header
   ONLY if prompt stays under 2k chars — grounding without latency.
4. EDITOR UI: Monaco `registerInlineCompletionsProvider` on the app's models;
   debounce 250ms after idle; cancel in-flight via AbortController on every
   keystroke; never show across a line you didn't ask for. Tab accepts, Esc
   dismisses.
5. TELEMETRY: log {shown, accepted, chars, latency_ms, model} to the events
   bus; acceptance rate is the ONLY success metric — target ≥25% accepted/shown
   before tuning anything else.

## Why it's done this way

- 360M-small + dedicated port is the only path to <350ms on a GTX 1060 shared
  with a 4B chat model. A big model "also doing completion" is how rivals fail
  on local hardware.
- FIM beats chat-prompted completion: model sees BOTH sides of the cursor and
  generates nothing but the middle — fewer tokens, better bracket/indent
  behavior.
- Reuse ModelManager lifecycle: keep-warm, stop, status, doctrine — all free.
  The only new code is the serving shape + the Monaco provider.

## Dependencies / issues / bugs

- Depends on: ModelManager lifecycle (built), smollm2-360m in-box + manifest
  entry (built, port 8082), Monaco editor (built), events bus (built),
  codebase index for grounding (aide-context-retrieval-wiring).
- VERIFY FIM token support for smollm2 in its GGUF template first — if absent,
  fall back to prefix-only prompting (suffix omitted) and say so in telemetry.
- Coexistence: completion engine + cipher both resident = ~5.5GB commit; the
  2.5GB floor law holds — completion engine loads FIRST at editor boot, before
  chat models.
- Do NOT route completions through the arch chat or harness scaffold — that
  path costs >1s and pollutes telemetry. Direct /v1/completions only.

## Threat matrix

| Threat | Signature | Defense |
|---|---|---|
| Latency death from shared engine | completions queue behind chat gens | dedicated port + single slot + in-flight abort |
| Secrets echoed into suggestions | API keys in open files suggested verbatim | skip files matching deny-list (.env etc); strip long high-entropy tokens from output |
| Copy-paste licensing paranoia | suggestion reproduces long file verbatim | cap 48 tokens; suppress if suffix match >90% of a single source line region |
| FIM tokens unsupported | gibberish or echo of fim markers | template sniff at startup; prefix-only fallback mode |
| Engine steal under memory pressure | cipher start kills completion engine (stopAll) | completion engine registers as lifecycle-managed with stay-warm flag; cipher start uses drain-wait, not blanket stop |
| Suggestion hijack via open file content | malicious repo file injects "delete everything" completion | completions are DATA; never executed; length cap; no tool calls from this path |

## Pitfalls

- Do NOT debounce below 150ms (token burn) or above 500ms (feels dead).
- Do NOT keep a completion request alive across keystrokes — abort always.
- Do NOT log file content in telemetry — path + counts only.
- Do NOT cache completions by cursor position alone (same position, changed
  buffer = different answer).

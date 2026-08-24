# Cipher — The Living Model Architecture

## What You're Describing (in plain terms)

A model that:
- Knows your workspace, your preferences, your past decisions
- Tries things in a safe sandbox before showing you results
- Remembers what worked and what didn't
- Gets better at YOUR workflow specifically
- Runs locally, always available

## What This Actually Is (technically)

Not weight updates. Not exotic architecture. Three systems working together:

### 1. Workspace Awareness (partially built)
- File tree + LSP already wired ✓
- RAG index exists daemon-side (needs UI wiring = W7)
- Session store remembers engine selection ✓
- MISSING: injecting relevant file context into chat prompts automatically

### 2. Sandbox Execution Loop (the core missing piece)
When the model proposes code changes:
1. Write to scratch copy (NOT user's file)
2. Run tests/lint/compile against the scratch copy
3. If passes → show diff for approval
4. If fails → feed error back to model for retry (up to N attempts)
5. Only verified-passing results reach the user

This is the Feedback-Over-Form pattern (>4σ improvement proven).
Components exist: task service runs commands, agent tools read/write files.
MISSING: the automated refine-loop wiring that connects proposal→execution→feedback→retry.

### 3. Preference Memory (designed, not wired)
Every approve/reject/retry logs to events.jsonl. Pattern extraction produces
[learned] blocks injected into future scaffolds. After enough samples:
"You prefer async/await over .then() chains" becomes automatic context.

## Why This Makes Static GGUFs Obsolete

Static GGUF: same prompt → same quality output, forever. No memory of your
preferences, no awareness of past mistakes, no adaptation.

Cipher (base + harness): same base weights, BUT the context around it evolves.
It's like the difference between a developer with amnesia who starts fresh
every day vs one who remembers every project they've ever worked on.

The base model provides raw capability. The harness provides accumulated
intelligence. Together = fluid, adaptive, improving.

## What We Need to Build (in order)

1. SANDBOX LOOP (the big one): TASK proposes → writes to scratch → runs verify
   → feeds errors back → retries → presents verified result. Uses existing
   task service + file contracts. ~200 lines of new orchestration code.
2. CONTEXT INJECTION: when building the chat scaffold, query events.jsonl for
   relevant [learned] entries and inject top matches. ~50 lines.
3. PREFERENCE MEMORY: store {pattern, preference} pairs from approvals/rejections.
   Inject as "Operator prefers X" lines in scaffold. ~30 lines.
4. WORKSPACE AWARENESS: include file tree summary + recent git log in scaffold
   workspace-facts section. ~20 lines.

Total estimated: ~300 lines of new code across app.js, server.mjs, scaffold.mjs.

## What We DON'T Need

- Weight updates / LoRA training (that's a later enhancement)
- Vector databases or embedding servers
- Cloud APIs or external services
- New dependencies

Everything uses existing infrastructure: file contracts, task service,
session store, events.jsonl, profile sidecars.

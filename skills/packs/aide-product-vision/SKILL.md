---
name: aide-product-vision
description: North-star product vision for the AIDE offline-first IDE — seamless online/offline model continuity (BYOK handoff, connectivity failover mid-task), closed-loop harness that improves every model via built-in SOP/credo layers, GGUF recommendations for every device/task, and an eventually fine-tuned house model with MCP tooling. Use at the START of any feature decision to test it against the vision, when prioritizing roadmap items, or before scoping any new capability.
---

# AIDE Product Vision (north star — locked 2026-08-24)

## The one-line pitch
Everything VS Code + Copilot can do, but simpler, fully offline-first out of the box, BYOK-online on demand, with zero lost context when switching between them.

## The three pillars

### P1 — Offline-first from the first minute
- User installs AIDE with ZERO internet and is productive: bundled local models for plan / act / utility roles already fit their device (M-series fit verdicts recommend what runs comfortably).
- Any-GGUF support: users bring any GGUF they want; AIDE benchmarks the DEVICE (measured tok/s, not just estimates) and recommends models that fit comfortably per task (coding vs planning vs chatting).
- Hub search/download works on explicit user action only (No-Phone-Home law unchanged).

### P2 — Seamless continuity local <-> cloud
The signature moment (user's words): drop internet mid-task -> AIDE says "You've lost internet. Falling back to a local model you have available offline — I recommend this one" -> user approves -> work picks up exactly where the cloud model left off, seamlessly. And the reverse: sign into a subscription (OpenRouter/OpenAI/Anthropic key) -> same window, same conversation, hand over to the frontier model instantly.
Required capabilities (each needs research->skill->build):
1. Connectivity watchdog (daemon-side; offline detection must be LOCAL — never probe the internet to check for internet).
2. Session carryover across chatFn switch: conversation state, task state, checkpoints survive a provider swap mid-session (extends H1 handoff bundles + agent-loop session state).
3. Role routing already exists (H2 plan/act/utility); failover = automatic role re-resolution with user consent prompt, not silent swap.
4. Context awareness of WHEN to hand off: cost/capability/privacy policy layer — e.g. long context -> cloud if consented; secrets in workspace -> stay local; no network -> local always.

### P3 — Closed-loop harness that makes every model better
- Every model served by AIDE gets the harness layer: SOPs, operating guidelines, verification discipline injected as system scaffolding (see aide-harness-prompt-scaffolding skill) — like the skills this project itself operates under, but built into the product for END USERS' workflows.
- Deterministic gates (verify/AST/test-run) grade outputs; failures feed the improvement loop (post-training-closed-loop skill pattern), so harness usage data can later train our own house model.
- Eventually: a house model fine-tuned specifically FOR AIDE's harness (DeepSeek-class reasoning + Liquid-class tool calling).

### P3b — Built-in MCP tool servers (packaged, not remote) — user clarification 2026-08-24
AIDE ships with every developer tool ALREADY IN THE BOX, exposed as built-in LOCAL MCP servers: file ops, git, terminal/tasks, workspace search/index, docs — the whole surface the daemon already owns, offered over standard MCP so ANY model (bundled local GGUF or BYOK cloud) can call tools through one uniform protocol. ZERO outside API calls for tooling: nothing to sign up for, nothing phones home, works fully offline day one. Remote MCP connectors remain strictly opt-in BYO later. Needs its own research->skill before build: MCP spec version, transport (stdio vs HTTP+SSE) choice, tool-manifest security/sandboxing, how our extension-host capability rules (P9) govern third-party MCP servers vs first-party bundled ones.

## Adoption bar (internal targets)
Public-facing materials stay pure technical (no funding/contest talk — hard rule). Success signal = organic stars/forks/contributors because the product solves the real problem: AI IDEs die without internet; ours doesn't.

## Decision rule for ANY new feature
1. Does it strengthen a pillar (offline-first / seamless continuity / improving loop)?
2. Does it respect the standing laws (In-the-Box, No-Phone-Home default, Verify-First, keys never leak)?
3. Does it have a researched skill SOP before code is written?
If any answer is no, it waits.

## Related skills (the operating map)
aide-master-roadmap (phases), aide-cloud-handoff (H1+H2 shipped base), aide-model-hub-acquisition (M series), aide-harness-prompt-scaffolding (P3 core), aide-production-cutover (wiring everything live), aide-device-benchmark-runner + aide-model-task-recommender (P1 recommendations), aide-unified-diff-repair (model quality blocker).

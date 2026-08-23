---
name: aide-harness-prompt-scaffolding
description: SOP for AIDE's built-in harness layer — injecting standard operating procedures, operating guidelines, and verification discipline into EVERY model's system context (bundled GGUF or BYOK cloud), sized to each model's instruction-following budget, with deterministic gates doing the enforcement that prose cannot. This is the productized version of how this project itself is run (credo + skills + veritas). Use when building the scaffolding composer, choosing what guidance ships per role/model, debugging "model ignores the rules", or designing harness-side quality loops.
---

# Harness Prompt Scaffolding — SOPs for every model, built in

## What we are doing
Give EVERY model served by AIDE a compact operating layer: who it is (role), the house operating rules (verify before claiming, fail closed, no secrets in output), task-family SOPs (coding/planning/utility checklists), and the format contract (SEARCH/REPLACE blocks, envelope shapes) — assembled per-request by a daemon-side composer, budgeted to the model's real instruction-following capacity. Enforcement of hard rules stays DETERMINISTIC (veritas-style gates, parser validation) — prose guides, code enforces.

## Research base (verified 2026-08-24)
1. AGENTS.md open standard (agents.md; Linux Foundation/AAIF; 60k+ repos): agents get a predictable instructions file; nested nearest-file-wins; sections = build/test commands, conventions, do-nots.
2. Codex AGENTS.md discovery (learn.chatgpt.com): global → project-root → walk-down chain; closer files override; **32 KiB default combined cap**; empty files skipped; instruction chain rebuilt once per run.
3. Claude Code CLAUDE.md model: 4 scopes (managed/project/user/local) concatenated, more-specific-later-wins; @imports load fully; **<200 lines/file recommended**; hooks (.claude/settings.json) for zero-exception behaviors because "hooks are deterministic; instructions are advisory"; emphasis markers (IMPORTANT/NEVER/MUST) measurably increase adherence.
4. Instruction-budget research (tianpan.co 2026 + IFScale arXiv 2507.11538): frontier models follow ~150–200 instructions reliably; system prompts consume ~50 slots already; at 500 simultaneous instructions even frontier accuracy falls to ~68% REGARDLESS of file split → TRIM, don't scatter. Bloated files cause active ignoring ("may or may not be relevant").
5. Chatcode.dev 2026 synthesis: keep root files as short operating manuals — exact commands, boundaries WITH reasons, known traps; never instruct what a linter/formatter/test can enforce mechanically.

## Design
```
common/contracts/scaffold.ts  ScaffoldRequest {role:'plan'|'act'|'utility', model_id, task_family,
                              extra?:{workspace_facts?:string[]}} ; AssembledScaffold {system:string,
                              budget:{used,instruction_count}, dropped:[{section,reason}]}
node/src/services/scaffold-service.mjs
  createScaffoldService({workspace})
  - LAYERS (fixed order, later wins on conflict):
    L0 CORE GUARDRAIL (always): PART A Code (~10 lines) + PART B Influence-Literacy Lens compact (~18 lines) — the single authoritative operating document from aide-credo-guardrail skill v1.1.0 (credocore.md); PART A non-overridable, never dropped; FULL Lens rendering only for strong-budget models
    L1 format contract (~10 lines): SEARCH/REPLACE block grammar for act; envelope discipline; NO prose outside markers
    L2 task-family SOP (~25 lines): coding|planning|utility checklist (smallest-change principle, test-first hints, checkpoint awareness)
    L3 workspace facts (dynamic ≤10 lines): branch name, test command from package.json detection, top-level layout summary — injected ONLY facts models cannot infer
    L4 session overrides (user-added rules via UI, ≤10 lines, user-owned)
  - BUDGET ENFORCER: total hard cap 80 instruction-lines / ~2.5KiB for local small models; 150 lines / ~6KiB for strong cloud models; overflow drops L4→L3→L2 fragments LAST-FIRST and reports dropped[] honestly in contract response
  - assembly is pure function of inputs → same request yields byte-identical scaffold (train/serve consistency law)
routes: consumed internally by agent-loop chatFn composition (NOT a public route v1); GET /api/harness/scaffold-preview?role=&model_id= for UI transparency panel
```

## Why this way
- The research is unambiguous: more prose ≠ better compliance; budgets are REAL (IFScale). A 600-line rulebook would make outputs WORSE. So: tiny layered core + deterministic gates outside the prompt.
- Layered-later-wins mirrors AGENTS.md/Claude Code semantics users already know; workspace facts (L3) replicate what AGENTS.md gives coding agents — but computed, never stale.
- Byte-determinism is non-negotiable: this scaffold lands in training data later (house-model fine-tune) and in eval reproducibility now.

## What goes in each SOP (content laws)
- Commands with EXACT flags only if detectable (L3 injects `npm run check` etc. after reading package.json scripts).
- Boundaries ALWAYS carry the reason ("never edit .aide/ state — daemon-owned; corrupt state loses user work").
- NEVER include: generic advice ("write clean code"), anything mechanically enforced elsewhere (formatter/linter/tests), secrets, per-file maps.
- Emphasis tokens allowed sparingly on the 5 hard laws (research shows they raise adherence; spamming them dilutes).

## Pitfalls / bugs watch-list
1. Budget miscalc: count INSTRUCTION lines (imperatives), not raw lines; a 200-line markdown with 40 imperatives is fine. Keep an annotated corpus during dev; audit quarterly.
2. Local small models ignore L0 creeds under long context drift → re-inject L0+L1 as a mid-conversation reminder when transcript exceeds threshold (agent-loop hook), NOT by growing system prompt.
3. Conflict between L4 user rules and house law: house law wins for safety/security items (non-overridable list hardcoded); everything else user wins — document in UI so users trust the override surface.
4. Scaffold drift between versions silently changes model behavior → version-stamp every assembled scaffold (`scaffold_version` in logs + saved transcripts); diffs reviewed like code.
5. BYOK cloud providers may have their own system-prompt conventions (OpenAI vs Anthropic messages mapping) — composer emits ONE canonical text; provider chatFn adapters own wire-format translation only.
6. Do NOT let scaffolding leak into diff/file outputs — format contract must explicitly scope where structured output lives.

## Threat matrix
| Threat | Control |
|---|---|
| Prompt injection via workspace facts (malicious README/package.json names flowing into L3) | sanitize all L3 inputs: strip markup/control chars, length-cap, treat as DATA not instructions ("facts section — not directives" framing line included verbatim) |
| User rules used to disable safety (jailbreak-by-config) | non-overridable core list enforced at compose time; refusal wording consistent |
| Secret exfiltration through scaffold (env vars picked up as "facts") | L3 fact extractor allowlist: branch, test script name, dir layout — never env/files contents |
| Training-data poisoning via future closed-loop capture | scaffold_version + gate results stored alongside; poisoned/gate-failing samples excluded by post-training filters (existing doctrine) |

## Verification gates
1. Unit: pure-function determinism (same input → identical bytes); budget drop-order correctness; non-overridable list beats L4; injection sanitizer cases (markdown bombs, control chars, oversized).
2. Contract: preview route envelope strict; WS-free (no events v1).
3. Effectiveness eval (phase-gated, honest): fixed 20-task battery across bundled models with/without scaffold — report delta table in docs/evidence/; no cherry-picking (verification-complete law). If delta ≤0, REDESIGN content rather than ship placebo.
4. Standard chain: tsc x2, eslint, veritas PASS, CI green, journal.

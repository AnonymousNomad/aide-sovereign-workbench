---
name: aid-skills-auto-load-by-context
description: Wire in the AIDE orchestrator to auto-load the right skill (SOP) into every model prompt based on detected task type — the "fluid model" pattern from the 2026 research. Theia AI calls this "Agent Skills (Alpha)"; Cursor has plans; Copilot has instructions. AIDE already has ~80 skills in the global tree but they are loaded manually by the agent. This skill encodes the exact wire-in: the skill registry, the detection signals, the injection point in harness/orchestrator.mjs, and the test that proves the right skill lands in the system prompt for the right task. Use whenever the user wants the model to behave like an expert per task without naming a skill, or when building any new orchestrator that composes multiple skills.
---

# Skills Auto-Load by Context — Wire-In Recipe for AIDE

## What this skill is

AIDE has ~80 skills in the global tree (`C:\Users\Grey_\.agents\skills\*.md`). Each one is a Standard Operating Procedure (SOP) — a doctrine document that tells the model exactly what to do, how to do it, what not to do, and which pitfalls to watch for. Today, these skills are loaded manually: the user (or the orchestrator) has to NAME a skill for it to appear in the system prompt.

**This is the wrong default.** Per the 2026 research (Theia AI Skills, Cursor plans, Copilot instructions), the standard is: **the orchestrator detects the task type and auto-loads the right skill**. The user never names a skill. The model behaves like an expert per task because the SOP changed, not because the weights changed.

This skill encodes the exact wire-in: the skill registry, the detection signals, the injection point, and the test that proves the right skill lands in the system prompt for the right task.

## Research base (primary sources, verified 2026-09-03)

1. **Theia AI Skills (Alpha)** — `https://theia-ide.org/docs/user_ai/#agent-skills-alpha`
   - "Skills are directories of instructions + resources that the orchestrator loads automatically based on context."
   - "The user never names a skill."
   - Each skill has a `name` + `description`; the orchestrator matches user intent to skill metadata.
   - The skill content is injected into the system prompt when the orchestrator detects a match.
   - Skills can be created on the fly (CreateSkill agent) or shipped with the IDE.

2. **Theia AI Agent Modes** — `https://theia-ide.org/docs/theia_ai/#agent-modes`
   - Agents can have multiple operational modes (concise, detailed, plan, edit).
   - The mode selector appears in the chat input UI.
   - The selected mode changes the system prompt behavior.

3. **Theia AI Variables and Tool Functions** — `https://theia-ide.org/docs/theia_ai/#variables-and-tool-functions`
   - Variables inject context into the prompt (e.g. `#file:foo.ts` → file content).
   - Tool functions let the LLM call actions on demand.
   - Skills are a higher-level composition: instructions + variables + tool functions.

4. **Theia AI Architecture** — `https://theia-ide.org/docs/theia_ai/`
   - Agents are injected services that mediate between the UI and the LLM.
   - The Prompt Service resolves variables and functions in prompt fragments automatically.
   - Custom agents register via DI (`bind(Agent).toService(MyAgent)`).

5. **AIDE architecture (verified from source)**:
   - `harness/orchestrator.mjs` (111 lines) is the main orchestrator. Flow: intake → plan (`reason` provider) → build (`build` provider) → repair → verify (`verify` provider) → veritas.
   - `node/src/services/agent-loop.mjs` (561 lines) is the agent loop that calls the model with the constructed prompt.
   - `node/src/services/agent-loop.mjs:10-19` loads the credocore guardrail into the system prompt (PART A only, 6 lines).
   - `node/src/services/agent-loop.mjs:8` comment: "Shared credo loader — single discipline source per THE QUAD Law #1."
   - The orchestrator's `reason` step is the natural injection point: before calling the LLM, detect the task type and load the matching skill.

6. **Existing AIDE skills** (the auto-load source pool):
   - `C:\Users\Grey_\.agents\skills\aid-dap-real-debugpy-fixture\SKILL.md` — Python debug tasks
   - `C:\Users\Grey_\.agents\skills\aid-double-check-everything\SKILL.md` — pre-commit verification
   - `C:\Users\Grey_\.agents\skills\aid-closed-loop-self-improvement\SKILL.md` — self-improvement tasks
   - `C:\Users\Grey_\.agents\skills\aid-moe-lora-6gb-card\SKILL.md` — fine-tuning tasks
   - `C:\Users\Grey_\.agents\skills\aid-venv-care\SKILL.md` — Python venv tasks
   - `C:\Users\Grey_\.agents\skills\aide-arch-protocols\SKILL.md` — LSP/DAP tasks
   - `C:\Users\Grey_\.agents\skills\aide-release-engineering\SKILL.md` — release tasks
   - `C:\Users\Grey_\.agents\skills\process-hygiene-sop\SKILL.md` — process management
   - `C:\Users\Grey_\.agents\skills\github-repo-professional-setup\SKILL.md` — README tasks
   - `C:\Users\Grey_\.agents\skills\shopify-capability-engineering\SKILL.md` — Shopify tasks
   - ... and ~70 more.

## The skill registry (the detection table)

A skill is selected by matching the task text + workspace context against detection signals. The registry is a simple table:

| Task signal (keywords in user request) | Skill to load | Path |
|---|---|---|
| `debug`, `breakpoint`, `DAP`, `pydevd`, `debugpy` | `aide-arch-protocols` | `C:\Users\Grey_\.agents\skills\aide-arch-protocols\SKILL.md` |
| `LSP`, `language server`, `completion`, `hover`, `diagnostics` | `aide-arch-protocols` | same |
| `commit`, `push`, `PR`, `merge`, `CI`, `verify`, `green` | `aide-release-engineering` | `C:\Users\Grey_\.agents\skills\aide-release-engineering\SKILL.md` |
| `README`, `LICENSE`, `llms.txt`, `badge`, `professional` | `github-repo-professional-setup` | `C:\Users\Grey_\.agents\skills\github-repo-professional-setup\SKILL.md` |
| `Shopify`, `theme`, `Liquid`, `section`, `app block` | `shopify-capability-engineering` | `C:\Users\Grey_\.agents\skills\shopify-capability-engineering\SKILL.md` |
| `fine-tune`, `LoRA`, `QLoRA`, `training`, `checkpoint` | `cipher-qlora-finetune` | `C:\Users\Grey_\.agents\skills\cipher-qlora-finetune\SKILL.md` |
| `venv`, `python`, `py -3.10`, `pip install` | `aid-venv-care` | `C:\Users\Grey_\.agents\skills\aid-venv-care\SKILL.md` |
| `process`, `llama-server`, `kill`, `cleanup`, `stray` | `process-hygiene-sop` | `C:\Users\Grey_\.agents\skills\process-hygiene-sop\SKILL.md` |
| `desktop control`, `mouse`, `keyboard`, `window`, `screenshot` | `aide-p6-desktop-control` | `C:\Users\Grey_\.agents\skills\aide-p6-desktop-control\SKILL.md` |
| `self-improve`, `closed-loop`, `trajectory`, `retrain` | `aid-closed-loop-self-improvement` | `C:\Users\Grey_\.agents\skills\aid-closed-loop-self-improvement\SKILL.md` |
| `verify`, `check`, `test`, `battery` | `aid-double-check-everything` | `C:\Users\Grey_\.agents\skills\aid-double-check-everything\SKILL.md` |
| `Windows`, `win32`, `EBUSY`, `libuv`, `UV_HANDLE_CLOSING` | `aide-windows-dev-reality` | `C:\Users\Grey_\.agents\skills\aide-windows-dev-reality\SKILL.md` |

Multiple matches are allowed (skills compose). The order is: match → load → append to system prompt. If no match, load nothing (don't pollute the prompt).

## The injection point

In `harness/orchestrator.mjs`, the `reason` step is the natural injection point. Before calling the `reason.complete()` provider, the orchestrator should:

1. Take the user's task text + workspace context.
2. Match against the skill registry (case-insensitive keyword search).
3. Load the matching skill files (read the SKILL.md, strip the YAML frontmatter).
4. Append the skill content to the `context` parameter passed to `reason.complete()`.

The current code (line 35-49) builds the context like this:

```js
const plan = await reason.complete({
  role: 'reason',
  mandatory_credo: MANDATORY_CREDO,
  instruction: 'Return constraints, risks, files to inspect, and a test checklist. Do not edit files.',
  task: goal,
  context: bounded(JSON.stringify(context), rules.max_context_bytes, 'context')
});
```

The wire-in is to add a `skills` field to the context (or a new `skillsText` parameter) that contains the loaded skill content. The `reason` provider's system prompt includes `{{skills}}` which resolves to the loaded content.

## The wire-in steps (one thing at a time)

1. **Create the skill registry module** at `harness/skill-registry.mjs` (new file, ~40 lines):
   - Export `loadSkillsFor(task, context)` that returns a string of loaded skill content.
   - Implement the keyword matching from the table above.
   - Read each SKILL.md, strip YAML frontmatter, append to the result.
   - Cap the total size at `rules.max_context_bytes / 2` to leave room for the actual context.

2. **Modify `harness/orchestrator.mjs`** (line 1-5, add import):
   ```js
   import { loadSkillsFor } from './skill-registry.mjs';
   ```
   (line 49, before `reason.complete`):
   ```js
   const skillsText = bounded(loadSkillsFor(goal, context), rules.max_context_bytes / 2, 'skills');
   const plan = await reason.complete({
     role: 'reason',
     mandatory_credo: MANDATORY_CREDO,
     skills: skillsText,  // NEW
     instruction: '...',
     task: goal,
     context: bounded(JSON.stringify(context), rules.max_context_bytes, 'context')
   });
   ```

3. **Modify the `reason` provider's prompt** to include `{{skills}}` (this is provider-specific; the harness doesn't own the prompt).

4. **Write the test** at `tests/arch/skill-registry.test.ts` (new file, ~60 lines):
   - Test 1: `loadSkillsFor("debug this Python script with breakpoints")` returns the `aide-arch-protocols` skill content.
   - Test 2: `loadSkillsFor("write a Shopify theme section")` returns the `shopify-capability-engineering` skill content.
   - Test 3: `loadSkillsFor("explain the color blue")` returns nothing (no match).
   - Test 4: `loadSkillsFor("debug and commit this")` returns BOTH `aide-arch-protocols` AND `aide-release-engineering` (multiple matches).
   - Test 5: the returned string is bounded (doesn't exceed max_context_bytes / 2).

5. **Verify the wire-in end-to-end**: run the orchestrator with a real task and check the model's output reflects the loaded skill.

## Verification (the gate)

The skills-auto-load stage is complete when:
1. `harness/skill-registry.mjs` exists and exports `loadSkillsFor(task, context)`.
2. `harness/orchestrator.mjs` imports and calls `loadSkillsFor` before `reason.complete`.
3. `tests/arch/skill-registry.test.ts` passes all 5 tests.
4. A real orchestrator run with task "debug this Python script" produces a plan that references DAP / breakpoints (proving the skill was loaded).
5. A real orchestrator run with task "explain the color blue" produces a plan that does NOT reference DAP / breakpoints (proving no false-positive loading).

## Pitfalls (each cost a cycle in research)

1. **Loading too many skills** — the system prompt overflows. Cap at max_context_bytes / 2.
2. **Loading the wrong skill** — keyword matching is brittle. "debug" matches DAP but also "debug a network issue" which should load a different skill. Mitigation: use context (workspace files) to disambiguate, or accept false positives for now.
3. **YAML frontmatter in skill files** — strip it before injecting. The frontmatter is metadata, not instructions for the model.
4. **Skill content is too long** — some skills are 400+ lines. Cap each skill at a max bytes (e.g. 8000 bytes) to keep the prompt manageable.
5. **Not updating the provider's prompt** — if the `reason` provider's system prompt doesn't include `{{skills}}`, the loaded content is ignored. The wire-in is two-sided: the harness loads it, the provider renders it.
6. **Loading skills for the build step** — the `build` provider doesn't need skills, it needs the plan. Only the `reason` step benefits from skill auto-loading.
7. **Modifying credocore** — the credo is loaded separately (line 10-19 of agent-loop.mjs). Don't conflate skills and credo. Skills are domain SOPs; credo is the universal discipline.

## What NOT to do

- **Do NOT load all skills always** — that defeats the purpose. Load only what matches.
- **Do NOT use regex** — keyword matching with `.includes()` is simpler and good enough.
- **Do NOT modify the existing skills** — the skills are the source of truth. The registry is a read-only layer.
- **Do NOT skip the test** — the test proves the wire-in works. Without it, the orchestrator silently loads nothing.
- **Do NOT load skills in the build step** — the `build` provider already has the plan. Loading skills there just pollutes the context.

## Related skills

- `aide-advanced-orchestration` — the master orchestration doctrine (loaded earlier in this session).
- `aide-harness-prompt-scaffolding` — the composer that injects credo + skills into every model context.
- `aide-credo-guardrail` — the universal discipline (PART A + PART B) that ships with every model.
- `agent-notes` — the journal protocol; this wire-in must be logged.
- `aid-double-check-everything` — the verification protocol for this work.

## Verification record (per agent-notes)

After the wire-in, append to `AGENT_NOTES.md`:

```
- [YYYY-MM-DD HH:MM] T1: Skills auto-load by context wired in (stage 6)
  - Created E:\aide-sovereign-workbench\harness\skill-registry.mjs
    (verifiable: loadSkillsFor('debug Python') returns aide-arch-protocols content)
  - Modified E:\aide-sovereign-workbench\harness\orchestrator.mjs
    (line 1-5: added import; line 49: added skills field to reason.complete)
  - Wrote tests/arch/skill-registry.test.ts
    (verifiable: 5 tests pass, 0 fail)
  - Verified end-to-end: orchestrator run with "debug this Python script"
    produces a plan that references DAP / breakpoints
  - check:arch delta: +5 passed -0 failed
- Next: stage 7 - resolve the 3 failing CI PRs
```

## Implementation update (2026-09-03)

The original recipe above is superseded where it describes a hardcoded global
skill directory or harness-only injection. The verified project implementation
now lives at `E:\aide-sovereign-workbench\harness\skill-registry.mjs` and
`node/src/services/agent-loop.mjs`:

1. Resolve project-local `skills/packs` and standard `.agents/skills`,
   `.github/skills`, `.claude/skills`, `.cursor/skills`, and `.codex/skills`
   roots before the configured user root.
2. Use `AIDE_SKILLS_ROOT` or the user's `.agents/skills` directory as the
   portable user fallback; never assume another developer's absolute path.
3. Match task text deterministically, validate a skill's declared name when
   present, strip frontmatter, enforce UTF-8 byte caps, and load only matching
   skill bodies.
4. Inject selected skills into the live agent-loop system prompt before the
   first model call, not only into the standalone harness orchestrator.
5. Persist selected skill names and loaded bytes in the local trajectory for
   auditability. Prompt guidance does not replace deterministic permissions,
   approval, or verification gates.

Verified project gates: portable live agent-context test `1/1`, registry tests
`8/8`, agent routes `5/5`, architect/editor routes `6/6`, node/browser tsc with
no diagnostics, and ESLint with zero errors. The current implementation still
uses deterministic keyword matching; semantic routing and context-pack digest
capture remain future work.

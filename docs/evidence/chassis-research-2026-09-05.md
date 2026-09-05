# Chassis research + acceptance plan — 2026-09-05

The operator said: build the chassis first, more important than everything that comes after. Skills after. This is the plan for the chassis.

**Why this is happening now:** the operator described the closed loop — the model, harness, orchestrator, and code all reinforce each other, nothing wasted, everything versions and improves. The existing chassis (182 skills in `skills/registry.json` + `harness/skill-registry.mjs` keyword detector) is a *seed*, not a chassis. It has skills, but no orchestrator, no SOP-vs-skill separation, no Helix fingerprinting routing, no versioning, no closed-loop capture. We need to build the chassis that makes skills a *living system* instead of a static pile.

## Primary sources read (current, live, primary)

1. **[Anthropic context management blog post](https://www.anthropic.com/news/context-management)** (Sep 29 2025) — the public, primary-source announcement of context editing + memory tool. Two distinct primitives:
   - **Context editing**: automatically clears stale tool calls/results from the context window when approaching the limit. 29% improvement on agentic search eval; 84% token reduction in 100-turn web search; enables workflows that would otherwise fail.
   - **Memory tool**: file-based storage outside the context window, accessed via tool calls. Claude can create/read/update/delete files in a dedicated memory directory. Persists across conversations.
   - Combined: **39% improvement over baseline**. This is the primary-source evidence that the chassis I propose works.

2. **Theia AI skills** (theia-ide.org/docs/user_ai) — skills system: each skill has a name + description; auto-loaded on user mention; per-skill tool allowlist; per-skill prompt fragment. Tasks: Coder, Universal, Orchestrator, Command, Architect, Code Completion, Terminal Assistance, App Tester, Claude Code, GitHub, PR Reviewer, CreateSkill. 12+ task types.

3. **Anthropic effective context engineering** (anthropic.com, Sep 29 2025) — the long-form post. Three long-horizon techniques: compaction, structured note-taking, sub-agent architectures. Hybrid pattern: drop CLAUDE.md up front, use glob/grep just-in-time. The 200-line CLAUDE.md recommended cap; 4 scopes (managed/project/user/local) with more-specific-later-wins.

4. **Anthropic prompt engineering best practices** (platform.claude.com) — be clear and direct; tools minimal overlap; parallel tool calls; default-to-action. The 5 hard laws: "by default implement changes rather than only suggesting them."

5. **AGENTS.md open standard** (agents.md, LF/AAIF, 60k+ projects) — predictable place for agent context; nearest-file-wins; 32 KiB cap; nested AGENTS.md in monorepos.

6. **TheiaCon 2025 + 2026 Theia AI updates** — MCP tool integration (Tools, Resources, Prompts), Session management, Skills as first-class, App Tester with Playwright MCP, agent-to-agent delegation.

7. **Cursor Agent docs** (docs.cursor.com/agent) — Agent + Thinking + Images per model. Agent Mode with file edits in diff editors; auto-loads file context. 200k default context for most models; 1M for Claude Sonnet 5+.

8. **Local audit** (today, against `t1/strict-pass-batch`):
   - `skills/registry.json` — 182 skills across 14 categories: 43 general, 69 aide-core, 12 architecture, 12 training-pipeline, 5 post-training, 5 web-builder, 4 parity, 3 aide-ops, 3 training-ecosystem, 3 academy, 11 phase-legacy, 6 build-series, 2 cloud-handoff, 10 discipline.
   - `harness/skill-registry.mjs:17-29` — `DETECTION_TABLE` is a 12-row keyword table. Fragile: "debug" matches 12 skills, "commit" matches 1 skill, etc. No embeddings, no semantic routing.
   - `harness/skill-registry.mjs:111-131` — `loadSkillsFor` injects matched skill text into the prompt. No "skill" envelope (each skill is just a markdown body), no versioning, no Helix integration, no operator approval per skill, no learning from outcomes.

## Diagnosis (the operator's framing, restated)

The operator's 138→182 skills are a *pile* of knowledge without *compartments*. The model sees them all in one prompt or none, has no way to know which is the right one for the task, and has no way to update them as it learns. The result is the "rocket bolted to a bike frame" problem: knowledge without a brain to put it in.

The chassis is the brain. It has four responsibilities:

1. **Classify** the request → which skill(s) apply? (Not the model's job; the orchestrator's.)
2. **Compose** the right context: universal SOP (L0) + skill body (L1) + workspace facts (L2) + session overrides (L3) + Helix memories (L4). Per Anthropic: don't dump the workspace tree into the prompt; use just-in-time tools.
3. **Route** to the right model + skill + tools. The orchestrator decides, the model executes.
4. **Persist** approved outcomes back: skills improve from real usage; Helix memories grow; the next fine-tune uses real trajectories (Loop C, already in the prior plan).

## What "chassis" means concretely — the four pieces, in order

### Piece 1 — Skill envelope (versioned, runtime, with metadata)

Every skill in the catalog is a file with a strict shape. The chassis reads this shape; the orchestrator routes on it.

```yaml
# skills/<name>/SKILL.md
---
name: code-review              # unique, lowercase, hyphenated
version: 1.4.2                # semver; bumps on every change
category: coding              # primary category
applies_to:                   # when this skill is the right pick
  - code review
  - pull request
  - "review my changes"
  - "check this diff"
depends_on:                   # prerequisite skills
  - github-repo-professional-setup
incompatible_with:            # mutually exclusive
  - auto-merge
tools_required: [read_file, git_diff]   # tools this skill needs
output_format: markdown-comment   # what the skill produces
input_template: "Review the diff in {path}"   # how to phrase the call
sop: |                        # the 8-12 instructions for THIS skill
  1. Read the file or diff.
  2. Identify changed lines and surrounding context.
  3. Check for: bugs, security, style, tests, docs.
  4. If unsure, ask — never silently skip.
  5. Output as a single markdown comment with severity tags.
  6. Cite file:line for every finding.
  7. Mark the verdict: APPROVE / REQUEST CHANGES / COMMENT.
  8. Never edit the file in this skill; only comment.
examples:                     # 3-5 canonical examples (per IFScale, must be tight)
  - input: "review src/api/auth.ts"
    output: "## Findings (REQUEST CHANGES)\n- auth.ts:42 ..."
failure_modes:               # what can go wrong, and how to recover
  - diff_too_large: chunk the diff and review in segments
  - binary_files: skip and note in the comment
success_metrics:             # what good looks like
  - accuracy: 95% of findings match the operator's own review
  - latency: <30s for a 200-line diff
deprecated_since: null        # when was this skill retired (if at all)
replaced_by: null              # which skill replaces this (if any)
---

# Skill body (markdown, max 6KB after frontmatter).
Use this skill when the user asks for a code review. ...
```

The envelope is what the orchestrator fingerprints. The body is what the model reads when this skill is picked. Anthropic's research says: 3-5 examples, keep the skill body small. The frontmatter is structured data; the body is prose.

### Piece 2 — The Orchestrator (routes, doesn't prompt)

The orchestrator runs *before* the model sees a request. It is a deterministic, fast classifier — not a model call. It reads the request, fingerprints it against:
- the skill catalog metadata (skill names, descriptions, `applies_to` triggers)
- the Helix memory of the operator's last 30 days of tasks (similar past requests)
- the live workspace state (what files are open, what changed, what tools are installed)

The orchestrator returns a `WorkflowBundle`:
```js
{
  primarySkill: 'code-review',
  auxiliarySkills: ['github-repo-professional-setup'],
  toolSet: ['read_file', 'git_diff', 'list'],
  scaffold: { L0: 'credo', L1: 'format', L2: 'task_sop', L3: 'workspace', L4: 'helix' },
  systemPrompt: '<rendered>',
  promptBudget: 80,
  cost: 'free',
  rationale: 'task matches code-review triggers; helix history shows 12 prior code reviews this month; workspace has 1 uncommitted diff on src/api/auth.ts',
  requiresApproval: true
}
```

The orchestrator is **deterministic** (no LLM in the routing loop). It uses keyword + embedding + Helix-fingerprint similarity. The model never sees the routing decision — it just receives a small, precise system prompt + tool set + Helix context. Per the operator: "the orchestrator needs to realize and understand what standard operating procedure goes with which tasks."

### Piece 3 — The SOP layer (universal, separate from skills)

A skill is a *route*. The SOP is the *chassis law*. The current `harness/credo.md` (the "Developer's Way" — 8 standards + Veritas oaths) IS the SOP. It already exists, version-stamped (`CREDO_VERSION = '1.1.0'`). What the chassis adds:

- **A canonical SOP catalog** at `sops/<name>.md` (companion to `skills/<name>/SKILL.md`). Each SOP is a *principle*, not a *task*. E.g.:
  - `sops/ask-dont-circle.md` — "When uncertain, surface the question; never silently assume."
  - `sops/verify-before-claiming.md` — "Every claim needs evidence: a test, a command output, a citation."
  - `sops/no-secrets-in-output.md` — "Never log env vars, tokens, paths with credentials."
  - `sops/operator-approves-mutations.md` — "Read_file and list are free. write_file and bash require explicit approval."
  - `sops/fail-closed.md` — "If a tool fails, surface the error; never swallow it."
- The operator's existing `harness/credo.md` is the seed; the new catalog is a *versioned, indexed, machine-readable* copy. The orchestrator decides which SOPs are relevant for the current task (always L0; L1-L4 picked by orchestrator).
- **The SOPs and the skills are versioned separately**, but they both flow through the same chassis. Skills reference SOPs by name; the orchestrator assembles them.

### Piece 4 — Helix routing (memory + fingerprint + close-matches)

Helix is already in the repo (`harness/cipher-state.mjs`, `harness/helix-retention.mjs`, `harness/helix-join.mjs`, `harness/memory-spine.mjs`, `harness/memory-blocks.mjs`). What it needs for the chassis:

- **A fingerprint of every past task**: model id, skill name(s), tool calls made, result, operator approval, Helix digests of the workspace state at decision time.
- **A retrieval API**: given a new request, return the top-3 most similar past tasks (by digest similarity, not exact text match). The orchestrator uses this to:
  - Skip skills the operator has overridden before.
  - Pre-load example trajectories into the model's context (with operator approval).
  - Surface to the operator: "you did this 12 times before; here's what worked."
- **A write path**: when the operator approves a trajectory, append to Helix with a digest. The next training cycle (Loop C, the prior plan) consumes Helix. Skills also read Helix to improve their own examples over time.

## Acceptance plan — what "chassis" MUST prove end-to-end

The chassis is proven by 5 capabilities, each one a battery. **No skills, no new code in the operator command — the chassis is the daemon, the routing, the assembly, the version stamping.** The 3-5 seed skills come after.

| # | Capability | What it proves | Battery |
|---|---|---|---|
| 1 | **Skill envelope parser** | A skill file with the strict frontmatter is parsed deterministically; missing required fields are rejected with a clear error; version, name, applies_to, tools_required, sop, examples, failure_modes are all machine-readable. | 10 tests: happy path, missing name, missing version, bad semver, missing applies_to, missing tools_required, oversized body, etc. |
| 2 | **Orchestrator classifier (no-LLM routing)** | Given a request string + a catalog of 182 skills + Helix memory, the orchestrator returns the correct `WorkflowBundle` (primary skill + aux + tool set + scaffold). The classifier uses embeddings + keyword + Helix fingerprint; it does NOT call any LLM. | 15 tests: 5 high-frequency task types, 3 ambiguous requests, 3 Helix-similar requests, 4 edge cases. |
| 3 | **SOP + skill assembly** | Given a `WorkflowBundle` and a model budget, the assembler composes the system prompt: L0 (universal SOP) + L1 (skill body, capped) + L2 (task SOP from skill) + L3 (workspace facts) + L4 (Helix memories) — within the budget. The output is byte-deterministic. | 10 tests: budget enforcement, SOP-vs-skill separation, determinism, drop order, edge cases. |
| 4 | **Operator-facing workflow bundle** | Given a request, the orchestrator returns a human-readable plan: "I think you want to: review code. Tools: read_file, git_diff. Plan: ... Approve to run." The plan is shown BEFORE the model starts. | 5 tests: bundle is shown before execution; operator approval moves the loop forward; rejection records a Helix memory. |
| 5 | **Helix fingerprinting + close-matches** | Helix stores a digest of every approved trajectory. New requests surface the top-3 similar past tasks. The orchestrator's routing improves over time (the prior research's Loop C close-matches). | 8 tests: digest uniqueness, retrieval ranking, similarity threshold, decayed memory, no-match fallback. |

Plus the 5 must-not-do guards:
- **Don't auto-approve** any skill call. The operator sees the bundle and approves.
- **Don't dump the skill body** into the prompt when the budget is tight. Drop the L1 line, keep L0+L2.
- **Don't make the orchestrator call an LLM.** It's deterministic — keyword + embeddings + Helix similarity.
- **Don't break the 355/355 arch tests or the 23 agent-loop battery or the 10 harness battery.** All additions are additive.
- **Don't change the agent loop's tool implementations.** The chassis composes; the executor still runs.

## Build order — 5 slices, each a single commit, operator tests in a real browser between slices

**Slice C1 — Skill envelope schema + parser (capability 1)**
- NEW: `harness/skill-schema.mjs` — strict frontmatter parser, version validation, body size cap (6KB).
- NEW: `harness/skill-loader.mjs` — loads a skill from `skills/<name>/SKILL.md` or `~/.agents/skills/<name>/SKILL.md` (the existing skill-roots).
- NEW: `tests/in-house-e2e/skill-schema-battery.mjs` — 10 tests.
- Commit: `feat(harness): skill envelope schema + parser (v1)`

**Slice C2 — SOP catalog (the universal law, separate from skills)**
- NEW: `sops/` directory with the canonical SOPs (8-12 files, each ~1KB): `sops/ask-dont-circle.md`, `sops/verify-before-claiming.md`, `sops/no-secrets-in-output.md`, `sops/operator-approves-mutations.md`, `sops/fail-closed.md`, `sops/surface-uncertainty.md`, `sops/cite-the-source.md`, `sops/minimal-diff.md`.
- NEW: `harness/sop-loader.mjs` — loads the SOP catalog (similar to skill-loader).
- The current `harness/credo.md` (Developer's Way, 8 standards + Veritas oaths) is *retained* and *indexed* — it becomes the "SOP v1" entry.
- NEW: `tests/in-house-e2e/sop-catalog-battery.mjs` — 5 tests.
- Commit: `feat(harness): SOP catalog (8 universal standards, separate from skills)`

**Slice C3 — Orchestrator classifier (no-LLM routing, capability 2)**
- NEW: `harness/orchestrator.mjs` — `classifyTask(requestText, skillCatalog, helixContext)` → `WorkflowBundle`. Uses keyword + lightweight embedding (already have `harness/cipher-state.mjs` tokenization) + Helix similarity. No LLM in the loop.
- NEW: `harness/workflow-bundle.mjs` — assembles the bundle: skill list, tool set, scaffold, system prompt (with budget).
- NEW: `tests/in-house-e2e/orchestrator-battery.mjs` — 15 tests.
- Commit: `feat(harness): orchestrator classifier (no-LLM routing) + workflow bundle`

**Slice C4 — Assembly + budget enforcement (capability 3)**
- MODIFY: `harness/scaffold.mjs` (or new `harness/scaffold-v2.mjs`) — the composer takes a `WorkflowBundle` and a model budget (80 lines small, 150 strong), produces a byte-deterministic system prompt. The 5 L0-L4 layers are still there; L0 is always the SOP catalog, L1 is the skill body (or close-match examples from Helix), L2 is the task SOP, L3 is the workspace facts, L4 is the session overrides.
- NEW: `tests/in-house-e2e/scaffold-assembly-battery.mjs` — 10 tests.
- Commit: `feat(harness): scaffold v2 (assembly + budget enforcement from workflow bundle)`

**Slice C5 — Helix fingerprinting + close-matches (capability 5) + operator bundle UI (capability 4)**
- MODIFY: `harness/cipher-state.mjs` — add a `fingerprintTask(taskBundle, outcome)` API. Writes a digest to `.aide/helix/fingerprints/YYYY-MM-DD.jsonl`.
- NEW: `harness/helix-retrieval.mjs` — `topKSimilar(query, k=3)` — cosine-similarity ranking over the digest store.
- MODIFY: `daemon/server.mjs` — new route `POST /api/orchestrator/classify` that returns the `WorkflowBundle` for the operator to approve. The bundle UI lives in the legacy `app.js` (NO cockpit change in this slice).
- NEW: `tests/in-house-e2e/helix-fingerprint-battery.mjs` — 8 tests.
- Commit: `feat(harness): Helix fingerprinting + close-matches + operator bundle UI`

## Threat matrix (per R8)

| Threat | Control |
|---|---|
| Skill body bloat makes the prompt too big | Body cap 6KB; budget enforcer drops L1 lines LAST-FIRST |
| Keyword-based routing misses real intent | Helix close-matches surface similar past tasks; orchestrator presents the top-3 candidates if ambiguous |
| Operator forgets which skills exist | The orchestrator's `WorkflowBundle` shows the chosen skill + its `applies_to` triggers + recent trajectories |
| Chassis code complexity makes it unmaintainable | 5 small files, each one capability, each one a slice |
| New skills arrive faster than the chassis can route them | The catalog is data; the chassis is the routing logic. Decoupled. |
| SOPs drift between versions | `sop_version` stamped in every system prompt; mismatch = warning, not failure |
| Helix grows unbounded | Digest store is append-only; rotation is operator-driven, not automatic |
| Model can't run the agent loop because of slow inference | The chassis doesn't change the agent loop. Operator picks a model that fits. |

## What I will NOT do in these 5 slices (out of scope, parked)

- **Don't add 3-5 seed skills yet.** Skills come after the chassis. The first skill that gets wired will be the one the operator has the most pain without — TBD.
- **Don't change the agent loop, the harness scaffold, the operator, the model manager, the manifest.** The chassis is *additive*. It composes; it doesn't replace.
- **Don't touch the cockpit UI (app.js, index.html, styles.css).** The operator-facing workflow bundle UI lives in the legacy `app.js` for now (a single new card). Cockpit rebuild is a separate branch.
- **Don't run a fine-tune round.** The Loop C trajectory capture from the prior plan is the long-term improvement engine; it consumes Helix fingerprints. The chassis produces Helix fingerprints. The fine-tune consumes them. Two separate slices, two separate slices in two separate branches.
- **Don't touch the Tauri packaging, the Covert rename, the in-house battery.** Other branches.

## Branch + commit hygiene

- One branch: `feat/chassis` (off `t1/strict-pass-batch` after the operator confirms C1 is solid).
- 5 commits, one per slice.
- Each slice = focused test battery + full `npm run veritas` + `npm test` (355 arch + 23 agent-loop + 10 harness from prior slices must stay green) + push + watch CI.
- The 5 skill-catalog slices above + the 3 harness-awareness slices from the prior research + the agent loop from slice A + the env-aware fixes from `a0aa429` = the entire chassis. Everything is additive.

## Files read (no code change in this entry)

- WebFetch: anthropic.com/news/context-management (the primary source for the chassis pattern)
- WebFetch: anthropic.com/engineering/effective-context-engineering-for-ai-agents
- WebFetch: docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/claude-prompting-best-practices
- WebFetch: agents.md (the AGENTS.md open standard)
- WebFetch: theia-ide.org/docs/user_ai (Theia skills system)
- Loaded: `aide-harness-prompt-scaffolding/SKILL.md`, `aide-orchestrator-awareness/SKILL.md`, `aide-cipher-house-model/SKILL.md`, `verify-first-discipline/SKILL.md`
- Read: `harness/skill-registry.mjs` (154 lines, all of it), `harness/credo.md` (72 lines, all of it), `skills/registry.json` (182-skill catalog), `models/manifest.json` (310 lines)
- Read: AGENT_NOTES.md (the chassis-awareness + slice-A + manifest-fix history)

## Files I will touch (no code yet)

**C1 (skill envelope):**
- NEW: `harness/skill-schema.mjs`
- NEW: `harness/skill-loader.mjs`
- NEW: `tests/in-house-e2e/skill-schema-battery.mjs`

**C2 (SOP catalog):**
- NEW: `sops/` directory (8-12 markdown files, ~1KB each)
- NEW: `harness/sop-loader.mjs`
- NEW: `tests/in-house-e2e/sop-catalog-battery.mjs`

**C3 (orchestrator):**
- NEW: `harness/orchestrator.mjs`
- NEW: `harness/workflow-bundle.mjs`
- NEW: `tests/in-house-e2e/orchestrator-battery.mjs`

**C4 (assembly):**
- MODIFY: `harness/scaffold.mjs` (or new `harness/scaffold-v2.mjs`)
- NEW: `tests/in-house-e2e/scaffold-assembly-battery.mjs`

**C5 (Helix + operator UI):**
- MODIFY: `harness/cipher-state.mjs` (add `fingerprintTask`)
- NEW: `harness/helix-retrieval.mjs`
- MODIFY: `daemon/server.mjs` (new `POST /api/orchestrator/classify` route)
- NEW: `tests/in-house-e2e/helix-fingerprint-battery.mjs`

## Next move

Operator sign-off on this 5-slice chassis plan. Slice C1 (skill envelope) first. Operator tests in a real browser after each slice. After all 5 slices are green, the next branch picks up the seed skills (3-5 high-frequency tasks) and the per-class model improvement plan from the prior research.

Coffee. Sign off and I start C1.

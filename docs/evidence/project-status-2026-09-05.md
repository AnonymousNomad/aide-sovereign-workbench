# AIDE Sovereign Workbench — Full Project Status

**For collaborator review.** This is a complete snapshot of the AIDE project as of 2026-09-05, gathered for handoff to a second set of eyes that can give architectural advice.

## 0. How to read this

The project is **AIDE** — a local-first "sovereign workbench" / offline-first IDE built around an in-house GGUF model (cipher / north-mini-code) and a multi-layer skill system. The full git history is at `github.com/AnonymousNomad/aide-sovereign-workbench`. The `main` branch is **behind** `t1/strict-pass-batch` by 4+ months of work that lives on the `t1` lane and several feature branches. **The active development branch right now is `feat/chassis` (off `t1/strict-pass-batch`).** All the recent work the operator and I have done is on `feat/chassis` (this turn's slice C1), `feat/environment-aware-model` (slice A, the agent loop), and `t1/strict-pass-batch` (the long-term baseline).

The two lanes (T1/T2) are:
- **T1 (operator lane, this machine `E:\aide-sovereign-workbench`):** cockpit, daemon, harness, manifest, skills, contracts. The "product" lane.
- **T2 (separate terminal, separate workspace `E:\pip_temp\aide-...`):** corpus generation, fine-tunes, micro-experts, trajectories, training pipelines. The "training data + model" lane.

Per the operator's P7 announce + process-hygiene-sop, T1 NEVER spawns T2's models and T2 NEVER starts T1's daemons. They share only the model artifact files at `E:\models\north-mini-code\` and `E:\aide-sovern-workbench\models\aide-house\`.

---

## 1. High-level architecture

AIDE has three top-level layers, all running in one Node.js process (the "daemon" at port 4779, exposed through a "facade" at port 4777 and a TS "arch" layer at port 4778):

```
+-----------------+  +-----------------+  +-----------------+
|   Cockpit (UI)  |  |  TypeScript     |  |   Legacy Node   |
|  app.js +       |  |  arch layer     |  |   daemon         |
|  browser/       |  |  node/src/      |  |   daemon/        |
|  4173           |  |  4778           |  |   4779            |
+-----------------+  +-----------------+  +-----------------+
        \                  |                   /
         \                 |                  /
          +---------------+------------------+
                          |
                  +---------------+
                  |   Facade       |
                  |   4777         |
                  |   scripts/      |
                  |   facade.mjs    |
                  +---------------+
```

**Cockpit (port 4173, `app.js` 1793 lines):** legacy monolith cockpit. The old AIDE 4-zone UI (Describe / Plan / Apply / Code / Ship). The operator's "the UI is fine for now — don't rebuild it" was a strong signal during this turn; I (mistakenly) rebuilt it once, they reversed it, I reverted, we restored. **The cockpit is unchanged in current work.** It still serves the operator's working daily-driver surface.

**Arch TS layer (port 4778, `node/src/`):** TypeScript Node.js route layer. All the zod-strict contracts, the agent loop, the operator, the task router, the model runtime, the LSP/DAP clients, the Helix memory, the workflow bundles. This is the "modern" daemon and the home of the chassis work happening in `feat/chassis`.

**Legacy daemon (port 4779, `daemon/server.mjs`):** the original AIDE daemon. Still serves a lot of routes (`/api/file`, `/api/chat`, `/api/terminal/run`, `/api/git/*`, `/api/diagnostics`, etc.). The chat handler at line 447 is the path that was returning HTTP 400 to the cipher engine on the first agent-loop turn because it was sending the tool result back as `role:"tool"`, which llama-server doesn't accept. Fixed in commit `a0aa429` to use `role:"user"` with a `[tool_result id=... tool=... approved=...]` marker instead.

**Facade (port 4777, `scripts/facade.mjs`):** request router. Has a static route map at `common/facade-route-map.json` that decides whether each URL goes to the TS arch (177+ routes) or the legacy daemon (~71 routes). Slice A3 of the agent loop added `/api/agent-loop/*` as exact legacy routes (via the new `FLIPS.legacyOnly` block in the generator script) because the agent loop lives in the legacy daemon.

**Operator's machine layout:**
- `E:\aide-sovereign-workbench` — the workbench repo (this codebase, the "T1" lane)
- `E:\llama-cpp\llama-server.exe` — the in-house engine binary
- `E:\pip_temp\aide-...` — T2's temp workspace (corpus, fine-tunes, trajectories)
- `E:\models\north-mini-code\` — the 30B-A3B MoE in-house model (10.5GB on disk, too big for the 6GB card so it stays `status:"pending"` on the manifest)
- `E:\aide-sovern-workbench\models\aide-house\` — cipher-fast base + frontier-lora (4.28GB, works on 6GB card)
- The desktop app at `desktop/` (Tauri 2 with `desktop:dev`, `desktop:build`, `desktop:staged-smoke`) is NOT shipping yet — no `cargo`/`rustc` on the machine. Parked in `docs/evidence/packaging-installation-decision-2026-09-03.md`.

---

## 2. The harness + orchestrator + models — the core of recent work

### 2a. The harness (system prompt for the model)

`harness/scaffold.mjs` (148 lines) composes the system prompt in 5 layers, always in this order, later wins on conflict:

- **L0 (always):** PART A credo (~10 lines, non-overridable) + PART B Influence-Literacy Lens compact (~18 lines, full only for strong-budget models). Source: `harness/credo.md`. The 8 standards of the Developer's Way + Veritas oaths.
- **L1:** format contract (~10 lines): SEARCH/REPLACE block grammar for act; envelope discipline; NO prose outside markers.
- **L2:** task-family SOP (~25 lines): coding/planning/utility checklist (smallest-change, test-first, checkpoint awareness).
- **L3:** workspace facts (dynamic ≤10 lines): branch, test command, top-level layout — only what's verifiable.
- **L4:** session overrides (user-added rules via UI, ≤10 lines).

Budget: 80 lines / 2.5KiB for small models, 150 lines / 6KiB for strong. The IFScale arXiv 2507.11538 paper proved 500 simultaneous instructions drop frontier models to 68% accuracy; budget discipline is mandatory.

### 2b. The agent loop (the tool-calling path)

`harness/agent-loop.mjs` (495 lines) — a 6-tool, multi-turn, approval-gated loop. The model proposes tool calls in a fenced json block; the daemon parses, asks the operator to approve, executes approved ones, feeds results back. 8 turns max, stops on `final_answer` or no-new-tool-call. 6 tools, all sandboxed:

| Tool | Mutating? | Purpose |
|---|---|---|
| `read_file(path, start_line?, end_line?)` | no | read a file or a slice |
| `write_file(path, content)` | YES | atomic write via `.aide-tmp-<pid>` rename |
| `bash(program, args)` | YES | allowlist `node npm npx git py python python3 cargo rustc` + flag denylist (`-e`, `--eval`, `-c`, etc.) + 30s timeout |
| `search(query, icase?, regex?, mask?)` | no | full-text + regex + glob mask |
| `git_diff(path?)` | no | unified diff for a file or whole tree |
| `list(path?)` | no | directory entries |

Routes: `POST /api/agent-loop/start`, `POST /api/agent-loop/decision`, `POST /api/agent-loop/cancel`, `GET /api/agent-loop/status?id=...` (all legacy daemon at 4779, routed through the facade at 4777).

Bugs fixed in `a0aa429` (manifest + agent-loop + parser fixes):
1. Manifest `artifact_uri` for cipher-fast had a trailing parenthetical copy-pasted from the description, so the model-manager looked for a file literally named `aide-house/base.q8_0.gguf (4.28 GB on disk, ...).gguf` — didn't exist. Cleaned to `local://aide-house/base.q8_0.gguf`.
2. `start({modelId})` was ignored — the session always used the loop's default modelId. Wired through.
3. Tool results sent with `role:"tool"` got HTTP 400 from the cipher engine (llama-server doesn't support the OpenAI `tool` role). Changed to `role:"user"` with a `[tool_result id=... tool=... approved=...]` marker.
4. Parser didn't accept bare JSON tool calls (local models often skip the ```json fence). Now accepts fenced `json`, fenced `final_answer`, bare JSON arrays, bare JSON objects, JSON on its own line.

### 2c. The skill system (the existing 182 skills + the new chassis)

`skills/registry.json` (112KB, 182 skills across 14 categories: 43 general, 69 aide-core, 12 architecture, 12 training-pipeline, 5 post-training, 5 web-builder, 4 parity, 3 aide-ops, 3 training-ecosystem, 3 academy, 11 phase-legacy, 6 build-series, 2 cloud-handoff, 10 discipline).

`harness/skill-registry.mjs` (154 lines) — the existing keyword-based detector with a 12-row `DETECTION_TABLE` (debug→aide-arch-protocols, commit→aide-release-engineering, etc.) and `loadSkillsFor(task)` that injects matched skill text into the prompt. **This is a flat keyword matcher. No orchestration, no fingerprinting, no Helix routing, no versioning. The chassis work replaces it.**

`harness/cipher-state.mjs`, `harness/helix-retention.mjs`, `harness/helix-join.mjs`, `harness/memory-spine.mjs`, `harness/memory-blocks.mjs` — DNA-Helix memory system. The 30-day operator task history stored as digests; the chassis work in `feat/chassis` will route through it.

### 2d. The models

`models/manifest.json` (310 lines, fixed in `a0aa429`):
- **Bundled (8082/8083/8087):** smollm2-360m Q8 (port 8082), qwen-coder-0.5b Q4 (8083), qwen-coder-1.5b Q4 (8087, verified, runtime_health:"verified", coding_smoke:"passed").
- **Pending (8085/8086/8088/8089):** smollm2-1.7b, phi-3.5-mini, granite-3.3-2b. All `status:"pending"` (not downloaded).
- **In-house (8091):** cipher-fast — base.q8_0.gguf (4.28GB) + frontier-lora.gguf. Was broken (file not found, duplicate endpoint), now works after `a0aa429`.
- **In-house (8084):** north-mini-code-1.0 (30B-A3B MoE, Q2_K_XL, 10.5GB on disk). Won't run on the 6GB card; `status:"pending"`.
- **In-house (8090):** qwen3-4b-minimax-m2.1-coder.q4_k_m (2.5GB) with `thinking_lora_full_f16.gguf` adapter. `status:"ready"`.
- **Removed (was 8091):** aide-cipher-v1 — file removed; marked `status:"removed"`, endpoint `null`.
- **Duplicate removed:** north-mini-code-1.0-ud-q2_k_xl at 8092 was a duplicate of the 8084 entry; deleted.

The 4 ports 8081-8088 are convention slots; 8081 has been the operator's `qwen3.5-4b` (unrelated, owned by T2-style). 8084-8089 are reserved for the optional packs. The new chassis uses `/api/agent-loop/*` to avoid all these.

### 2e. The closed loop (per the operator's "nothing wasted, everything reinforces each other")

This is the chassis design that the operator described this turn. The closed loop:

```
User request
  -> Orchestrator (no LLM): keyword + embedding + Helix fingerprint
       -> picks WorkflowBundle { primarySkill, auxSkills, toolSet, scaffold, systemPrompt, promptBudget, cost, rationale, requiresApproval }
  -> Operator sees the bundle, approves
  -> Scaffold composer (L0 SOP + L1 skill body + L2 task SOP + L3 workspace + L4 Helix)
  -> Model runs the agent loop
  -> Approved trajectory written to Helix
  -> Skill's `examples` updated from real usage
  -> Skill's `failure_modes` updated from real failures
  -> (Later) Loop C consumes Helix + skills -> fine-tune the cipher adapter
```

That's 5 chassis slices (C1-C5) shipped this turn on `feat/chassis`. **C1 is done and pushed (commit `fd3d2ef` + journal commit `8347c0b`). C2-C5 pending operator sign-off.**

---

## 3. What got done in this turn (chronological)

1. **Operator: "I tested it. This doesn't seem like it's the proper and most simple as efficient way... I changed everything. Undo the changes you just made."** — I had pushed a `feat/ui-cockpit-rebuild` branch and broken the cockpit. Reverted: deleted the branch, deleted local + remote, switched back to `t1/strict-pass-batch` and confirmed the legacy `app.js` 1793-line cockpit was restored. Lesson logged in AGENT_NOTES.
2. **Operator: "let's continue" / engine won't load / duplicate endpoint** — committed `a0aa429 fix(harness+manifest): engine loads + agent loop + tool-result role` which fixed the 4 bugs above. Cipher-fast now starts and serves chat.
3. **Operator: "this is the proper and most simple as efficient way to..."** — operator wanted to see the working model. Confirmed engine on 8091, /v1/models returns 4B params, /v1/chat/completions returns "OK" in 240ms.
4. **Operator: "the harness in the models that get used inside our aide being aware of the environment..."** — researched 5 primary sources (Anthropic context engineering, Anthropic prompting best practices, AGENTS.md open standard, Theia AI skills, Cursor agent, HuggingFace PEFT/LoRA/TRL). Wrote a 2-slice plan: A1 (tool guide v2 + AGENTS.md + workspace tree on demand), A2 (auto-context after tool execution), A3 (trace + cost endpoints). Posted as research commit `452bdfd` on `feat/environment-aware-model`. **NOT YET IMPLEMENTED. Operator pivoted to the chassis research.**
5. **Operator: "hold on you said in reference to what you said about Anthropics 2026 Context Engineering post..."** — operator pushed back on my 68% accuracy claim. Right. I clarified: Helix (the existing memory system) is the counter-move to the flat-prompt problem, not an addition to it. The operator's framing of the closed loop: model + harness + orchestrator + code all reinforce each other, nothing wasted, skills versioned like code, approved trajectories feed the next fine-tune. **Operator said "we have to do everything 200%, backed by research" and "I don't like you using the word guessing a lot."** I corrected my language.
6. **Operator: "OK how many skills too many no amount of skills is too many skills... This is what we do. We're software engineers and developers. This is what we do."** — confirmed no upper bound on skill count. The operator wants coverage of every dev task, with the chassis making it scalable.
7. **Operator: "signed off"** — I researched and wrote the 5-slice chassis plan (`6417c56 docs(research): chassis plan - 5 slices...`).
8. **Operator: "signed off" (again)** — I implemented C1 (`fd3d2ef feat(chassis): skill envelope schema + parser (C1)`). 27/27 tests pass, 14/14 facade tests pass. Pushed.

---

## 4. What is in the works (open and parked)

### 4a. Active — C2 through C5 on `feat/chassis` (chassis continuation)

- **C2 — SOP catalog** (8-12 universal standards, separate from skills). `sops/ask-dont-circle.md`, `sops/verify-before-claiming.md`, `sops/no-secrets-in-output.md`, `sops/operator-approves-mutations.md`, `sops/fail-closed.md`, `sops/surface-uncertainty.md`, `sops/cite-the-source.md`, `sops/minimal-diff.md` + `harness/sop-loader.mjs` + battery. **Current state of the existing `harness/credo.md` (Developer's Way) gets INDEXED and made machine-readable; new SOP catalog adds task-agnostic standards.**
- **C3 — Orchestrator classifier + workflow bundle** (`harness/orchestrator.mjs`, `harness/workflow-bundle.mjs`). No LLM in the loop. Keyword + embedding + Helix fingerprint. Returns `WorkflowBundle { primarySkill, auxSkills, toolSet, scaffold, systemPrompt, promptBudget, cost, rationale, requiresApproval }`.
- **C4 — Scaffold v2** (`harness/scaffold-v2.mjs`). Takes a WorkflowBundle, composes L0 (SOP) + L1 (skill body) + L2 (task SOP) + L3 (workspace) + L4 (Helix) within budget. Byte-deterministic.
- **C5 — Helix fingerprinting + operator bundle UI**. `harness/cipher-state.mjs` gains `fingerprintTask()`. New `harness/helix-retrieval.mjs` for top-K similar past tasks. New `POST /api/orchestrator/classify` route. Operator-facing workflow bundle card in legacy `app.js` (no cockpit rebuild).

### 4b. Parked branches

- **`research/in-house-model-e2e`** (off `t1/strict-pass-batch`): in-house end-to-end battery for cipher-fast and qwen-coder-1.5b. Stashed on this branch as `wip: in-house-battery slice (drift + new battery) - parked for its own commit`. The battery itself exists in `tests/in-house-e2e/agent-loop-battery.mjs` but the test file was NOT brought over to `feat/chassis` because chassis is additive. (I noticed during C1 that `agent-loop-battery.mjs` doesn't exist on `feat/chassis` — it's on the prior branch.)
- **`research/cross-platform-packages`** (off `t1/strict-pass-batch`): Tauri Linux/Windows packaging research. The operator pivoted away from this to focus on the chassis first.
- **`feat/environment-aware-model`** (off `t1/strict-pass-batch`): slice A's 3-slices (tool guide v2 + AGENTS.md, auto-context, trace + cost). Not implemented; chassis took priority.
- **`feat/subagent-dispatch-pr-a-tests`** (off `t1/strict-pass-batch`): subagent dispatch PR A tests. Older work.
- **`t1/strict-pass-batch`** (the lane's baseline): the long-term baseline with all the prior turns. ~2-3 months of work.

### 4c. Parked on the T1/T2 coordination list

Per the docs in `docs/notes/T1-T2_notes.md`:
- T1: model handoff contracts, helix files, manifest swap, P7 (no GPU from T2; 8084 is T1's lane).
- T2: corpus generation, fine-tunes, micro-expert training. They run in a separate terminal in `E:\pip_temp\aide-...`.

---

## 5. Verification: what the tests prove right now

`E:\aide-sovereign-workbench\AGENT_NOTES.md` is the canonical journal. The most recent entry logged 355/355 arch tests + 23 agent-loop battery + 10 harness battery all green, plus 27/27 new chassis-schema battery. The most recent `npm run veritas` call (`run 33911447758` on the agent-loop slice) returned `passed:true score:1 evidence_level:sufficient 0 failed checks 0 failed oaths`. Pre-push CI catches regressions.

The chassis slice C1 added a new battery (`tests/in-house-e2e/skill-schema-battery.mjs`, 27 tests, all pass). The facade battery (`tests/unit/test-facade.mjs`, 14/14 pass) confirms the route-map fix didn't regress. Other test files (the original 23 agent-loop battery, the 10 harness-awareness battery) live on `feat/environment-aware-model` and will be re-run when that slice continues.

---

## 6. The roadmap, from the operator's mouth and the research

Short term (next turn or two):
- C2 (SOP catalog) — pure docs + a small loader
- C3 (orchestrator) — the brain, but no LLM
- C4 (scaffold v2) — assembly with budget
- C5 (Helix + bundle UI) — closes the loop on real usage

Medium term:
- Skills (3-5 seed skills, the operator's most-painful-when-missing tasks)
- The 3-slice harness-awareness plan (A1, A2, A3) from `feat/environment-aware-model`
- In-house model end-to-end battery (from `research/in-house-model-e2e`)
- Per-class model improvement plan (LoRA + DPO recipes for 0.5B and 1.5B)
- Loop C: closed-loop trajectory capture for the cipher

Long term / parked:
- Tauri cross-platform packaging (no cargo on this machine)
- Cockpit UI rebuild (operator reversed my prior attempt; legacy `app.js` is fine for now)
- iOS / Android packaging (need Mac + Apple account + Android keystore)
- New in-house cipher fine-tune round (depends on Loop C having real data)
- Real MCP integration (aLoRA-style; future)

---

## 7. What I (the AI) am uncertain about and want feedback on

- **The "chassis" framing vs. the existing skill-registry** — I'm replacing the flat keyword detector with an orchestrator that uses Helix fingerprints. The existing `skills/registry.json` has 182 skills. The new envelope requires skills to have strict frontmatter. **My current plan treats them as separate systems** (legacy keyword detector still works for un-enveloped skills, new envelope works for the ones the operator upgrades). Is that right, or should I migrate ALL 182 skills to the new envelope at once? (I lean: migrate the most-painful-when-missing first, like the operator said, rather than 182-at-once.)
- **The 5 chassis slices depend on each other but I'm doing them sequentially with operator sign-off between each.** The operator said "build the chassis first, skills after" — but should skills land BEFORE C5 (so the bundle UI has something to render), or AFTER C5 (so the UI is built first and skills plug in)?
- **Helix fingerprinting (C5) is the one piece that requires real operator data** — the Helix digest store currently has whatever's in `cipher-state.mjs`. The top-K similarity only works after we have N real trajectories. The first install of AIDE has zero history. **The chassis has to bootstrap with empty Helix and learn from real usage over the first few weeks.** Is that acceptable, or should I write a "warm-start" step that seeds Helix from the existing 138 skills' documented examples?
- **The operator's "we have to do everything 200%, backed by research"** is the loudest signal in this turn. But the operator is a single developer with no funding. **C1 alone took this turn longer than it should have because the YAML parser was harder than expected.** The 4 remaining chassis slices will be similar. Should I batch some of them (C3+C4 together, since the orchestrator is the brain and the scaffold-v2 is the body), or strictly one at a time?
- **The cockpit UI** — operator said it's confusing but didn't ask for a rebuild. **Slice A3's "operator-facing workflow bundle card" would touch `app.js` (legacy).** Is that allowed, or should the bundle UI live somewhere else (a new overlay panel, an injected DOM element)?

---

## 8. What I would ask the collaborator to evaluate

Given the above, the architectural questions worth a second set of eyes are:

1. **Is the chassis framing right?** The operator's words were "the harness and orchestrator and the model all being part of a closed loop reinforcement system" and "skills and standard operating procedures are different things." My 5-slice plan (skill envelope, SOP catalog, orchestrator classifier, scaffold v2, Helix fingerprinting + bundle UI) is my best read of that. Does it actually deliver the closed loop the operator described?

2. **Is the SOP-vs-skill distinction clean?** The operator said clearly that SOPs are universal law and skills are task-specific. The 5-layer scaffold composer (L0 SOP, L1 skill, L2 task SOP, L3 workspace, L4 Helix) implements this. Is the separation right? Is L2 (task SOP inside the skill body) redundant with the skill's own `sop` field, or is it a different thing?

3. **Is the orchestrator's "no LLM" promise sound?** The operator said "what can we do for our harness orchestrator that is more sophisticated than what everybody else does" — but using keyword + embedding + Helix fingerprint is the same approach Cursor, Theia, and Claude Code use. **What's the differentiator?** I'm planning: (a) Helix fingerprinting (no one else does this), (b) skill versioning like code (no one else does this either), (c) the closed-loop trajectory capture feeding the next fine-tune (Cipher-specific). Is that enough, or am I missing the bigger differentiator the operator is hinting at?

4. **What's the right Helix threshold?** When the top-K similar past task has confidence > X, the orchestrator pre-loads its trajectory as an example. When X is too low, the orchestrator either skips or uses only the strongest match. What's the right X? The operator said "we have to do everything 200%" — so probably set X high (only pre-load when we're very confident). I was thinking 0.7. What do you think?

5. **Should the chassis ship without skills, or with a minimal seed set?** Operator said "no amount of skills is too many" — but I shouldn't ship the chassis empty. What's the right minimum seed set that demonstrates the value without over-promising? I was thinking: code review, write test, debug error, explain code, search docs. What do you think?

---

## 9. File map (for the collaborator to orient)

- `E:\aide-sovern-workbench\harness\scaffold.mjs` (148 lines) — current scaffold composer
- `E:\aide-sovern-workbench\harness\agent-loop.mjs` (495 lines) — current agent loop
- `E:\aide-sovern-workbench\harness\skill-schema.mjs` (298 lines) — NEW C1 chassis
- `E:\aide-sovern-workbench\harness\skill-loader.mjs` (99 lines) — NEW C1 chassis
- `E:\aide-sovern-workbench\harness\credo.md` (72 lines) — Developer's Way
- `E:\aide-sovern-workbench\daemon\server.mjs` (621 lines) — legacy daemon
- `E:\aide-sovern-workbench\models\manifest.json` (310 lines) — model catalog
- `E:\aide-sovern-workbench\common\facade-route-map.json` (76 lines) — facade routing
- `E:\aide-sovern-workbench\app.js` (1793 lines, 84KB) — legacy cockpit (UNCHANGED)
- `E:\aide-sovern-workbench\index.html`, `styles.css` — cockpit assets
- `E:\aide-sovern-workbench\browser\` — new Vite + TS frontend module tree (built into `dist/`)
- `E:\aide-sovern-workbench\tests\in-house-e2e\skill-schema-battery.mjs` (27 tests, NEW C1)
- `E:\aide-sovern-workbench\tests\unit\test-facade.mjs` (14/14 pass)
- `E:\aide-sovern-workbench\skills\registry.json` (112KB, 182 skills)
- `E:\aide-sovern-workbench\skills\packs\` (the skill catalog directories)
- `E:\aide-sovern-workbench\AGENT_NOTES.md` (the journal, ~2300 lines)
- `E:\aide-sovern-workbench\.git\` (the repo)

Live branches:
- `feat/chassis` (the C1 chassis work, freshly pushed)
- `feat/environment-aware-model` (the agent loop + manifest fixes)
- `research/in-house-model-e2e` (parked, has the agent-loop battery)
- `t1/strict-pass-batch` (the long-term baseline)
- `main` (behind everything)

---

## 10. Honest assessment of where the project is

**Where it shines:** the backend is real and working. Engine starts, model responds, agent loop proposes and awaits approval, the verification battery is green. The work the operator and I have done in the last 2-3 days is on the right track.

**Where it's painful:**
- The cockpit UI (`app.js` 1793 lines) is a 4-generation-accretion fossil. The operator knows it. It works but it's not delightful.
- The chat interface in `app.js` is dead-simple — POST to `/api/chat` and render the result. The agent loop is a separate path. **The cockpit doesn't yet use the agent loop at all.** That's a near-term gap.
- The 6-tool agent loop is verified by the battery but not yet wired into the cockpit UI. The operator has to curl `/api/agent-loop/*` to test it. A real user-facing flow is missing.
- T2's micro-experts (task-router at 0.978 holdout agreement, diff-risk-gate at 1.00, request-intent-classifier at 1.00) are trained and registered but **not yet consulted from the agent loop start path** for the agent-loop variant. The arch's `/api/agent/start` does consult them (commit `c1d4922`), but the legacy `daemon/agent-loop.mjs` doesn't.
- Helix memory has the 3 strands (X1 spine, X2 join, X3 retention) but no real operator trajectories to fingerprint yet.
- The chassis is 1/5 done. The orchestrator (slice C3) is the part that actually makes everything useful — and it's not built.

**What I'd tell the operator's collaborator:** the work the operator and I have been doing is directionally right and the chassis research is grounded. The biggest risks are (a) the cockpit UI gap, (b) Helix having no real data to fingerprint, and (c) the operator's bandwidth. The operator is doing this solo and the per-slice testing takes longer than it should because the Windows + git-for-Windows + node-for-Windows stack is fragile. If the collaborator can advise on the orchestrator design (slice C3) and on how to handle the bootstrap-Helix-without-data problem, that would be the most valuable input.

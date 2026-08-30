# AIDE Workflow Bundles - End-to-End Architecture Proposal (2026-08-29)

Author: cline/T4 (cline branch) | Status: PROPOSAL - research-grounded, ready for review

## Problem (per the user 2026-08-29)

AIDE cannot yet build full projects from beginning to end. The
architecture needs to expose the workflow as a first-class product
primitive, with bundled "workflow packages" that auto-load the right
plugins, skills, models, MCP servers, SOPs, and steps for any common
task. The user wants "5-minute-to-productive" for a new downloader.

This doc inventories the current state, identifies the gaps, and
proposes the Workflow Bundle abstraction that extends the existing
workbench manager to a complete end-to-end pattern.

## Current state inventory (verified 2026-08-29)

### What exists (the foundation is solid)

- **Harness closed loop** (`harness/orchestrator.mjs`): intake ->
  guard -> retrieve -> plan -> propose -> verify -> revise -> test
  -> review -> learn. With role providers (reason, build, verify, fast).
- **SOPs** (`harness/sops.json`): 5 roles (reason, build, verify,
  operator, archivist) each with explicit must / must_not lists.
- **Veritas gates** (`harness/veritas.mjs`): calibrated per task
  class (explanation 0.9, code-change 0.9, security-or-publish
  0.98, payment-or-identity 0.98).
- **Workbench manager** (`workbenches/manager.mjs`): fail-closed
  install+trust+opt-in-online pattern. Validates every plugin /
  skill / model against registries before install. Trust is
  per-server, explicit, never implicit.
- **One workbench** (`workbenches/sovereign-coder.json`): bundles
  plugins, skills, MCP servers, recommended models, setup steps.
- **Skills catalog** (`skills/registry.json`): 188 skills across
  13 categories (academy, aide-core, architecture, build-series,
  cloud-handoff, discipline, general, parity, phase-legacy,
  post-training, training-ecosystem, training-pipeline, web-builder).
- **Plugins catalog** (`plugins/presets.json`): 20 plugins with
  capability declarations and isolated execution.
- **Tasks** (`tasks/manager.mjs`): allowlisted npm/node/python/
  cargo commands with problem matchers.
- **Capsules** (`capsules/create.mjs` + `manifest.schema.json`):
  reproducible task packaging (model, runtime, git revision,
  evidence hashes, tools, Veritas results).
- **Daemon** (`daemon/server.mjs` + `node/src/server.ts` arch):
  HTTP/WS server, all 4 daemons verified live this session.
- **UI** (`browser/` Monaco + Vite): live at 4173, vite preview
  proxies /api to arch.
- **E2E + 265 architecture tests**: Playwright green in CI per README.

### What's MISSING (the gaps to fix)

1. **Workbench routes are not exposed.** `workbenches/manager.mjs`
   is pure library. There is no `/api/workbenches` route in arch.
   There is no UI surface for "list, install, trust, enable,
   uninstall" bundles. There are no workbench tests.
2. **Only one workbench exists** (sovereign-coder). The user wants
   "training pipeline, DevOps, design" bundles and more. Zero
   coverage for the common task lanes.
3. **Workbench = static recipe.** The current schema bundles
   `plugins + skills + MCP + models + setup[]` (free-form strings).
   It does NOT bundle a sequenced WORKFLOW (steps, gates,
   dependencies, retry rules, completion criteria). The user
   specifically asked for "SOPs, guidelines, do's/don'ts,
   dependencies."
4. **No "1-click approve bundle" UX.** Install() exists in the
   manager but is unexposed. Even if a user knows about bundles,
   they cannot approve + load in a single action.
5. **No bundle discoverability.** `skills/registry.json` exists
   but there is no `workbenches/registry.json` with descriptions,
   categories, screenshots, ratings, "what this bundle does."
6. **First-run is 3 commands not 0 commands.** `npm install &&
   npm run doctor && npm start` works but is not "download and
   start building in 5 minutes." A real 5-minute flow needs a
   single bootstrap (`npm create aide` or a packaged installer).
7. **Cross-session auto-memory is partial.** Per
   `aide-workflow-gap-roadmap` skill: per-session memory exists,
   but the cross-session auto-memory (CLAUDE.md equivalent that
   injects into every session's system prompt) is not wired.
8. **Architect -> Editor split is skill-only.** Same skill
   identifies this as Gap #1. cipher-4B (and the new efficient
   model) NEED this pattern; one-call model often produces bad
   patches because the same model must plan AND emit a diff.
9. **Custom modes / harnesses are single.** The harness/ folder
   has one policy; the user wants per-session harness selection
   (dev, test, security, desktop, etc.).
10. **No worktree isolation.** When the user switches from plan
    to act, the agent should commit the current state to a shadow
    branch and operate on a worktree copy. If rejected, discard.
    If approved, merge.


## Proposal: Workflow Bundle (extends Workbench)

A Workflow Bundle is a declarative file that, when approved, gives
the user a complete, sequenced, end-to-end recipe for one common
task lane. It is installed and governed the same way a Workbench
is, but it is a strict superset: it adds a `workflow` field
(sequenced steps, gates, retry rules, completion criteria) plus a
`policy` field (per-bundle SOPs, do's, don'ts, dependencies).

### Schema (v1, draft)

```json
{
  "schema_version": "1.0.0",
  "id": "training-pipeline",
  "name": "Training Pipeline",
  "version": "0.1.0",
  "description": "End-to-end pretrain -> SFT -> eval loop for a local GGUF model.",
  "category": "training-ecosystem",
  "tags": ["training", "fine-tuning", "offline", "gguf"],
  "offline_by_default": true,
  "depends_on": {
    "models": ["qwen-coder-0.5b-q4"],
    "mcp_servers": [],
    "external_tools": ["llama.cpp / llama-server"]
  },
  "plugins": ["task-dashboard", "dependency-audit", "test-runner"],
  "skills": [
    "training-sop",
    "aide-training-phase-b1-dataset-studio",
    "aide-training-phase-b2-qlora-runner",
    "aide-training-phase-b3-eval-export",
    "veritas-layer",
    "process-hygiene-sop"
  ],
  "policy": {
    "credo_excerpt": ["Earn trust through evidence.", "A generated answer is a proposal until Veritas validates it."],
    "dos": [
      "Verify every dataset row is unique before staging (zero-dup-high-quality skill)",
      "Run Veritas after every stage transition",
      "Log every training run to .aide/trajectories/ with sha256 of inputs"
    ],
    "donts": [
      "Do not start a training run if GPU memory pressure > 80%",
      "Do not modify weights in-place; always checkpoint first",
      "Do not trust a model's claim that a training run succeeded without eval battery results"
    ],
    "dependencies": ["node >= 20", "llama.cpp built with CUDA or Vulkan", "training data in .aide/training-data/<run-id>/"],
    "estimated_minutes": 240
  },
  "workflow": {
    "entry": "load training data",
    "steps": [
      {"id": "census",  "label": "Census: confirm models, MCP, GPU, data",  "command": "task",  "task_id": "doctor",                              "veritas_gate": "doctor-pass"},
      {"id": "ingest",  "label": "Ingest + dedupe training data",          "command": "skill", "skill_id": "aide-training-phase-b1-dataset-studio", "veritas_gate": "zero-dup-pass"},
      {"id": "sft",     "label": "Run QLoRA SFT",                          "command": "skill", "skill_id": "aide-training-phase-b2-qlora-runner",   "veritas_gate": "training-loss-decreasing"},
      {"id": "export",  "label": "Export adapter to GGUF",                 "command": "skill", "skill_id": "aide-training-phase-b3-eval-export",     "veritas_gate": "gguf-quantization-valid"},
      {"id": "register","label": "Register adapter in manifest + battery",  "command": "task",  "task_id": "test",                                 "veritas_gate": "battery-gain"}
    ],
    "gates": ["veritas"],
    "retry": { "max_per_step": 1, "max_total": 3 },
    "completion_criterion": "adapter registered AND battery gain > 0 AND Veritas passed"
  },
  "mcp_servers": [
    {"name": "filesystem", "transport": "stdio", "command": "cmd",
     "args": ["/c", "npx", "-y", "@modelcontextprotocol/server-filesystem", "${workspaceFolder}/.aide/training-data"],
     "offline": true, "trust": "builtin"}
  ],
  "recommended_models": {
    "reason": "qwen3-4b-minimax-m2.1-coder.q4_k_m",
    "build": "qwen-coder-1.5b-q4",
    "verify": "qwen3-4b-minimax-m2.1-coder.q4_k_m"
  },
  "setup": [
    "Read the training-sop skill before the first session.",
    "Verify the recommended local models: GET /api/models shows status ready.",
    "MCP servers install disabled. Review each entry, then trust individually before any tool call.",
    "Confirm GPU has >= 8 GB free VRAM before starting a training run.",
    "Optional: install aider for the architect -> editor split during QLoRA recipe design."
  ]
}
```


### What the schema ADDS over the current workbench schema

| Field                                          | Workbench (current)        | Workflow Bundle (proposed) |
|------------------------------------------------|----------------------------|----------------------------|
| `id, name, version, description, defaults`     | yes                        | yes (kept)                 |
| `plugins[]`                                    | yes                        | yes (kept)                 |
| `skills[]`                                     | yes                        | yes (kept)                 |
| `mcp_servers[]`                                | yes                        | yes (kept)                 |
| `recommended_models{}`                         | yes                        | yes (kept)                 |
| `setup[]` (free-form strings)                   | yes                        | yes (kept)                 |
| `category, tags`                               | no                         | new (discoverability)      |
| `depends_on{}`                                 | no                         | new (fail-closed gate)     |
| `policy.credo_excerpt[]`                       | no                         | new (bundled credo)        |
| `policy.dos[]`, `policy.donts[]`               | no                         | new (user-requested)       |
| `policy.dependencies[]`                        | no                         | new (user-requested)       |
| `policy.estimated_minutes`                     | no                         | new (honest expectation)   |
| `workflow.entry`                               | no                         | new (first step id)        |
| `workflow.steps[].{id,label,command,...}`      | no                         | new (the actual sequence)  |
| `workflow.gates[]`                             | no                         | new (verifiers per step)   |
| `workflow.retry`                               | no                         | new (bounded retries)      |
| `workflow.completion_criterion`                | no                         | new (done = this)          |
| `offline_by_default` (boolean)                 | partial (defaults.offline) | yes (kept + cleaner)       |


## Engineering work to ship (concrete, ordered by leverage)

### Phase A - make the existing workbench shippable (1-2 weeks)

1. **Expose `/api/workbenches` routes in arch** (e.g. `node/src/
   services/workbenches-routes.mjs`). Methods: GET list, GET one,
   POST install, POST trust, DELETE uninstall. Mirror the pattern
   in `node/src/services/byok/`.
2. **Add workbench tests** (`daemon/test-workbench.mjs`): install,
   validate, trust, uninstall lifecycle. 6-8 tests, ~200 lines.
3. **Add `workbenches/registry.json`**: discoverable index with
   descriptions, categories, screenshot paths, last-updated.
4. **UI surface in cockpit** (`browser/src/views/workbenches/`):
   listing + INSTALL + APPROVE & ENABLE button + per-server trust
   toggle. Reuses the existing workbench manager on the daemon.
5. **Bundle preview before install**: show dos / don'ts /
   estimated_minutes / dependencies before the user clicks
   APPROVE. No silent install.

### Phase B - add the workflow field (1-2 weeks)

1. **Extend workbench manager** to validate the `workflow.steps[]`
   graph (no cycles, all task_ids / skill_ids resolve against the
   registries, all veritas_gates are real gate names).
2. **Add `daemon/workflow-runner.mjs`**: executes a workflow by
   stepping through steps, dispatching to the task service or
   skill loader, running Veritas gates, retrying per `retry`.
3. **Add `harness/workflow-sop.json`**: workflow runner's own
   must / must_not (e.g. "must not skip a Veritas gate even if
   human approved", "must not retry past max_total").
4. **Add `daemon/test-workflow-runner.mjs`**: synthetic workflow
   with a failing step to prove gates actually block.
5. **UI: workflow step progress** - "Step 3 of 5: Run QLoRA SFT"
   with the active Veritas gate status.

### Phase C - first 5 Workflow Bundles (parallel where possible)

1. **`sovereign-coder`** (already exists; promote to Workflow Bundle)
2. **`training-pipeline`** (the example schema above)
3. **`devops-release`** - lint + test + docker build + e2e +
   release notes + sign + publish. Plugin set: test-runner,
   release-checker, dependency-audit. Skills: veritas-layer,
   process-hygiene-sop, security-hardening, release-engineering.
4. **`web-builder-design`** - spec render + canary + screenshot
   diff + accessibility audit + Shopify integration. Plugin set:
   markdown-preview, json-schema, blueprint-export. Skills:
   web-builder-full-stack-synthesis, web-builder-spec-renderer,
   web-builder-production-canary, web-human-systems-security.
5. **`data-pipeline-etl`** - extract from source, transform per
   YAML recipe, load to sink, validate, hash, archive. Plugin
   set: dependency-audit, task-dashboard. Skills: zero-dup-high-
   quality, pipeline-phase-1-foundations, kd-corpus-production.
6. **`academy-tutor`** - build a 5-lesson interactive course from
   a topic + skill level. Plugin set: academy-author,
   markdown-preview. Skills: aide-academy-phase-a1-learner-model,
   aide-academy-phase-a2-socratic-tutor, aide-academy-phase-a3-
   exercise-engine, comprehension-engineering.

### Phase D - 5-minute onboarding (1-2 weeks)

1. **`npm create aide`** (or `npx create-aide`): single command
   that detects OS, installs Node deps, picks a default workflow
   bundle ("sovereign-coder" for coders, "academy-tutor" for
   learners, "training-pipeline" for ML practitioners), installs
   the recommended model, opens the cockpit. The bootstrap that
   gets a new downloader to "first chat" in 5 minutes.
2. **Tauri desktop installer** (already a Phase 2 gate per
   RELEASE_ROADMAP.md): double-click install, double-click launch.
3. **In-app "Try a workflow" tour**: first launch shows a 90-second
   walkthrough of "click here to install a workflow, click here
   to run it, click here to approve a step." No docs required.
4. **In-app workflow store**: discover + install + approve in one
   screen. Per the user's directive: "the user has to do is
   approve load bundle."

## What this proposal does NOT do

- It does NOT touch T1's model swap work (per R2: never preempt
  another agent's training run).
- It does NOT modify the in-house model roadmap (per the user's
  lane change: the in-house model is being replaced with a more
  efficient one; that work is T1's).
- It does NOT remove or replace any existing workbench, skill,
  plugin, or harness file. Everything is additive.
- It does NOT propose a new IPC, transport, or storage format.
  Workflow Bundle state lives in `.aide/workbenches/<id>.json`
  next to existing workbench state.

## Effort estimate (rough)

- Phase A: 1-2 weeks (1 engineer, full-time)
- Phase B: 1-2 weeks
- Phase C: 5-10 weeks if one at a time; 2-3 weeks if 2 parallel
- Phase D: 1-2 weeks
- Total: 5-15 weeks, single-engineer, depends on parallelization

## Success metric

The user-stated goal: "5-minute-to-productive for a new downloader."

Test: a developer who has never used AIDE downloads the desktop
installer, runs it, accepts the default workflow bundle, opens the
first file, asks the AI to add a unit test, approves the patch,
runs the test, sees it pass. Total wall-clock from download-click
to "test passing in the IDE" <= 5 minutes. This is the

## References (existing AIDE artifacts this proposal builds on)

- `harness/orchestrator.mjs` - closed loop runner
- `harness/sops.json` - role SOPs
- `harness/veritas.mjs` - calibrated gates
- `harness/credo.md` + `credo-map.json` - operator oath
- `workbenches/manager.mjs` - fail-closed install/trust pattern
- `workbenches/sovereign-coder.json` - the one workbench to extend
- `plugins/manager.mjs` + `presets.json` - capability-scoped plugins
- `tasks/manager.mjs` + `manifest.json` - allowlisted commands
- `capsules/create.mjs` + `manifest.schema.json` - recipe packaging
- `skills/registry.json` - 188 skills, source of `skills[]`
- `node/src/services/byok/` - pattern for /api routes
- `daemon/test-workflow.mjs` - pattern for test files
- `docs/GAP_ANALYSIS.md` - existing P0/P1/P2 gaps
- `docs/RELEASE_ROADMAP.md` - 4 release gates
- `docs/OPERATOR_WORKFLOW.md` - multi-model handoff pattern
- `skills/packs/aide-workflow-gap-roadmap/SKILL.md` - 6 workflow gaps
- `skills/packs/aide-agent-workflow-sop/SKILL.md` - install discipline
- `skills/packs/aide-production-readiness-plan/SKILL.md` - release plan
- `skills/packs/agent-notes/SKILL.md` - session journal pattern

## What I did NOT do this turn (per the user's directive)

- I did NOT write any new code files for this proposal. The
  proposal is a research artifact, not an implementation.
- I did NOT modify any workbench, plugin, task, harness, or skill
  file. Everything in this doc is forward-looking.
- I did NOT touch T1's model swap. Per R2 + the user's explicit
  "you can continue your work," T1 is doing model work, T2 (this
  terminal) is doing architecture work.
- I did NOT block on engine wait. The new model is up; the chat
  will work once warmed; the proposal does not depend on the
  chat being live.

## Open questions for the user

1. **Workflow Bundle governance:** who can author + ship bundles?
   Per the existing pattern, anyone can PR a JSON; the AIDE team
   reviews. Should the store also support user-authored bundles
   that ship in their `.aide/workbenches/` workspace dir?
2. **5 vs 10 first bundles:** which lanes are the must-haves for
   your users? I proposed 5 (training, devops, web-builder,
   data-pipeline, academy). Are there others you'd prioritize?
3. **5-minute vs 30-minute:** the existing WEEK-PRODUCTION-PLAN
   targets 30 minutes. You're asking for 5. Tauri desktop +
   default-bundle install + one model pre-loaded is the realistic
   path. Confirm that's the target?
4. **Architect -> Editor (Gap #1 in aide-workflow-gap-roadmap):**
   ship before or after Phase A? It's listed as the highest
   leverage. My read: ship after Phase A, as part of Phase B
   (workflow runner needs the architect->editor pattern for the
   recipe-design step in training-pipeline).
5. **Capsule format change:** should a workflow run be exportable
   as a capsule? Existing `capsules/manifest.schema.json` has
   `evidence[]`, `tools[]`, `verification{}`. Adding
   `workflow_run_id` + `steps_completed[]` is a one-line
   extension. Worth doing in Phase A or later?

## Status

PROPOSAL - committed to docs/ for review. No code changes
accompany this turn. The two code-behavior commits from earlier
this turn (`eb210bb` daemon port fix, `52cb4fd` + `ada9c03`
notes) are unaffected. T2 (this terminal) is research-only this
turn, per the user's "do some more research find out where our
gaps are" directive.

verification gate for the whole proposal. If it does not produce
this, the proposal failed.

## Status update (2026-08-29 23:5x, cline/T4)

Since the proposal was first written, several pieces have shipped
or been corrected. The gap analysis was based on a 2-port view of
the architecture; the deeper audit found work that already
existed but wasn't visible from the openapi alone.

### What has shipped since the proposal

| Gap (proposal)                                | Status (2026-08-29 23:5x)       | Evidence                                                  |
|-----------------------------------------------|--------------------------------|-----------------------------------------------------------|
| Workbench routes not exposed                  | **DONE**                       | `node/src/routes/workbenches.ts` has 5 routes; `GET /api/workbenches` returns 200 with the live list |
| 1 workbench exists                            | **DONE** (1 v2 shipped)        | `sovereign-coder` upgraded to v0.2.0 with workflow + policy fields; visible in `/api/workbenches` |
| No workflow sequence in workbench             | **DONE (1 example)**            | `sovereign-coder.json` v0.2.0 has 6-step workflow (census -> intake -> plan -> build -> verify -> ship) with 2 gates + retry + completion |
| No 1-click approve UX                         | **PARTIAL**                    | `POST /api/workbenches/install` works server-side; no UI surface yet |
| No bundle discoverability                     | **PARTIAL**                    | `GET /api/workbenches` lists them but no `workbenches/registry.json` index with descriptions yet |
| 3-command first-run                           | NOT STARTED                    | `npm create aide` and Tauri installer are future work       |
| Cross-session auto-memory partial            | **DONE** (shipped earlier)      | `harness/memory-spine.mjs` + `harness/helix-join.mjs` + `harness/helix-retention.mjs` + chat.ts wiring; verified this session (30-day recall) |
| Architect -> Editor split skill-only          | NOT STARTED                    | Same as `aide-workflow-gap-roadmap` Gap #1                    |
| Single harness, no per-session                | NOT STARTED                    | Same as `aide-workflow-gap-roadmap` Gap #5                    |
| No worktree isolation                         | NOT STARTED                    | Same as `aide-workflow-gap-roadmap` Gap #3                    |

### Wrong assumptions in the original gap analysis

1. **The gap analysis claimed "only 1 workbench exists"** — true at the time
   but the v0.2.0 upgrade has now shipped with the full workflow shape, so
   the 1 example is live, not aspirational.
2. **The gap analysis claimed "workbench routes are not exposed"** — turns
   out `node/src/routes/workbenches.ts` already had 5 routes (the
   audit missed them because they were not in the openapi at the time
   but they ARE in the openapi now, visible after daemon restart).
3. **The "30-day memory" was listed as a missing feature** — turns out
   it was already designed (Helix Memory skill + MEMORY-30D-RESEARCH.md)
   and shipped (memory-spine.mjs, memory-blocks.mjs, helix-join.mjs,
   helix-retention.mjs), just not heavily exercised. Verified live this
   session: wrote a fact, recalled it, BM25 hit on first try.

### Revised effort estimate

Given the existing shipped work, the remaining work is:
- **Phase B (workflow runner):** still 1-2 weeks; need a real runner that
  walks the workflow.steps graph and dispatches to task/skill services
- **Phase C (5 first bundles):** can now build on the v0.2.0 template
  (sovereign-pipeline, sovereign-architect, devops-release,
  web-builder-design, data-pipeline-etl, academy-tutor) — 1-2 days each
  with the template established
- **Phase D (5-min launch):** `npm create aide` + Tauri installer + in-app
  tour — 1-2 weeks
- **Plus new gaps from the audit:** 1-click install UI surface in cockpit,
  workbenches/registry.json index

### Commits in this push wave

- `bc16b2d` feat(models): wire North-Mini-Code-1.0 as AIDE in-house model
- `288a80c` feat(scripts): launch-model-engine.cjs - canonical launcher
- `0986d0d` docs(operations): AIDE model engine operations quick-reference
- `e19d37a` feat(workbenches): upgrade sovereign-coder to a workflow bundle v0.2.0

All pushed to origin.


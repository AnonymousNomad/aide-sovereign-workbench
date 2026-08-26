# AIDE Master Roadmap — Router for All Phases

Master entry point for the aide-sovereign-workbench program. Routes every feature decision to its phase skill. Use at session start when working on AIDE, when deciding what to build next, or when a request doesn't match an existing phase skill (then it belongs HERE as a new phase).

## Thesis

AIDE is a **privacy-first, offline-capable universal IDE**: everything ships in the box — models, tools, task runner, git, terminal, LSP/DAP, extension host, marketplace, skills. First boot on an air-gapped machine is fully workflow-capable. Online connectivity (cloud providers, HF downloads, marketplace sync) is strictly opt-in per action.

## Standing Laws (non-negotiable)

1. **In-the-Box Law**: zero network required at first boot. Every capability must work from bundled assets. THE BOTTLE (enumerated, binding): GGUF models + tokenizers; MCP servers + tool binaries; docs/library/textbook corpora (tutor + RAG); language servers + debug adapters; templates/scaffolds; skill/SOP packs; offline help set — everything a model might need inside a workflow to succeed ships inside AIDE. Any feature needing a download before first use is a release blocker unless explicitly gated as opt-in.
2. **No-Phone-Home Law**: for an offline-first tool, ANY unexpected network call is a bug. Every outbound connection must be user-initiated, logged, and auditable. Enforced by V1 supply-chain audit.
3. **Verify-First / Verification-Complete**: every phase ships only after real verification battery (unit + arch + tsc + eslint + openapi regen clean + e2e where applicable). No smoke-test claims.
4. **Contract-first**: every new surface goes through zod contracts -> openapi regen -> typed client -> shared fixtures (aide-arch-wiring).
5. **No-Brick-Wall Law**: the user NEVER hits a dead end. Any state change (network loss, provider outage, model crash) triggers an orchestrator response <2s: one-sentence explanation + best continuation path + grounded recommendation (e.g., "Network lost — continue locally with model X; conversation carries over"). Never silent degradation, never a worse answer presented as equivalent. Enforced by aide-resilience-orchestrator.
6. **The Credo Law**: every model session runs under the Developer's Code SOPs (aide-model-sop) — KNOW/RESEARCH/ARMOR/BUILD/VERIFY/LOG enforced mechanically by the orchestrator. No per-model exemption.
7. **Distilled-Intent Law**: no raw conversation ever crosses to a paid API. Cloud calls carry machine-built briefs only (C1), routed by tier policy (C2), budgeted (C3), profiled (C4). Enforced by aide-cloud-economy.
8. **Frictionless Continuity Law**: cloud/BYOK is strictly opt-in (explicit user action, journaled egress). When opted in, local<->cloud handoff is SAME-CONTEXT and effortless: one continuous task window where subscription models and local models collaborate back-and-forth on shared state — H1 session handoff bundles + H2 role routing (plan/act/utility). Switching engines mid-task NEVER loses context, never needs copy-paste, never restarts the loop; the seam feels like one assistant with two engines. Cloud crossings still honor Law 7 (distilled briefs, not raw dumps). Enforced by aide-cloud-handoff + aide-model-handoff.

## Doctrine Thesis: The Iron Man Suit

AIDE = a suit any model wears (aide-iron-suit-orchestrator). Model does cognition; the suit provides unlimited context (X1 Helix Memory), verification + honesty (X2 Veritas Layer), resilience/failover (R), tools, discipline (M-SOP), and gets smarter about THIS user/THIS project via the local improvement flywheel. Evidence base: same model swings 35+ points purely by harness; harness-first debugging doctrine. Goal state: whatever the task, local or cloud, it can get DONE in this IDE.

## PRODUCT SCOPE LOCK — the #1 developer workstation (locked 2026-08-24)

Target position: the new default developer workstation — community developers' choice. Every capability below ships IN THE BOX (Law 1) and is executable from inside AIDE without leaving it:
1. **Full model lifecycle in-app**: search/download/import GGUF (M-series), benchmark device fit, quantize/merge, fine-tune, evaluate, serve — training pipelines runnable from the RUN surface (P10/B-series skills).
2. **House model directive**: the frontier merge currently quantizing WILL be fine-tuned specifically for AIDE workflows — planning, building, debugging, compiling, research, doc-building, corpus work. All AIDE-flow training data (dual-mind traces, SOP docs) targets THIS deployment surface; harness/SOP scaffolding is co-designed so the model and the cockpit ship as one system.
3. **Complete dev workflow**: plan -> build -> debug -> compile -> run -> verify -> ship, plus research/RAG, document building, corpus assembly — all preloaded capabilities, not integrations to hunt for.
4. **Community work locks INTO project scope**: extensions/skills/marketplace contributions (P9 + S1 curation) must conform to contract-first, offline-first, no-phone-home laws to be installable — the ecosystem grows the bottle without breaking the laws.
Nothing outside this scope gets built ahead of an in-scope gap; scope creep = distraction = rejected per the linear-execution protocol.

## EXECUTION LADDER (strict order — one phase at a time, verify gate before advancing)

Session loading protocol (AUTO-LOAD, every session): (1) read AGENT_NOTES.md tail, (2) load hard-rules, (3) THIS router -> find `**CURRENT PHASE:**` below, (4) load ONLY that phase's listed skills, (5) work its exit gate to VERIFIED completion, (6) journal + commit, (7) move the marker. Never skip ahead, never run two phases at once, never claim a gate passed without observed output. PHASE-ENTRY SKILL GATE: before doing phase work, check each listed skill actually answers WHAT to do, HOW, WHY-this-way, DEPENDENCIES, and PITFALLS/THREATS backed by research; if any listed skill is missing, thin, or wrong, author/patch it FIRST - a phase never starts with a broken manual. Skills stay wired-together law: every slice keeps the served app usable end-to-end (contract-first via common/contracts, facade parity, verification-complete gates) so updates ship working, never half-migrated.

- **W1 — MAKE THE SERVED APP ACTUALLY WORK** (usability blocker). Facade consumer-compat: unwrap `{ok,data}` adapter for ts-target responses (tests written 2026-08-24, must run green + commit); cold-boot `npm start` reliability proof; re-openable HELP/launch-guide in UI; REAL-UI evidence: file open/edit/save round-trip through :4777. Exit: screenshots/evidence in docs/evidence/, suite green, committed. Skills: aide-production-cutover, verification-complete.
- **W2 — COCKPIT SHELL SLICE 1** ✅ SHIPPED (cd06b33, live battery). 
- **W3 — ORCHESTRATOR LOOP VISIBLE** ✅ SHIPPED mechanism-level (agent loop wired, gated BoN; operator browser pass still owed).
- **W4 — HUB + TUNING** ✅ SHIPPED (files route, register/import bridges, MODELS panel, profiles+presets).
- **W5 — HARNESS ALWAYS-ON** ✅ SHIPPED v2.1 (micro/full tiers, drift hook, compose telemetry, effectiveness battery w/ published negative->redesigned result). Full-tier rerun on operator fine-tune pending.
- **R-SERIES — REFACTORING DEPTH** ✅ SHIPPED (F2 rename w/ previewed apply, Shift+F12 references, Ctrl+Shift+I format, format-on-save toggle). Evidence: 1167-dev study confirms rename = #1 refactoring.
- **E-SERIES — POWER SURFACE** ✅ SHIPPED (Ctrl+K palette, Ctrl+Shift+F find-in-files, Ctrl+` terminal, LSP bridge, bounded delegation console, provenance source-ref links, ship telemetry v0).
- **PLUGINS v1** ✅ SHIPPED (catalog install/trust from 20-preset catalog, three capability contributions: git-review/env-inspector/markdown-preview).
- **PR — PHASE ROUTER** 🔜 QUEUED after Situation Object + BENCH verdicts. Skill: aide-phase-router.
- **ORCH — ORCHESTRATOR AWARENESS** 🔜 QUEUED after PR. Situation engine (/api/orch/context), recommendation engine, BENCH productization, MONITOR sheet. Skill: aide-orchestrator-awareness.
- **HM/CIPHER — HOUSE MODEL FLUID ENGINE TRACK** 🔜 QUEUED after ORCH. Static capable base + per-user LoRA adapters trained on verified AIDE trajectories via /lora-adapters hot-swap (<20ms), battery-gated promotion; three-tier learning ([learned] blocks -> nightly QLoRA -> full FT); Loop C events.jsonl feeds training data. Research-grounded on CLaaS/MERA/SIA/SLIFT/WER/ZOForLLMAgents. Skills: aide-cipher-house-model. NEW.
- **W6 — CUTOVER CONVERGENCE** ⚙️ PARTIAL (TS runtime binary port ✅ e762237; router resolve fix ✅ 3377167; legacy-key compat + gated BoN port + /api/chat facade flip ✅ 28a14c3 LIVE-PROVEN; remaining: models-family ts ports [profile, register] then prefix flip).
- **W7 — WORKSPACE KNOWLEDGE (A2 UI)**: hybrid RAG results in command palette/search; index status chip; embedder smoke on 1060. Skills: aide-offline-rag.
- **W8 — RESILIENCE + NOTIFICATIONS SURFACE**: toast center, compound-run grouping, No-Brick-Wall recovery cards for every blocked state (cockpit law compliance sweep). Skills: aide-build-b4-notifications, aide-resilience-orchestrator.
- **W9 — RELEASE ENGINEERING**: installer + bundled models, clean-install offline smoke, BYOK live consent smoke, synchronized release build. Shell decision: Tauri preferred if Rust toolchain installed in dedicated session; Electron as fallback (npm-only). Desktop staging pipeline already working (desktop/prepare.mjs + verify-prepare.mjs). Skills: aide-arch-packaging-release, aide-release-engineering, aide-cloud-handoff.

**CURRENT PHASE: P6 DESKTOP CONTROL (operator-designated flagship; DC-a shipped+CI-green w/ cockpit panel, DC-b trajectory recorder live, /ask brain wired; remaining = T2 executor integration approval cards + business ops lane [outlook_draft_email/excel_generate] + DC-b screen-vision). P5 TELEGRAM bridge+wizard+brain SHIPPED (d5ebab8..1025919). Micro-Expert Collective skill authored (aide-micro-expert-collective), runner build queued. P0 LAUNCH SHELL next after P6 executor integration; P1-P4 follow ladder in docs/LAUNCH-AUDIT-2026-08-25.md. X1.c/d memory slices interleave. THINKING import ready, awaiting GPU-window journal announcement.**

## Completed Phases Summary

| Phase | What Shipped | Key Commits |
|---|---|---|
| W1 | Facade unwrap, HELP button, exit battery | 50e9044, 406875d |
| W2 | Cockpit clean rewrite + binary serving root cause fix | cd06b33 |
| W3 | Agent loop wiring, plan/approve/apply, diff review, rail badges | d5605ac |
| W5 | Harness scaffold v2.1 micro/full tiers, drift reinjection, gated BoN | f5d7f1d |
| R-series | F2 rename, Shift+F12 references, format-on-save | 862955f |
| E1-E3 | Palette, search, terminal, SHIP flow, delegation console | 5b44886, 862955f |
| Plugins v1 | Catalog install/trust, 3 capability contributions | ed806d4 |
| Backend auto-select | --list-devices probe, Vulkan/CUDA/CPU resolution, --prio -1 | 514a387 |
| House model files | Cipher base+LoRA copied into models/aide-house/, manifest entry ready | pending |

## Pending Operator Actions

- Fine-tune GGUFs landing → MODELS→IMPORT→battery rerun
- Browser pass on cockpit = W3/W4 exit gate signoff

## Competitive Gap Matrix (what users WILL compare against)


Not copying — knowing the adoption bar. Sources: VS Code BYOK/Language Models API blogs (2025-2026), Cline docs/marketplace listing, Cursor/Windsurf public docs.

| Capability | Cursor/Windsurf | Cline/Kiro | VS Code native | AIDE status |
|---|---|---|---|---|
| Split editor groups | yes | yes | yes | **DONE** (P3) |
| Inline diff edits w/ review-revert | yes | yes (diff view + Timeline) | yes | **GAP** -> A1 |
| Agent loop w/ tool use (read/write/run/search) | yes | yes (Plan/Act modes, checkpoints) | yes | **GAP** -> A1 |
| Checkpoints / undo agent work | yes | yes (Compare/Restore) | partial | **GAP** -> A1 (git-stash based) |
| Model picker incl. local + BYOK | yes | yes (Ollama/LM Studio/OpenRouter) | yes (BYOK, LM Provider API) | **PARTIAL** (local runtime done) -> M1-M3, H2 |
| Workspace semantic indexing | cloud-based mostly | AST+regex+context mgmt | embeddings via Copilot | **GAP** -> A2 (fully LOCAL: tree-sitter chunks + local embeddings + SQLite) |
| Tasks/terminal/git built-in | terminal yes | terminal yes | yes | **DONE** (B1, P8, P4) |
| Problem-aware fixes (diagnostics feed) | yes | yes (watches linter/compiler) | yes | **PARTIAL** (LSP markers done) -> B2 |
| Notifications/harness | yes | yes | yes | **GAP** -> B4 |
| Extension ecosystem OFFLINE | no (cloud marketplaces) | no | no | **UNIQUE** (P9) |
| Skill/governance layer w/ curation | no | partial (custom tools/MCP) | no | **UNIQUE** -> S1 |
| Zero-phone-home guarantee | no | no | no | **UNIQUE** -> V1 |

Honest notes: tab-autocomplete (Cursor's killer feature) is weak territory for small local models — defer or ship FIM-format completion late; say so publicly rather than ship junk. Inline edits and the agent loop are the two gaps that BLOCK adoption — they are top priority after B-series.

## Phase Catalog

### DONE (shipped, verified)
- **P0-P2**: foundations, backend core, frontend shell (aide-arch-foundations/-backend-core/-frontend-core)
- **Wiring**: OpenAPI/zod contract layer, WS events, e2e (aide-arch-wiring)
- **P3 editor**: Monaco core, tabs, find/replace, split groups, dirty state (aide-arch-editor)
- **P4 git**: status/diff/stage/commit via CLI (aide-arch-git)
- **P5 protocols**: LSP + DAP clients (aide-arch-protocols)
- **P6 model runtime**: llama.cpp spawn chain, chat SSE, warmup gates (aide-arch-model-runtime + Large-GGUF memory expansion policy)
- **P7 git panel UI**, **P8 terminal** (xterm/node-pty), **P9 extensions + offline marketplace** (aide-arch-terminal/-extensions)
- **B1 task service**: contracts, service, routes, non-blocking run, cmd.exe bridge, 11 unit + 6 arch tests green (aide-build-b1-task-service)
- **P10 training ecosystem**, **P11 packaging/release** (aide-arch-training-ecosystem/-packaging-release)

### NEXT — locked order
- **B2 problem matchers**: DONE (daemon feed, commit 2e57f85): registry + parse engine + `/api/problems/parse` + diagnostics over event channel; aide-build-b2-problem-matchers
- **B2b problems panel**: DONE (commit cc71454): legacy TaskManager resolves matchers, parses output at close, `/api/diagnostics` now serves task problems source-tagged `task <id>` (severity 1/2/3, clear-on-rerun, escape-dropped) merged ahead of LSP entries; real UI panel renders them unchanged via existing 3s poll. Panel gate of aide-build-b2-problem-matchers satisfied on the production UI path.
- **B4 notification harness**: DONE daemon-side (commits 5ca4822+85a2734, CI green): NotificationService (coalescing store), hook engine (.aide/hooks.json, consent guard FORBIDDEN/CONSENT_REQUIRED), OS toast builder + OSC encoders, 6 routes, WS channel `notifications`, task-event fan-out; aide-build-b4-notifications. UI toast-center consumption queued as B4b (B2b pattern).
- **B3 compound tasks**: DONE daemon-side (commits 483211c+a4d41d9, CI green): dependsOn graph w/ cycle detection + inline deps, sequential/parallel orchestration w/ failed_dependency, background readiness via matcher ends-pattern, coordinator jobs grouped by parent_job_id/name_path, group kill; single-root notification law wired into B4 ingestion. UI grouping of compound runs queued as B3b (B2b pattern).
- **B5 local build cache**: DONE (commit 7d1ed34, CI green): content-hash keys (canonical-JSON sha256 over label+argv+input-glob contents+declared env+node version), restore-without-spawn w/ honest banner + restored flag, exit-0-only recording, watcher exclusion, LRU eviction, stats/clear routes. **BUILD SERIES B1-B5 SHIPPED daemon-side**; queued UI passes: B3b compound grouping, B4b toast-center (legacy-wiring pattern).
- **M1 model hub search/download**: DONE daemon-side (commit 4049f46, CI green): injectable-fetcher search + egress journal before first byte, resumable .part downloads (Range, bounded auto-retry keeping part), cancel w/ cleanup, per-model manifests, `modelhub` WS channel; routes search/download/cancel/downloads/import. Live-download manual verification + hub UI panel queued (needs network consent).
- **M2 device benchmark + recommendation**: DONE daemon-side (commit 8fbc6a7, CI green): verdict tiers COMFORTABLE/TIGHT/OVER (0.70/0.95) in fitModel + contract; free-VRAM probe via nvidia-smi (pure parser); existing ingest->fit chain provides the route surface.
- **M3 import any GGUF**: DONE daemon-side (same commit 4049f46): header-validated import into models/ with source:manual manifest, unsupported-runtime flag for unknown archs; warmup-gate load flow reuses existing model-runtime chain. **M-SERIES SHIPPED daemon-side**; queued: hub explorer UI panel + repo quant-sheet (PocketPal/ToolNeuron reference UX).
- **A1 offline agent loop**: DONE daemon-side (commit 51d90be, CI green): Plan/Act modes w/ approved switch_mode, tolerant XML tool protocol (parser: schema-gated params, unclosed-tag detection, alias normalization — aider evidence says text formats beat function calling for local models), 8 tools (read_file/list_dir/search/write_file/replace_in_file/run_command/switch_mode/attempt_completion; diagnostics deferred — no problems store exists yet), flexible SEARCH/REPLACE ladder (exact→trailing-ws→relative-indent, CRLF-normalized), human approval gate w/ diff preview + risk flags (protected-file, network-command→B4 consent tokens + egress journal, invisible-char DENY), consecutive-mistake limit (3) + max iterations (25), shadow-git checkpoints (.aide/checkpoints/repo, core.worktree, nested-repo rename-aside, reset --hard + clean :/ — SUPERSEDES the original git-stash idea; stash would corrupt user repo state), WS channel `agent`, routes start/decision/status/sessions, scripted-chatFn e2e proves zero egress. aide-offline-agent-loop. Queued: A1b agent panel UI (approval cards, Monaco diff preview, checkpoint timeline); live-model smoke on GTX 1060; diagnostics tool once a problems store exists.
- **A2 workspace indexing (offline RAG)**: DONE daemon-side (commit 4e5595a, CI green): pure-JS hybrid retrieval with ZERO new native deps — structure-aware heuristic chunker (regex unit anchors across JS/TS/Python/Go/Rust/Java/markdown; cAST-style greedy sibling packing to 1800 non-ws chars; never cuts mid-unit; oversized units sub-split on blank lines; enrichment headers path|signature; stable ids relPath#unitIndex), Okapi BM25 (symbol-preserving tokenizer, zero-score filter) ⊕ Float32 dense vectors → RRF(k=20) w/ per-source rank provenance; incremental sha256 diff reindex (unchanged skipped, deleted purged, branch change = full rebuild); persistence .aide/index/{manifest,chunks,vectors.bin} atomic tmp+rename w/ caps (512KB/file, 50k chunks); degraded:true BM25-only fallback when embedder down; routes POST /api/index/reindex (BUSY→409 CONFLICT) GET /api/index/status GET /api/index/search; WS channel `index`; injectable indexEmbedFn seam. Research verdict encoded: function-per-chunk is the WORST strategy (arXiv 2605.04763); nomic search_document:/search_query: prefixes mandatory. aide-offline-rag. Queued: A2b UI wiring of hybrid results into search palette; live embedder GGUF smoke on GTX 1060; per-file vector incrementality (v1 re-embeds all changed-set docs).
- **H1 cloud handoff**: session export/import between local harness and cloud providers; conversation-history carry-over like VS Code handoff; never sends code unless user explicitly delegates (aide-cloud-handoff)
- **H2 provider config UI**: BYOK manager (OpenAI-compatible endpoints, Ollama, cloud keys stored locally encrypted), per-task model roles (chat/plan/utility) mirroring VS Code `chat.utilityModel` concept (same skill)
- **R resilience orchestrator**: capability state machine, circuit breaker, failover popup w/ grounded local-model recommendation, durable outbox, visible degradation tiers, harness intelligence/escalation ladder (aide-resilience-orchestrator)
- **C cloud economy**: distilled-intent briefs (never raw transcripts to paid APIs), tiered execution router (local-first + FrugalGPT-style cascade judged by Veritas gates), budget governor w/ cache-aware accounting + escalation-rate dashboard + anti-drain guards, per-provider efficiency profiles calibrated on own ledger data (aide-cloud-economy)
- **X1 Helix Memory**: essentially-unlimited context for ANY model — dual-strand fact+provenance entries, 4-tier hierarchy, sleep-time extraction, promotion/decay, multi-signal retrieval, staleness gates (aide-helix-memory)
- **X2 Veritas Layer**: honesty gates + provenance chips, execution sandbox + verification ladder, and the improvement flywheel — contrastive skill/insight extraction from own traces, verified-as-intervention A/B, consolidation; every model gets better with use without touching weights (aide-veritas-layer)
- **I Iron Suit Orchestrator**: capstone integration — division of labor contract, tool-scope discipline, restraint ladder, traces-as-artifacts, operational metrics dashboard, personalization layer, future-proofing test (aide-iron-suit-orchestrator)
- **M-SOP Model SOPs**: Developer's Credo as mechanically-enforced procedure injection for every model session: six-step task SOP, phase-at-a-time completion, creed failure protocol, compliance metrics (aide-model-sop)
- **S1 skill curation/discoverability**: tags, file-type mapping, context auto-suggest ("you opened a Shopify theme -> these 3 skills apply"), search, dependency declaration between skills (aide-skill-curation)
- **V1 supply-chain/no-phone-home audit**: SBOM of deps, static scan for fetch/http/net usage, runtime egress log (daemon-level net shim), CI gate that fails on unexpected outbound calls (aide-supply-chain-audit)

### EXISTING SKILLS (reference, don't duplicate)
Terminal (P8), Extensions (P9), Packaging/release (aide-arch-packaging-release, aide-release-engineering), Training ecosystem (P10), CI diagnostics (aide-ci-diagnostics), Performance & launch (aide-perf-launch-engineering), Distribution (aide-distribution-packaging).

## Complete Coverage Matrix (every capability surface of an AI IDE -> owning skill)
Directive 2026-08-22: no capability may be built without a named skill or scheduled spec. Rows are exhaustive; anything new gets added here FIRST.
| Surface | Owner |
|---|---|
| Foundations, contracts, backend/frontend core | aide-arch-foundations, -backend-core, -frontend-core, -wiring |
| Editor core + depth | aide-arch-editor; depth = parity P3 skill (created at phase start per parity router) |
| Commands/keybindings/settings | parity P1 (shipped) |
| Quick-open/global search/replace/symbols | parity P2 (shipped) |
| SCM/git UX | aide-arch-git (+ parity P4 shipped) |
| Debug depth | parity P5 — scheduled, spec structure in parity router |
| Tasks/task service/matchers/cache | BUILD series: b1-b5 skills (b1,b2,b2b DONE) |
| Notifications/hooks | aide-build-b4-notifications |
| Compound/background tasks | aide-build-b3-compound-tasks |
| Terminal/profiles | aide-arch-terminal (+ parity P6 for profiles) |
| Extension ecosystem/API v1 | aide-arch-extensions (+ parity P7 API surface) |
| Theming/icons/accessibility/i18n | parity P8 — scheduled |
| Performance budgets/large-repo/memory/watchers | aide-perf-launch-engineering (NEW 2026-08-22) + parity P9 CI gate |
| Test explorer | parity P10 — scheduled |
| Local model runtime | aide-arch-model-runtime |
| Model acquisition M1-M3 | aide-model-hub-acquisition |
| Offline agent loop + workspace RAG | aide-offline-agent-loop (A1+A2) |
| Cloud handoff/provider config/cloud economy | aide-cloud-handoff (H1/H2), aide-cloud-economy (C1-C4) |
| Resilience/failover/degradation | aide-resilience-orchestrator |
| Unlimited-context memory | aide-helix-memory |
| Honesty gates/improvement flywheel | aide-veritas-layer |
| Orchestrator capstone/personalization | aide-iron-suit-orchestrator |
| Model SOP injection/credo enforcement | aide-model-sop |
| Skill curation/discoverability | aide-skill-curation |
| Supply-chain/no-phone-home audit | aide-supply-chain-audit |
| Packaging/installer/updater/signing/download UX | aide-arch-packaging-release + aide-distribution-packaging (NEW) + aide-packaging-offline |
| Release verification/evidence | aide-release-engineering + verification-complete |
| In-app offline docs/help viewer | SCHEDULED post-P8 polish phase (one-liner spec: local markdown help set + palette entry; skill written at phase start) |
| Inline FIM completions | DEFERRED by recorded gap-matrix decision (defer-or-ship-late); revisit only after A2 RAG lands |
| Remote SSH/container, notebooks, web flavor, realtime collab | EXPLICIT NON-GOALS (parity router); revisit only after P10 |

## Week Plan (from today)

- **Day 1**: Ship B1: README tasks section, AGENT_NOTES journal, commit, push, watch CI to green.
- **Day 2**: B2 problem matchers end-to-end (parser + route + test). DONE 2e57f85 (daemon feed); B2b panel wiring queued at top of NEXT.
- **Day 3**: B4 notifications (harness + routes + UI center).
- **Day 4**: B3 compound tasks + wire B2 matchers into task runs.
- **Day 5**: B5 local cache + V1 audit skeleton (egress log first — cheap, high value).
- **Day 6**: M1 hub search/download behind explicit consent UI; M3 import flow.
- **Day 7**: A1 agent loop scaffold (tool schema, approval gate, read-only tools) + A2 indexing spike. Handle the 2 open PRs.

### Week 2+ sequence (adoption blockers before polish)
R resilience core (breaker + capability state) -> X1 Helix Memory tiers 1-3 -> M-SOP injection v1 (KNOW/VERIFY gates only) -> H1/H2 provider config minimal -> C economy core (C1 briefs + C3 ledger first; C2 router + C4 profiles once real traffic exists) -> X2 honesty gates -> X2 flywheel capture -> I orchestrator metrics dashboard -> S1 curation UI. B-series polish interleaves as tests demand.

## Gate Per Phase

Each phase ships only when: unit tests green, arch suite green (>= previous count), tsc node+browser clean, eslint clean, openapi regen produces zero diff, e2e for user-visible flows passes offline (network blocked), AGENT_NOTES journaled, evidence file written under docs/evidence/.

## Escalation Rule

If a request conflicts with the Standing Laws (e.g., "add telemetry", "auto-download models on startup"), refuse and cite this file. If two phase skills conflict, the more recently verified one wins and this router gets updated same-day (continuous-improvement-sop).

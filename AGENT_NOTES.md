# AGENT_NOTES — AIDE Sovereign Workbench

Project: E:\aide-sovereign-workbench — offline-first IDE (VS Code + GitHub + Android Studio) with 3 pre-installed GGUF models, zero cloud.
Journal rules: append-only, newest first, timestamped `YYYY-MM-DD HH:MM`, actor named. This is the project memory.

## CURRENT STATUS

- 2026-08-14 03:02 verified runtime-routing fix: patched daemon/model-manager.mjs now verifies `/v1/models` identity before declaring an endpoint ready or proxying chat. Live qwen 1.5B endpoint 8081 is correctly blocked as conflict because it serves unrelated `qwen35` from `E:\llama-cpp\llama-server.exe`; AIDE did not kill it. SmolLM2 was started on 8082 through the patched daemon and `/api/chat` returned HTTP 200 with assistant content `"OK."`.
- 2026-08-14 02:05 directive: user reconfirmed that AIDE needs a professional front-to-back rebuild to production readiness. Treat the current workbench as an untrusted prototype; research, audit, and verify every capability before retaining it. Investigation is in progress; no product code, runtime, or existing skill was changed in this turn. Tentative new orchestration skill: `aide-ide-delivery`, to be finalized from the audit and research.
- 2026-08-14 directive: user says AIDE must be finished end-to-end, simpler, and must rival Visual Studio Code in every meaningful way with offline-first operation plus opt-in online abilities. Architecture direction from research: VS Code/Theia-class workbench with browser frontend + local Node daemon backend, extension host, agent host, LSP, DAP, real PTY terminal, Git/task/debug/editor cores, local GGUF model runtime by default, provider adapters only behind explicit user opt-in.
- Phase skills created (10): aide-ide-research (master), aide-phase1-model-runtime, aide-phase2-view-switching, aide-phase3-editor-core, aide-phase4-git-integration, aide-phase5-training-arena, aide-phase6-tutor-mode, aide-phase7-community-hub, aide-phase8-android-build, aide-packaging-offline. All research-grounded.
- Python runtime FIXED: use `py -3.10 -E` (E:\Python310). Env self-contained: numpy 2.2.6, jinja2 3.1.6, diskcache, typing-extensions, uvicorn, fastapi, sse-starlette, starlette_context, pydantic_settings installed; llama_cpp 0.3.34 copied into E:\Python310\lib\site-packages. NEVER use plain `python` (MS Store stub) or PYTHONPATH=E:\python_packages (cp313-only, broken).
- Daemon python discovery is ROBUST (fixed 8/13 evening, user's IDE reported "fix Python 3.10 env"): ModelManager.probePython() tries AIDE_PYTHON env → `py -3.10 -E` → `py -3 -E` → absolute `E:\Python310\python.exe -E`, lazy re-probe every 5s, start() re-probes before failing. Verified under hostile PATH (no py at all) → still runtime_available=true. Message now: "fix Python runtime: set AIDE_PYTHON or ensure `py -3.10 -E -c "import llama_cpp"` succeeds".
- Model servers VERIFIED: `start_model_servers.ps1` launches 3 llama_cpp.server instances (8081 qwen-1.5b, 8082 smollm2-360m, 8083 qwen-0.5b) — MUST use `--logits_all false` (else 2.32 GiB scores buffer per model; machine had 4 GB free). Real chat verified on all 3 ports. qwen-0.5b was truncated on first download (420,602,730B) — re-downloaded via curl.exe with Bearer token to exact 491,400,064B.
- Daemon ADAPTED to python runtime: ModelManager pythonServer-mode — spawns python servers from `/api/model/start`, verifies already-listening ports by matching `/v1/models` served IDs against the manifest before returning running, blocks occupied/wrong ports as conflicts, stderr → logs/model-<id>.err.log. Fixed earlier: unawaited start() → `{}` (server.mjs now awaits), `fs.createWriteStream` shadow bug (promises fs vs node:fs), missing `processes.set` (status never showed 'running').
- Phase 1 VERIFIED end-to-end: daemon + UI (`node scripts/start.mjs`) → /api/models/start spawns real python server → status 'running' → /api/operator returns real model text ("Hello!") + audit artifact; /api/chat proxy also verified ("1. Hello / 2. World"). UI contract audit passes (103 ids referenced).
- Phase 2 view switching: browser-accepted through the real Edge-headless editor smoke harness on 2026-08-14. The harness now verifies EXP/LEARN/MAP/RUN transitions, overlay containment, fixed viewport overflow, active activity buttons, terminal visibility, and `VIEW:` logs in addition to editor behavior.
- Editor Core targeted gates: `editor/test-groups.mjs`, `session/test-store.mjs`, `daemon/test-workspace-manager.mjs`, `tasks/test-manager.mjs`, `daemon/test-lsp-manager.mjs`, and `daemon/test-dap-manager.mjs` pass. `scripts/acceptance-real.mjs` passes its real workspace integration flow through LSP completion, task, Git, plugin, Academy, Blueprint, provider, artifact, and search paths. The real `daemon/test-dap-fixture.mjs` now passes 17/17 assertions using the configured Python 3.10/debugpy runtime, including breakpoints, stack/scopes/variables, stepping, termination, and orphan cleanup.
- Frontend stabilized again on 2026-08-14 01:41: prior `simple-mode` CSS had a later `CORE WORKBENCH OVERRIDE` that re-shown explorer/editor/terminal; root `styles.css` now ends with a `MODEL-FIRST LOCK` so the served UI hides launch guide, activity bar, explorer, editor/terminal/statusbar, command button, advanced toggle, model handoff, connection duplicate, and assistant-mode selector. Visible core is model controls, lane/status, bounded workflow lane, and chat. Root `app.js` normal local chat now uses raw `/api/chat` instead of `/api/operator`; `/api/operator` remains for heavier contextual workflows.
- styles.css mangled-units concern: RESOLVED — checked both root styles.css (30,757 B) and Desktop/frontend/styles.css (19,021 B); no mangled units found (pattern `:\s*\d+x[;,\s}]` clean in both).
- Current live state at 2026-08-14 23:29: the active training run and unrelated qwen35 server remain protected/untouched. The real-browser harness and temporary-daemon acceptance are now verified; live model inference was not restarted under training load.
- Next: close the remaining Daily-Driver gap: hot-exit recovery and session restore parity before desktop packaging; terminal/task UX and Git panel parity are now implemented and contract/API verified.

---

## [2026-08-15 00:34] Actor: codex
**Type:** Gate 1 implementation checkpoint
**Status:** verified
**Summary:** Implemented the served Git and task Daily-Driver surfaces.
**Details:** Phase 4 audit found the Git API existed but the served UI exposed only refresh/review, with no staging or commit controls. Added structured `git status --porcelain=v1 -z --branch` parsing, branch/file metadata, path-scoped diff, per-file DIFF/STAGE, STAGE ALL, and explicit local COMMIT controls. Phase 3 audit found task buttons remained disabled after launch and never displayed completion output. Added bounded status polling, pass/fail output rendering, button recovery, status text, and STOP ACTIVE. Real acceptance now verifies Git status and path-scoped diff; `scripts/git-ui-contract.mjs`, `scripts/task-ui-contract.mjs`, `scripts/ui-audit.mjs` (108/108), app/server syntax checks, and the real acceptance suite pass.
**Files:** `daemon/server.mjs`, `app.js`, `index.html`, `styles.css`, `scripts/acceptance-real.mjs`, `scripts/git-ui-contract.mjs`, `scripts/task-ui-contract.mjs`, `package.json`, `AGENT_NOTES.md`
**Next:** push this checkpoint, then implement hot-exit recovery/session restore acceptance and test it through the editor/browser harness when Edge is available.
---

## [2026-08-15 00:20] Actor: codex
**Type:** Gate 1 checkpoint
**Status:** verified
**Summary:** Completed the first real Editor Core/Git/DAP acceptance slice and hardened daemon test startup.
**Details:** Applied Phase 3 Editor Core and Phase 4 Git procedures. `tasks/test-manager.mjs`, `daemon/test-lsp-manager.mjs`, and `daemon/test-dap-manager.mjs` pass. Fixed `scripts/test-git-api.mjs` and `scripts/e2e.mjs` sub-two-second daemon readiness windows; both now pass Git staging/commit and daemon endpoint/terminal/model-readiness checks. Fixed `daemon/test-dap-fixture.mjs` to resolve AIDE’s configured Python fallback (`AIDE_PYTHON` or `py -3.10 -E`) instead of silently probing the broken plain `python` stub; the complete debugpy fixture passes 17/17 assertions and writes the verified wire transcript.
**Files:** `daemon/test-dap-fixture.mjs`, `scripts/test-git-api.mjs`, `scripts/e2e.mjs`, `docs/evidence/dap-wire-sequence.json`, `AGENT_NOTES.md`
**Next:** push this checkpoint, then implement/verify terminal-task UX, Git panel parity, and hot-exit recovery. Edge headless remains an environment blocker for the full aggregate suite.
---

## [2026-08-15 00:04] Actor: codex
**Type:** release checkpoint
**Status:** verified
**Summary:** Pushed the production-readiness gate work to GitHub after rebasing onto the remote and removing a historical credential from the journal.
**Details:** Local commit `682d0dc` was rebased onto remote commit `c70eead`, resolving package/test-script and browser-harness conflicts while preserving the remote Veritas additions. GitHub push protection correctly blocked the first rebased push because an old Hugging Face credential had been recorded in `AGENT_NOTES.md`; the journal entry is now redacted, the amended commit is `2e48db3`, and `origin/main` points to that commit. The push was accepted; GitHub reports the repository’s expected `verify` status/PR rule and one moderate Dependabot vulnerability. The Edge headless environment remains blocked: even a standalone `data:` DOM probe hung without output, while the AIDE editor smoke had passed earlier when the browser was responsive. Untracked `.aide/`, `models/qwen2.5-coder-0.5b-instruct-q4_k_m.gguf.corrupt`, and `styles.css.wrongfile` were intentionally left untouched.
**Files:** `AGENT_NOTES.md` — redacted historical credential and recorded release checkpoint; GitHub `origin/main` — updated to `2e48db3`
**Next:** rotate/revoke the previously exposed Hugging Face credential; then continue Gate 1 Daily-Driver work with terminal/task UX, Git parity, LSP/DAP fixture completeness, and hot-exit recovery. Treat Edge headless as an environment gate until its runtime is repaired.
---

## [2026-08-14 23:29] Actor: codex
**Type:** checkpoint
**Status:** verified
**Summary:** Resumed after accidental cancellation, completed Phase 2 browser acceptance, and repaired the real acceptance harness startup gate.
**Details:** Re-loaded/applied the AIDE research, Phase 2/3, release-engineering, verification, surgical-precision, professional-developer, and agent-notes procedures. The cancelled test batch produced no result and was not counted. Reran `editor/test-groups.mjs`, `session/test-store.mjs`, and `daemon/test-workspace-manager.mjs`; all passed. The first `scripts/acceptance-real.mjs` run exposed a two-second temporary-daemon readiness window; changed it to a bounded 15-second health wait with child exit/spawn/stderr diagnostics. The next run reached the LSP completion assertion; after adding response diagnostics, the full real acceptance suite passed. The updated `scripts/editor-smoke.html` also passed real Edge-headless acceptance for EXP/RUN/LEARN/MAP, fixed viewport/overflow, terminal visibility, active buttons, and `VIEW:` logs.
**Files:** `scripts/acceptance-real.mjs`, `scripts/editor-smoke.html`, `AGENT_NOTES.md`
**Next:** run regression checks, review the intentional diff, commit and push to the configured GitHub remote; do not stage `models/*.corrupt` or `styles.css.wrongfile`.
---

## [2026-08-14 18:10] Actor: codex
**Type:** decision
**Status:** verified
**Summary:** Set the forward production-readiness sequence: prove Phase 2 in a real browser, then complete the Daily-Driver Editor Core gate before desktop packaging.
**Details:** Reviewed the current journal, `docs/RELEASE_ROADMAP.md`, `docs/RESEARCH_LOG.md`, `desktop/README.md`, and AIDE release SOP. Research prioritizes Gate 1 Daily-Driver Workbench—real editor/files, undo/save/recovery, search, terminal/tasks, Git, LSP/DAP, model workflows, and real-repository evidence—before Gate 2 Tauri distribution. Current state is Phase 2 code-level complete but browser acceptance pending, with live model chat/full suite also unverified in the latest pass. Decision: next task is real-browser acceptance of EXP/RUN/LEARN/MAP plus local chat when the protected training run permits; next implementation phase is Phase 3 Editor Core parity: open/edit/save round-trip, find/replace, undo/redo, split groups, and hot-exit recovery with failing-on-revert tests.
**Files:** E:\aide-sovereign-workbench\AGENT_NOTES.md — recorded production sequence; docs\RELEASE_ROADMAP.md and docs\RESEARCH_LOG.md — reviewed
**Next:** human/browser acceptance first; codex proceeds to Phase 3 Editor Core after the acceptance result.
---
## [2026-08-14 08:18] Actor: codex
**Type:** checkpoint
**Status:** verified
**Summary:** Repaired the served AIDE view-switch contract and made Python runtime discovery non-blocking for daemon status requests.
**Details:** Root `app.js` now centralizes EXP/RUN/LEARN/MAP/CHAT transitions in `setWorkbenchView(view)`, closes LEARN/MAP before RUN, expands the RUN terminal, and logs uppercase `VIEW:` events. Root `styles.css` now restores EXP/RUN in the guided shell, shows editor chrome for EXP/RUN, keeps overlays contained, and ends with fixed-viewport/mobile overflow overrides. `daemon/model-manager.mjs` now probes candidate Python interpreters asynchronously with a cached in-flight promise and a 5-second lazy retry; `status()` returns immediately with `Checking the local Python runtime…`, while `start()` awaits the same probe. `daemon/server.mjs` maps local model setup failures to HTTP 503. Added `scripts/view-switch-contract.mjs` and wired it into `npm test`/`npm run view-switch-contract`.
**Verification:** `npm run check` passed; `node scripts/view-switch-contract.mjs` passed; `node daemon/test-model-manager.mjs` passed; `node scripts/ui-audit.mjs` passed (`103 ids, 103 referenced`); `node tests/smoke.mjs` passed; isolated patched daemon on port 4878 returned health 200 and model status in ~2.0 seconds while probing; restarted live AIDE pair and observed health `ok:true`, 6 model entries, runtime probe pending, root app/styles served. After the probe window, live status reported all three bundled artifacts `runtime_available:true`. A live absent-model POST intended to observe 503 timed out under current machine load and is not counted as passed. Full `npm test` baseline remained hung for several minutes and was terminated; no training or qwen35 process was stopped.
**Files:** E:\aide-sovereign-workbench\app.js — unified view state; E:\aide-sovereign-workbench\styles.css — view/viewport contract; E:\aide-sovereign-workbench\daemon\model-manager.mjs — async probe; E:\aide-sovereign-workbench\daemon\server.mjs — 503 setup errors; E:\aide-sovereign-workbench\scripts\view-switch-contract.mjs — regression gate; E:\aide-sovereign-workbench\package.json — test script
**Next:** human performs browser acceptance of EXP/RUN/LEARN/MAP and real local chat when safe; codex should next address any observed browser layout defect and then complete the blocked release gates (full test suite, Edge editor smoke, and real model chat).
---
## [2026-08-14 05:41] Actor: codex
**Type:** audit
**Status:** verified
**Summary:** Audited the actual served AIDE paths and established the baseline before the view-switching repair.
**Details:** `index.html` serves root `app.js` and root `styles.css`; `Desktop/frontend/app.js` is a stale parallel frontend and is not loaded by the root page. `npm run check` passed. The full `npm test` baseline produced no output and remained running for several minutes, so it was terminated as a hung baseline; the existing package includes known environment/live integration gates. Root `app.js` currently routes simple chat to `/api/chat` with `modelId`, while its RUN handler only scrolls/focuses the terminal and does not close LEARN/MAP overlays or log `VIEW: RUN`. Root `styles.css` has later responsive rules that restore `overflow:auto` on `html/body` and hide EXP/RUN in simple mode, contrary to the Phase 2 fixed-viewport contract. No product files changed during this audit.
**Files:** E:\aide-sovereign-workbench\index.html, app.js, styles.css, Desktop\frontend\app.js, package.json — inspected; AGENT_NOTES.md — appended audit
**Next:** codex will patch the served root view state/CSS contract, add a regression contract check, then run syntax, targeted tests, and live daemon/UI verification where the environment permits.
---
## [2026-08-14 05:22] Actor: codex
**Type:** checkpoint
**Status:** in-progress
**Summary:** Started a verification-first AIDE completion pass focused on the listed model-runtime, API, frontend view-switching, and launch files.
**Details:** Loaded the mandatory AIDE research, Phase 1 model-runtime, Phase 2 view-switching, release-engineering, journal, and verification-discipline instructions. Read the current journal: Phase 1 is recorded as verified, Phase 2 is code-level complete but browser acceptance is pending, and the live environment currently has an unrelated qwen35 process on port 8081. Baseline inspection and the supplied GitHub repository context are next; no product files changed in this checkpoint.
**Files:** E:\aide-sovereign-workbench\AGENT_NOTES.md — appended session checkpoint
**Next:** codex will inspect Git state and source, run baseline checks, reproduce remaining gaps, patch surgically, verify live behavior, and append the final checkpoint.
---
## [2026-08-14 03:02] Actor: codex
**Type:** bug
**Status:** verified
**Summary:** Fixed daemon false-ready model routing when an unrelated OpenAI-compatible server occupies a bundled model port.
**Details:** Found live 8081 serving unrelated `qwen35` from `E:\llama-cpp\llama-server.exe -m E:\models\qwen3.5-4b\Qwen_Qwen3.5-4B-Q4_K_M.gguf ... --alias qwen35`, while AIDE manifest expects `qwen-coder-1.5b-q4`. Previous daemon logic treated any successful `/v1/models` endpoint as the selected model and could falsely return running or proxy chat to the wrong model. Fix: `ModelManager` now derives expected IDs from manifest ID/model/artifact/local path, verifies `/v1/models` served IDs before `start()`, `isReady()`, `waitReady()`, or `chat()`, reports wrong/hung occupied ports as conflicts, and refuses chat when the endpoint is not the selected model. Also corrected qwen 1.5B `artifact_uri` from `local:///root/models/...` to `local://model-pack/...`. Restarted only verified AIDE Node processes (old 4777 PID 45156, old launcher/UI PID 47940); did not kill unrelated qwen35 or training processes. Verification: `node --check daemon\model-manager.mjs` passed; `node daemon\test-model-manager.mjs` passed; `node --check daemon\server.mjs` passed; direct patched manager check reported qwen 1.5B conflict with served_models `[qwen35]` and SmolLM2 ready when 8082 was live; patched daemon `/api/model/ready?id=qwen-coder-1.5b-q4` reported conflict; `/api/models/start` started SmolLM2 on 8082; `/api/model/ready?id=smollm2-360m-q8` returned ready with served model path; `/api/chat` to SmolLM2 returned HTTP 200 and assistant content `"OK."`; `npm run check` passed; `node scripts\ui-audit.mjs` passed (103 ids, 103 referenced).
**Files:** E:\aide-sovereign-workbench\daemon\model-manager.mjs — endpoint identity verification and occupied-port conflict guard; E:\aide-sovereign-workbench\models\manifest.json — qwen 1.5B artifact URI normalized; E:\aide-sovereign-workbench\AGENT_NOTES.md — status/log updated
**Next:** Fix UI ergonomics so model selection defaults to the first verified ready model, shows wrong-port conflicts clearly, and offers safe next actions without touching unrelated processes.
---

## [2026-08-14 02:02] Actor: codex
**Type:** task
**Status:** in-progress
**Summary:** Began a fresh research and architecture audit for completing AIDE as an offline-first VS Code-class IDE and creating an orchestration skill.
**Details:** Read the workspace journal and mandatory governance/skill-creation rules before planned writes. The journal confirms ten existing AIDE phase skills and a partially verified Node daemon/browser workbench; it also shows that the current model-first UI intentionally hides most IDE panes while model UX is stabilized. Spawned independent audit/research passes for the repository, official IDE architecture sources, and the existing skill system. Planned skill creation is recorded before any skill-file write in compliance with hard-rules R4; tentative name is `aide-ide-delivery` pending evidence from the audit.
**Files:** E:\aide-sovereign-workbench\AGENT_NOTES.md — current status and research kickoff recorded
**Next:** Codex will inspect existing AIDE skills and source architecture, synthesize independently researched recommendations, create and validate the orchestration skill, then present an executable build sequence for user confirmation before broad product changes.
---

## [2026-08-14 02:05] Actor: human / codex
**Type:** decision
**Status:** in-progress
**Summary:** User directed a professional research-first path to take AIDE from its current prototype state to production readiness.
**Details:** User stated that prior work was damaged and requested end-to-end help. Codex adopted a verification-first recovery plan: audit claims against source and live runtime, choose a proven desktop-IDE foundation, create a skill that routes existing AIDE/project procedures, establish a capability baseline, then rebuild through end-to-end acceptance gates. No runtime processes or product files have been changed by this recovery turn. The active plan records discovery/research first, then skill creation, a capability-gap baseline, foundation implementation, and offline release verification.
**Files:** E:\aide-sovereign-workbench\AGENT_NOTES.md — current status and recovery decision recorded
**Next:** Codex will complete architecture/codebase research, validate the proposed `aide-ide-delivery` skill, and begin the first verified foundation milestone rather than restoring hidden UI panels prematurely.
---

## [2026-08-14 01:41] Actor: codex
**Type:** update
**Status:** verified
**Summary:** Applied all AIDE job skills, verified stale handoff against disk/live state, enforced model-first UI, and moved normal chat off the heavy operator path.
**Details:** Loaded AIDE/project skills for this job: hard-rules, agent-notes, aide-ide-research, aide-phase1-model-runtime, aide-phase2-view-switching, aide-phase3-editor-core, aide-phase4-git-integration, aide-phase5-training-arena, aide-phase6-tutor-mode, aide-phase7-community-hub, aide-phase8-android-build, aide-packaging-offline, aide-release-engineering, verification-complete, surgical-precision, verify-first-discipline, and professional-developer. Verified actual current state rather than trusting the handoff: root `index.html` loads root `styles.css` and root `app.js`; `Desktop/frontend/app.js` is not the served script. Found stale/incomplete UI simplification: earlier `MODEL-FIRST STABILIZATION MODE` hid non-model UI, but a later `CORE WORKBENCH OVERRIDE` re-displayed explorer/editor/terminal. Added final `MODEL-FIRST LOCK` at end of `styles.css` so cascade order hides launch guide, activity bar, explorer, editor column, command button, mode toggle, workspace text, handoff/connection duplicates, and assistant-mode selector while keeping DOM/code intact. Changed root `app.js` normal local chat to call `/api/chat` with recent short history and `{max_tokens:180, timeout_ms:120000}` instead of `/api/operator`; changed `daemon/server.mjs` `/api/chat` to pass request options through to `modelManager.chat()`. Verified `npm run check` passed; `node scripts\ui-audit.mjs` passed (103 ids, 103 referenced); started `node scripts/start.mjs` in background with logs at `logs/start-ui.out.log`/`.err.log`; verified listeners on 4173/4777/8081; verified served page HTTP 200, daemon `/api/models` returned manifest, served CSS contains final `MODEL-FIRST LOCK`, served JS contains `/api/chat`, and live `POST /api/chat` to qwen-coder-1.5b returned assistant content `OK` with usage 15 prompt tokens + 112 completion tokens in ~52s. Also observed `/api/operator` timed out with `"The operation was aborted due to timeout"` after ~117s, consistent with large workspace-context prompt overhead on CPU.
**Files:** E:\aide-sovereign-workbench\styles.css — final model-first lock; E:\aide-sovereign-workbench\app.js — normal local chat uses raw daemon chat; E:\aide-sovereign-workbench\daemon\server.mjs — `/api/chat` forwards options; E:\aide-sovereign-workbench\AGENT_NOTES.md — status/log updated
**Next:** Human verifies in real browser at http://127.0.0.1:4173. Then reduce perceived latency: prefer smaller/faster default model when available, add visible "CPU generation may take ~50s" progress state, and keep operator/workflow separate from simple chat until model loop is solid.
---

## [2026-08-14 00:00] Actor: codex
**Type:** decision
**Status:** done
**Summary:** Rescoped AIDE from a feature-panel prototype into a VS Code-class offline-first IDE with opt-in online adapters.
**Details:** User clarified that AIDE must compete with Visual Studio Code in every meaningful way, ideally better, and must be universal: offline working by default with optional online abilities. Research checked against primary docs: Eclipse Theia two-process frontend/backend model, VS Code Extension API and web extension host constraints, VS Code LSP guidance, DAP/debugger extension guidance, VS Code Agent Host architecture, and llama.cpp server OpenAI-compatible API. Decision: AIDE needs a small reliable shell with progressive capability gates, not many visible half-working panels. Default path: local workspace, local files, local terminal, local Git, local LSP/DAP, local GGUF model chat/agent. Online providers, marketplace sync, remote repos, and cloud models must be opt-in adapters with explicit user permission and local fallback.
**Files:** E:\aide-sovereign-workbench\AGENT_NOTES.md — updated current status and decision log
**Next:** Produce and execute a build roadmap: Foundation Core, Editor Core, Terminal/Tasks, Git, LSP/DAP, Agent Host, Extensions, Android tooling, Packaging, then optional online adapters.
---

## [2026-08-14 00:00] Actor: codex
**Type:** update
**Status:** verified
**Summary:** Applied model-first stabilization UI and recorded user directive to simplify the IDE until functions work end-to-end.
**Details:** User reported that the whole IDE needs to be finished end-to-end, none of the functions feel working, and the experience must be simpler. Implemented CSS-only stabilization mode in `styles.css`: hides activity bar, editor column, explorer/sidebar tools, command/advanced buttons in `body.simple-mode`; expands the agent panel into a two-column full workspace containing model controls, model lane/status, bounded workflow log/actions, and a prominent chat pane. Underlying markup/JS for explorer, terminal, git, tasks, academy, blueprint, community, and training remains in place but hidden. Verification: `npm run check` passed; `node scripts\ui-audit.mjs` passed with 103 ids referenced; `py -3.10 -E -c "import llama_cpp"` passed. Logs showed qwen 1.5B and 0.5B servers had previously started and generated, so the model files/runtime are healthy; no current listener found via `netstat` before restart attempt.
**Files:** E:\aide-sovereign-workbench\styles.css — added model-first stabilization override; E:\aide-sovereign-workbench\AGENT_NOTES.md — updated current status and log
**Next:** Start/restart app, verify `/api/health`, `/api/models`, model start, and chat from the simplified UI/API; then proceed feature-by-feature with a simpler working core.
---

## [2026-08-13 21:30] Agent: opencode
**Type:** checkpoint
**Status:** verified
**Summary:** Laptop restarted; state verified intact, Phase 2 RUN-button gap fixed at code level.
**Details:** After reboot: no daemon/UI running (expected); `py -3.10 -E -c "import llama_cpp"` OK; all 3 GGUF present (smollm2 386,404,992B; qwen-0.5b 491,400,064B; qwen-1.5b 1,117,320,768B). Phase 2 audit per aide-phase2-view-switching: view-switch IIFE (app.js ~911-970) binds EXP/LEARN/MAP with showEditor/showLearn/showBlueprint + VIEW: console logs; overlay CSS and :has() chrome hiding verified in styles.css; html{100vh;100vw;overflow:hidden} at styles.css:30. GAP FIXED: RUN button did not exit LEARN/MAP overlays (scrollIntoView on hidden .bottom-panel does nothing) — now runBtn.onclick = showEditor() + unhide .bottom-panel + focus #terminal-command. All chrome selectors confirmed in index.html. ui-audit passes (103/103). No jsdom/linkedom in node_modules — DOM-level automation not possible without adding deps; browser acceptance is user's task (Edge headless broken).
**Files:** E:\aide-sovereign-workbench\Desktop\frontend\app.js — RUN handler in view-switch IIFE
**Next:** User launches `node scripts/start.mjs` (daemon + UI), verifies in browser: chat + view switching + DevTools VIEW logs. Then Phase 3.

---

## [2026-08-13 20:15] Agent: opencode
**Type:** bug
**Status:** fixed
**Summary:** Daemon reported "fix Python 3.10 env" from IDE while env was healthy — root cause: daemon's startup probe used `py` which the IDE terminal env could not resolve.
**Details:** User saw setup_message "fix Python 3.10 env: py -3.10 -E -c "import llama_cpp" must succeed" in the IDE. Probe verified fine from normal shell; live daemon (PID 22864) had runtime_available=false → its load() probe failed (spawnSync('py') unresolved in the daemon's launch env). FIX: ModelManager.probePython() now resolves the interpreter in order — AIDE_PYTHON env → py -3.10 -E → py -3 -E → absolute E:\Python310\python.exe -E — stores pythonCmd, re-probes lazily when !pythonReady && >5s since last probe, and start() re-probes before failing with a message listing candidates. setup_message updated to "fix Python runtime: set AIDE_PYTHON or ensure `py -3.10 -E -c "import llama_cpp"` succeeds". VERIFIED: normal PATH → runtime_available true; PATH stripped to C:\nonexistent → still true (absolute fallback). Stale daemon 22864 killed; fresh daemon restarted (runtime_available=true). Reboot since then — daemon must be relaunched by user.
**Files:** E:\aide-sovereign-workbench\daemon\model-manager.mjs — probePython(), lazy re-probe in status(), interpreter resolution in start()
**Next:** done — user relaunches app after reboot.

---

## [2026-08-13 20:50] Agent: opencode
**Type:** milestone
**Status:** verified
**Summary:** Phase 1 (model runtime) COMPLETE and verified end-to-end on real hardware. Daemon adapted to llama-cpp-python runtime.
**Details:** (1) Python env: installed numpy 2.2.6, jinja2 3.1.6, diskcache, typing-extensions, uvicorn, fastapi, sse-starlette, starlette_context, pydantic_settings into E:\Python310; copied llama_cpp 0.3.34 (pure-python + DLLs, no .pyd) into E:\Python310\lib\site-packages; `py -3.10 -E` imports and generates. (2) start_model_servers.ps1: sequential start of 3 servers (RAM burst fix), `--logits_all false` (critical: default True allocates n_ctx×151936×4B scores = 2.32 GiB per 4096-ctx model), polls /v1/models up to 5 min, READY/FAILED, Enter kills all, logs to logs/server-<port>.{out,err}.log. All 3 verified: 8081 "Hello.", 8082 "One-word response: HAPPY!", 8083 "Hello!". (3) qwen-0.5b GGUF was truncated (420,602,730B < 491,400,064B) — re-downloaded byte-exact with curl.exe + Bearer; corrupt copy kept as .gguf.corrupt. (4) Daemon: ModelManager pythonServer-mode (probe in load(), spawn `py -3.10 -E -m llama_cpp.server --model <file> --host 127.0.0.1 --port <port> --n_ctx <ctx> --n_gpu_layers 0 --logits_all false`, stderr → logs/model-<id>.err.log, idempotent already-listening check); server.mjs awaits start() (was returning `{}` — JSON.stringify of a Promise). Bugs fixed during verification: promises-fs shadow (`fs.createWriteStream` on node:fs/promises), missing processes.set (status stuck 'ready'), stale daemon orphans on 4777/4173 (kill via Get-NetTCPConnection listener PIDs). (5) End-to-end: node scripts/start.mjs → UI 200 + manifest via UI + /api/models/start → running → /api/operator answer "Hello!" + audit aide-1786671232917-84357877/answered. (6) Test suite: 31/33 pass; acceptance-real + test-git-api flaky under load (5s git timeout; pass standalone — machine runs 2 concurrent SFT trainings, 4 GB free RAM); editor-smoke ENV-BLOCKED (Edge headless networking broken machine-wide — data: works, all http/https hang incl. example.com, all flag combos, no proxy env; chrome.exe absent); dap-fixture SKIPPED (debugpy). Tutor passes with AIDE_PYTHON=E:\Python310\python.exe. Frontend chat wiring already existed (boot→sendChat→/api/operator) — no changes needed.
**Files:** E:\aide-sovereign-workbench\start_model_servers.ps1 (new), daemon\model-manager.mjs (pythonServer mode), daemon\server.mjs (await fix), models\qwen2.5-coder-0.5b-instruct-q4_k_m.gguf (re-downloaded)
**Next:** Phase 2 view switching per aide-phase2-view-switching; repair styles.css mangled units; user interactive verification in browser (http://127.0.0.1:4173, DevTools console).

---

## [2026-08-13 15:40] Agent: opencode
**Type:** decision
**Status:** done
**Summary:** Created 10 research-grounded phase skills per user's first directive.
**Details:** User directive: research first (web, Big Tech practice), create a skill for every IDE phase, apply as SOPs, confirm before continuing. Research sources: theia-ide.org architecture/extensions docs, VS Code Monaco design doc + debugger-extension guide, Theia DeepWiki (terminal/DAP), ggml-org llama.cpp server README + production guides, Multigrid model-shipping doctrine, Tauri v2 resources/Windows-installer docs, Electron packaging docs, Android developer docs (Gradle/APK/signing/emulator). Skills written to C:\Users\Grey_\.agents\skills\: aide-ide-research (master), aide-phase1-model-runtime, aide-phase2-view-switching, aide-phase3-editor-core, aide-phase4-git-integration, aide-phase5-training-arena, aide-phase6-tutor-mode, aide-phase7-community-hub, aide-phase8-android-build, aide-packaging-offline.
**Files:** C:\Users\Grey_\.agents\skills\aide-ide-research\SKILL.md, aide-phase1-model-runtime\SKILL.md, aide-phase2-view-switching\SKILL.md, aide-phase3-editor-core\SKILL.md, aide-phase4-git-integration\SKILL.md, aide-phase5-training-arena\SKILL.md, aide-phase6-tutor-mode\SKILL.md, aide-phase7-community-hub\SKILL.md, aide-phase8-android-build\SKILL.md, aide-packaging-offline\SKILL.md — created
**Next:** Wait for user verification of skills; then Phase 1 deliverables per SOP.

---

## [2026-08-13 15:30] Agent: opencode
**Type:** checkpoint
**Status:** verified
**Summary:** Verified machine state for Phase 1 (model runtime).
**Details:** `python` on PATH = MS Store stub (fails). pip 26.2.1 from E:\python_packages (python 3.13). py -0p: 3.13 Store (WindowsApps), 3.11 C:\Python311 (python.exe MISSING — "Unable to create process"), 3.10 E:\Python310 (works). llama-cpp-python 0.3.34 at E:\python_packages; import FAILED on 3.13 (numpy _multiarray_umath DLL load failed = missing VC++ redistributable) and on 3.10 (No module named 'jinja2.ext'). Manifest endpoints verified: smollm2-360m-q8=8082, qwen-coder-0.5b-q4=8083, qwen-coder-1.5b-q4=8081 (+8084/8085/8086 for unlisted models). app.js already binds #send-button→sendChat (line 864) and Enter key (887); server.mjs has POST /api/chat (line 244) — new wiring must reuse, not double-bind. styles.css now 19,021 bytes (healthy; .bak is 0 bytes).
**Files:** E:\aide-sovereign-workbench\models\manifest.json, Desktop\frontend\app.js, daemon\server.mjs
**Next:** Fix interpreter env (jinja2 for 3.10 or VC++ redist for 3.13) before running model servers.

---

## [2026-08-13 12:00] Agent: opencode
**Type:** event
**Status:** done
**Summary:** Downloaded the 3 GGUF model files via PowerShell Invoke-RestMethod.
**Details:** User provided Hugging Face access for the model download; credential value intentionally omitted from the journal. Canonical repos used (user's own repo has no .gguf): HuggingFaceTB/SmolLM2-360M-Instruct-GGUF (smollm2-360m-instruct-q8_0.gguf, 386,404,992B), Qwen/Qwen2.5-Coder-0.5B-Instruct-GGUF (qwen2.5-coder-0.5b-instruct-q4_k_m.gguf, 420,602,730B), Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF (qwen2.5-coder-1.5b-instruct-q4_k_m.gguf, 1,117,320,768B). All verified present via Get-ChildItem.
**Files:** E:\aide-sovereign-workbench\models\*.gguf (3 files)
**Next:** (done — feeds manifest status update + Phase 1).

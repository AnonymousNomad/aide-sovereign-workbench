# AIDE Research And Gap Log

Every meaningful change must have a research basis, a decision, an acceptance
test, and an honest result. This is the project memory for architecture work.

## Operating Creed

**This is the Way:** research, decide, implement surgically, test live, record
the result, and refuse unsupported completion claims.

## 2026-08-12 — Workbench Reset

- Research: VS Code UX containers, extension host, agents, harnesses, trust and
  safety; Anthropic effective agents; LSP; DAP; Parrot modular/security
  principles; GNOME HIG.
- Decision: use Activity Bar -> primary sidebar -> editor -> tabbed panel ->
  status bar; keep model/harness/execution/permissions separate; use standards.
- Gap found: AIDE exposed prototype panels and unfinished project artifacts as
  if they were finished features.
- Change: removed TinyLiquid from the IDE model catalog and removed Journalism
  Desk from the default workbench.
- Gate: manifest parse, full tests, UI audit, GitHub CI.
- Result: PASS.

## 2026-08-12 — Workspace And Terminal Foundation

- Research: VS Code editor navigation, tasks, terminal, workbench views, and
  workspace behavior; Workspace Manager safety constraints.
- Decision: files must come from the real workspace; terminal commands use
  allowlisted executable plus argument arrays, bounded output, timeout, and
  explicit approval.
- Gap found: demo files and static terminal output were not an IDE.
- Change: real workspace tree/file reads and bounded integrated terminal.
- Gate: workspace manager tests, terminal endpoint smoke, full suite.
- Result: PASS.

## 2026-08-12 — Plugin Boundary

- Research: VS Code extension host isolation/lazy activation and extension UX;
  AIDE offline/trust requirements.
- Decision: validate manifests without execution; require declared capabilities
  and trust; execute only later in isolated worker/child process.
- Gap found: no user plugin contract or safe discovery path.
- Change: plugin manifest validator, trust registry, API version, UI registry.
- Gate: invalid manifest rejection, trust persistence, no entrypoint execution,
  full suite, CI.
- Result: PASS for discovery/trust foundation; execution remains gated.

## 2026-08-12 — Operator Modes

- Research: VS Code agent harness separation and trust; Anthropic workflows,
  ground-truth feedback, bounded loops, tool documentation, and evaluator gates.
- Decision: Ask, Plan, Agent modes; context budget; plan/tool output visible;
  Agent proposals require explicit approval and typed terminal broker execution.
- Gap found: raw chat existed without a model-operated workflow.
- Change: operator endpoint, bounded context, mode budgets, structured proposed
  tools, approval button, execution output.
- Gate: live local Ask/Plan/Agent calls, approval-required Agent result, unit and
  full suites, CI.
- Result: PASS for bounded proposal/execution path; patch/diff/checkpoint loop
  remains next.

## Next Research Gates

- Source control: VS Code SCM patterns, Git safety, diff/stage/revert/worktree
  recovery.
- Tasks: task profiles, problem matchers, streaming output, cancellation, and
  background task lifecycle.
- Diagnostics: LSP publishDiagnostics, Problems navigation, code actions, and
  error-to-agent context.
- Debugging: DAP breakpoints, threads, stack, scopes, variables, stop, and
  crash cleanup.
- Recovery: hot exit, session persistence, checkpoints, undo, and crash restart.
- Plugins: isolated execution, capability RPC, lazy activation, failure
  containment, and plugin end-to-end tests.
- Visual system: accessibility, keyboard navigation, responsive containers,
  reduced motion, contrast, and original security-workbench identity.

## 2026-08-12 — Source Control Review Slice

- Research: VS Code Source Control view, diff editor, status synchronization,
  review-before-commit, graph/history, staging, branches, and conflict flow:
  https://code.visualstudio.com/docs/sourcecontrol/overview
- Decision: expose live status and diff review before implementing mutations;
  staging and commits require a later explicit approval gate.
- Change: added `/api/git/diff`, `/api/git/log`, Source Control status in the
  Explorer, refresh, and diff output in the Panel.
- Gate: UI audit and full suite PASS. Clean repository behavior remains to be
  tested with a dedicated Git workspace before enabling mutations.

## 2026-08-12 — Task Profiles

- Research: VS Code task profiles, background tasks, output presentation,
  problem matchers, and cancellation in the Debug/Tasks documentation.
- Decision: tasks are manifest-defined, executable-plus-arguments only, bounded
  by workspace, output, process lifecycle, and one-active-task policy.
- Change: added task manifest, manager, start/stop/status APIs, and task UI.
- Gate: allowlist unit test, UI audit, full suite, and daemon endpoint smoke.
- Result: PASS. Problem matchers and richer task configuration remain next.

## 2026-08-12 — LSP Diagnostics And Problems

- Research: LSP `textDocument/publishDiagnostics` contract and VS Code Problems
  behavior: severity, range, source, message, counts, navigation, and inline
  feedback.
- Decision: retain diagnostics by URI in the LSP manager, expose an aggregate
  endpoint, render counts and clickable Problems entries, and never fabricate a
  zero count when an LSP is unavailable.
- Change: diagnostics storage, `/api/diagnostics`, Problems panel, and file
  navigation from a diagnostic location.
- Gate: UI audit, full suite, and daemon smoke PASS. Live LSP notification
  fixture remains next for full protocol coverage.

## 2026-08-12 — DAP Session Events

- Research: DAP initialization, initialized/configuration sequencing, stopped
  events, thread/stack/scopes/variables waterfall, and terminate/disconnect:
  https://microsoft.github.io/debug-adapter-protocol/overview
- Decision: preserve bounded DAP events per adapter and expose session state to
  the UI; do not infer a stopped state from a successful initialize response.
- Change: DAP event history/state endpoint and stopped-event display in debug
  status.
- Gate: syntax and full suite PASS. Live debuggee fixture remains required
  before claiming breakpoint/stack readiness.

## 2026-08-12 — Debug Inspection And Git Mutation Boundary

- Research: DAP stopped-state waterfall for threads, stackTrace, scopes, and
  variables; VS Code Run/Debug sidebar and Source Control review-before-commit.
- Decision: show stack/scopes only after a real stopped event; stage and commit
  are explicit approved mutations and paths are validated before Git receives
  them.
- Change: stack/scopes inspection UI plus approved Git stage/commit endpoints.
- Gate: UI audit and full suite PASS. Dedicated temporary-repository mutation
  tests remain required before exposing commit controls in the default UI.

## 2026-08-12 — Session Recovery

- Research: VS Code hot exit/session behavior and recovery requirements from the
  workbench/editor model.
- Decision: persist only non-secret workspace UI state atomically: active file,
  open files, selected panel, and mode. Never persist prompts, credentials,
  model output, or source content in the session record.
- Change: SessionStore, `/api/session`, restore-on-boot, and atomic session save.
- Gate: session unit test, UI audit, full suite, and daemon smoke PASS.

## 2026-08-12 — Plugin Execution And Git Mutation Tests

- Research: VS Code extension host separation/lazy activation and Node 22
  permission flags; VS Code Source Control approved mutation flow.
- Decision: trusted plugins execute only in a child Node process with plugin-dir
  read permission, no native addons, IPC JSON, timeout, and no UI-process load.
  Git stage/commit is validated in a temporary repository before release UI.
- Change: plugin execution host, `/api/plugins/execute`, temporary Git API test,
  and explicit approval rejection test.
- Gate: plugin host unit test, temporary Git stage/commit test, UI audit, full
  suite, and daemon smoke PASS. Plugin network capability enforcement remains a
  later hardening gate.

## 2026-08-12 — Command Palette

- Research: VS Code Command Palette, Quick Pick, keyboard navigation, and
  discoverable workbench commands: https://code.visualstudio.com/api/ux-guidelines/command-palette
- Decision: every primary AIDE action gets a searchable command and keyboard
  path; commands call the same tested handlers as visible buttons.
- Change: real `CMD K` palette, filtering, Enter/Escape behavior, Ctrl/Cmd+K,
  and commands for files, tasks, Assistant, Blueprint, Academy, and Problems.
- Gate: UI contract audit and full suite PASS.

## 2026-08-12 — Public Repository Communication

- Research: GitHub repository best practices, README, contributor guidance,
  security policy, and community health files:
  https://docs.github.com/en/repositories/creating-and-managing-repositories/best-practices-for-repositories
- Decision: public communication leads with verified capabilities, installation,
  tests, limitations, support, and security. Remove mythology, personas,
  fictional references, and unsupported superiority claims.
- Change: README, runtime/harness documentation, Engineering Standards naming,
  citation file, and support guide cleaned for professional presentation.
- Gate: documentation review pending full repository scan and CI.

## 2026-08-12 — Plugin Preset Catalog

- Research: VS Code extension contribution points, plugin trust, lazy activation,
  and AIDE's isolated execution boundary.
- Decision: provide a catalog of 20 honest preset scaffolds, each with declared
  capabilities; scaffolding writes only a manifest and never trusts or executes
  the new plugin automatically.
- Change: preset catalog, `/api/plugins/presets`, approved scaffold endpoint, and
  preset catalog UI. Functional execution remains capability- and trust-gated.
- Gate: plugin unit test, UI audit, full suite, and daemon smoke PASS.

## 2026-08-12 — Audit Artifacts

- Research: VS Code agent session/review concepts, Anthropic ground-truth
  workflows, GitHub reproducibility guidance, and Stack Overflow's reported
  distrust of inaccurate AI output.
- Decision: every operator interaction emits a metadata-only local audit
  artifact with mode, model, approval state, proposed tools, executed tools,
  and source-export status. Never persist prompts or private source by default.
- Change: ArtifactStore, `/api/artifacts`, operator audit IDs, and visible audit
  badges in Assistant responses.
- Gate: artifact unit test, UI audit, full suite, and daemon smoke PASS.

## 2026-08-12 — Hybrid Provider Boundary

- Research: official provider API patterns and local OpenAI-compatible runtime
  contracts; OpenAI, Anthropic, and Gemini request/response differences.
- Decision: local runtime remains the default; optional provider adapters expose
  configured state, keep credentials server-side, and never persist keys or
  private prompts in artifacts. Online use is explicit and separate from local
  operator mode.
- Change: provider manifest, local/OpenAI-compatible/OpenAI/Anthropic/Gemini
  adapter boundary, provider configuration UI, and unconfigured-state handling.
- Gate: provider unit test, UI audit, full suite, and daemon smoke PASS. Live
  external-provider tests remain intentionally unrun without user credentials.

## 2026-08-12 — Shared Visible Model Handoff

- Decision: model collaboration belongs in one user-visible chat surface, using
  typed handoff artifacts rather than hidden free-form model conversation.
- Change: handoff artifacts now carry `evidence_score: null` and an explicit
  `not-scored-until-independent-verification` status. Added the operator
  workflow contract and 98% evidence-gate policy.
- Gate: handoff unit test and full suite remain required before claiming the
  shared-chat workflow complete.

## 2026-08-12 — Opt-In Dual Model Mode

- Decision: single-model Ask/Plan/Agent remains the default; Dual is an explicit
  user-selected mode for complex tasks or a second perspective.
- Change: `DUAL / TWO MODELS` chat mode, same-chat analyst/builder messages,
  approval-gated handoff, sequential model unloading/loading, and visible
  handoff artifacts.
- Evidence rule: confidence stays `NOT SCORED` until independent deterministic
  checks pass; model agreement never creates a 98% result.
- Gate: handoff unit test, UI audit, real acceptance suite, and full suite PASS.

## 2026-08-12 — Tutor Assessment Gate

- Research: Python official tutorial sequencing; Google ML Crash Course's
  self-contained modules, interactive exercises, metrics, production systems,
  and fairness; fast.ai's examples-first practical learning; W3C Verifiable
  Credentials Data Model 2.0.
- Decision: Tutor Mode requires runnable lesson checks before completion. Tracks
  cover Python, ML/AI, and Production Engineering across beginner-to-capstone
  progression. AIDE credentials are local verifiable evidence artifacts and are
  explicitly unaccredited until an external issuer/verifier adopts them.
- Change: expanded three-course catalog, allowlisted lesson checks, completion
  gating, and credential digest endpoint/UI.
- Gate: every Python lesson check, certificate test, UI audit, real acceptance,
  and full suite PASS.

## 2026-08-12 — Real Acceptance Suite

- Research decision: smoke tests are insufficient for release confidence; use an
  isolated temporary Git workspace and exercise real state transitions.
- Initial acceptance failure: task execution completed, but TaskManager discarded
  the final result and `/api/tasks/status` returned idle without output.
- Fix: retain the last task result and poll until completion in the acceptance
  runner.
- Final gate: REAL AIDE ACCEPTANCE PASSED for workspace read/write, approval
  rejection, patch apply, terminal, task, Git stage/commit, session, plugin,
  Academy, Blueprint, provider, and artifact workflows. Full `npm test` passed.

## 2026-08-12 — Unified Diff Reliability

- Signal: local coding benchmark showed useful code generation but strict
  unified-diff formatting failures.
- Research: Git patch format requirements and the existing Veritas/harness
  validation boundary.
- Decision: normalize only safe presentation noise deterministically, then
  require real diff headers and hunk headers before verification. Never apply
  raw model prose.
- Change: patch normalization, stricter validation, and regression coverage for
  prose-wrapped/fenced patches.
- Gate: full harness suite PASS; real repository task benchmark remains open.

## 2026-08-12 — Desktop Packaging Audit

- Research: Tauri secure foundation, process model, sidecars, permissions,
  frontend distribution, packaging, signing, and platform bundles:
  https://v2.tauri.app/start/ and https://v2.tauri.app/distribute/
- Finding: the current Tauri project packages the frontend but the Rust shell
  does not yet own the daemon lifecycle or bundle a verified daemon/runtime.
- Decision: do not call the desktop artifact production-ready. The next desktop
  implementation must add a lifecycle-managed sidecar or native daemon, scoped
  permissions, clean shutdown, crash cleanup, and platform build tests.
- Gate: audit recorded; desktop release remains BLOCKED until the lifecycle and
  sidecar tests pass.

## 2026-08-12 — Desktop Daemon Lifecycle

- Research: Tauri resource embedding, sidecar/process lifecycle, secure app
  startup, and clean exit from the official Tauri documentation.
- Decision: desktop preparation bundles the daemon source and Node runtime;
  Rust starts the daemon from the resource directory and terminates it on app
  exit. Missing runtime resources must not be hidden.
- Change: desktop prepare copies daemon/runtime support and Rust owns a managed
  child process.
- Gate: desktop frontend preparation PASS. Local Rust compilation is BLOCKED
  because cargo is unavailable in this environment; GitHub desktop matrix is
  required for the Rust compile and installer gate.

## 2026-08-12 — External Product Review

- Signal: external collaborator reviewed the cleaned README and identified the
  remaining product risks as unified-diff reliability, desktop packaging,
  real-world benchmarks, shared model harness contracts, and adoption friction.
- Decision: keep AIDE public claims pre-production and evidence-first. Prioritize
  release gates over mythology, model announcements, or broad feature claims.
- AIDE actions: finish core workbench acceptance, make patch generation reliable,
  ship and test the Tauri desktop artifact, benchmark real repository tasks, and
  keep all model adapters behind one contract.
- Boundary: feedback about the separate website-builder and journalist models is
  recorded as future work only. Do not interrupt or modify their training while
  AIDE release gates are active.

## 2026-08-12 — Editor Tabs And Dirty State

- Research: VS Code quick navigation, editor groups/tabs, dirty indicators,
  close behavior, and breadcrumbs: https://code.visualstudio.com/docs/editing/editingevolved
- Decision: tabs represent real workspace files; active file and dirty state are
  explicit; closing the active tab selects the previous open file; save remains
  approval-gated.
- Change: dynamic editor tabs, active-file selection, dirty marker, close action,
  and real workspace file loading.
- Gate: UI audit, full suite, and daemon smoke PASS. Undo stack and split editor
  groups remain next.

## 2026-08-12 — Clean Install Audit

- Research: VS Code startup/workspace expectations and AIDE release gates.
- Decision: verify the user-facing launch path with the actual doctor, static
  server, daemon health, and every primary endpoint before any release claim.
- Gate: doctor 7/7 PASS; UI static server HTTP 200; daemon health HTTP 200;
  workspace, model, Academy, Blueprint, plugin, task, session, diagnostics, and
  Git endpoints all HTTP 200.
- Result: PASS for current exposed services. Full editor, Git mutation, DAP
  fixture, and plugin execution gates remain open.

## 2026-08-12 — Plugin Execution Permission Model Fix + Network Hardening

- Research: Node.js Permission Model official docs and release notes (flag
  rename `--experimental-permission` -> `--permission` in Node 24.0.0,
  semver-major; deny-by-default fs/network/child/worker/addons/WASI/FFI/
  inspector; `--allow-net` added in Node 25, absent in 24; `--permission-audit`
  for grant discovery; documented as a "seat belt" that does not secure against
  malicious code; CVE-2026-21636 UDS bypass in v25).
- Finding (CRITICAL): plugin execution was broken on modern Node —
  `plugins/manager.mjs` spawned children with the removed
  `--experimental-permission` flag (`bad option` crash) and the REAL AIDE
  ACCEPTANCE suite failed at `/api/plugins/execute` as a result.
- Decision: use `--permission` with capability-gated grants derived ONLY from
  the plugin manifest: default `--allow-fs-read=<pluginDir>`; `workspace.write`
  -> `--allow-fs-write=<pluginDir>`; `network.localhost` -> `--allow-net`;
  `terminal.run` -> `--allow-child-process`; `--no-addons` retained; trust
  before execution and path-escape checks unchanged. Network is deny-by-default.
- Change: `plugins/manager.mjs` args rebuilt from the declared-capability grant
  map; `plugins/test-manager.mjs` extended with live probes proving a plugin
  without `network.localhost` is network-denied
  (`process.permission.has('net') === false` and fetch fails) and a plugin with
  `network.localhost` receives the grant (socket opens, ECONNREFUSED).
- Gate: plugin manager test PASS; REAL AIDE ACCEPTANCE PASSED; full suite PASS.
- Note: the permission model is blast-radius reduction, not a sandbox; keep OS
  egress control for untrusted code.

## 2026-08-12 — Tutor Check Interpreter Resolution

- Finding (SIGNIFICANT): `academy` lesson checks invoke `python`, which on this
  host resolves to the Windows Store stub, so every lesson check failed and
  `npm test` aborted at the tutor test.
- Decision: honor a configured interpreter first (same convention as the DAP
  manager's `AIDE_PYTHON`), falling back to `python`/`python3` as written in
  the course manifests. This does not weaken the check — the allowlisted
  command must still run and pass.
- Change: `TutorManager` accepts `pythonPath` (default `process.env.AIDE_PYTHON`),
  `check()` resolves python/python3 through it; daemon passes it through.
- Gate: tutor manager test PASS with `AIDE_PYTHON` set; full `npm test` 26/26.

## Next Research Gates

- Debugging: DAP breakpoints, threads, stack, scopes, variables, stop, and
  crash cleanup, driven by a real debuggee fixture (per skill SOP
  aide-release-engineering).
- Editor parity: search, undo history, split editor groups, hot-exit recovery.
- Plugins: remaining capability RPC surface and platform execution tests.
- Desktop: installer lifecycle smokes via GitHub Actions (Rust compile is
  BLOCKED locally — cargo unavailable).
- Accessibility: WCAG 2.2 AA manual + automated audit (focus visible, 24x24
  targets, focus not obscured, keyboard traversal, screen-reader pass).
- Benchmarks: real-repository battery with FAIL_TO_PASS/PASS_TO_PASS metrics
  and raw logs.
- Providers: live external-provider tests remain intentionally unrun without
  user credentials.

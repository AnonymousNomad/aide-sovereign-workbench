# AIDE Research And Gap Log

Every meaningful change must have a research basis, a decision, an acceptance
test, and an honest result. This is the project memory for architecture work.

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

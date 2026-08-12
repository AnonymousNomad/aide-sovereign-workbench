# AIDE Workbench Rebuild

This document is the release gate for turning AIDE from a visual prototype into
a dependable offline IDE. A rendered panel is not a feature until its complete
workflow is implemented and tested.

## Product Shape

AIDE follows the proven workbench shape:

- Activity Bar: Explorer, Search, Source Control, Run/Debug, Extensions,
  Assistant, Settings.
- Primary Sidebar: only the views belonging to the selected activity.
- Editor: real files, tabs, split groups, dirty state, undo/redo, quick open,
  breadcrumbs, symbols, and safe persistence.
- Panel: Terminal, Problems, Output, Tests, and Assistant as tabs.
- Status Bar: workspace trust, branch, diagnostics, runtime, and connection
  state.
- Command Palette: every command has one discoverable command and a testable
  handler.

The default screen exposes only Explorer, Editor, Panel, and Assistant. Academy,
Blueprint, community, and advanced research views are opened as tabs or activity
containers, never dumped into the first screen.

## Operator Model

The user selects a local model and the model operates through the AIDE harness.
The model is not granted raw authority. The harness owns:

1. Context selection and token budgets.
2. Plan, ask, edit, and agent modes.
3. Typed tools for workspace, search, terminal, tests, Git, LSP, and DAP.
4. Approval policy and workspace trust.
5. Patch preview, checkpoint, apply, revert, and cancellation.
6. Ground-truth feedback from commands, diagnostics, and tests.
7. Session history and a complete visible activity log.

The model proposes actions. Deterministic AIDE services execute and verify them.

## Required User Flows

### First launch

1. Open or create a workspace.
2. Confirm workspace trust and offline status.
3. Select an installed model from a single model picker.
4. Start the runtime and wait for an explicit ready state.
5. Send a chat message and receive a real response.
6. Ask the model to inspect the workspace.

### Safe code change

1. User asks for a change in Assistant.
2. Harness produces a plan with files and commands.
3. User approves the plan.
4. Model proposes a structured patch.
5. AIDE validates the patch and shows a diff.
6. User accepts or rejects each hunk.
7. AIDE applies atomically and creates a checkpoint.
8. Tests run and results become clickable diagnostics.
9. User can revert the entire session.

### Debug and recover

1. User starts a task or debug profile.
2. Output streams into the Panel.
3. Errors map to Problems and source locations.
4. Model receives only the relevant diagnostics and files.
5. Cancellation stops child processes.
6. Crashes restore the last session and preserve unsaved edits.

## Release Gates

AIDE is not release-ready until all are demonstrated on a clean install:

- A real workspace can be opened and its files edited and saved.
- Quick open, search, tabs, dirty state, undo, and recovery work.
- One installed model can start, become ready, answer chat, stop, and restart.
- Assistant can inspect files without silently modifying them.
- Plan, patch, diff review, apply, test, and revert work end to end.
- Terminal commands are allowlisted, cancellable, bounded, and audited.
- LSP completion, hover, definition, rename, formatting, and diagnostics work.
- DAP launch, breakpoints, stack, scopes, and stop work for one supported language.
- Git status, diff, stage, commit, branch, and revert work safely.
- Academy and Blueprint open as secondary views without blocking the workbench.
- Offline mode is tested with network access disabled.
- Every visible control is either implemented and tested or removed from the UI.

## Research Basis

- VS Code workbench containers and views: https://code.visualstudio.com/api/ux-guidelines/overview
- VS Code extension isolation and lazy activation: https://code.visualstudio.com/api/advanced-topics/extension-host
- VS Code agent, planning, model choice, tools, review, and trust: https://code.visualstudio.com/docs/agents/overview
- VS Code agent harness separation and workspace isolation: https://code.visualstudio.com/docs/agents/concepts/agent-harnesses
- VS Code trust, approval, checkpoints, and sandboxing: https://code.visualstudio.com/docs/agents/concepts/trust-and-safety
- VS Code navigation and editor productivity: https://code.visualstudio.com/docs/editing/editingevolved
- Anthropic's simple composable workflow guidance: https://www.anthropic.com/engineering/building-effective-agents
- Language Server Protocol: https://microsoft.github.io/language-server-protocol/
- Debug Adapter Protocol: https://microsoft.github.io/debug-adapter-protocol/

## Explicit Removals

- Unreleased project-specific model checkpoints are not model choices in AIDE.
- Journalism/casefile functionality is not part of the default workbench.
- Features are reintroduced only as tested extensions or secondary views with a
  clear owner, workflow, and release gate.

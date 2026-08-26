---
name: aide-plugins-surface-v1
description: Cockpit plugin surface v1 — declarative capability plugins from the 20-preset catalog, install/trust lifecycle over /api/plugins routes, and trusted-plugin UI contributions (git-review, markdown-preview, env-inspector) backed by existing cockpit features. Use when implementing or modifying the PLUGINS panel, plugin trust flow, or adding built-in plugin contributions.
---

# Plugins Surface v1 — Capability Declarations, Not Code Execution

Research anchors: ToolNeuron plugin pattern (manifest + SHA verify + capability
gate); VS Code lesson (ecosystem = moat, start with stable minimal API);
AIDE plugins/README doctrine (discovery/validation NEVER executes plugin code).
The legacy PluginManager already ships: preset catalog (20), scaffold(),
trust state persistence, manifest validation, /api/plugins* routes.

## Core design decision (why declarative v1)

A scaffolded plugin is a manifest only (`status:'template', entry:null`) — it
DECLares capabilities (`workspace.read`, `ui.view`, `terminal.run`,
`command.register`) but ships no code. Trusted plugins earn UI CONTRIBUTIONS
backed by cockpit features that already enforce those capabilities server-side:

- `git-review` -> reveals the GIT sheet (status/diff/stage/commit already approval-gated)
- `markdown-preview` -> PREVIEW action on opened .md files (escaped-subset renderer)
- `env-inspector` -> command writing runtime versions through the terminal drawer

This is ToolNeuron's gate model with zero attack surface added: trusting a
plugin REVEALS existing gated functionality; it never grants new execution.
Extension-host process model (real third-party code) stays governed by
aide-phase9-extension-host for a later phase.

## Implementation map

- Panel: #plugins-overlay, topbar PLUGINS button. Two sections: INSTALLED
  (from GET /api/plugins; trust checkbox -> POST /api/plugins/trust
  {id,trusted}) and CATALOG (GET presets merged flag installed; INSTALL ->
  POST /api/plugins/scaffold {id}).
- Contribution registry (client): FEATURED = { 'git-review': show(), 
  'markdown-preview': render(activeFile), 'env-inspector': run() }. A plugin
  contributes ONLY if installed AND trusted AND its declared capabilities are a
  subset of what the contribution uses (check manifest.capabilities array).
- Markdown preview safety: escape HTML FIRST, then transform a whitelist
  (headings #/##/###, **bold**, `code`, - lists) on the ESCAPED text. No raw
  pass. Links rendered as text, never anchors (phasing to full sanitizer later).
- Status honesty: template/untrusted plugins show exactly why they are inert
  ("template — no code", "untrusted — contributions hidden").

## Threat matrix

| Threat | Control |
|---|---|
| Trust-all fatigue | Trust is per-plugin checkbox with explicit capability list shown beside it |
| Manifest tampering after trust | trust keyed by id; manager reload re-validates manifest (invalid flag hides contributions) |
| Markdown preview XSS | escape-then-whitelist-transform; no anchors, no raw HTML ever |
| Catalog sprawl | INSTALL requires one click per plugin; nothing auto-installs |

## Pitfalls

- /api/plugins/scaffold returns the FULL loaded catalog+installed shape — parse
  accordingly, not just the new plugin.
- Presets marked installed:true must render as INSTALLED even if trust=false.
- Capabilities check: manifest.capabilities may be missing on hand-made
  manifests — treat missing as empty (contributes nothing needing caps).

## Gates

1. Live: scaffold workspace-health -> appears INSTALLED; trust -> contribution
   visible; untrust -> hidden. Round-trip without daemon restart.
2. markdown-preview renders a malicious md file (`<script>` + headings) with
   ZERO script execution and correct heading styling.
3. env-inspector writes versions into the terminal drawer via existing route.
4. Untrusted git-review contributes NO button (capability gate visible).

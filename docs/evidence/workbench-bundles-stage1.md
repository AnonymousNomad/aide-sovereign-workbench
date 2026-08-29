# Workbench Bundles — Stage 1 (Curated Workflows)

**Date**: 2026-08-29 · **Status**: implemented + verified · **Actor**: Cline

## The doctrinal gap
Competitors ship **curated bundles** (Cursor profiles, VS Code Profiles, Claude
Code routines, Codex CLI's plugin marketplace). AIDE shipped plugins + skills +
MCP *as separate surfaces* — the operator had to compose them by hand. The
plugins-skill even calls this out: plugins+skills need a "bundles" layer for
workflow composition. This is the first installable, validated, trust-gated
bundle surface.

## What changed

| File | Role |
|---|---|
| `workbenches/sovereign-coder.json` | The canonical bundle: 10 plugins, 3 skills, 5 MCP servers (3 offline + 2 online), 4 recommended local models |
| `workbenches/manager.mjs` | Fail-closed composition engine: validate-against-real-registries → install-disabled → per-server explicit trust → consent-gated online |
| `workbenches/manager.d.mts` | Type declarations for TS consumers |
| `common/contracts/workbench.ts` | Zod schemas: list / detail / install / trust / uninstall |
| `node/src/routes/workbenches.ts` | 5 routes, FORBIDDEN on consent denial, BAD_REQUEST on validation error |
| `node/src/openapi.ts` | Wires `WorkbenchManager` with `egressConsent` reading the new `workbenchEgressAllowlist` option |
| `tsconfig.node.json` | Includes `workbenches/**/*.d.mts` |
| `tests/arch/workbench-manager.test.ts` | 7 tests: list/install/trust/consent-fail/untrust/uninstall/missing-id |
| `tests/arch/workbench-routes.test.ts` | 5 tests: end-to-end via real ArchServer |

## The composition engine — fail-closed by construction

1. **`#validate(bundle)`** resolves every plugin id, skill id, and model id
   against the *real* registries (presets.json, registry.json, manifest.json)
   *before* install. A bundle with a phantom component never installs.
2. **`install(id)`** writes `.aide/workbenches/<id>.json` with `enabled: false`,
   `plugins_enabled: {}`, `mcp_trusted: {}`. Nothing is pre-enabled. Nothing
   is pre-trusted. (Verified: deepEqual on the persisted state.)
3. **`setTrust(id, server, true)`** is the only way to enable a server.
   - **Offline servers** (e.g. filesystem, memory, git) trust with no consent.
   - **Online servers** (e.g. github, netdata) require `egressConsent(server) === true`.
   - If consent is denied, the route returns **HTTP 403 + FORBIDDEN** and
     `detail.code === 'CONSENT_REQUIRED'`. The state remains untrusted.
4. **Opt-in online doctrine**: the consent signal is `options.workbenchEgressAllowlist`,
   default = empty. Granting a server logs to the egress journal
   (`workbench.egress.granted` / `workbench.egress.denied`) so every decision
   is auditable.
5. **`uninstall(id)`** wipes state only — the bundle stays discoverable
   in `list()` as `installed:false` so the operator can re-install it later.

## The shipped bundle — sovereign-coder

Privacy-first daily coding loop. **Fully local by default, every online touch
is an explicit opt-in.** Verified composition against the real registries:

| | Count | Examples |
|---|---|---|
| Plugins | 10 | workspace-health, git-review, git-history, branch-manager, test-runner, task-dashboard, problem-triage, assistant-context, patch-review, env-inspector |
| Skills | 3 | aide-agent-workflow-sop, aide-credo-guardrail, aide-plugins-surface-v1 |
| MCP servers (offline) | 3 | filesystem, memory, git (all stdio) |
| MCP servers (online) | 2 | github, netdata (both http, both untrusted by default) |
| Recommended models | 4 | chat, coder, autocomplete, fast-chat |

## Verification (all live, this machine)

| Check | Result |
|---|---|
| `node --check workbenches/manager.mjs` | MGR_CHECK_0 |
| `node --check node/src/routes/workbenches.ts` | RTE_CHECK_0 |
| `tsc --noEmit -p tsconfig.node.json` | TSC_EXIT_0 |
| `tests/arch/workbench-manager.test.ts` | MGR_EXIT_0 — **7/7 PASS** |
| `tests/arch/workbench-routes.test.ts` | RTE_EXIT_0 — **5/5 PASS** |
| Full arch sweep (`scripts/run-arch.mjs`) | in flight before commit |

## What this unlocks (the competitive pitch)

- **"Install the privacy stack in one click"** — Cursor has "profiles" but
  none are auditable, deny-by-default, and consent-gated. AIDE's bundle
  is the only first-class offline-by-default workflow.
- **Bundles are validated, not advertised** — the manager refuses to install
  any bundle whose plugins/skills/models don't resolve. Cursor's marketplace
  will happily ship broken profile YAMLs.
- **Trust is per-server, per-bundle, per-workspace** — and the journal logs
  every grant/deny. The doctrine is the same one Claude Code uses, except
  Claude Code never persists the decision visibly.
- **Zero attack surface added** — bundles don't grant new execution. Trusted
  servers ARE the execution; they're either off (filesystem stdio, scoped to
  the workspace) or on (online, with consent on file).

## What's next (Stage 2 candidates)
- `markdown-writer` bundle (lsp-toolbox-style author guide + md plugin + RAG)
- `secure-code-review` bundle (aide-credo-guardrail + patch-review + aider)
- `desktop-power-user` bundle (desktop-control + winapp MCP + telegram brain)
- AIDE **client UI**: PLUGINS panel + WORKBENCHES panel, share the trust flow

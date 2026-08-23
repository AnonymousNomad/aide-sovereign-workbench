# AIDE Release Engineering — Sources

Research basis for the skill (all official or primary sources, accessed
2026-08-12).

## Node.js permission model

- Node.js Permissions documentation:
  https://nodejs.org/api/permissions.html
- Node.js 24.0.0 release notes (flag rename `--experimental-permission` ->
  `--permission`, semver-major): https://nodejs.org/en/blog/release/v24.0.0
- nodejs/node PR #56240 (drop --experimental-permission in favour of
  --permission): https://github.com/nodejs/node/pull/56240
- nodejs/node PR #56201 (stabilize permission model, "seat belt" not sandbox):
  https://github.com/nodejs/node/pull/56201
- nodejs/node PR #58517 (add --allow-net permission):
  https://github.com/nodejs/node/pull/58517
- Node.js Command-line API docs (--allow-net, --allow-child-process):
  https://nodejs.org/api/cli.html
- NVD CVE-2026-21636 (v25 UDS bypass of network restrictions):
  https://nvd.nist.gov/vuln/detail/CVE-2026-21636
- DEV Community 2026-07-29, "Node.js 25 permission model: scope --allow-net
  and --allow-fs for production":
  https://dev.to/mr_manushukla/nodejs-25-permission-model-scope-allow-net-and-allow-fs-for-production-2026-745

## Debug Adapter Protocol

- DAP specification: https://microsoft.github.io/debug-adapter-protocol/specification.html
- DAP overview (launch sequencing, stopping/waterfall, thread handling):
  https://github.com/microsoft/debug-adapter-protocol/blob/main/overview.md
- DAP Debug Session Lifecycle (DeepWiki): https://deepwiki.com/microsoft/debug-adapter-protocol/2.2-debug-session-lifecycle
- DAP State Inspection (DeepWiki): https://deepwiki.com/microsoft/debug-adapter-protocol/2.5-state-inspection
- debugpy DAP client reference: https://github.com/microsoft/debugpy/wiki/DAP-Client-reference
- VS Code Python debugging docs (message ordering with debugpy):
  https://github.com/microsoft/vscode-jupyter/wiki/How-python-debugging-works

## Editor parity

- VS Code Basic editing (find/replace, hot exit, find history):
  https://code.visualstudio.com/docs/editing/codebasics
- VS Code User interface (editor groups, split, MRU, close behavior):
  https://code.visualstudio.com/docs/editing/userinterface
- VS Code Custom layout (split in group, locked groups, grid layout):
  https://code.visualstudio.com/docs/configure/custom-layout
- VS Code Working Copies wiki (backup/revert/dirty contract):
  https://github.com/microsoft/vscode/wiki/Working-Copies

## Tauri desktop + NSIS installer

- Tauri v2 Windows installer docs (NSIS, MSI, WebView2 modes, hooks, install
  modes): https://v2.tauri.app/distribute/windows-installer/
- tauri-apps/tauri issue #15134 (externalBin stale cache + NSIS sidecar not
  replaced on reinstall): https://github.com/tauri-apps/tauri/issues/15134
- tauri-apps/tauri issue #9950 (NSIS upgrade leaves sidecar running):
  https://github.com/tauri-apps/tauri/issues/9950
- tauri-apps/tauri PR #14479 (NSIS uses Windows Restart Manager for graceful
  close): https://github.com/tauri-apps/tauri/pull/14479
- JustHireMe CI commit (bounded installer smokes, kill process tree before
  upgrade, job timeouts):
  https://github.com/vasu-devs/JustHireMe/commit/ade80b5e60426b1536511ec224f9e1275002dd2a
- Tandem fix (NSIS_HOOK_PREINSTALL KillProcessCurrentUser for sidecar):
  https://github.com/bloknayrb/tandem/commit/7d383af50bbac72e6efd5f66ddf162b3e2025bae

## Real-repository benchmarks

- SWE-bench evaluation harness:
  https://www.swebench.com/SWE-bench/reference/harness/
  https://www.swebench.com/SWE-bench/api/harness/
- SWE-bench evaluation guide (run_id caching, predictions format, metrics):
  https://www.swebench.com/SWE-bench/guides/evaluation/
- SWE-bench original paper page (FAIL_TO_PASS primary signal):
  http://www.swebench.com/original.html

## Accessibility / usability

- WebAIM WCAG 2.2 checklist: https://webaim.org/standards/wcag/checklist
- W3C What's New in WCAG 2.2:
  https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/
- W3C Understanding 2.5.8 Target Size (Minimum):
  https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum
- WebAbility WCAG 2.2 AA checklist (audit path):
  https://www.webability.io/blog/wcag-2-2-aa-checklist
- TestKase WCAG 2.2 AA checklist for web apps (criteria map):
  https://www.testkase.com/blog/wcag-2-2-aa-compliance-checklist-2026
- DigitalApplied WCAG 2.2 audit checklist:
  https://www.digitalapplied.com/blog/wcag-2-2-accessibility-audit-checklist-2026-reference

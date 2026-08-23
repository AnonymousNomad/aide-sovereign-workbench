# AIDE P1 - Command Registry + Keybindings + Settings (VS Code parity)

Research basis (VERIFIED 2026-08-22, microsoft/vscode source + docs):
- CommandsRegistry = Map<commandId, LinkedList<handler>>, registerCommand returns IDisposable, aliases forward via executeCommand. Metadata carries description + arg constraints (src/vs/platform/commands/common/commands.ts).
- KeybindingResolver: merges defaults + user rules; `-commandId` entries REMOVE defaults; chords resolved as prefix sequences (`ctrl+k ctrl+p`); on first-chord collision the binding whose `when` fully implies the other wins (whenIsEntirelyIncluded); lookup map keyed by FIRST chord only (keybindingResolver.ts).
- Context keys: flat key-value store of app state; `when` clauses parsed recursive-descent, support && || ! and comparisons; `enablement` gates commands everywhere, `when` gates single menus (contribution-points doc).
- Settings: hierarchy Default -> User -> Workspace -> Folder(.vscode/settings.json), each a ConfigurationModel; resource-scoped override lookup; scopes Application|Machine|Window|Resource; restricted settings revert on untrusted workspace (DeepWiki 3.5, configurationRegistry.ts).

## What
1. `common/contracts/commands.ts`: CommandDescriptor {id, title, category?, icon?, when?, enablement?}; CommandInvokeRequest {id, args?}; CommandListResponse; KeybindingRule {key, command, when?}; KeybindingListResponse; SettingsTree {values: record(string, unknown)}; SettingDescriptor {key, type, default, scope, description}.
2. `node/src/services/command-registry.mjs`: registerCommand(id, handler) -> IDisposable; executeCommand(id, args) emits EventHub 'command' events (onWill/onDid); list() returns descriptors. Server-side only; browser dispatches via POST /api/commands/invoke.
3. `common/context-keys.mjs` (shared!): tiny expression evaluator - tokenize + recursive descent for `&& || ! == != =~`; context object passed in. Used server-side AND imported by browser for palette filtering.
4. `node/src/services/keybinding-service.mjs`: load defaults (JSON in node/src/services/default-keybindings.json), merge user `<workspace>/.aide/keybindings.json`, handle `-commandId` removals, build first-chord lookup map. resolve(chords, context) -> commandId | 'pending-chord' | null. Browser owns raw keydown capture; sends chord arrays via POST /api/keybindings/resolve.
5. `node/src/services/settings-service.mjs`: read `.aide/settings.json` (user) + `.vscode/settings.json` (folder, best-effort); deep-merge over registered defaults; GET /api/settings returns merged + descriptor tree; PUT /api/settings {values} writes user file atomically (tmp+rename, same as DatasetStore).
6. Routes: GET /api/commands (list), POST /api/commands/invoke, GET /api/keybindings, POST /api/keybindings/resolve, GET/PUT /api/settings. Contracts-first, regen openapi (target ~68 routes).

## Why this way
- Server-side resolution (not pure-browser like VS Code) because our command handlers ARE server services (git, terminal, training); one resolver means extensions later (P7) plug into the same registry they already see.
- Chord state lives in ONE place: browser tracks current pending chords visually, but truth is a stateless POST with full chord array - avoids desync after reload/HMR (train-serve consistency doctrine applied to UI).
- Shared expression evaluator prevents "palette shows it but invoke rejects it" drift.
- Settings as merged-read-only-tree + explicit user-file PUT keeps the contract simple; folder settings never written from UI v1.

## Threat matrix
| Threat | Radius | Mitigation |
|---|---|---|
| Command id injection / invoking internal-only routes | HIGH security | allowlist: only registered descriptors invocable; no eval; args zod-validated per-command |
| settings.json malicious values (paths, env) | HIGH | restricted-keys set reverting to default when workspace untrusted (VS Code pattern); path-typed settings validated against path-boundary gate |
| Chord storms / keylogging-style event flood | MEDIUM perf | resolve is stateless POST; browser debounces repeat keydown; no per-keystroke server round-trip except chords |
| When-clause parser ReDoS (~= regex comparisons) | LOW-MED | regex literals length-capped (64 chars), parse timeout guard |
| Contract drift commands <-> palette | MEDIUM bugs | list endpoint generated FROM registry, arch test asserts every route has a palette-visible command or explicit hide flag |

## Dependencies
Upstream: aide-arch-backend-core (routes/envelope), aide-arch-wiring (EventHub), aide-vscode-parity-roadmap (this program). Primitives reused: tmp+rename atomic write, RouteError codes, Envelope, contracts regen pipeline. Blocks: P2 (palette renders CommandList), P7 (extensions contribute commands/keybindings/settings via same registries).

## Known pitfalls (from repo history + VS Code source)
- Windows: keybindings.json edited while server running -> use fs.watch debounce or re-read per request v1 (no watcher yet).
- `-commandId` removal must match chords AND implied-when exactly (VS Code issue #293802 lesson: implication not equality).
- First-chord map: bindings sharing first chord are NOT conflicts unless one is a prefix of the other - do not dedupe eagerly.
- CI dap-flake rule applies: any new waitFor-style test gets >=90s budget (aide-ci-diagnostics).
- EBUSY/ENOTEMPTY retry pattern required for all temp-workspace tests.

## Gates
1. Unit: expression evaluator truth table (&&/||/!/==/=~ incl. precedence); keybinding merge/removal/chord-resolution cases; settings deep-merge + restricted-key revert.
2. Arch: routes envelopes (list/invoke/resolve/settings round-trip), unknown command -> NOT_FOUND-like typed error, disabled command -> FORBIDDEN.
3. Perf: resolve < 5ms p95 local for 500-rule registry (assert in unit with Date.now budget, generous CI multiplier x10).
4. Manual: real-repo smoke - Ctrl+Shift+P equivalent lists >= 40 commands; rebinding `workbench.action.` analog works after restart; .aide/settings.json edit reflects without daemon restart.

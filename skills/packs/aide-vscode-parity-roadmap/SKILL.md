# AIDE vs VS Code - Parity Roadmap (master router)

## Mission
Close every gap that makes a developer reach for VS Code instead of AIDE, in dependency order, one SKILL.md per phase (created at phase start, never batched blind). This skill routes; the per-phase skills command.

## Doctrine (inherits aide-arch-foundations)
1. Verify-first: before implementing any phase, run live research for that phase's CURRENT best practice (VS Code release notes, Monaco changelog, ripgrep docs) - this roadmap was drafted from stable knowledge 2026-08-22 and MUST be re-grounded per phase.
2. Every feature rides the existing typed-route + envelope + EventHub architecture (aide-arch-backend-core/wiring). No side channels.
3. Every phase ships behind `npm run check` green + CI success + a manual smoke on a real repo.
4. Public-facing copy rules from CLAUDE.md apply to any user-visible strings.

## Gap Matrix (what VS Code has that AIDE lacks today)
| Area | Gap | Severity | Phase |
|---|---|---|---|
| Command palette / keybindings / settings schema | no unified registry, no user settings JSON, no keybinding resolution | CRITICAL - everything else plugs into it | P1 |
| Quick Open + global search/replace | fuzzy file open, workspace grep (ripgrep), replace-all, symbol search | CRITICAL daily driver | P2 |
| Editor depth | multi-cursor, folding, minimap toggles, sticky scroll, snippets, bracket colorization config | HIGH | P3 |
| SCM UX | gutter diff decorations, hunk staging/unstage, inline blame, timeline/history view | HIGH | P4 |
| Debug depth | conditional/log/hit-count breakpoints, watch pane, hover eval, call-stack click-through | HIGH (DAP fixtures already partial per aide-release-engineering) | P5 |
| Tasks + terminal profiles | tasks runner (build/test presets per language), terminal splits/profiles/shell-integration sequences | MEDIUM-HIGH | P6 |
| Extension API v1 | stable minimal API surface (commands, status bar, diagnostics consumer), capability-gated network, offline marketplace format | HIGH strategic | P7 |
| Theming + icons + accessibility | color theme JSON, icon themes, screen-reader/keyboard-only/high-contrast conformance | MEDIUM | P8 |
| Performance budgets | large-file virtualization numbers, startup budget, watcher debouncing, memory ceiling on 16GB box | MEDIUM but gates all claims | P9 |
| Test explorer | discovery via LSP/test adapters, run/debug single test | MEDIUM | P10 |

Non-goals (explicitly): remote-SSH/container targets, notebooks, web flavor - revisit only after P10.

## Phase order + dependencies
P1 -> P2 -> P3 (P4/P5/P6 can parallel after P2) -> P7 (needs P1) -> P8 -> P9 (continuous, final gate) -> P10.

## Per-phase skill spec (what each future SKILL.md must contain)
Each phase skill MUST include, verbatim structure:
1. `What` - exact modules/files/routes/events to create (typed contracts first).
2. `How` + `Why this way` - code-level decisions with the evidence citation (VS Code impl note or prior verified practice in this repo).
3. `Threat matrix` - table: threat | likelihood | blast radius | mitigation | detection test.
4. `Dependencies` - upstream phases + repo primitives (process manager, EventHub channels, contract regen).
5. `Known bugs/pitfalls` - Windows path traps, IPC flood risks, CI-flake history relevant to the phase.
6. `Gates` - unit + arch tests + perf number + manual real-repo smoke script.

## Threat matrix (program-wide, applies to every phase)
| Threat | Radius | Mitigation |
|---|---|---|
| Renderer jank from unvirtualized lists (search results, palette) | whole-app feel | virtualize from day one; measure with 100k-item fixture |
| EventHub channel flooding (watchers, search streaming) | UI freeze, memory | coalesce/debounce server-side; bounded ring buffers; backpressure test |
| Breaking typed contracts mid-phase | compile gate red | contracts-first edits; `npm run contracts` regen in same commit |
| Windows-only path/watcher bugs escaping local dev | CI vs local divergence | keep EBUSY/ENOTEMPTY retry pattern; POSIX-path normalization at route edge |
| Command injection via tasks/terminal/user-named commands | security | argv arrays only, no shell string concat; deny-list shell metacharacters at boundary |
| Extension/plugin escape (network, fs) | security | capability-gated permissions (pattern exists in aide-release-engineering); default-deny network |
| Perf regressions silently shipping | credibility | P9 budgets asserted in CI (startup ms, search latency on fixture repo) |
| Scope creep per phase | schedule drift | phase skill fixes the file list; additions need new decision entry |

## Current verified baseline (2026-08-22)
- 62 documented OpenAPI routes; academy (learner/hints/exercises) + training pipeline (dataset store/QLoRA runner/fail-closed export) shipped CI-green at 4494dd3.
- DAP waitFor budget 90s after runner-slowness flake (see aide-ci-diagnostics).
- Known blockers tracked in aide-release-engineering (installer smoke, DAP fixture completeness) fold into P5.

## Execution protocol for each phase session
1. Load this skill + the phase's arch skill (e.g., P4 -> aide-arch-git).
2. Live-research refresh (websearch: official docs/changelogs only).
3. Write the phase SKILL.md following "Per-phase skill spec" above.
4. Implement contracts -> service -> routes -> wiring -> tests -> battery -> commit -> CI watch.
5. Update AGENT_NOTES journal + continuous-improvement writebacks.

## Re-prioritization 2026-08-25 (usage data, FlouState 11805 sessions + PanDev heartbeat + GitKraken/DORA 2026)

- **Debug depth (was P5/HIGH) -> DEFER to post-release.** Measured reality: developers spend 1.4% of editor time in debugger UI; 75% never open it. Real debugging = console output + reading code, which the cockpit terminal drawer + diagnostics rail already cover. Do not build breakpoint UI before W9.
- **Search & Replace (P2): split.** Find-in-files SHIPPED in cockpit E1. Replace-in-files stays HIGH - maintenance work is 23.7% of editor time and needs approval-gated multi-file rewrite via the existing diff pipeline (E1.1).
- **Settings persistence: elevated to CRITICAL-adjacent.** Cockpit currently remembers nothing across reloads (selected engine, panel state). Session store exists daemon-side (/api/session GET/PUT); wire engine selection + UI state on boot.
- **SCM UX (P4): partially shipped** - branches/history/push-consent live (E3). Remaining: gutter diff decorations (requires Monaco delta decorations vs HEAD content), inline blame (low usage evidence - defer).
- **Palette/keybindings (P1): palette SHIPPED. Keybinding customization remains (user JSON overrides over hardcoded map) - MEDIUM, after settings persistence.
- **New differentiator confirmed by DORA-2026 rework-rate adoption:** per-SHIP telemetry (shipped v0 in ships.log) + provenance chips are the AI-era parity surface VS Code lacks entirely - keep investing here over feature-count parity.
- Editor depth P3: Monaco gives multi-cursor/folding free; minimap toggle + sticky scroll = trivial config flags when requested. Snippets = defer.

## R-series added 2026-08-25 (evidence: Golubev et al. 2021, 1167 devs)

- **Rename Symbol = #1 refactoring (85.8% IDE adoption, 65.7% regular)** + Find All References + format-on-save(opt-in) -> NEW skill aide-rseries-refactor governs; slots into cockpit BEFORE W6 (maintenance work = 23.7pct of editor time and these are its core tools).
- Trust law from the study: PREVIEW + UNDO drive refactoring-tool adoption - the preview card is the product, never apply silently.

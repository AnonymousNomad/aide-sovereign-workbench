---
name: aide-power-surface
description: E1 power-surface SOP for the AIDE cockpit — Ctrl+K command palette (files + commands fuzzy search), workspace-wide find-in-files over the rg-service, and an xterm.js terminal drawer wired to the task/run contracts. Covers exactly which endpoints/files/components to create, why each decision, dependency choices, threat matrix (injection, DoS, egress), pitfalls, and verification gates. Use when implementing or modifying the cockpit palette, global search, or terminal panel.
---

# Power Surface E1 — Palette · Global Search · Terminal

Governs the first P0 slice from docs/GAP_ANALYSIS.md. Phase skills in force:
aide-smart-workbench-flow (layout laws), aide-arch-terminal (pty discipline),
aide-inference-control n/a here. Author: ox-alpha, 2026-08-25.

## Why these three, why now (research base)

- GAP_ANALYSIS P0: no developer adopts an editor without find-in-files,
  a terminal, and keyboard-first command access. These are table stakes that
  gate every other feature's discoverability.
- Progressive-disclosure law (smart-workbench-flow): monthly features live two
  keystrokes deep — the palette is WHERE they live, so it must exist before we
  add more surface.
- VS Code interaction grammar is the de-facto standard developers already know:
  Ctrl+K/Ctrl+P files-and-commands palette with prefix modes; Ctrl+Shift+F
  workspace search with grouped results; integrated terminal drawer. We follow
  the grammar, not the chrome.
- ripgrep is the industry floor for workspace search speed; our rg-service
  already wraps it with workspace containment (do NOT reimplement).

## Architecture (exact)

### 1. Command palette — Ctrl+K (also Ctrl+P alias)

Files: index.html (add `#command-palette` overlay: input + results list),
styles.css (.cmdk-* rules), app.js (openPalette/render/exec).
No backend route: palette entries are composed client-side.

Entry sources (ranked, deterministic order):
1. Static commands array in app.js COMMANDS[] — id, label, keywords, action fn.
   Seed set: Open Models panel, Toggle terminal drawer, Find in files,
   New engine start (opens models), Stop engine, Run harness battery (info
   toast only v1), Open help, Save file, Ship panel.
2. File index: fetched once per palette open via GET /api/workspace/tree,
   flattened to file paths, fuzzy-matched. Cap 2000 entries; if tree larger,
   match against directories then files under matched dirs (keeps O(n)).
3. Prefix modes in the input: type `>` to show ONLY commands; default shows
   mixed files+commands; `#` reserved (future RAG semantic hits — W7).

Fuzzy match: subsequence scoring — score = consecutive-char bonus +
word-boundary bonus + starts-with bonus; NO external fuzzy lib (zero-dep law;
a 30-line scorer is deterministic and auditable).

Why client-side composition: palette content is UI state, not domain state;
round-tripping keystrokes through the daemon adds latency (>100ms feedback law)
and zero value.

### 2. Global search — Ctrl+Shift+F

Files: index.html (#search-overlay: query input, glob input (default `*`),
results container), app.js (runSearch/grouped render/jump-to-file), styles.css.

Backend: GET /api/search?q=<query>&<options> — ALREADY EXISTS via legacy rg-service.
Verify actual option names by reading daemon route handler BEFORE coding the
client params (verify-first; do not guess option keys). Known-good minimum:
q + defaults render fine. Response shape: confirm at implementation time; the
renderer must be written against the observed shape, copied into a fixture in
tests/unit/test-search-render.mjs so drift is caught.

Render law: group by file path; one matching line preview per hit, match
substrings wrapped in <mark>; HARD CAPS: 40 files, 8 hits/file, 160 chars/line
preview (ripgrep can return 100k hits on node_modules-less trees; uncapped
rendering freezes the cockpit — DoS-by-size is a real failure mode seen in
VS Code issue history).

Hit click -> openInEditor(path) (existing) then editor.revealLine(lineNumber)
+ setPosition; store line in data-line from search response when present,
else first occurrence scan of the needle in opened content.

Replace-in-files: OUT OF SCOPE for E1 (write-amplification risk; needs its own
approval diff pass — schedule as E1.1 after terminal lands).

### 3. Terminal drawer — Ctrl+`

Files: index.html (#terminal-drawer at bottom of .workbench, toggle button in
workbench-bar), app.js (term session mgmt), styles.css (drawer height 240px,
resizable later), package.json (+ @xterm/xterm @xterm/addon-fit — scoped names;
xterm moved to the @xterm scope in 2024; installing bare `xterm` still resolves
but is deprecated — pin the scoped packages).

Dependency decision: xterm.js is the only maintained browser terminal renderer
(VS Code, Theia, Hyper all use it); ~250KB min+fit addon, bundled offline =
In-the-Box compliant. Alternative rejected: rolling a read/write <pre> pane —
loses ANSI colors/cursor/control sequences, and every task output uses them.

Transport decision v1: POLLING over existing POST /api/terminal/run
({program,args,approved:true}) per command execution — NOT node-pty streaming.
Rationale: (a) pty streaming requires a new WS channel + process-per-session
management (E2-scale work); (b) the cockpit's terminal need today is
build/test/git one-shots whose output arrives complete; (c) polling a
long-running server would hang — so v1 runs foreground commands with a 120s
cap and prints "long-running processes: use TASKS (next slice)". Streaming pty
is E2, built on the B1 task service event stream which already exists.

Execution safety: ALL terminal runs go through the same approved:true gate as
the agent tools; program+args are entered by the operator directly (no model
path writes to terminal without the SHIP/approval flow). Output rendered via
textContent-equivalent escaping — NEVER innerHTML (ANSI stripped in v1;
xterm handles raw sequences safely itself, the danger is HTML injection from
command output — xterm writes are safe by design, DOM fallback path must esc()).

## Threat matrix

| # | Threat | Vector | Defense |
|---|---|---|---|
| T1 | Command output HTML/script injection | git log %s, npm audit advisories, error text carrying markup | xterm.write() only (safe); any DOM fallback path escapes; never innerHTML |
| T2 | Result-set DoS | search over huge trees | rg caps + renderer caps (40f/8h/160ch) enforced client-side too |
| T3 | Path traversal via palette-jump | crafted tree/path strings | paths come from daemon tree/file contracts; openInEditor passes path back through GET /api/file which jails server-side; client never constructs fs paths |
| T4 | Egress via terminal | curl/iwr planted in scripts the operator is told to run | terminal is OPERATOR-typed only in v1 (model cannot call it outside SHIP/approval flows); NETWORK_TOKENS consent check lands with agent-tool parity in E2 |
| T5 | Palette phishing entries | fake "commands" from search results | palette commands are a hardcoded array; search results are files only, never executable labels |
| T6 | Keybinding hijack complaints | Ctrl+K browser conflicts (search bar in some browsers) | preventDefault on keydown when cockpit focused; document Ctrl+K/Ctrl+P both |

## Pitfalls (device/codebase specifics)

- monaco + xterm both attach key handlers: terminal drawer input focus MUST
  stopPropagation so Monaco does not swallow typing when drawer is focused.
- automaticLayout:true on Monaco handles resizes; xterm needs fitAddon.fit()
  on drawer toggle + window resize (ResizeObserver on the drawer element).
- The static server (scripts/start.mjs) serves any repo path — assets/monaco
  worked because of this; do NOT serve node_modules root.
- Windows cmd quirks live in task-service escapeCmdArg — reuse, never shell-join.
- Palette open fetches the whole tree: cache 60s TTL in memory; invalidate on
  save/ship.
- Escape ALL interpolated strings in palette/search/tree renders (esc() helper
  exists; new code tends to forget it — review checklist item).

## Verification gates

1. Unit: fuzzy scorer table-driven cases; parseListDevices-style strictness for
   the tree flattener (cycles/oversize guarded); search renderer fixture test
   (grouping, cap enforcement, escaping) against recorded response fixture.
2. Live: palette opens <50ms after warm load; search "gated" returns grouped
   hits incl harness/gates.mjs; terminal runs `node --version` and renders
   exit status; Ctrl+C in drawer cancels only the focused input (v1: no pty,
   so no signal forwarding — documented limitation shown in drawer footer).
3. Keyboard map: Ctrl+K palette, Ctrl+Shift+F search, Ctrl+` terminal,
   Ctrl+S save — each preventDefault'd, verified in Chromium + Firefox.
4. Battery non-regression: harness battery rerun unchanged (these are UI-only;
   assert via git diff that daemon chat path untouched).
5. Journal entry with evidence screenshots in docs/evidence/e1/.

## Out of scope / next

Replace-in-files (E1.1), pty streaming terminal (E2), RAG `#` mode (W7),
symbol palette `@` mode (needs LSP bridge E2).

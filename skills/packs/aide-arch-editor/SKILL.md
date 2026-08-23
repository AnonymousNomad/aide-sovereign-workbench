---
name: aide-arch-editor
description: Phase 3 SOP for the AIDE offline-first IDE rebuild — the Monaco editor core: locally bundled monaco-editor with Vite worker wiring (NO CDN), model/view separation (URI-keyed models), open/save round-trip via daemon contract, native undo/redo, find/replace + workspace search, large-file handling (Monaco virtualization replaces the custom windowing), dirty state, split editor groups, view-state restore, and LSP wiring points (didOpen/didChange versioning, markers). Use whenever wiring editor open/save/tabs/find/split/LSP, debugging "editor blank", "undo lost", "model mismatch", or worker loading failures. Research-grounded (github.com/microsoft/monaco-editor, VS Code engineering docs).
---

# AIDE Architecture — Phase 3: Editor (Monaco)

## Doctrine

- **Monaco, offline.** The exact engine VS Code uses. Bundled locally via npm — NO CDN, no loader from jsdelivr. All workers local. Fonts local.
- **Model/View separation (the core Monaco law)**: `editor.createModel(content, language, uri)` creates the MODEL (content + language + edit history, URI-keyed, process-wide). `monaco.editor.create(dom, { model })` creates a VIEW of that model. One model, many views (split editors). View state is serializable and restorable.
- **The daemon owns the filesystem, Monaco owns the text.** The frontend never writes files directly (renderer rule); save = push model content to the daemon file route.
- **Native undo/redo.** Monaco has a built-in, correct undo/redo stack per model. The custom undo-stack.mjs is superseded for the editor (its verified cap logic survives conceptually in session/ops hygiene, but Monaco's stack is the source of truth). Never reimplement undo on top of Monaco.
- Verify before claiming: open/save/find/split round-trips verified live in the real browser at 127.0.0.1:4173 before a phase is called done.

## What

Phase 3 replaces the hand-rolled editor (textarea + renderEditorText + custom windowing + custom undo) with Monaco:

- **Monaco bootstrap**: local import, CSS, worker wiring for Vite (see How #1).
- **File lifecycle**: open (daemon GET /api/file → tooLarge gate → model create or "file too large" fallback path), save (dirty → daemon POST), close (dirty guard, LSP didClose, diagnostics clear — ported verified behavior).
- **Tabs + splits**: tab bar = open models (uri-keyed); split = second editor VIEW on the same model; view states saved per tab in the session.
- **Find/replace**: Monaco's built-in find widget (options: case, regex, whole word, selection) + workspace search/replace via daemon contract (the verified /api/search/replace semantics: approved flag, dotfile/node_modules skip, 20k cap, ≤512KiB per file).
- **Large files**: Monaco renders virtualized lines natively — the custom WINDOW_LINES=40 windowing is deleted. The 1MiB too-large gate stays as the load guard (verified: `{too_large:true, size}` → user prompt to open raw/read-only or skip).
- **Dirty state + hot-exit**: dirty flag per model; save prompts on close; session persists open models + view states + caret (shared zod schema).
- **LSP wiring points** (protocols in Phase 5): didOpen on model create, didChange debounced with version counter, didSave on save, didClose on close, publishDiagnostics → monaco markers, completions/hover/definition commands bound to Monaco APIs.
- **Theme/fonts**: dark theme (match current styles), monospace font bundled locally, correct font metrics so cursor/line height are stable.

## How

### 1. Monaco + Vite worker wiring (the classic failure point)

- Install `monaco-editor` as a local dep. NO `monaco-editor/esm/vs/loader` CDN usage.
- Workers: Monaco needs web workers for its language services (typescript/json/css/html basics). With Vite, import workers explicitly:
  ```ts
  import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
  import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
  self.MonacoEnvironment = { getWorker(_, label) {
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    return new editorWorker();
  } };
  ```
- Import the ESM entry + css: `import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'; import 'monaco-editor/min/vs/editor/editor.main.css';` (or the esm css path matching the version).
- Vite `build.assetsInlineLimit` / worker format: workers are emitted as separate chunks — verify they exist in `dist/` after build and are served LOCALLY (offline rule: no worker from remote origin).
- Version pinning: lock the exact monaco version in package.json (upgrades change worker/API surface; deliberate upgrades only).

### 2. Model registry (the editor's source of truth)

```ts
// browser/src/editor/models.ts
const models = new Map<string, monaco.editor.ITextModel>();  // key: workspace-relative path
export function getOrCreateModel(relPath: string, content: string, language: string): ITextModel
export function disposeModel(relPath: string): void
export function dirty(relPath: string): boolean
```

- Language mapping: extension → languageId (js/ts → typescript, py → python, html/css/json/md/gitignore…). Registered via `monaco.languages.register` if a language is missing.
- One model per file, process-wide — split views share it; LSP didOpen fires once per model, not per view.
- URI convention: `inmemory://model/<relPath>` or a plain `file://`-style scheme — pick ONE and keep it in the contract/session schema (restore must reproduce the same URI).

### 3. Open/save round-trip

- Open: `api.file.read(relPath)` → envelope → if `tooLarge` → show the gate UX (no model created; offer read-only raw view via the same route with raw=true if the daemon supports it, else skip). Else create model, set value, mark clean, notify LSP didOpen.
- Save: `model.getValue()` → `api.file.write(relPath, content)` → on ok mark clean + LSP didSave; on error envelope → keep dirty + toast the code.
- Debounce: save on Ctrl+S + on tab close + on window/pagehide flush (port the verified pagehide flush pattern).
- Auto-save option (if the old app had it) stays opt-in.

### 4. Find/replace

- In-file: Monaco find widget (`find` action), configure `find.addExtraSpaceOnTop`, case/regex/whole-word/selection toggles; results scroll the view automatically (Monaco handles it — no manual scrollIntoView hacks).
- Workspace: `api.search.replace` contract ported verbatim (approved flag — UI shows a confirm dialog with occurrence count BEFORE sending approved:true; dotfiles/node_modules/target/.git/dist/build skipped; per-file ≤512KiB; 20k cap). Result: per-file replacement counts; then reload the AFFECTED models' content (model.setValue or a dedicated reload for dirty files — NEVER overwrite dirty unsaved buffers; skip files that are dirty with a clear report).

### 5. Splits, view state, hot-exit

- Split = second `monaco.editor.create` on the same model; each view's state via `editor.saveViewState()`/`restoreViewState()` (scroll, caret, folding — all serializable).
- Session (shared zod schema, daemon-persisted): tabs [{relPath, language, viewStates: [per group], dirty: bool}], active tab, split layout (vertical/horizontal, sizes).
- Restore order: create all models → create views → restore view states → THEN paint shell (prevents blank flash — verified lesson).

### 6. LSP integration points (interface only; Phase 5 implements)

- `editor/lsp-bridge.ts` exposes: `onOpen(model, relPath)`, `onChange(model, version)`, `onSave(model)`, `onClose(model)`, `setMarkers(relPath, monaco.MarkerData[])`, `requestCompletion(position)` → `CompletionList`, hover, definition. Phase 5 implements the bridge against the LSP manager; Phase 3 just defines and stubs it with zero external effects.
- Version counter: `model.getVersionId()` is the Monaco-native version — use it for didChange version tracking (no custom counters).

## Why (research grounding)

- Monaco docs (github.com/microsoft/monaco-editor): models are the state, editors are views, view states serializable — this is why VS Code tabs/splits/restore "just work"; we inherit it.
- VS Code uses Monaco for files of any size via virtualization — the custom windowing was a workaround for a hand-rolled textarea; it is deleted, not ported.
- VS Code engineering docs: renderer owns the editor, privileged host owns fs — our save path (model → contract → daemon) is that split.
- Verified project lessons: the 1MiB too-large gate + pagehide flush + dirty-close confirm + LSP didClose/diagnostics-clear on tab close are proven behavior — ported as contracts, not re-invented.

## Dependencies

monaco-editor (pinned), Vite worker support (Phase 0), common/contracts file.ts (Phase 1), api client (Phase 2), LSP bridge stub (Phase 5 fills). Node-side: nothing new — the daemon already has file routes + search/replace.

## Known issues / bugs (watch these)

- **Worker 404s**: if dist/ is missing worker chunks or paths are wrong, editor loads but language features (TS) silently die — verify workers exist in dist and are requested from the same origin. Check the Network tab after `vite build`.
- **Monaco CSS**: forgetting editor.main.css import = broken layout/overlap between editor and overlays (LEARN/MAP/EXP/RUN must keep absolute positioning over the editor column — verified Phase 2 rule).
- **EOL/CRLF**: `model.getValue(monaco.editor.EndOfLinePreference.CRLF)` vs LF — files written must preserve the ORIGINAL EOL; detect on read (model.detectIndentation / EOL sniff) and write back the same. CRLF round-trip bugs are silent data corruption.
- **BOM**: strip on read, restore on write if the original had one (UTF-8 BOM); forgetting = diff noise in git.
- **model.setValue resets undo history**: when reloading a file after workspace replace, ONLY setValue if the model is clean; dirty files must NOT be clobbered (report + keep buffer). setValue also resets markers — re-request diagnostics after.
- **Undo across save**: Monaco undo survives saves natively; do NOT clear undo stack on save.
- **Memory**: dispose models on tab close (unused models leak memory — the process-wide registry must be the only holder).
- **IME/unicode**: Monaco handles IME; but `getValue` with astral chars is fine — never do manual offset math on the string; use Monaco positions/offsets APIs.
- **Find widget overlap**: the find widget is inside the editor DOM; the custom find-bar DOM element from the old app is removed (no dual find UIs).
- **Font**: non-bundled font = FOUT + wrong metrics (cursor misalignment). Bundle a monospace font (e.g. JetBrains Mono or Fira Code woff2, local file) and set it in the editor options AND the CSS, matching family/size.
- **Glob masks (FOUND 2026-08-18, FIXED)**: `escapeRegExp(pattern).replace(/\*/g,'.*')` is WRONG — escape leaves `\*` in the string, then the star replacement yields `\..*` (a literal dot + anything) instead of `.*`. Real symptom: `mask=*.json` matched NOTHING while exact masks worked (search "accepts a file mask" test was vacuous — it never passed a mask). Correct order: escape regex specials EXCEPT `*` and `?` first (`/[.+^${}()|[\]\\]/g`), then `*`→`.*`, `?`→`.` (node/src/routes/fs.ts matchMask). Regression test must pass a REAL glob (e.g. `*.txt` and `*.t?`).

## Phase 3 audit checklist (applied to the existing editor code)

1. monaco-editor local; workers emitted to dist/ and served same-origin; zero CDN references anywhere (grep for http(s):// in browser code).
2. Custom textarea editor, renderEditorText windowing, custom undo-stack wiring, custom find-bar DOM all REMOVED; Monaco owns editing/find/undo/virtualization.
3. Model registry: one model per file; split views share models; dispose on close.
4. Round-trip verified live: open → edit → save → reopen shows saved content; CRLF + BOM preserved on a test file.
5. Dirty guard: closing a dirty tab prompts; session restore reopens tabs + view states without blank flash.
6. Workspace replace reloads clean models, reports/skips dirty ones; approved-flag confirm flow intact.
7. LSP bridge stub compiles (Phase 5 implements); `npm run check` green.
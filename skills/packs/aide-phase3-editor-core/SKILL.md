---
name: aide-phase3-editor-core
description: Phase 3 SOP for the AIDE offline IDE — make the code editor actually edit files: MVVM editor contract, file open/save round-trip via daemon routes, tabs, find/replace, workspace search, undo/redo stack, split editor groups, dirty state, hot-exit recovery, large-file handling, and LSP integration (spawn, initialize handshake, didOpen/didChange, completion/hover/definition, shutdown). Use whenever wiring explorer/file loading/save/find/terminal/LSP-DAP or debugging "file won't open/save", "undo lost", "LSP returns nothing", or "search finds nothing" issues.
---

# Phase 3 — Editor Core SOP (battle-tested, repo-verified)

Goal: the editor behaves like VS Code on a 1-file-per-feature vanilla-JS budget: browse tree → open file → edit → Ctrl+S saves atomically → Ctrl+F finds/replaces → Ctrl+Shift+F searches the workspace → Ctrl+Z/Y undoes/redoes → SPLIT gives a second pane → dirty state survives daemon restart without data loss → LSP gives completion/hover/definition/diagnostics.

All routes, function names, and JSON shapes below were verified against the repo at `E:\aide-sovereign-workbench` (app.js, index.html, editor/undo-stack.mjs, editor/groups.mjs, daemon/server.mjs, daemon/workspace-manager.mjs, daemon/lsp-manager.mjs, session/store.mjs, scripts/editor-smoke.*, scripts/ui-audit.mjs, package.json). Anything that does NOT exist yet is marked `[TODO]` with the exact behavior required. Do not invent routes or functions that are not listed here.

## Research base (source → principle → applied as)

| Source | Principle | Applied as |
|---|---|---|
| VS Code Monaco design doc (microsoft/vscode-wiki `[WIP]-Code-Editor-Design-Doc.md`) | MVVM: Model holds text + edit history + markers, knows nothing about display; ViewModel converts Model→View (tab stops, positions) and is an EventEmitter; View renders DOM from ViewModel events only; truth lives in JS objects, never in the DOM | `UndoStack` (editor/undo-stack.mjs) is the Model for a file's text+history; `renderEditorText()`/`refreshLineNumbers()` are the View; `state.editorStacks` Map + `currentStack()` are the ViewModel bridge. DOM is a projection, re-rendered from `stack.text()` |
| Monaco view parts | Only render what is visible; dirty-check before DOM writes | `refreshLineNumbers()` re-renders line numbers only when content changes; `[TODO]` virtual scrolling for large files (render ~40-line window, not the whole `pre`) |
| Eclipse Theia widgets (theia-ide.org/docs/widgets + custom_editors) | Widget = id/label/closable + factory (`WidgetManager.getOrCreate`) + contribution; open handlers claim file URIs by `canHandle` priority; editor tabs are widgets over a file URI | `openFile(name)` + `renderEditorTabs()` + `EditorGroups` (editor/groups.mjs) mirror widget/tab management; `state.editorStacks` is the per-URI model registry; `ensureEditorModules()` lazily registers the `window.UndoStack`/`window.EditorGroups` factories |
| LSP 3.17 spec (microsoft.github.io/language-server-protocol) | JSON-RPC 2.0 over stdio with `Content-Length` framing; lifecycle `initialize` → `initialized` → `textDocument/didOpen` → `didChange` (versioned) → requests (`completion`/`hover`/`definition`) → server pushes `textDocument/publishDiagnostics` → `shutdown` + `exit`; positions are 0-based `{line, character}` UTF-16 | `LspManager` (daemon/lsp-manager.mjs) already implements spawn + framing + pending-map timeouts + diagnostics capture; frontend `checkActiveFile()`/`lspAction()` drive it; `[TODO]` auto didOpen/didChange wiring + real cursor position |
| W3C ContentEditable WD 2025 + contenteditable.lab reality catalog | contenteditable behaves differently per browser/IME: Enter inserts `div` vs `br`, composition events reorder, native undo clears, paste keeps formatting; W3C recommends JS owns the data model and renders to the DOM, not vice versa | AIDE keeps its OWN undo stack (`UndoStack.apply` via `diffOperation`); `[TODO]` normalize the `pre#code` DOM on input (strip `br`/`div` → `\n`), guard IME `compositionstart/end`, force plain-text paste |
| Monaco virtual rendering / viewport tracker | Line-based virtual rendering: only visible lines exist in the DOM, viewport tracker re-renders on scroll | `[TODO]` windowed rendering for files over a size threshold; find marks computed from the Model, not the DOM |

## Editor core architecture (MVVM contract for AIDE)

The repo already follows Monaco's MVVM shape. Keep these invariants — every fix must respect them:

1. **Model**: one `UndoStack` per open file, stored in `state.editorStacks` (Map, app.js:1). It owns `base` (disk text), `ops[]` (diff ops), `position`, `baseline`. `stack.text()` is the ONLY authoritative content source (`renderEditorText()` reads it, app.js:63).
2. **No truth in the DOM**: `#code` is a projection. The one current violation is the `oninput` handler (app.js:1156) which reads `$('#code').textContent` back as truth. That is acceptable ONLY because `diffOperation(before, after)` + `stack.apply` reconstructs the Model from the diff; if the DOM was corrupted by browser edit quirks (see contenteditable pitfalls below), the model diverges — that is why the handler resets the stack to `new UndoStack(after)` on apply failure (app.js:1166).
3. **Events, not direct calls**: all UI actions funnel through the same functions the tests call: `openFile`, `saveFile`, `undoEditor`, `redoEditor`, `openFind`, `markFind`, `findNext`, `replaceCurrent`, `replaceAll`, `searchWorkspace`, `syncDirty`, `renderEditorTabs`, `toggleSplitEditor`. The headless smoke test (scripts/editor-smoke.html) calls these functions directly, so keep their signatures stable.
4. **View = function of state**: `renderEditorText()` → `refreshLineNumbers()` → re-apply find marks; `renderEditorTabs()` renders tabs from `state.openFiles` + `state.dirtyFiles` + `state.activeFile`. Dirty state is derived (`UndoStack.dirty`, editor/undo-stack.mjs:70), never stored as a flag.
5. **Session is a snapshot**: `saveSession()` PUTs `{active_file, open_files, buffers}` (dirty buffers only) to `/api/session`; `restoreSession()` (app.js:246) replays `buffers` as diff ops against the fresh on-disk baseline so dirty files come back dirty and undo history survives restart.

## Step-by-step implementation SOP (numbered)

The following numbered steps are ordered by dependency. Steps 1–10 exist and pass tests; steps marked [TODO] are the verified gaps. Re-run the verification gate named in each step after touching that code.

### 1. File open round-trip (IMPLEMENTED)

- Route: `GET /api/file?path=<rel>` (server.mjs:231) → `{path, content}`. Read is utf8, path must be workspace-relative (`WorkspaceManager.resolve()` throws on absolute/escaped paths, workspace-manager.mjs:8-13).
- Frontend: `openFile(name)` (app.js:200) → `ensureEditorModules()` → fetch, offline fallback to the in-memory `state.files` corpus → push to `state.openFiles` → create `new UndoStack(content)` if absent → `state.editorGroups.open(0, name)` → `renderEditorText()` + `renderEditorTabs()` + `saveSession()`.
- DOM: explorer buttons `[data-file]` are wired in `loadWorkspaceTree()` (app.js:272) via `GET /api/workspace/tree` → `renderWorkspaceTree()` (recursive, `node.kind === 'directory'` vs file button, indent by depth).
- Gate: `node scripts/editor-smoke.mjs` (asserts boot + open + content) + manual curl step in "Daemon API contract".

### 2. Save round-trip (IMPLEMENTED)

- Route: `POST /api/file/write` `{path, content, approved: true}` (server.mjs:235) → `{path, bytes}`. `WorkspaceManager.write` requires `approved === true`, creates parent dirs, writes `*.aide-tmp-<pid>` with mode 0o600 then atomic `rename` (workspace-manager.mjs:35-43). Never send `approved` without a user gesture.
- Frontend: `saveFile()` (app.js:408) sends `{path: state.activeFile, content: stack ? stack.text() : $('#code').textContent, approved: true}`; on success `stack.markSaved()` (sets `baseline = position`, so undo history survives save but dirty clears), then `syncDirty()`. Errors surface inline in the collab log: "Save blocked: … Start the local daemon and open a trusted workspace."
- Keyboard: Ctrl/Cmd+S in `bindEditorShortcuts()` (app.js:192) — guarded against typing in INPUT/SELECT/TEXTAREA.
- Gate: smoke asserts `save: written to workspace` by re-fetching `/api/file` and comparing bytes (editor-smoke.html:102-107).

### 3. Tabs, dirty markers, close (IMPLEMENTED, one gap)

- `renderEditorTabs()` (app.js:219) renders one button per `state.openFiles` with `data-editor-tab`, dirty `*` from `state.dirtyFiles`, a `×` span (`data-close-tab`), plus `+`, `SPLIT` (`#split-editor`), and `SAVE APPROVED FILE` buttons. Tab click → `openFile`; close → filter `openFiles`, fall back to `openFiles.at(-1) || 'README.md'`.
- `syncDirty()` (app.js:159) recomputes `state.dirtyFiles` from `stack.dirty` across the stacks Map and only re-renders tabs when the set changed — this is the Monaco "dirty-check before DOM write" rule.
- `[TODO] dirty-close guard`: closing a tab with unsaved changes currently discards silently. Before filtering `openFiles`, if `state.dirtyFiles.has(file)`, `window.confirm('Close <file>? Unsaved changes will be lost.')` and abort on cancel. Add smoke assertion `close: dirty tab prompts` (stub `window.confirm` in the harness).

### 4. Undo/redo (IMPLEMENTED — Model-level, DOM-proof)

- `editor/undo-stack.mjs` is the Model: `diffOperation(before, after)` produces `[{type:'delete',start,length,deleted}, {type:'insert',start,text}]`; `apply()` validates integer/non-negative starts and truncates the redo branch (ops.length = position); `text()` replays ops from `base` and throws on corruption (corruption is caught and the stack is reset, app.js:1163-1167).
- `undoEditor()`/`redoEditor()` (app.js:148-157) guard on `stack.canUndo/canRedo`, then `renderEditorText()` + `syncDirty()`.
- Keyboard: Ctrl+Z undo; Ctrl+Y or Ctrl+Shift+Z redo (app.js:193-194). Command palette entries `editor-undo`/`editor-redo` exist (app.js:1061-1062).
- Contenteditable reality: because the browser's own undo is irrelevant (we rebuild DOM on every render), never rely on `document.execCommand` or native undo; keep diffing `textContent`.
- `[TODO] cursor restore`: `renderEditorText()` and `markFind()` replace DOM content, which resets the caret to 0. Track the caret (line/column from `window.getSelection()` + a `Range`) per file in the Model (Monaco keeps selection in ViewModel state), and restore it after undo/redo/replace. Smoke assertion: `undo: caret restored to prior line`.
- `[TODO] ops cap`: `UndoStack.ops` grows unboundedly; cap at ~200 ops by folding old ops into `base` (rebuild `base = textAt(position-200)` and reset `ops/position/baseline` accordingly).

### 5. Find / replace in file (IMPLEMENTED, DOM-rebuild design is intentional)

- `openFind()` (app.js:166) shows `#find-bar`; `markFind(query, keepIndex)` (app.js:70) does a case-insensitive `indexOf` scan of `stack.text()`, stores `state.findState = {query, matches: [utf16 indices], index}`, then rebuilds `#code` innerHTML with `<mark>` spans (escaped via `esc()`) + `active-match` class. `updateFindCount()` renders `n/total` in `#find-count`.
- `findNext(dir)` cycles `index` with wrap; Enter/Shift+Enter in `#find-input` (app.js:179-182), Esc closes via `closeFind()`.
- Replace: `replaceCurrent()` (app.js:100) splices via `diffOperation` + `stack.apply` (undoable!) then re-renders; `replaceAll()` (app.js:114) does a whole-text scan and applies diff ops. Both call `syncDirty()`. Replace input + REPLACE / REPLACE ALL buttons exist in `#find-bar`.
- `[TODO] scroll active match into view` (`$('#code').querySelector('mark.active-match')?.scrollIntoView({block:'nearest'})` inside `findNext`).
- `[TODO] find history`: Monaco keeps the last find query per file; restore `state.findState.query` in `openFile`.

### 6. Workspace search (IMPLEMENTED server-side options, UI gaps)

- Route: `GET /api/search?q=<query>&regex=1&icase=1&word=1&mask=<glob>&include-node_modules=1` (server.mjs:239-273) → `{query, results:[{path, hits:[{line, text}]}], total, regex, caseInsensitive, wholeWord, fileMask}`. Server walks the workspace, skips dotfiles and `.git/node_modules/target/dist/build` unless `include-*`, skips files > 512 KiB, caps at 400 files, and slices hit text to 300 chars. Regex mode is opt-in (`regex=1`) — literal by default with `escapeRegExp`.
- Frontend: `searchWorkspace()` (app.js:130) sends only `q`, renders `#search-results` with per-hit `<button data-search-file>` → `openFile(file)`. Ctrl+Shift+F (app.js:196).
- `[TODO] expose server options in UI`: add checkboxes for icase/regex/word and a mask input, pass them as query params. The server already supports them; the UI just never sends them.
- `[TODO] multi-file replace`: there is no replace endpoint. Add `POST /api/search/replace` `{query, replacement, icase?, regex?, mask?, approved:true}` that re-runs the same walker, applies replacement per file via `WorkspaceManager.write`, and returns `{files_changed, occurrences}`. Frontend: REPLACE ALL IN WORKSPACE button in `#search-results`. Gate: curl the route against a temp workspace, assert changed bytes via `/api/file`.

### 7. Split editor groups (IMPLEMENTED core, PERSISTENCE gap)

- `editor/groups.mjs` (`EditorGroups`): `open(i, file)`, `split(file)`, `closeTab(file)` (auto-closes empty groups), `move(file, i)`, `activate(file)`, `nextGroup()`, `mruOrder()`, `state()` → `{groups:[{id, tabs, active}], activeGroup, mru}`. Exposed as `window.EditorGroups`; unit tests in editor/test-groups.mjs.
- Frontend: `toggleSplitEditor()` (app.js:227) flips `state.splitEditor`, reveals `#secondary-editor` (index.html:118: `#secondary-line-numbers` + `pre#secondary-code`), and calls `openSecondaryFile(name)` which fetches `/api/file` into the read-only `pre`.
- `[TODO] secondary pane is read-only`: `#secondary-code` has no contenteditable, no UndoStack, no dirty tracking, no save. Two options: (a) promote it to a full editor (own `UndoStack`, own input handler, SAVE button routes the secondary path) — the EditorGroups model already supports 2 groups; or (b) declare it a read-only preview and say so in the UI. The journal flagged split groups as incomplete, so (a) is the parity target.
- `[TODO] persist split layout`: `saveSession()` sends only `active_file/open_files/buffers`. Extend to `{..., split_editor: state.splitEditor, groups: state.editorGroups.state()}` and rebuild in `restoreSession()` (call `editorGroups.split(...)` per extra group, re-open tabs per group). SessionStore just spreads input (`session/store.mjs:33`), so no daemon change needed.

### 8. Dirty state (IMPLEMENTED — derived, not stored)

- `UndoStack.dirty` = `position !== baseline`; `markSaved()` after successful write. `syncDirty()` derives `state.dirtyFiles` from the stacks and persists dirty buffers to the session (`buffers: Object.fromEntries(...stack.dirty...)`).
- Dirty tabs show `*` in the tab label. `saveFile()` clears it only on daemon-confirmed success.

### 9. Hot-exit recovery after restart (IMPLEMENTED — verified in journal 2026-08-13)

- Writes: `GET /api/session` / `PUT /api/session` (server.mjs:336-337) → `SessionStore` (session/store.mjs): sanitizes open_files (relative, no `..`, ≤ 32, ≤ 512 chars), buffers capped at 512 KiB/file and 4 MiB total, atomic tmp+rename write to `.aide/session.json`.
- Restore: `restoreSession()` (app.js:246) fetches the session, reopens each file (fresh `UndoStack` from disk), replays each saved buffer via `diffOperation(stack.text(), recovered)` so the buffer comes back DIRTY with working undo, then logs `Recovered N unsaved buffer(s) without writing to disk.` It never auto-writes to disk — recovery is a frontend concern.
- `[TODO] pagehide flush`: recovery depends on `syncDirty()` having run during editing. Add `window.addEventListener('pagehide', () => saveSession({...current}))` (best-effort, swallowed on failure) so a killed daemon or closed tab still persists the last keystroke.
- Gate: `node scripts/hot-exit-contract.mjs` (part of `npm test`), plus the manual kill-and-restart curl sequence below.

### 10. Terminal + tasks (IMPLEMENTED)

- `POST /api/terminal/run` `{program, args, approved:true}` (server.mjs:274-295) → `{code, stdout, stderr}`; builtins echo/pwd/ls|dir/cat|type run inside the daemon, everything else must be on the allowlist (node, npm, npx, git, py, python, python3, cargo, rustc), 30 s timeout, ≤ 24 args. `runTerminalCommand()` (app.js:397) tokenizes quoted args and renders into `#terminal` with ok/error classes.
- Tasks: `GET /api/tasks`, `POST /api/tasks/run {id}`, `GET /api/tasks/status`, `POST /api/tasks/stop` — `runTask()` polls every 250 ms up to 150 s and renders output into the terminal panel.
- `[TODO] interactive streams`: the terminal is one-shot exec, not a PTY. If long-running/interactive processes are needed, follow Theia/xterm.js pattern (WS stream from the daemon) — this is a Phase-3 stretch, not a blocker for the editor core.

### 11. Large-file handling (MISSING — [TODO] end to end)

- Problem today: `GET /api/file` reads the whole file, the whole text goes into one `pre`, and every keystroke re-renders all line numbers. A 5 MB file will freeze the renderer.
- Server `[TODO]`: in `GET /api/file`, stat first and return `{path, content, too_large: true}` (or 413) when size > ~1 MiB instead of shipping the whole blob; keep `content` for normal files.
- Frontend `[TODO]` windowed rendering (Monaco's line-based virtual rendering): keep the full text in the `UndoStack` Model, but render only the visible ~40 lines + overscan into `#code` with absolute-positioned rows and a scroll container; `refreshLineNumbers` renders only the window; find marks are computed from the Model and only the visible marks are inserted into the DOM. Gate: open a generated 2 MB file headlessly, assert DOM node count stays bounded (smoke assertion `large: windowed DOM`).
- Note: workspace search already skips > 512 KiB files (server.mjs:265), so search is safe.

## LSP integration SOP (spawn → handshake → sync → features → shutdown)

### Transport (already built — daemon/lsp-manager.mjs)

- Manifest: `languages/manifest.json` → server `{id:'typescript', command:'node_modules/typescript-language-server/lib/cli.mjs', args:['--stdio'], languages:[...]}`.
- `LspManager.start(id)` spawns the process with piped stdio, buffers stdout, parses `Content-Length`-framed JSON-RPC 2.0 (`#consume`), routes responses to a pending map with a 15 s timeout (`request()`), stores `textDocument/publishDiagnostics` into `this.diagnostics` keyed by uri (`diagnosticsList()`).
- URI bridging: the daemon rewrites `file:///workspace/<rel>` placeholders to real `file:///` URIs on the way in (`rewriteIncoming`, server.mjs:109-115) and rewrites diagnostics URIs back out (`toPlaceholderUri`, server.mjs:363). The frontend strips the prefix in `loadDiagnostics()` (app.js:388).
- Routes: `POST /api/lsp/start {id}`, `POST /api/lsp/request {id, message}`, `POST /api/lsp/notify {id, message}`, `POST /api/lsp/stop {id}`, `GET /api/lsp/status`, `GET /api/diagnostics`.

### Correct lifecycle (handshake order matters — never invert)

1. **Spawn**: `startTool('lsp', 'typescript', ...)` (app.js:792) → `POST /api/lsp/start {id:'typescript'}` → `{id, status:'starting', languages}`.
2. **initialize request**: `POST /api/lsp/request {id, message:{method:'initialize', params:{processId:null, rootUri:null, capabilities:{}}}}` (app.js:802). The daemon adds `id`/`jsonrpc` and rewrites rootUri. The server replies with `result.capabilities` — store these (this is the capability negotiation; only call features the server advertised).
3. **initialized notification**: `POST /api/lsp/notify {id, message:{method:'initialized', params:{}}}` (app.js:803). The server is now live.
4. **didOpen per file** (currently only manual, app.js:823): `POST /api/lsp/notify {id, message:{method:'textDocument/didOpen', params:{textDocument:{uri:'file:///workspace/<rel>', languageId:'typescript', version:1, text:<full content>}}}}`. LSP is push-based: the server never reads disk — you must send the whole file.
5. **didChange on every edit** `[TODO]`: send `textDocument/didChange` with `contentChanges:[{text: <full current text>}]` and an incrementing `version` (the server advertises sync kind; full-text sync is the simplest and safest for a small editor). Debounce ~250 ms after the last `input` event; version must never go backwards. Wire it into the `#code` `oninput` handler (app.js:1156) next to `syncDirty()`.
6. **Features at the real cursor** `[TODO]`: today `lspAction()` hardcodes `{line:0, character:0}` and `checkActiveFile()` sends completion at 0,0. Compute position from the caret (line = count of `\n` before the caret offset, character = UTF-16 offset on that line — LSP is 0-based). Wire `data-lsp-action` buttons (HOVER/DEFINITION/RENAME/FORMAT exist in index.html:77) to the cursor position.
7. **Diagnostics**: the server pushes `textDocument/publishDiagnostics`; the daemon stores them; the frontend polls `GET /api/diagnostics` every 3 s (`setInterval(loadDiagnostics, 3000)`, app.js:1126) and renders `#problems-list` with click-to-open (uri → `openFile` + line). `[TODO]` clear diagnostics for a file on didClose.
8. **Shutdown**: `POST /api/lsp/stop {id}` kills the process. `[TODO]` send `shutdown` request + `exit` notification before killing (protocol-correct), and stop the LSP on tab close of the last open document of its language + on app `pagehide`.

### LSP curl verification (headless, no browser)

```powershell
# start server, expect {id,status:'starting'}
curl.exe -s -X POST http://127.0.0.1:4777/api/lsp/start -H "Content-Type: application/json" -d '{"id":"typescript"}'
# initialize -> expect result.capabilities back (server must respond within 15s)
curl.exe -s -X POST http://127.0.0.1:4777/api/lsp/request -H "Content-Type: application/json" -d '{"id":"typescript","message":{"method":"initialize","params":{"processId":null,"rootUri":null,"capabilities":{}}}}'
# initialized notification
curl.exe -s -X POST http://127.0.0.1:4777/api/lsp/notify -H "Content-Type: application/json" -d '{"id":"typescript","message":{"method":"initialized","params":{}}}'
# didOpen a real file
curl.exe -s -X POST http://127.0.0.1:4777/api/lsp/notify -H "Content-Type: application/json" -d '{"id":"typescript","message":{"method":"textDocument/didOpen","params":{"textDocument":{"uri":"file:///workspace/app.js","languageId":"javascript","version":1,"text":"const x: number = 1;"}}}}'
# completion at (0,7)
curl.exe -s -X POST http://127.0.0.1:4777/api/lsp/request -H "Content-Type: application/json" -d '{"id":"typescript","message":{"method":"textDocument/completion","params":{"textDocument":{"uri":"file:///workspace/app.js"},"position":{"line":0,"character":7}}}}'
# diagnostics should list the file after a moment
curl.exe -s http://127.0.0.1:4777/api/diagnostics
# status shows running; stop
curl.exe -s -X POST http://127.0.0.1:4777/api/lsp/stop -H "Content-Type: application/json" -d '{"id":"typescript"}'
```

## Exact daemon API contract (verify with curl)

Daemon: `node scripts/start.mjs` (or `node daemon/server.mjs`), listens on `http://127.0.0.1:4777`, CORS origin `http://127.0.0.1:4173`. All JSON. Writes require `approved: true`.

| Method + path | Body / query | Response (verified shape) | Implemented at |
|---|---|---|---|
| GET `/health` | — | `{ok:true, service:'aide-local-daemon', host, workspace}` | server.mjs:167 |
| GET `/api/workspace/tree` | — | `{workspace, tree:[{name, path, kind:'file'\|'directory', children?}]}` (depth ≤ 4, dotfiles + node_modules/target/dist skipped, sorted) | server.mjs:173, workspace-manager.mjs:19 |
| GET `/api/file?path=` | rel path | `{path, content}` (utf8) | server.mjs:231, workspace-manager.mjs:15 |
| POST `/api/file/write` | `{path, content, approved}` | `{path, bytes}` (atomic tmp+rename, mode 0600) | server.mjs:235, workspace-manager.mjs:35 |
| GET `/api/search?q=&regex=&icase=&word=&mask=&include-node_modules=` | — | `{query, results:[{path, hits:[{line, text}]}], total, regex, caseInsensitive, wholeWord, fileMask}` (>512 KiB files and >400 files skipped) | server.mjs:239 |
| POST `/api/terminal/run` | `{program, args, approved}` | `{code, stdout, stderr}` (allowlist: echo/pwd/ls/dir/cat/type + node/npm/npx/git/py/python/python3/cargo/rustc; 30 s timeout) | server.mjs:274 |
| GET `/api/session` | — | `{active_file, open_files, buffers, panel, mode, updated_at}` | server.mjs:336, session/store.mjs |
| PUT `/api/session` | `{active_file?, open_files?, buffers?}` | saved state (buffers ≤ 512 KiB/file, 4 MiB total) | server.mjs:337 |
| POST `/api/lsp/start` | `{id}` | `{id, status, languages?}` | server.mjs:394 |
| POST `/api/lsp/request` | `{id, message}` | server response `{jsonrpc, id, result}` (15 s timeout) | server.mjs:397 |
| POST `/api/lsp/notify` | `{id, message}` | `{sent:true}` | server.mjs:401 |
| GET `/api/lsp/status` | — | `{servers:[{id, name, languages, status}]}` | server.mjs:360 |
| GET `/api/diagnostics` | — | `{diagnostics:[{server, uri, range, severity, message, source}]}` | server.mjs:363 |
| POST `/api/lsp/stop` | `{id}` | `{id, status:'stopped'}` | server.mjs:405 |
| POST `/api/dap/start` / `/api/dap/request` / `/api/dap/stop` | `{id}`, `{id, request}`, `{id}` | adapter JSON-RPC envelopes; `GET /api/dap/state?id=` for session events | server.mjs:384-393, 367 |

### Round-trip + recovery curl proof (the "verified round-trip" gate)

```powershell
# 1. tree
curl.exe -s "http://127.0.0.1:4777/api/workspace/tree" | Select-String -Pattern 'app.js'
# 2. read
$before = (curl.exe -s "http://127.0.0.1:4777/api/file?path=README.md" | ConvertFrom-Json).content
# 3. write (approval required)
curl.exe -s -X POST http://127.0.0.1:4777/api/file/write -H "Content-Type: application/json" -d '{"path":"README.md","content":"# AIDE\n\nround-trip proof","approved":true}'
# 4. read back — must differ exactly by the write
$after = (curl.exe -s "http://127.0.0.1:4777/api/file?path=README.md" | ConvertFrom-Json).content
# 5. session persistence: PUT then GET, assert buffers round-trip
curl.exe -s -X PUT http://127.0.0.1:4777/api/session -H "Content-Type: application/json" -d '{"active_file":"README.md","open_files":["README.md"],"buffers":{"README.md":"unsaved edit"}}'
curl.exe -s http://127.0.0.1:4777/api/session
# 6. kill daemon, restart, GET again — buffers still there (hot-exit recovery contract)
# 7. search
curl.exe -s "http://127.0.0.1:4777/api/search?q=round-trip&icase=1"
# restore README.md
curl.exe -s -X POST http://127.0.0.1:4777/api/file/write -H "Content-Type: application/json" -d '{"path":"README.md","content":"# AIDE\n\nLocal-first development with explicit model lanes and reviewable patches.","approved":true}'
```

## Verification gates (headless-first)

1. **Syntax**: `node --check app.js` and `node --check daemon/server.mjs` (both are in `npm run check`).
2. **UI contract**: `node scripts/ui-audit.mjs` — every `$('#id')` in app.js must exist in index.html (currently 108 ids; `save-file`/`split-editor` are generated at runtime and whitelisted). Run after ANY index.html/app.js edit.
3. **Unit**: `node editor/test-undo-stack.mjs` (byte-exact undo, dirty-baseline, emoji/UTF-16, redo branch truncation, corrupted-op throws) and `node editor/test-groups.mjs` (tabs, split, close, move, MRU, auto-close empty group).
4. **Daemon**: `node daemon/test-workspace-manager.mjs` (escape guard, atomic write) and `node daemon/test-lsp-manager.mjs` (framing, pending timeout, diagnostics capture).
5. **Browser e2e**: `node scripts/editor-smoke.mjs` — boots a real daemon on a temp workspace, serves index.html on 4173 with the smoke runner injected, drives Edge headless `--dump-dom`, and asserts: `PASS boot`, `PASS undo: reverted byte-exact`, `PASS replace: text replaced`, `PASS save: written to workspace`, and no `FAIL `. Requires Edge/Chrome; if the browser is unavailable it exits 0 with a skip message (environment gate, not a pass).
6. **Recovery**: `node scripts/hot-exit-contract.mjs` (part of `npm test`).
7. **Full suite**: `npm test` (aggregate; see package.json:11 — includes ui-audit, editor-smoke, session, undo, groups, workspace, lsp, dap, git, e2e).

## Audit checklist (run before claiming "editor core done")

- [ ] `openFile` → `saveFile` round-trip verified via curl AND smoke (`save: written to workspace`).
- [ ] Edit → Ctrl+S → dirty clears only after the daemon confirms the atomic write.
- [ ] Ctrl+Z restores byte-exact pre-edit text; dirty follows `baseline`, not memory; Ctrl+Y/Shift+Z redoes.
- [ ] Find highlights match `n/total`, Enter wraps, replace is undoable, `#code` textContent never altered by the marks.
- [ ] Workspace search finds a phrase across files; clicking a hit opens the file (`data-search-file`).
- [ ] SPLIT shows the secondary pane; `[TODO]` secondary pane edits + saves; split layout survives restart.
- [ ] Closing a dirty tab prompts `[TODO]`; recovery replays dirty buffers without writing to disk (`Recovered N unsaved buffer(s)` log line).
- [ ] Kill the daemon mid-edit, restart, reload — unsaved edits return dirty with undo history (hot-exit contract).
- [ ] LSP handshake order initialize → initialized → didOpen → request; diagnostics appear in `#problems-list` ≤ 3 s after opening a TS file; click jumps to the line.
- [ ] `node scripts/ui-audit.mjs` passes (no missing ids), `node scripts/editor-smoke.mjs` all PASS, `npm run check` clean.
- [ ] `[TODO]` items above are either implemented (remove the tag) or explicitly deferred in AGENT_NOTES with a reason.

## Sources

- VS Code Monaco editor design doc (MVVM, Model/ViewModel/View, EventEmitter): https://github.com/microsoft/vscode-wiki/blob/main/%5BWIP%5D-Code-Editor-Design-Doc.md
- Monaco editor README (Models/URIs/Editors concepts): https://github.com/microsoft/monaco-editor
- Monaco architecture deep-dive (three layers, view parts, workers, DI): https://readoss.com/en/microsoft/monaco-editor/monaco-editor-architecture-packaging-layer-over-vscode
- Eclipse Theia widgets (widget/factory/contribution): https://theia-ide.org/docs/widgets/
- Eclipse Theia custom editors (widget + open handler + contribution): https://theia-ide.org/docs/custom_editors/
- LSP 3.17 specification (framing, JSON-RPC, document lifecycle, diagnostics): https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification
- LSP client/server flow explained (initialize handshake, push-based didOpen/didChange, capability negotiation): https://dev.to/archycode/how-vs-code-understands-your-code-inside-the-language-server-protocol-2gop
- W3C ContentEditable Working Draft 2025 (why JS must own the data model): https://www.w3.org/TR/2025/WD-content-editable-20250325/
- contenteditable.lab (cross-browser/IME pitfalls: event order, div vs br on Enter, native undo, paste): https://github.com/easylogic/contenteditable
- Monaco virtual rendering (line-based rendering, viewport tracker): https://app.studyraid.com/en/read/15534/540310/exploring-monaco-editor-architecture

## Repo references (verified line anchors)

- app.js: `state` (1), `ensureEditorModules` (48), `currentStack` (52), `renderEditorText` (63), `markFind` (70), `findNext` (93), `replaceCurrent` (100), `replaceAll` (114), `searchWorkspace` (130), `undoEditor`/`redoEditor` (148/153), `syncDirty` (159), `bindEditorShortcuts` (177), `openFile` (200), `renderEditorTabs` (219), `toggleSplitEditor` (227), `openSecondaryFile` (237), `saveSession` (242), `restoreSession` (246), `loadWorkspaceTree` (272), `saveFile` (408), `checkActiveFile` (819), `lspAction` (833), `loadDiagnostics` (387), `#code` oninput (1156), `boot` (1090)
- editor/undo-stack.mjs: `diffOperation` (1), `UndoStack` (15), `markSaved` (66), `dirty` (70)
- editor/groups.mjs: `EditorGroups` (1): `open` (18), `split` (26), `closeTab` (50), `move` (64), `state` (95)
- daemon/server.mjs: tree (173), file read (231), file write (235), search (239), terminal (274), session (336-337), lsp routes (360-407), uri rewrite (104-115)
- daemon/workspace-manager.mjs: `resolve` (8), `read` (15), `tree` (19), `write` (35)
- daemon/lsp-manager.mjs: `start` (35), `request` (51), `notify` (63), `#consume` (71), `stop` (93)
- session/store.mjs: `safeRelativeFile` (4), `normalizeBuffers` (8), save/load (30/24)
- index.html: `#workspace-tree` (38), `#editor-tabs` (103), `#find-bar` (104-111), `#search-results` (112), `.editor`/`#line-numbers`/`#code` (114-117), `#secondary-editor` (118)
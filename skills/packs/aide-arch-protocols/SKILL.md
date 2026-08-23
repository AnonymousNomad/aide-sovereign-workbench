---
name: aide-arch-protocols
description: Phase 5 SOP for the AIDE offline-first IDE rebuild — the LSP and DAP clients in the daemon: JSON-RPC 2.0 with Content-Length framing, correct lifecycle (initialize→initialized→didOpen→didChange→didSave→shutdown→exit), spawn-without-shell process rules, pending-request tracking with timeouts, diagnostics→Monaco markers pipeline, completion/hover/definition, and the DAP client (initialize/capabilities first, breakpoints, stack/scopes/variables). Use whenever wiring language features, debugging "LSP returns nothing", "editor shows no diagnostics", or "debugger won't connect", or auditing the existing lsp-manager.mjs. Research-grounded (microsoft.github.io/language-server-protocol, debugadapterprotocol, Node child_process docs).
---

# AIDE Architecture — Phase 5: Protocols (LSP + DAP)

## Doctrine

- **Protocols are exact.** LSP and DAP are precise specs; deviations (wrong header casing, missing initialized notification, out-of-order requests) fail silently or crash servers. Follow the spec byte-for-byte.
- **LSP is 3.17/3.18-class**: JSON-RPC 2.0, Content-Length framing, headers `Content-Length` + `Content-Type: application/vscode-jsonrpc; charset=utf-8`, one message per frame, NO batching.
- **DAP order is law**: client sends `initialize` FIRST; server replies capabilities; client confirms `initialized`; only then events/requests flow.
- The daemon hosts BOTH clients (privileged host owns child processes). The browser sends typed requests via the contract (Phase 4); the daemon translates to the protocol.
- Offline-first: LSP servers are local binaries on PATH or bundled (no remote language services). If a server is missing, the UI says "language server not found" with install guidance — never a silent dead feature.
- Verify before claiming: a real language server (e.g. pyright, typescript-language-server if available locally) must complete a real hover/completion round-trip in the browser before the phase is done.

## What

Phase 5 delivers language intelligence + debugging on top of Phases 1-4:

- **LSP client manager** (daemon `services/lsp-manager.ts` — the verified lsp-manager.mjs logic is ported): server registry (languageId → command+args), spawn via `spawn(shell:false)`, framing encode/decode, request/notification dispatch, pending-request map with timeouts, lifecycle enforcement, crash detection + restart with backoff, per-server `stop()` = shutdown request → exit notification → 500ms → tree-kill (VERIFIED: this exact order, plain kill leaves orphans on Windows).
- **Editor bridge** (Phase 3 stub now implemented): didOpen on model create, didChange debounced (250ms verified) with `model.getVersionId()`, didSave on save, didClose on tab close, textDocument sync kind = incremental (full on open only).
- **Features**: completion (Monaco `registerCompletionItemProvider`), hover, definition/go-to, diagnostics (publishDiagnostics → `monaco.editor.setModelMarkers` with severity mapping, `clearDiagnostics(uri)` on close — verified behavior).
- **DAP client** (`services/dap-manager.ts` — verified dap-manager.mjs ported): initialize → capabilities → initialized; setBreakpoints/configurationDone → launch/attach; events: stopped → stackTrace → scopes → variables; continue/stepOver/stepInto/stepOut; disconnect with terminateDebuggee.
- **Contracts**: `common/contracts/lsp.ts` + `dap.ts` — the browser's requests are typed (hover(uri,pos) → HoverContent, completions → CompletionList, breakpoint ops, stack/scopes/variables reads). Raw JSON-RPC never crosses the browser boundary.
- **Status surfacing**: per-file language server status in the status bar (idle/working/error + restart button) via the WS event channel (Phase 4).

## How

### 1. Framing (the part everyone gets wrong)

```ts
// node/src/services/jsonrpc.ts — ported from lsp-manager.mjs framing, keep verified behavior
function encode(msg: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(msg), 'utf8');
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\nContent-Type: application/vscode-jsonrpc; charset=utf-8\r\n\r\n`), body]);
}
// decode: accumulate buffer; parse Content-Length; slice exactly; leftover bytes = next message (streams may split messages arbitrarily)
```

- MUST handle split/torn frames (a message may arrive in multiple chunks; two messages may arrive in one chunk). Unit test with synthetic chunked input.
- Content-Length counts BYTES not characters (UTF-8) — counting chars corrupts framing for non-ASCII.
- JSON-RPC messages: `{ jsonrpc:'2.0', id?, method, params? }` — requests have numeric/string id, notifications have NO id, responses echo id. Never send a response with an unknown id.

### 2. Lifecycle (LSP)

1. spawn server (stdio: pipe for stdin/stdout, stderr captured for logs; `shell:false`, args array).
2. Send `initialize { processId, rootUri: 'file:///<workspace>' (POSIX-style URI! Windows path must be forward-slashed and percent-encoded — `file:///C:/Users/...`), capabilities }` → await response → capture serverCapabilities (hoverProvider? completionProvider? etc.).
3. Send `initialized` NOTIFICATION (no id). Only after this can didOpen/didChange flow.
4. didOpen per document (once per model, Phase 3 registry), didChange with `{ textDocument: { uri, version }, contentChanges: [{ range, text }] }` — incremental changes from Monaco (use Monaco's `onDidChangeContent` + delta ranges, or full-text per debounce with text sync full — pick incremental for large files, full for simplicity elsewhere; MUST match the capability negotiated).
5. `shutdown` request → await → `exit` notification → wait 500ms → tree-kill if still alive. This exact order is VERIFIED against real servers.
6. Crash handling: stderr line "server exited" or EPIPE → mark dead → restart with backoff (1s→10s) → re-open ALL open documents (didOpen re-send with current content + version) — or diagnostics disappear forever.

### 3. Diagnostics pipeline (verified behavior, ported)

- publishDiagnostics → map severity (Error=1/Warning=2/Info=3/Hint=4 → MarkerSeverity) → `monaco.editor.setModelMarkers(model, 'aide.lsp.<serverId>', markers)`.
- Marker positions: LSP ranges are 0-based, Monaco markers 1-based — off-by-one here is the classic "diagnostic points at the wrong line" bug. Convert carefully, test with a known bad file.
- On tab close: `clearDiagnostics(uri)` before didClose (verified — diagnostics must not linger on closed tabs).
- Debounce didChange 250ms (verified); version = `model.getVersionId()`.

### 4. DAP

- Connection modes: stdio (spawn adapter, stdin/stdout) — we host adapters, so stdio only; server-mode listening is for external adapters (Phase 11 packaging may add).
- Sequence: `initialize { adapterID:'aide' }` → response.capabilities stored → `initialized` → `setBreakpoints { source: { path }, breakpoints: [{line}] }` (path must match what the adapter expects — Windows path vs URI; verify per adapter) → `configurationDone` → `launch { program, args, cwd }` or `attach`.
- Events: `stopped` (reason: breakpoint/step/pause) → `stackTrace` → per frame `scopes` → per scope `variables` (lazy: expand variablesReference; never request all at once).
- Controls: `continue/next/stepIn/stepOut` with threadId from stopped event; `pause`; `disconnect { terminateDebuggee: true }`.
- Timeouts on every request (e.g. 10s) → TIMEOUT envelope code; adapters that don't respond get killed+restarted.
- Breakpoint verification: adapter replies `breakpoints: [{ verified, message }]` — show unverified breakpoints in the UI (red hollow vs solid), that's the honest UX.

### 5. Server registry + discovery

- `common/contracts/lsp.ts`: `LspServerConfig { languageId, command, args[], enabled }`.
- Discovery order: bundled in `node/servers/` (offline-first: ship pyright/typescript-language-server when feasible) → PATH (`py -m pyright-langserver`, `typescript-language-server --stdio`, etc.) → none → status "not found".
- Never auto-install from the internet. Install guidance text only (opt-in online flow in Phase 9 marketplace could supply servers as extensions — extension host is Phase 9; the contract here stays).

## Why (research grounding)

- LSP spec (microsoft.github.io/language-server-protocol): framing + lifecycle are normative; the spec explicitly documents that servers may refuse requests sent before initialized. Order is not style, it's correctness.
- DAP spec: initialize-first is normative; capabilities gate what the client may request.
- Node docs: spawn with `shell:false` + args array = the injection-safe, quoting-safe way to launch servers (paths with spaces on Windows MUST be array args — a single string is shell-parsed and breaks).
- Verified project lessons: the lsp-manager stop sequence (shutdown→exit→kill) and the 250ms didChange debounce + version tracking were proven against real servers; port them verbatim.

## Dependencies

Node 20+, zod contracts, Phase 1 process manager (spawn/tree-kill/timeout), Phase 2 api client, Phase 3 Monaco bridge, Phase 4 WS channel. Real servers for verification: `py -m pyright` (pyright-langserver) and/or `typescript-language-server` — verify availability on THIS machine before claiming the phase; if absent, the status-bar "not found" flow IS the deliverable for that language.

## Known issues / bugs (watch these)

- **Chunked framing**: the #1 LSP bug — writing tests with split/merged buffers catches it; do NOT debug against a real server first.
- **Windows URIs**: `file:///C:/path` (forward slashes, drive letter, no backslashes). Wrong URIs = server opens the wrong file or refuses — silent feature death.
- **Version mismatch**: didChange version must increment per change and match what the server expects (start at 1 per document; never reset on re-open of the same model).
- **Stale diagnostics**: markers cleared on tab close, on server restart, and on didOpen of a fresh model (server re-publishes); never assume the server clears its own diagnostics.
- **Adapter stdout noise**: some adapters log to stdout (breaking framing) — capture stderr separately; if framing breaks, log a clear "adapter writing to stdout" error.
- **Backpressure**: rapid didChange bursts (paste!) — debounce + drop intermediate versions is fine (server only needs latest); never queue unboundedly.
- **Kill on shutdown**: `shutdown` awaits response; a hung server blocks shutdown — wrap with timeout (2s) then proceed to exit+tree-kill.
- **Path containment**: launch/program paths come from the browser → they're workspace paths, but DAP launch args can point anywhere — validate containment (Phase 1 rule) for program/cwd, or a malicious extension could debug arbitrary processes (Phase 9 threat model).

## DAP verified field notes (aide-sovereign-workbench arch build, 2026-08)

What: the arch `DapManager` (node/src/services/dap.ts) + `dap-contract.test.ts` (9 tests incl. a REAL debugpy round trip on fixtures/debuggee/fizz_engine.py) proved these rules against debugpy. Port them verbatim into any future DAP work.

1. **debugpy request order is law**: `launch` (fire-and-forget, do NOT await) → `setBreakpoints` → `configurationDone` → await the stored launch promise.
   - Why: debugpy DEFERS its launch response until configurationDone, so awaiting launch first deadlocks (times out). And `setBreakpoints` BEFORE launch rejects with "Server is not available" — the debug server does not exist yet.
2. **launch `type` must be the adapter's language** (e.g. `'python'`), NOT a client id. debugpy rejects unknown types immediately.
3. **debugpy dict keys arrive quoted** (`'items'`, `'02'`) in `variables` names — strip `^'|'$` when matching; plain locals (`engine`, `total`) are unquoted.
4. **Event waiting needs index watermarks**: `stopped` repeats across a session (breakpoint → step → breakpoint); a naive `find(event === 'stopped')` re-matches stale events. Always `events.slice(watermark).find(...)`.
5. **Adapter children hold the temp workspace as cwd** → `rmdir` fails EBUSY. Always `manager.stopAll()` (disconnect → SIGTERM → 2s → SIGKILL) before cleanup, and retry rmdir on EBUSY with backoff — the debuggee process may outlive the adapter briefly.
6. **Optional contract fields must be OMITTED**, not `undefined` (`message: undefined` breaks `deepStrictEqual` and route response exactness).
7. **Surface adapter error `message`**, not just `error` — debugpy's "Server is not available" lives in `message`; dropping it makes failures undebuggable.
8. **Test fixture adapters: parse raw byte buffers, never `readline`** — readline emits a final line only on a terminator or EOF; a JSON body with no trailing `\n` sits in its buffer forever while the pipe stays open, so the fixture never answers and the client times out. Use a Buffer accumulator + Content-Length slicing (mirror the real `JsonRpcDecoder`).
9. **Test fixture adapters: never tear frames across timer boundaries** — overlapping `setTimeout` writes splice one message's bytes into another (header of message B lands inside body of message A) — unrecoverable corruption, no parser can fix it. Write whole frames in one `write()`; tear only when a message is single-flight (e.g. the initialize response).

Threat matrix:

| Finding | Dependency | Failure mode | Symptom if violated |
|---|---|---|---|
| launch→setBreakpoints→configure order | debugpy defers launch response | request deadlock / "Server is not available" | launch timeout (60s) or instant reject |
| `type` = adapter language | adapter validates request type | launch rejected | instant success:false |
| quoted dict-key names | debugpy variable naming | name match misses | `items` undefined → assertion fail at depth 2 |
| watermark waiting | repeated `stopped` events | stale event re-match | wrong reason/threadId consumed |
| stopAll before rmdir | child cwd = temp workspace | EBUSY on cleanup | every test in the file fails in `finally` |
| omit undefined optionals | zod/exact contracts | deepStrictEqual mismatch | contract drift complaints |
| raw-buffer fixture parsing | no EOF on open pipes | readline never flushes final line | adapter "never responds", client timeout |
| whole-frame fixture writes | byte-stream framing | interleaved frame corruption | decoder drops the mangled message |

## LSP feature verified field notes (aide-sovereign-workbench arch build, 2026-08-19)

What: completion/hover/definition + status surfacing went live in the arch build and were verified end-to-end against real typescript-language-server in Playwright (suggest widget, hover content, F12 go-to-definition). These are the traps hit and fixed:

1. **`monaco-editor/editor/editor.api` is CORE-ONLY — no language registrations.** Every model reports languageId `plaintext`, so any `SUPPORTED_LANGUAGES[languageId]` gate in the LSP bridge silently no-ops. Import `monaco-editor/editor/editor.main` (extensionless — the exports map `"./*" -> "./esm/vs/*.js"` double-prefixes `esm/` and appends `.js`, so `monaco-editor/esm/vs/...` and `.../editor.main.js` BOTH resolve wrong) as a side-effect import once in main.ts. Symptom before fix: editor renders, diagnostics dead, zero `/api/lsp/open` calls.
2. **Monaco 0.56 `CompletionItem` requires `kind`, `insertText`, and `range`** (not optional). With `exactOptionalPropertyTypes`, build optional props conditionally. `range` = `model.getWordUntilPosition(position)` word span.
3. **tsserver does NOT implement `textDocument/declaration`** — the wrapper answers `-32601 "Unhandled method"`. Only `textDocument/definition` exists. Consequence: definition on an import binding returns the BINDING ITSELF (same file, the import line), not the declaring file — cross-file follow-through through imports is a known limitation of plain LSP here (VS Code's TS extension uses its own `definitionAndBoundSpan` protocol, not LSP). Do not try to hop twice client-side — it loops.
4. **Providers need a one-shot retry** (800ms) for the open-in-flight race: F12/hover can fire before the daemon processes didOpen → `CHILD_FAILED "document is not open"` → without retry the provider returns null ONCE and monaco never recomputes (hover stays dead until the mouse moves again).
5. **Monaco F12 goToDefinition**: bound only when `EditorContextKeys.hasDefinitionProvider` is set (per-language provider registration); success announces via the aria-live `.monaco-alert` ("Found N symbol(s) in <file>") — THE assertion target for e2e. The peek widget's DOM classes are CSS-module hashed in 0.56 (`peekview-widget` string exists in the bundle but NOT as a DOM class) — never assert on peek DOM classes.
6. **`.monaco-hover` matches TWO nodes** (content hover + `modesGlyphHoverWidget` in `.overflowingOverlayWidgets`) → strict-mode violations in Playwright. Scope: `.monaco-hover:not([widgetid])`.
7. **Hover position precision is brutal**: tsserver returns empty hover for `=` and whitespace; one column off the identifier = `{"contents":""}`. The mouse offset must land inside the token span (monospace 13px Cascadia ≈ 7.8px/char + gutter/padding ≈ +48px from `.view-line` x). Verify the sent position from the request body when debugging (Playwright `request.postData()`).
8. **The map overlay swallows mouse events** (keyboard passes through to the focused editor — completion/F12 work; hover needs real mouse). Toggle the activity back to 'editor' (re-click the activity button) before any mouse-driven LSP assertion.
9. **Suite-vs-isolated timing**: in a full run the LSP server is already warm, so `#lsp-status` waits pass instantly — wait for concrete DOM (`view-line` visible) before measuring boxes.
10. **Status surfacing**: `onStatusChange` fires on EVERY state transition (starting/running/error/stopped/not_found) and publishes the `lsp-status` WS channel (zod-validated `LspStatusEvent`); the browser keeps a per-language map and renders into a dedicated `#lsp-status` status-bar span — never `statusBar.textContent` (it wipes the shell's child spans).

Threat matrix:

| Finding | Dependency | Failure mode | Symptom if violated |
|---|---|---|---|
| editor.api is core-only | monaco exports map | models open as plaintext | LSP bridge silent no-op, zero api calls |
| editor.main import form | exports `./*` mapping | resolve error at build | rolldown "failed to resolve" |
| CompletionItem required fields | monaco 0.56 types | type errors / empty suggestions | tsc failure or blank widget |
| declaration unsupported | typescript-language-server | -32601 error | 504 CHILD_FAILED from definition route |
| import-binding definition | tsserver behavior | same-file result only | F12 "goes nowhere" cross-file |
| open-in-flight race | didOpen async | CHILD_FAILED once | hover dead until mouse moves |
| peek DOM hashed classes | monaco CSS modules | selector never matches | flaky e2e timeouts |
| hover node ambiguity | glyph hover widget | strict-mode violation | e2e fails despite working feature |
| one-column hover precision | tsserver strictness | empty contents | hover widget renders empty |
| overlay mouse swallow | view-overlay.active | mouse events blocked | hover/completion-click dead, keyboard features fine |

## Phase 5 audit checklist (applied to the existing LSP/DAP code)

1. lsp-manager.mjs ported into services/ with the verified stop sequence + clearDiagnostics + version tracking; framing unit tests with chunked buffers pass.
2. Lifecycle enforced: initialize → initialized → didOpen before any change; shutdown→exit on close.
3. Diagnostics pipeline live in Monaco: markers appear on a deliberately broken file, cleared on tab close; severity/line mapping correct.
4. Completion/hover/definition round-trip verified with a REAL server in the browser (or the "not found" status flow verified if the server is absent).
5. DAP: initialize-first, capabilities stored, breakpoints with verified status, stack/scopes/variables lazy expansion, disconnect terminates.
6. Contracts lsp.ts/dap.ts in common/; drift test green; `npm run check` green.
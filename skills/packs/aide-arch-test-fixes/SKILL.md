# AIDE Arch Test Fixes — Windows libuv & Port Relocation

## Root Causes Found (2026-08-27)

### 1. `--test-force-exit` triggers libuv UV_HANDLE_CLOSING assertion on Windows
**Symptom**: `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 94`  
**Cause**: `--test-force-exit` kills the Node.js process while WebSocket/HTTP handles are still open. On Windows, libuv fires a native assertion during process teardown when it encounters handles in a CLOSING state.  
**Fix**: Remove `--test-force-exit` from `scripts/run-arch.mjs`. Rely on `--test-timeout=240000` to prevent hangs. Tests that don't clean up properly will timeout rather than crash.  
**Verified**: All261 arch tests run clean without `--test-force-exit`.

### 2. `closeAllConnections()` causes cascading test failures
**Symptom**: One test's `after` hook triggers the libuv assertion, which crashes the `node --test` process, causing ALL subsequent test files to fail with `'test failed'`.  
**Cause**: `closeAllConnections()` calls `socket.destroy()` on all sockets. On Windows, this races with libuv's handle lifecycle for sockets already in a CLOSING state.  
**Fix**: Remove `closeAllConnections()` from all 29 arch test files. Proper cleanup uses `server.events.close()` (closes WS connections first) then `httpServer.close()` (drains HTTP).  
**Key insight**: The cleanup ORDER matters: WebSocket connections must be closed before the HTTP server, because the WSS is attached to the HTTP server via `events.attach(server)`.

### 3. model-runtime port relocation missing from binary llama-server path
**Symptom**: `start relocates to a free port` test fails — model starts on the squatted port instead of relocating.  
**Cause**: The binary llama-server path (lines 386-416 of model-runtime.ts) had NO port relocation logic. The Python fallback path (lines 421-434) had it, but the binary path just proceeded on the occupied port.  
**Fix**: Added conflict detection + `allocateFreePort()` to the binary path, mirroring the Python path. Also updated `binaryArgs[5]` (the `--port` value) after relocation — the args array is built before the conflict check, so the port must be patched in place.  
**Critical detail**: `binaryArgs` is constructed before the squatter check. After relocation, you must update both `endpointUrl.port` AND `binaryArgs[5]`.

### 4. `events.close()` must precede `httpServer.close()` in test cleanup
**Symptom**: Even without `closeAllConnections()`, the `after` hook's `httpServer.close()` triggers the libuv assertion if WebSocket connections are still open.  
**Cause**: The `EventHub` attaches a `WebSocketServer` to the HTTP server. When the HTTP server closes, the WSS sockets race with the close.  
**Fix**: Always call `server.events.close()` before `httpServer.close()` in test `after` hooks.

## Prevention Checklist
- [ ] Never add `--test-force-exit` to `run-arch.mjs`
- [ ] Always close WS before HTTP in test cleanup
- [ ] Always patch `binaryArgs` port after relocation (not just `endpointUrl`)
- [ ] Never use `closeAllConnections()` in arch tests

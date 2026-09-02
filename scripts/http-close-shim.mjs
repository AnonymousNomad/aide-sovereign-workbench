// scripts/http-close-shim.mjs (T2, 2026-09-02)
//
// Preloader for node --test that patches http.Server.prototype.close to call
// closeAllConnections() before the close callback fires. This is the root cause
// of the 46-error hang across 6+ arch test files: every test uses
// `httpServer.close(() => resolve())` in its after() hook, but the inner
// `fetch()` calls in the test bodies keep the keep-alive connection alive so
// the close callback never fires, the runner hangs at the 15-min CI timeout.
//
// Per node:test runner docs, --import runs the preloader BEFORE the test
// runner starts and patches the prototypes globally. The test files themselves
// are NOT modified — surgical, no test weakening per aid-double-check-everything.
//
// The fix path comes from node:http docs and a known Node 22+ pattern:
// `close()` waits for ALL active connections to close before firing the
// callback. `closeAllConnections()` force-closes them. We do the force-close
// synchronously before invoking the real close(), so the existing callback
// (the original `() => resolve()`) fires reliably.
import http from 'node:http';

const originalClose = http.Server.prototype.close;
http.Server.prototype.close = function patchedClose(...args) {
  // closeAllConnections is in Node 18.2+, safe to call unconditionally.
  try { this.closeAllConnections?.(); } catch { /* noop on older or already-closed */ }
  return originalClose.apply(this, args);
};

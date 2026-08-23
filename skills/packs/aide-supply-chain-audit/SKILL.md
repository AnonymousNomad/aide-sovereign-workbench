# V1 — Supply-Chain / No-Phone-Home Audit

Phase skill for AIDE V-series. Master router: aide-master-roadmap. Enforces the No-Phone-Home Law: for an offline-first tool, ANY unexpected network call is a bug.

## Three Layers of Evidence

### 1. Static (CI gate)
- SBOM: `npm sbom`/lockfile walk -> deps.json committed; diff-checked in CI (new dep = visible PR change, requires justification line in PR template).
- Scan ALL first-party code (`node/src`, `common`, `browser/src`) for network primitives: `fetch(`, `http.request`, `https.request`, `net.connect`, `XMLHttpRequest`, `WebSocket` (allowlist: our own daemon WS), `dns.lookup`, child_process spawning curl/wget/Invoke-WebRequest.
- Rule: every hit must sit inside a module exporting through the EGRESS GATE (below) or be in the static allowlist with a code comment `// egress: <reason>` — CI fails otherwise. No comment, no merge.
- Same scan over extension-host SDK samples and any bundled MCP-style servers: they run in OUR process tree, they inherit OUR law.

### 2. Runtime egress journal (daemon shim)
- All outbound calls funnel through one audited module `node/src/net/egress.mjs`: { timestamp, target_host, purpose_tag, route_or_caller, bytes_up/down, user_initiated:boolean } -> append `.aide/egress.jsonl`.
- Enforcement: global fetch/http agents patched at daemon boot to route through the gate. Undeclared host => call BLOCKED + error logged + notification (B4) 'Blocked unexpected network call to <host>' with allow option (explicit consent, persisted).
- UI: Privacy panel shows the journal live; one-click "audit mode" export (redacted) for user verification.
- Extension host + spawned model servers inherit via env proxy pointing at a local deny-by-default proxy in strict mode (setting `privacy.strictEgress`, default ON).

### 3. Chaos verification (offline e2e suite)
- Run ENTIRE e2e battery with system-level block: launch daemon under a local firewall profile / NODE_OPTIONS resolver hook that throws on non-loopback connect. Every test must pass => proof of zero mandatory egress.
- Middle-state tests per resilience skill: 503s, 40s latency, mid-stream cuts, corrupt model file — all degrade honestly, never phone home to "check".

## Dependency Risk Scoring (advisory, CI-reported)
Per new dep: [maintainer activity, last publish age, install scripts present?, transitive fanout, license]. Install scripts (postinstall) = hard flag requiring manual review note. No auto-updating anything; version pinning via lockfile only; updates are deliberate PRs.

## Tests FIRST
1. Gate blocks undeclared host; allowed after explicit consent entry lands in settings store.
2. Journal entry written BEFORE first byte for search/download routes (M-phase contract test asserts this).
3. Offline chaos suite green (the big one) — count of thrown resolver-hook attempts outside loopback == 0 during full battery.
4. Static scanner: fixture file with naked fetch() fails CI locally via script `npm run audit:egress`; adding the gate import passes.
5. Strict-mode proxy: extension calling example.com gets denied + journaled; loopback daemon calls pass.

## Pitfalls
- Patch fetch BEFORE any module import that captures it (order matters in daemon boot).
- Windows firewall automation is flaky in CI — prefer the resolver-hook + proxy approach for portability.
- Allowlists are code-reviewed artifacts: each entry has reason+owner+expiry date; expiry enforcement in audit script.

## Gate
`npm run audit:egress` clean; offline chaos suite part of required CI; SBOM diff job active; journal. After V1 ships, marketing claim "zero telemetry, provable" links the privacy panel docs — claims follow evidence (verify-first).

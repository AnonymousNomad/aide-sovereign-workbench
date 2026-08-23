---
name: aide-phase7-community-hub
description: Phase 7 SOP for the AIDE offline IDE — local GitHub-like collaboration: feed, projects, issues, discussions, marketplace — stored locally, zero cloud. Use whenever wiring /api/community, the community feed, the PROJECTS/ISSUES/DISCUSSIONS/MARKETPLACE tabs, community-store CRUD, or any future sync/marketplace-install work.
---

# Phase 7 — Community Hub SOP (verified against code, 2026-08)

Goal: a local collaboration hub — browse local items, add items, organize by PROJECTS / ISSUES / DISCUSSIONS / MARKETPLACE — all offline-first, zero cloud, GitHub-like shapes but single-writer local store.

This SOP is verified against the actual implementation:
- Store: `community/store.mjs` (class `CommunityStore`), file `<workspace>/.aide/community-store.json` (`daemon/server.mjs:52-53`)
- Routes: `daemon/server.mjs:357-358` (GET), `408-418` (POST/PUT/DELETE)
- Frontend: `app.js` — `communityStore` cache (line 456), `renderCommunity` (753), `loadCommunity` (767), `addCommunityIssue` (775), `removeCommunityItem` (760); tab binding (1135-1136); markup `index.html:64-73`
- Test: `daemon/test-community-store.mjs` (passes, wired into `npm test`)
- Policy anchors: `community/node-manifest.json`, `community/protocol.md`, `community/store-schema.json`, `community/README.md`

## 1. Research base (verified, primary sources)

| Topic | Finding | Source |
|---|---|---|
| Local-first doctrine | 7 ideals: no spinners, multi-device, offline, collaboration, longevity, privacy, user control. Local copy is PRIMARY; servers (if any) hold secondary copies. CRDTs are the foundational technology for conflict-free merge; conflicts are rare and only occur when two peers concurrently write the SAME property of the SAME object | Ink & Switch "Local-first software: You own your data, in spite of the cloud" (2019, Kleppmann/Wiggins/van Hardenberg/McGranaghan) — inkandswitch.com/essay/local-first/ |
| CRDT conflict semantics | Automerge merge rules: concurrent list inserts merge (deterministic order); concurrent same-property set → LWW winner + multi-value `getConflicts()` register (loser is NOT lost). Docs are the unit of collaboration (UUID); schema versioning via hard-coded migration changes, never editing the initial change | Automerge docs — automerge.org/docs/reference/documents/conflicts/, /docs/cookbook/modeling-data/, /docs/reference/under-the-hood/merge-rules/ |
| CRDT choice guidance | Automerge (rich JSON docs) vs Yjs (lightweight state) vs cr-sqlite (relational). All rely on hybrid logical clocks for causality. Memory/history grows — needs compaction. For simple settings/status: plain last-write-wins is sufficient and far simpler | MVP Factory "CRDTs for offline-first mobile sync" (2026); Jsonic "JSON Real-Time Sync: CRDTs & OT" (2025) |
| Append-only log as truth | Event log (JSONL, append-only) is the source of truth; everything else (SQLite cache) is DERIVED and disposable; git merges are safe because the log is append-only — conflicts resolved by keeping both lines; no merge driver needed. Caveat: only works if items are never edited in place | Pebbles architecture (pebbles/ARCHITECTURE.md); beads/br (SQLite + JSONL export for git-friendly collaboration, JSONL "merges cleanly in git") |
| GitHub issue model | Issue: number (monotonic per repo, shared with PRs), title, body, labels, state `open`/`closed`, state_reason, created_at, updated_at, closed_at, author, assignees. Discussion: same number space, category (Q&A/General/Ideas), answer_id; thread = comments with `parent_id` for replies. Local implementations mirror this shape | github-export data-model docs (github.com/mevdschee/github-export); kanbots docs/issues.md (local_issues table mirroring GitHub fields); dogsheep/github-to-sqlite |
| SQLite vs JSON at small scale | File-based JSON/YAML works fine for small sets; degrades at hundreds-thousands of items (listing/searching parses many files). SQLite wins with indexed queries at that scale. For a few thousand items read whole-file into an in-memory index is fine; no FTS needed | ghx issue #1 "SQLite backend for issue/PR storage" (file-based degrades, SQLite indexed lookups); kanbots ("no FTS index", simple LIKE/client-side filter) |
| Marketplace/install security | Install-time supply-chain doctrine: verify checksum + signature BEFORE bytes reach disk (SHA-512 dist.integrity / SHA256SUMS, fail-closed), quarantine tarballs so lifecycle scripts NEVER execute during analysis, separate install from execution (explicit approval to run scripts), provenance/trusted-publisher pinning because "valid signature is not enough". npm v12 (2026) now disables auto install scripts by default — install and execution are separate decisions | targate; SafeInstall (safeinstall.dev); scpm.dev/docs/security; Chainsaw; Veln; LinuxSecurity npm v12 coverage |

### Verified IMPLEMENTED vs MISSING

IMPLEMENTED:
- CRUD store: add/update/remove/list per type, atomic write (tmp + rename), schema_version + `sync: 'local-only'` root fields, validation (type enum, title 1..160 chars, detail ≤2000 chars), survives daemon restart.
- Routes: GET list, POST add, PUT update, DELETE remove (index-addressed).
- Frontend: feed render with type tabs, add form (ISSUE/DISCUSSION only), REMOVE per row, "LOCAL CACHE / SYNC OFF" banner, node policy banner from `community/node-manifest.json`.
- Test: `daemon/test-community-store.mjs` (add/update/remove/list + rejects unknown type) — passes; `npm test` includes it; e2e hits `/api/community`.

MISSING (do not claim these exist):
- NO duplicate check (old skill claimed id/hash dedupe — store.mjs has none; two identical items are stored).
- NO ids — items are addressed by integer index (fine for a single-writer local store; breaks under future multi-writer sync).
- NO status transition endpoint (`POST /api/community/items/:id/status` from the old skill does NOT exist; `status` is only set at creation, default `'local'`).
- NO edit UI (PUT route exists, no frontend button), NO comments/replies on discussions, NO labels/state_reason/assignees.
- Add form covers only issues + discussions; projects and marketplace have storage + tabs but no add path in `#community-type`.
- NO marketplace install/verify flow (marketplace holds metadata items only — Section 5 is doctrine for the future install path, per `protocol.md` capability gates).
- NO server-side tab filter (GET returns the whole store; filtering is client-side).
- Logging uses `appendLog('COMMUNITY', ...)` — the old skill's `console.log('COMMUNITY_FETCH: ...')` convention is not implemented; keep using appendLog.

## 2. Data model SOP (as implemented in `community/store.mjs`)

Root document (exact shape, `store.mjs:9`):
```json
{
  "schema_version": "1.0",
  "sync": "local-only",
  "projects": [],
  "issues": [],
  "discussions": [],
  "marketplace": []
}
```
- `schema_version` MUST stay `"1.0"` (const in `community/store-schema.json`); bump only with a migration.
- `sync` enum: `local-only` | `invited-encrypted` | `public-publish` (store-schema.json). Today it is always `local-only`; the UI banner "LOCAL CACHE / SYNC OFF" must match it.

Item shape (created by `add`, `store.mjs:24`):
```json
{ "title": "…", "detail": "…", "status": "local", "created_at": "2026-08-16T…Z" }
```
- `update` adds `updated_at` and preserves `created_at` (`store.mjs:39`).
- Validation rules (enforced server-side, exact errors):
  - type must be in `projects|issues|discussions|marketplace` → `community type is not allowed` (400)
  - `title` trimmed, non-empty, ≤160 chars; `detail` trimmed, ≤2000 chars → `invalid community item` (400)
  - update/remove: type valid AND `Number.isInteger(index)` AND `items[index]` exists → `community item is not addressable` (400)
- Addressing: integer index per type array. NOTE: this is the GitHub-like-model gap — GitHub uses monotonic `number` ids; index addressing is acceptable ONLY because the store is single-writer local. If any sync feature is added, ids become mandatory (see Section 6).
- Persistence is atomic: write `${file}.tmp-${process.pid}` then `fs.rename` over the target (`store.mjs:27-29, 51-56`). Never write the file in place.
- `list()` returns `structuredClone` — never let callers mutate the store's live object.
- Storage scale decision (research): a single JSON file read whole into memory is correct at this scale (a few thousand items). Do NOT introduce SQLite until there are hundreds+ of items AND listing/searching measurably degrades — the file is human-inspectable, portable, and backup = copy one file. JSONL would only be warranted if git-based collaboration is added (then: append-only event log as source of truth, derived cache rebuilt from it — Pebbles/beads pattern).

Data model SOP steps:
1. New item → `add(type, item)` validates → push to `data[type]` → atomic save → return entry (status defaults to `'local'`).
2. Edit → `update(type, index, item)` partial merge (`...current, title, detail, updated_at`) → atomic save.
3. Delete → `remove(type, index)` splice → atomic save → return removed entry.
4. On daemon boot → `load()` (errors swallowed at `server.mjs:53` — first run writes the file lazily on first add via `fs.mkdir(..., recursive: true)`).
5. Never add a second writer. The daemon is the ONLY process that touches the store file.

## 3. API contract (exact, from `daemon/server.mjs`)

| Method | Route | Request body | Success response | Errors |
|---|---|---|---|---|
| GET | `/api/community` | — | 200, the FULL store root object (`communityStore.list()`), no tab filtering | daemon down → fetch fails (frontend keeps last cache) |
| POST | `/api/community/items` | `{ type, item: { title, detail?, status? } }` | 201 `{ item }` | 400 `community type is not allowed` / `invalid community item` |
| PUT | `/api/community/items` | `{ type, index, item: { title?, detail? } }` (partial) | 200 `{ item }` | 400 `community item is not addressable` / `invalid community item` |
| DELETE | `/api/community/items` | `{ type, index }` | 200 `{ item }` (removed) | 400 `community item is not addressable` |

Contract invariants:
- Item field is `detail` (NOT `body`) — GitHub-style `body` does not exist. Frontend MUST send `detail`.
- No tab query param on GET; client filters by reading the per-type array.
- Unknown routes → 404 `{ error: 'not found' }`; daemon errors → `{ error: message }` with 500 (or 503 if model-setup related).

## 4. Feed/render SOP (app.js wiring, verified)

- Boot: `loadCommunity()` at `app.js:1153` — `GET /api/community` → `communityStore = await response.json()`. On failure the cache stays at the empty initial shape `{ projects: [], issues: [], discussions: [], marketplace: [] }` (line 456) — never throw on daemon-down.
- Tabs: `index.html:64-68` buttons `[data-community-tab]` = `projects|issues|discussions|marketplace` (label is MARKET, not MARKETPLACE); click → `renderCommunity(tab)` (`app.js:1135`).
- `renderCommunity(tab)` (753-758): renders `#community-feed` with banner `LOCAL CACHE / SYNC OFF`, one row per entry: bold title, `detail`, meta line `entry.boundary || entry.status || 'local'`, and a REMOVE button carrying `data-community-remove="${index}"`. Active tab colored, others muted.
- Add: `#community-add` → `addCommunityIssue()` (775-790): reads `#community-title`, `#community-type` (only ISSUE / DISCUSSION options exist), POSTs `{ type, item: { title, detail: 'Created locally from AIDE.' } }`; on 201 clears the input, reloads feed, logs `appendLog('COMMUNITY', 'Issue created locally: …')`. Empty title → no-op. Failure → warning log.
- Remove: REMOVE → `removeCommunityItem(type, index)` (760-765) DELETE → reload feed; failure → warning log.
- Render discipline: all user content through `esc()`; feed rows use inline-styled markup (keep it minimal); feed lives inside the community panel — do not scroll the page.

Editing checklist when touching the feed:
1. New fetch/refresh path must go through `loadCommunity()` (single source of truth for the cache).
2. Every POST/PUT/DELETE followed by `await loadCommunity()` — never mutate `communityStore` manually.
3. Keep the "LOCAL CACHE / SYNC OFF" banner truthful: if `sync` ever changes, banner must reflect it (node-manifest `network_default: "disabled"` until then).
4. Log through `appendLog('COMMUNITY', …)`, not console.log.

## 5. Marketplace safety SOP (sha256/signature gate — doctrine, mirrors packaging discipline)

Marketplace TODAY is metadata items only (title/detail/status). No install flow exists and none may be built casually: `community/protocol.md` says marketplace objects are SIGNED PUBLIC MANIFESTS, and `node-manifest.json` gates `payments: false`, `encrypted_group_sync: false`, `relay: false`. The following is the mandatory gate order for ANY future "install from marketplace" feature — install and execution are SEPARATE decisions (npm v12 precedent):

1. MANIFEST FIRST: a marketplace item must reference an artifact manifest, never raw payload in the item body. Manifest fields (protocol.md): `artifact`, `license` (SPDX), `terms`, `payment_destinations`, `refund_policy`, `checksums: {file: sha256}`, `author_signature`.
2. HASH GATE before bytes reach disk: download to a quarantine directory (e.g. `<workspace>/.aide/marketplace-quarantine/`), compute SHA-256 of every file, compare against `checksums` — mismatch → delete + refuse install (fail closed, like scpm's `dist.integrity` check and targate's minisign+SHA256SUMS verification). Never install a package whose hash is unverifiable or missing.
3. SIGNATURE GATE: verify `author_signature` with an audited Ed25519 implementation against a pinned author public key (protocol.md: never hand-roll crypto, never store private keys in repo/localStorage/URLs/logs). A valid signature is not sufficient — pin the trusted publisher (SafeInstall doctrine); reject artifacts from any other key.
4. INSPECT IN QUARANTINE: list archive contents, statically inspect lifecycle/install scripts WITHOUT executing them (targate pattern: scripts never run during analysis; resource-bounded quarantine).
5. EXPLICIT USER APPROVAL to install: the item is staged, shown with its sha256 + author + license; user clicks APPROVE → bytes move from quarantine to the target location. No approval = no move.
6. NEVER AUTO-RUN: nothing executes at install time (no postinstall equivalent). Running/loading the artifact is a separate, later, user-initiated step (scpm `allowBuilds` / npm v12 approve-scripts model).
7. AUDIT TRAIL: record `{ artifact, sha256, author_key_fingerprint, staged_at, approved_at }` in the store (status `'quarantined'` → `'staged'` → `'installed'`) — statuses travel through the existing `status` field so the feed renders them.
8. No payments: `protocol.md` — AIDE never holds funds, no custodial wallet, no undisclosed fees; external payment status is untrusted until the provider confirms.

Violations of this doctrine (installing without hash+signature, auto-running installed code) are release blockers.

## 6. Future sync note (CRDT upgrade path — opt-in ONLY)

Today: single-writer local store, `sync: 'local-only'`, `network_default: "disabled"` (node-manifest). Nothing may silently change that. If cloud/peer sync is ever added (a user opt-in, per node-manifest `future_adapters: ["encrypted-peer-sync", "user-selected-relay", …]`):

1. ADOPT CRDTs, not naive JSON merging. Research base: Ink & Switch — CRDTs are the foundation for local-first collaboration; Automerge — JSON document model, concurrent list inserts merge deterministically, only same-property concurrent writes conflict (LWW + multi-value register, loser not lost). Alternative: append-only JSONL event log as source of truth with derived cache (Pebbles pattern) — git-friendly, merges by keeping both event lines, but requires the item model to become event-sourced (no in-place edits).
2. The upgrade is a schema migration: `schema_version` 1.0 → 2.0, items gain stable ids (`uuid`) — index addressing is incompatible with multi-writer merge; ids are mandatory. Do the migration as a hard-coded, deterministic change on every device (Automerge modeling-data doctrine: never modify the initial change; every migration is a separate hard-coded change).
3. Document-granularity: one CRDT document per item (Automerge "a document is a unit of collaboration between a small group"); a per-type feed can stay a plain array of document ids.
4. Group sync requires the protocol.md envelope: `group_id`, `object_id`, `author`, `parent`, `content_hash`, `ciphertext`, `signature`, `created_at`; authenticated encryption from an audited library (libsodium); peers verify signature + group membership + parent history + content hash BEFORE storing. Git remains the merge/history authority — never silently overwrite a working tree.
5. Capability gates (protocol.md): do not mark encrypted sync/relay/payments/moderation production-ready until interoperability tests, key-rotation tests, replay protection, conflict tests, offline recovery tests, abuse tests, and a crypto security review all pass. Until then the UI must show those capabilities disabled (as it does today).
6. All of this is OPT-IN per repository, branch, issue, artifact, or discussion. Private data (source, prompts, traces, credentials) is never replicated.

## 7. Verification gates

1. Unit test: `node daemon/test-community-store.mjs` — add/update/remove/list, file persistence (`assert.match(await readFile(...), /Local issue/)`), unknown-type rejection. MUST print `community store test passed`.
2. Full suite: `npm test` (includes the store test + `scripts/e2e.mjs` which asserts `GET /api/community` → 200 against a live daemon on port 4879).
3. Curl contract checks (daemon running):
   - `curl http://127.0.0.1:4777/api/community` → 200, root shape with 4 empty arrays
   - `curl -X POST http://127.0.0.1:4777/api/community/items -H "Content-Type: application/json" -d '{"type":"issues","item":{"title":"T1","detail":"D1"}}'` → 201 `{item}` with `created_at`
   - `curl -X POST … -d '{"type":"bogus","item":{"title":"x"}}'` → 400 `community type is not allowed`
   - `curl -X POST … -d '{"type":"issues","item":{"title":""}}'` → 400 `invalid community item`
   - `curl -X PUT … -d '{"type":"issues","index":0,"item":{"detail":"D2"}}'` → 200 with `updated_at`
   - `curl -X DELETE … -d '{"type":"issues","index":0}'` → 200 with the removed item
4. Persistence: add an item → restart daemon → item still listed (file-backed).
5. UI audit: `node scripts/ui-audit.mjs` (part of `npm test`); manually: add via the form in ISSUES and DISCUSSIONS tabs → row appears in its tab → REMOVE deletes it → daemon restart keeps remaining items → "LOCAL CACHE / SYNC OFF" banner still shown → feed never scrolls the page.
6. Truthfulness gate: every claim in the UI (banner, node panel, marketplace status) must match node-manifest + store `sync` value.

## 8. Audit checklist

- [ ] Store file is single-writer, atomic (tmp+rename), never written in place.
- [ ] `schema_version: "1.0"` and `sync: "local-only"` intact; `additionalProperties: false` schema respected.
- [ ] All 4 type arrays exist; item validation identical to `store.mjs` rules (title 1..160, detail ≤2000).
- [ ] No duplicate entries were introduced without a deliberate decision (store has NO dedupe — do not claim it).
- [ ] Routes match Section 3 exactly; no invented `/status` or `/id` endpoints; `detail` not `body`.
- [ ] Frontend routes all mutations through `loadCommunity()`; user content escaped; no page scroll from feed.
- [ ] Add form type select matches what the store accepts; projects/marketplace add paths documented as MISSING if still absent.
- [ ] Any marketplace install flow implements Section 5 gates (hash → signature → quarantine → explicit approval → never auto-run) or it does not exist.
- [ ] Sync features: none active; `network_default` disabled; UI shows capabilities disabled; nothing silently uploads.
- [ ] `node daemon/test-community-store.mjs` and `npm test` green after any community change.

## 9. Sources

- Ink & Switch — Local-first software: You own your data, in spite of the cloud (2019): https://www.inkandswitch.com/essay/local-first/ (PDF: https://www.inkandswitch.com/essay/local-first/local-first.pdf)
- Wikipedia — Local-first software (seven ideals summary): https://en.wikipedia.org/wiki/Local-first_software
- Automerge — docs: https://automerge.org/docs/hello/ ; Conflicts (LWW + multi-value register): https://automerge.org/docs/reference/documents/conflicts/ ; Merge rules: https://automerge.org/docs/reference/under-the-hood/merge-rules/ ; Modeling data (doc granularity, migrations): https://automerge.org/docs/cookbook/modeling-data/
- Ink & Switch — PushPin (CRDT + append-only hypercore production patterns): https://www.inkandswitch.com/pushpin/
- MVP Factory — CRDTs for offline-first mobile sync: Automerge vs Yjs vs cr-sqlite (2026): https://mvpfactory.io/blog/crdts-for-offline-first-mobile-sync-automerge-vs-yjs-merge-semantics-and-the/
- Jsonic — JSON Real-Time Sync: CRDTs & OT (2025): https://jsonic.io/guides/json-realtime-sync
- Pebbles — event-log-as-truth architecture: https://github.com/Martian-Engineering/pebbles/blob/master/ARCHITECTURE.md
- beads/br — SQLite + JSONL hybrid for git-friendly local issue tracking: https://github.com/dicklesworthstone/beads_rust
- github-export — GitHub issue/discussion data model documentation: https://github.com/mevdschee/github-export/blob/main/docs/data-model.md
- kanbots — local SQLite issues mirroring GitHub fields: https://github.com/leodavinci1/kanbots/blob/main/docs/issues.md
- ghx issue #1 — SQLite backend for issue/PR storage (file vs SQLite scale trade-off): https://github.com/TomzxCode/ghx/issues/1
- dogsheep/github-to-sqlite — FTS/search patterns: https://github.com/dogsheep/github-to-sqlite
- targate — install-time supply-chain security (quarantine, scripts never run, signature+SHA-256): https://www.npmjs.com/package/targate
- SafeInstall — install-time policy, Sigstore provenance, trusted publisher pinning: https://www.safeinstall.dev/ and https://github.com/Mickdownunder/SafeInstall
- scpm — security docs (SHA-512 dist.integrity verification, allowBuilds gate): https://scpm.dev/docs/security
- Chainsaw — checksum fail-closed install firewall: https://chain305.com/
- Veln — pre-download scoring/blocking: https://veln.sh/
- LinuxSecurity — npm v12 disables automatic install scripts (install vs execution separation, 2026): https://linuxsecurity.com/news/vendors-products/npm-v12-disable-install-scripts-default
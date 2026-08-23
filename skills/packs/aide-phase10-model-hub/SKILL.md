# AIDE Phase 9 — HuggingFace Model Hub (search, verified download, register)

## What
In-AIDE discovery and installation of GGUF models straight from HuggingFace:
1. Search bar querying `GET https://huggingface.co/api/models` with GGUF filtering.
2. Result cards: id, author, downloads, params range, quant/file listing, size estimate, license.
3. One-click install: stream download → sha256 verify against LFS metadata → atomic rename into `models/` → probeGguf validation → manifest registration → appears in existing model UI immediately.

## Why
Bundled packs are fixed; users hit the wall the first time their task outgrows 0.5B/1.5B. Every competitor (LM Studio, Jan, GPT4All) ships hub search. This closes the #1 discovery gap while keeping the offline-first doctrine intact.

## Research Grounding (primary sources, fetched 2026-08-21)
- Hub API docs: `https://huggingface.co/docs/hub/api` (+ machine-readable `.well-known/openapi.md`).
- Search endpoint: `/api/models?search=<q>&author=<org>&filter=<tag>&library=gguf&sort=downloads&direction=-1&limit=N&full=false&config=false`.
  - GGUF filter: `library=gguf` (equivalently `filter=gguf` as tag).
  - Param-size ranges: `num_parameters=min:6B,max:128B` style bounds are supported server-side.
  - Pagination: response `Link` header (`rel="next"`); never paginate by offset guesses.
- File listing: `GET /api/models/{repoId}/tree/{revision}?recursive=true` returns LFS metadata including `sha256` (LFS blob oid) and `size` per file.
- Raw download: `https://huggingface.co/{repoId}/resolve/{revision}/{filename}` (follows redirects to CDN).
- JS client exists (`huggingface.js`) — prefer plain `fetch` to avoid a dependency; endpoints are stable public REST.

## Code Plan
New daemon service `node/src/services/model-hub.ts`:
```
searchModels(query, {sort, limit})        -> GET /api/models, library=gguf, map to HubModelCard
listRepoFiles(repoId)                     -> GET tree endpoint; return .gguf entries w/ size+sha256
downloadModel(repoId, file, destDir, onProgress)
  1. pre-checks: free disk >= size*1.15 (headroom); filename sanitized basename only
  2. stream to `<dest>/.partial-<hash>` (resume NOT required v1; restart clean on failure)
  3. sha256 stream-hash while downloading; compare to LFS sha256 -> MISMATCH abort+delete
  4. probeGguf(partial path after rename-candidate): reject bad magic/v1/no-chat-template BEFORE final rename
  5. atomic fs.rename into models/<file>
  6. call existing ModelRuntime.ingest(path) -> registration, fit report, endpoint assignment
Routes (envelope-wrapped, OpenAI-documented, regenerate contracts!):
  GET  /api/hub/search?q=&sort=&limit=
  GET  /api/hub/repo/:repoId/files       (URL-encoded repoId)
  POST /api/hub/install {repoId, file}   -> job id; status via existing events channel `hub-progress`
UI: new "Hub" view behind existing view-switch contract; search input, result grid, install button with progress bar bound to hub-progress channel.
Egress: add huggingface.co + *.huggingface.co CDN hosts to egress-audit allowlist ONLY for these two routes' fetch sites; all other code paths remain offline-enforced.
```

## Threat Matrix
| Threat | Control |
|---|---|
| Truncated/corrupt download | sha256 vs LFS metadata mandatory; mismatch deletes artifact |
| Misleading repo (not actually GGUF / v1 / template-less) | probeGguf gate BEFORE final rename; reuse ingest's chat_template rejection |
| Path traversal via crafted filename | basename() sanitize; reject any name containing path separators or `..` |
| Disk exhaustion mid-install | pre-flight free-space check incl. 15% headroom; delete .partial on every abort path |
| Offline-doctrine violation | network confined to model-hub.ts; egress-audit updated; installs require explicit user action (no background sync, ever) |
| Rate limit / 429 storm | honor Retry-After; single in-flight install at a time (queue) |
| Partial file mistaken for real model | `.partial-*` prefix excluded from models dir scanning; runtime never lists it |

## Dependencies
Existing: `services/gguf.ts` probeGguf, `services/model-runtime.ts` ingest, `services/model-fit.ts`, hardware probe, envelope/error codes, events hub, view-switch contract, egress-audit script.
New: none (fetch only).

## Issues / Bugs Watchlist
- OpenAPI drift: any new route requires `npm run contracts` regen or `openapi-drift.test.ts` fails — run it before pushing.
- Windows long paths: keep install dir shallow (`models/<file>` flat, same as bundled packs).
- HDD lesson (2026-08-21): streaming hash of ~0.5–1.5GB is I/O heavy on slow disks — progress events must throttle to ≤4/sec or WS floods.
- Repo ids are case-sensitive in URLs; encode fully, never rebuild from display names.
- License display is a hard requirement: surface `cardData.license` when present; block install with explicit user override if license field missing (policy decision logged in AGENT_NOTES when first triggered).

# M — Model Hub Acquisition (search / download / benchmark / import any GGUF)

Phase skill for AIDE M-series. Master router: aide-master-roadmap. Extends aide-arch-model-runtime (P6 spawn chain + Large-GGUF memory expansion policy — read both before acting).

## Reference UX (user-directed: PocketPal AI + ToolNeuron)

User named two apps as the simplicity bar for hub UX (both studied from their repos/docs, 2026):

**PocketPal AI** (a-ghorbani/pocketpal-ai): menu -> Models -> tap Download, or "+" to add from HF/local storage; search inside app then CHOOSE THE QUANT THAT FITS your device memory before download; bookmark-for-later option; explicit Load step after download (maps to our warmup gate); load-from-chat chevron; Settings->Set Token for GATED repos; auto offload/reload for RAM; deep link `pocketpal://hub/run?repo_id=...` opens bottom sheet resolving the repo into the FULL quant list (filename optional; malformed/path-traversal repo_id rejected; resolve failure = inline Retry/Cancel); per-file free-disk check at resolve; "already downloaded" state per file card.

**ToolNeuron** (Siddhesh2377/ToolNeuron): drawer -> Model Store with a recommended-by-use-case starter table (sizes shown: ~600MB quick test / ~2.8GB general / ~5.5GB power); full-screen HF Explorer with FILTER CHIPS that matter — pipeline tag, library, param count, quant, license, gated, author — populated dynamically from the live HF tags catalog; README rendered client-side in-app; gated-repo detection up front; CONCURRENT multi-model downloads incl. background; any-GGUF file-picker import without conversion; privacy stance identical to ours (outbound ONLY on explicit user action; local server never initiates calls).

**Adopt into AIDE hub UI** (M1/M3):
1. Curated starter grid ranked by OUR M2 verdicts (we out-do both: fit verdict computed on the user's actual GPU/RAM, not generic size tiers).
2. Filter chips: params, quant, license, gated, author — cached tags catalog refreshed only when user opens the explorer.
3. Repo page = quant-list sheet: one card per file { size, disk-check result, already-downloaded badge, Download/Bookmark }.
4. Downloads concurrent, cancelable, resumable (.part discipline already specced).
5. Gated repos: token prompt routed through P7 credential store (DPAPI) — same flow as providers, never plaintext.
6. After download: explicit "Load & verify" button -> warmup gate -> ready chip.
7. `aide://hub/run?repo_id=` deep link parity with PocketPal (post-v1 nice-to-have).
8. Attribution User-Agent on all HF calls (`aide-sovereign-workbench/<version>`).
9. Import tab (M3) sits beside search as equal citizen — file picker, no conversion, same manifest flow.

## Doctrine

Downloads are USER-INITIATED, explicit, visible, cancelable, and logged. Nothing auto-fetches at startup, ever (In-the-Box Law). AIDE ships WITH bundled models; hub is for getting MORE.

## M1 — Search & Download (Hugging Face GGUF)

Research base (verified 2026-08): HF Hub public REST needs no auth for public repos.
- `GET https://huggingface.co/api/models?search=<q>&filter=gguf&sort=downloads&direction=-1&limit=20` -> [{ id, downloads, likes, tags[], siblings[](rfilenames) }]
- File download: `https://huggingface.co/<id>/resolve/main/<filename>` follows CDN redirect; stream to disk.
- llama.cpp native pulls (preferred when server supports it): `-hf <user>/<repo>:<quant>` uses `-hfr` repo regex + `-hff` file regex; cache under `%LOCALAPPDATA%\llama.cpp` on Windows; `--docker-repo` style naming exists for OCI registries.
- Implement BOTH paths behind one service; default to our own downloader (we control progress/verify/cache layout), keep -hf as fallback flag passthrough in advanced settings.
- Progress: WS channel `modelhub` { job_id, bytes_done, bytes_total, eta_s }; cancel = abort fetch + delete partial + `.part` suffix discipline.
- sha256 verify when repo publishes it; else record etag+size in manifest. Manifest per model dir: { repo_id, filename, quant_label, size_bytes, sha256?, downloaded_at, source:'hf'|'manual' }.

## M2 — Device Benchmark & Recommendation

On demand ("Will this run?") and after each download:
1. Probe once per boot (cache result): total/free VRAM via nvidia-smi parse (fallback WMI), free RAM, CPU cores. GTX 1060 6GB class baseline known from device-training-1060.
2. Estimate fit from GGUF metadata WITHOUT loading weights: mmap the header only, parse `general.architecture`, block_count, embedding_length, `*.context_length`; compute runtime footprint ≈ file_size + ctx*KV_bytes_per_token*ctx_len + graph overhead (~600MB fudge for 8B-class; scale by param count). Reuse P6 RAM-doctrine numbers.
3. Verdict tiers: COMFORTABLE (<70% VRAM), TIGHT (70-95%, warn about spill; reference Large-GGUF policy: mmap default, layer offload research track), OVER (needs quant downgrade or CPU offload — show expected tok/s hit).
4. Rank search results BY THIS VERDICT before popularity. "Runs well on YOUR machine" is the differentiator vs Ollama's flat list.

## M3 — Import Any GGUF (drop-in)

- Watched import folder + drag-drop route `POST /api/models/import` { path } -> copy into models dir, same manifest flow, source:'manual'.
- Accept ANY valid GGUF regardless of architecture family; validation = header parses + required keys present. If arch unsupported by bundled llama.cpp build -> still import, mark status 'unsupported-runtime', never crash.
- After import: identity check + warmup gate EXACTLY per aide-arch-model-runtime spawn chain (identity check, warmup gate, port doctrine 8081->8087).

## Routes (zod strict)

`GET /api/modelhub/search?q&sort`, `POST /api/modelhub/download {repo_id,filename}`, `DELETE /api/modelhub/downloads/{job_id}`, `GET /api/models/{name}/fit` (verdict), `POST /api/models/import`. All network-touching routes log to egress journal (V1) BEFORE first byte leaves.

## Tests FIRST

1. Search route against recorded fixture JSON (no live network in CI; live test manual-only script under scripts/, opt-in env var).
2. Downloader: local http server fixture serving bytes; resume-after-interrupt mid-stream; .part cleanup on cancel.
3. Header-only fit probe: real small GGUF from fixtures -> verdict matches precomputed expectation.
4. Import unsupported arch -> imported + flagged, daemon alive.
5. Arch tests: strict bodies, error envelope, openapi zero-diff.
6. Egress journal entry written for search+download routes (V1 contract test).

## Pitfalls

- NEVER call HF at boot or on UI load without user click (law). Search results page shows "connect to huggingface.co" consent chip first time per session.
- Windows path length: model filenames exceed 200 chars sometimes — use \\?\ prefix if needed; tested with 260+ char name.
- Disk-full mid-download -> catch ENOSPC, clean .part, human error message.

## Gate

Unit+arch green; offline e2e proves ZERO network calls during normal IDE use (V1 harness); manual live-download verified once with evidence screenshot + sha256 note in docs/evidence/. Journal.

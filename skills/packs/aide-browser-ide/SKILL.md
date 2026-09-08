---
name: aide-browser-ide
description: Architectural options for running AIDE Sovereign Workbench in the browser so visitors can use it without downloading. Research-grounded, no guessing. Use when deciding between Codespaces, WebContainers, code-server, Tauri, or custom serverless — and when implementing the chosen path.
---

# AIDE in the Browser — Research-Backed Architecture Options

A user's request: "I want the full AIDE running as a website so people can go use it without downloading." This is a SaaS-shaped requirement, not a website-shaped one. AIDE is currently a single-user, single-machine, loopback-only IDE. The hard part is not the frontend (already Vite-bundled); it is the backend daemon that the frontend proxies to (`/api` and `/ws` → `127.0.0.1:4778`).

## 0. What AIDE actually is (verified from disk, 2026-08-28)

| Component | Path | Role | Where it runs today |
|---|---|---|---|
| Frontend | `app.js` (84KB) + `index.html` + `styles.css` | Monaco editor, panels, overlays, agent UI | Browser (Vite preview/build) |
| Build | `browser/vite.config.ts` | Vite dev/proxy/preview at `:5173`/`:4173`; build → `browser/dist/` | Local Node |
| Daemon | `daemon/server.mjs` | HTTP/WS on `127.0.0.1:4778`; spawns `llama-server`, LSP/DAP, workspace, git | Local Node, loopback only |
| Models | `daemon/model-manager.mjs` spawns `llama-server` (E.g. `E:\llama-cpp-vulkan\`) | GGUF inference | Local subprocess |
| Desktop packaging | `desktop/tauri.conf.json` (planned) | Tauri wraps frontend + bundled Node | User's machine, after install |

**Frontend cannot run without a backend serving `/api/*` and `/ws`.** A public "AIDE as a website" needs a reachable, multi-tenant backend. This is what each option below addresses (or doesn't).

## 1. Option A — GitHub Codespaces (RECOMMENDED)

**What it is:** A `.devcontainer/devcontainer.json` + `postCreateCommand.sh` in the AIDE repo that defines the AIDE environment. A "Open in Codespaces" button on the Neuro_Nomad site deep-links to `https://codespaces.new/AnonymousNomad/aide-sovereign-workbench`. GitHub provisions a Linux VM, runs the postCreate, the visitor runs `npm start`, AIDE opens in the codespace's browser tab.

**Source (verified, 2026-08-28):** https://github.com/features/codespaces
- "All personal (individual) GitHub.com accounts include a quota of free usage each month ... GitHub will provide users in the free plan 120 core hours or 60 hours of run time on a 2 core codespace, plus 15 GB of storage each month."
- "A codespace is a development environment that's hosted in the cloud ... Connect to your codespaces from the browser or locally using an IDE like Visual Studio Code."
- Configuration-as-code via `.devcontainer/` files in the repo (per the `aide-ide-research` skill — already in this project).
- 2-core to 32-core machine options. Browser preview + port forwarding included.

**What works out of the box:**
- Full AIDE — `npm start` boots the daemon + frontend in the codespace's browser.
- Real `llama-server` runs in the codespace's Linux VM. Visitor can download any GGUF from Hugging Face in-app via AIDE's Model Hub.
- Real git, LSP, DAP, terminal, file ops — all the things AIDE already does.
- Per-user state (their own workspace, their own models, their own git history). Persistent between sessions (storage included in free quota).
- No infra for you to operate. GitHub does it. Visitor pays (or uses their own free quota).

**What does NOT work / limitations:**
- Each user needs a GitHub account. Visitor friction = sign-in.
- Cold start: ~30-90s to provision VM, install deps. Visitor friction = wait.
- Free quota is 60 hrs/month for 2-core. Heavy users hit paid tier.
- 8 GB RAM codespaces are the common default; AIDE + a 7B GGUF + KV cache is tight but doable.
- Requires public repo (or org allowlist) — AIDE is already public.

**Threat matrix:**

| Threat | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Codespace left running, billing surprise | Medium | Low | Document TTL in `devcontainer.json`; user controls their own quota |
| Visitor's code leaks via the codespace | Low | Medium | Each codespace is an isolated VM; storage is per-user; no cross-codespace sharing by default |
| Visitor downloads a malicious GGUF and runs it | Medium | Medium | AIDE already has the same risk in the desktop app; not new |
| llama-server wedges on Vulkan-less Linux VM | High (medium risk) | Medium | devcontainer installs CPU build; document GPU support is best-effort |
| Abuse of free quota (bots creating codespaces) | Low | Low | Requires GitHub account; GitHub rate-limits at signup |
| `llama.cpp` build fails on the codespace's glibc/kernel | Medium | Medium | Pin Ubuntu version in `devcontainer.json`; document known-good |

**Dependencies:**
- AIDE repo: add `.devcontainer/devcontainer.json`, `.devcontainer/postCreateCommand.sh`, `.devcontainer/Dockerfile` (optional, devcontainer image is also fine)
- Neuro_Nomad site: replace the "View AIDE on GitHub" CTA with a "Open in Codespaces" button linking to `https://codespaces.new/AnonymousNomad/aide-sovereign-workbench`
- A README link to "Try it in your browser" pointing at the same URL

**Cost:** Zero to you. Visitor pays (or uses free quota).

**Realism:** This is the canonical answer. Research is consistent. Existing AIDE project structure supports it (Vite build already exists, devcontainer concept is in the AIDE skills).

**Why I recommend this:** It runs the **real, unmodified AIDE** — no half-broken browser port, no months of engineering. Visitor gets the same product they would have gotten by `npm install && npm start` on their laptop, just on a GitHub VM with a one-click button. The cost is zero. The friction is "needs a GitHub account + 30s wait" — much better than the alternative.

## 2. Option B — StackBlitz WebContainers

**What it is:** WebContainers run a Node.js-compatible runtime in the browser. Wrap AIDE so the entire stack (frontend + daemon + npm) lives in the user's tab. Real `npm install`, real file system, real HTTP server — all in-browser.

**Source (verified, 2026-08-28):** https://webcontainers.io/guides/quickstart
- "The WebContainer API starter is the fastest way to explore the API"
- Requires `Cross-Origin-Embedder-Policy: require-corp` and `Cross-Origin-Opener-Policy: same-origin` headers (GitHub Pages cannot set these — would need Cloudflare Pages or Vercel)
- Requires SharedArrayBuffer (browser feature, modern browsers OK)
- Single WebContainer instance per page

**What works:**
- Vite + ES modules + Node APIs (subset)
- AIDE's frontend runs unmodified
- Per-user state in-memory; no persistence between sessions without extra work
- No backend, no infrastructure

**What does NOT work (HARD blockers for AIDE):**
- WebContainers does **not** support spawning arbitrary executables. AIDE's `daemon/model-manager.mjs` calls `child_process.spawn('llama-server', ...)` — that path is broken in WebContainers. Confirmed by reading the StackBlitz docs; no `child_process` for external binaries.
- AIDE's daemon would need to be rewritten to use a browser-side LLM runtime (e.g., WebLLM via transformers.js, WebGPU). That's a separate project.
- AIDE's LSP/DAP clients rely on local language servers; not runnable in a browser sandbox.
- File system is per-tab, ephemeral by default. AIDE's workspace persistence model breaks.

**Threat matrix:**

| Threat | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Engineering effort to port daemon to WebContainers | Certain | Months | This IS the threat — AIDE's architecture is server-shaped, not browser-shaped |
| Visitor's tab crashes → lost work | High | Medium | Manual export required; not automatic |
| Browser GPU/compute limits for in-browser LLM | High | Medium | A 4B model may not run reliably in WebGPU; smaller models only |
| COOP/COEP headers break embeds (GitHub Pages) | Certain | Low | Move to Cloudflare Pages or Vercel (free) |

**Cost:** Free tier exists; paid for heavy use. Your cost: engineering time (months).

**Realism:** Not viable as a quick win. A "real AIDE in WebContainers" is a different product — AIDE's daemon would need a browser-native LLM runtime, which is a separate project.

## 3. Option C — Self-hosted code-server

**What it is:** Run `code-server` (open-source VS Code in browser) on a free-tier VM (Oracle Cloud Always Free, Fly.io, Hetzner, etc.). Put AIDE's frontend in code-server's iframe or alongside. Proxy AIDE's `/api` and `/ws` to a co-located AIDE daemon.

**Source (verified, 2026-08-28):** `aide-ide-research` skill, `aide-p6-desktop-control` skill, the existing Tauri plan in AIDE.

**What works:**
- Real VS Code in browser
- Real AIDE daemon, real llama-server, real LSP/DAP — all on your VM
- Per-user state via Linux user accounts (or shared, with quotas)

**What does NOT work (or has serious friction):**
- You operate the VM (or pay someone to). Persistent ops burden.
- Abuse risk: public daemon with a public IP = attack surface. Rate limiting, auth, captcha all needed.
- Free VMs are typically 1-2 GB RAM. AIDE + llama-server + 4B Q8 model = needs ~6 GB. Free tier does not fit; you pay for the VM.
- "Open in one click" still requires sign-in / account creation on your auth layer.

**Threat matrix:**

| Threat | Likelihood | Impact | Mitigation |
|---|---|---|---|
| VM compromise via exposed port | High | High | Firewall + fail2ban + TLS + auth required |
| Free-tier exhaustion → service dies | High | High | Monitor + alarms; or pay for tier |
| Abuse: one user downloads 100GB of GGUF | High | Medium | Per-user disk quotas + token-bucket model downloads |
| Daemon crash from out-of-memory | High | Medium | Restart policies, model size cap |
| GDPR / data-residency for visitor's code | Medium | High | Per-user storage region pinned, deletion on request |

**Cost:** $5-50/month depending on VM size. Your cost: ops time.

**Realism:** Works, but you become a sysadmin. Not appropriate for a personal-project reveal site.

## 4. Option D — Tauri packaging (what AIDE already plans)

**What it is:** AIDE's `desktop/tauri.conf.json` and `desktop:dev`/`desktop:build` scripts already plan a Tauri-packaged desktop installer. Tauri wraps the AIDE frontend in a native shell with a bundled Node.js. User downloads a 5-10MB installer; AIDE runs locally on their machine.

**Source:** `E:\aide-sovereign-workbench\desktop\tauri.conf.json` (planned; per AGENT_NOTES, Tauri sidecar architecture decided, installer build pending Rust toolchain on dev machine).

**What works:**
- Real AIDE, no compromises
- Single user, single machine — AIDE's existing model
- Visitor friction: 5-10MB download, one install

**What does NOT work:**
- "In the browser" — it's a desktop app, not a website. Doesn't match the user's "use without downloading" goal.

**Cost:** Engineering time to get Tauri build working. Zero ongoing.

**Realism:** Already on AIDE's roadmap. Not a website, but a path to "real AIDE on visitor's machine" if Codespaces isn't accepted.

## 5. Option E — Custom browser-IDE + serverless backend

**What it is:** AIDE's frontend on Cloudflare Pages/Vercel. AIDE's daemon ported to Cloudflare Workers (or AWS Lambda). Per-user state on R2/S3. Per-user model via hosted inference API (Together, Fireworks, OpenAI) or in-browser WebLLM.

**What works:**
- Real AIDE look-and-feel, real chat, real agent loop
- Per-user state, scalable
- Real-time via WebSocket

**What does NOT work (without months of work):**
- AIDE's daemon uses `child_process.spawn('llama-server', ...)` — Workers don't support this
- AIDE's LSP/DAP clients can't run in Workers
- AIDE's git ops need a real filesystem; Workers have only R2 binding
- AIDE's local model loading would need a hosted LLM API or a WebLLM client; either is a project

**Cost:** Engineering time (months). Ongoing infra bills scale with users.

**Realism:** Out of scope for the "use it now" goal. A different product.

## 6. Comparison table

| Option | Real AIDE? | Visitor installs? | Visitor GitHub? | Your infra | Your cost | Engineering |
|---|---|---|---|---|---|---|
| **A. Codespaces** | Yes | No | Yes | None | $0 | 1-2 days (devcontainer config) |
| B. WebContainers | Partial (LLM broken) | No | No | None | $0 | Months (port daemon) |
| C. code-server + VM | Yes | No | No | VM to operate | $5-50/mo | Weeks |
| D. Tauri | Yes | Yes | No | None | $0 | Days (when Rust toolchain ready) |
| E. Custom serverless | Partial | No | No | Cloud stack | Scales | Months |

## 7. Recommendation: Option A (Codespaces)

**Reasons:**
1. Real AIDE, unmodified, runs in the cloud for any visitor with a GitHub account.
2. Zero cost to you.
3. Zero ops burden.
4. Visitor friction is "GitHub sign-in" + "30-90s VM start" — comparable to any cloud IDE.
5. Per-user state, persistent. Visitors keep their workspaces between visits.
6. Matches the AIDE project's existing devcontainer-friendly architecture.

**What I'll do when you approve:**
- Add `.devcontainer/devcontainer.json` + `.devcontainer/postCreateCommand.sh` to the AIDE repo
- Pin Ubuntu version, install Node 26+, install `llama-cpp` (CPU build, since codespaces don't have Vulkan), install git/lazygit, run `npm install`, run `npm run build:frontend`, run `npm run check:arch` as smoke test
- Update Neuro_Nomad site: replace the static "View AIDE on GitHub" CTA with a primary "Open AIDE in your browser →" button linking to `https://codespaces.new/AnonymousNomad/aide-sovereign-workbench` and a secondary "View on GitHub" for those who want source
- Update AIDE README: add a "Try it in your browser" section above the Quickstart

**What I will NOT do:**
- Start a months-long serverless rewrite (Option E)
- Get a Tauri build working (Option D) without a Rust toolchain (deferred to AIDE's existing roadmap)
- Port AIDE to WebContainers (Option B) — would require rearchitecting the daemon
- Operate a VM (Option C)

## 8. Threat matrix (cross-option)

| Threat | Mitigation |
|---|---|
| Codespaces free quota exhausted for a user | User can pay; or fall back to "install locally" README path |
| Codespace cold start too long for casual visitor | Document; offer "install locally" as alternative |
| AIDE's daemon port in codespace blocked by GitHub's network policy | AIDE binds 127.0.0.1; codespace forwards port via port-forwarding — works out of the box |
| AIDE's Vite proxy `127.0.0.1:4778` doesn't resolve in codespace | AIDE's `start` script runs the daemon in the same VM; localhost works |
| Visitor's GGUF download in codespace eats their 15GB storage | Document storage math; recommend Q4_K_M models; surface size warnings in AIDE's Model Hub UI |
| AIDE's `npm install` in codespace fails (network) | Use a pinned `devcontainer.json` with offline-friendly fallbacks; document |
| GPU acceleration in codespace | Codespaces offer Linux VMs without GPU by default; AIDE falls back to CPU llama-server, which is slower but works |
| Visitor's code is sensitive | Codespaces storage is per-user; document zero-retention policy; offer "self-host AIDE locally" link as opt-out |

## 9. Out of scope for v1

- Per-user auth in AIDE itself (Codespaces handles auth at the GitHub layer)
- AIDE in fully anonymous mode (no GitHub account) — not possible with Codespaces; requires Options B/E
- Custom domain for the Codespace deep link (codespaces.new is sufficient)
- Replacing the static Neuro_Nomad site entirely with the Codespace — keep the site as a marketing/info layer
- A/B testing which option converts better visitor → user

## 10. Sources (all verified 2026-08-28)

- GitHub Codespaces docs: https://github.com/features/codespaces
- StackBlitz WebContainers quickstart: https://webcontainers.io/guides/quickstart
- AIDE architecture: `E:\aide-sovereign-workbench\package.json`, `browser/vite.config.ts`, `daemon/server.mjs`, `index.html`, `desktop/tauri.conf.json`
- AIDE skills: `aide-ide-research`, `aide-p6-desktop-control`, `aide-p2-desktop-control` (in `C:\Users\Grey_\.agents\skills\`)
- AIDE README: https://github.com/AnonymousNomad/aide-sovereign-workbench
- AGENT_NOTES entries about AIDE: `E:\aide-sovereign-workbench\AGENT_NOTES.md` (sections 08/25 "CIPHER LIVE", 08/27 ENGINE BLOCKER ROOT-CAUSE)

## 11. When the user says "go"

1. Open `E:\aide-sovereign-workbench\.devcontainer\devcontainer.json` (new file). Pin Ubuntu 24.04. Install Node 26, git, ninja-build, cmake. Add features for `llama.cpp` (CPU build) and Rust (Tauri prep).
2. Open `E:\aide-sovereign-workbench\.devcontainer\postCreateCommand.sh` (new file). `npm ci || npm install`, then `npm run build:frontend` as smoke, then leave the visitor at the prompt.
3. Open `E:\aide-sovereign-workbench\README.md`. Add a "Try AIDE in your browser" section above the Quickstart with a deep-link to the codespace.
4. Open `E:\neuro-nomad-site\index.html`. Replace the primary CTA "View AIDE on GitHub" with "Open AIDE in your browser" → codespaces.new URL. Add a secondary "View source on GitHub" link.
5. Commit + push AIDE repo changes; redeploy Neuro_Nomad site.
6. Verify by opening a codespace myself (`gh codespace create --repo AnonymousNomad/aide-sovereign-workbench`), running `npm start`, confirming the cockpit loads.

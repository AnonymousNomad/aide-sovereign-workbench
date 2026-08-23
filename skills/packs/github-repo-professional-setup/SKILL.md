---
name: github-repo-professional-setup
description: Prepare a project as a high-visibility professional GitHub repository — README structured for conversion and AI parseability, shields.io badges, LICENSE, SECURITY.md, CONTRIBUTING.md, CI workflow, llms.txt, and credential-safe publishing. Use when setting up a new public repo, rewriting a README for traction, adding badges/CI, or pushing an existing project to GitHub.
---

# GitHub Repo Professional Setup

Researched 2026 practice for READMEs that get adopted and repos that get trust. Apply every section in order.

## 1. Ask blocking decisions FIRST (never assume)

Before touching anything, ask the user, in one question batch:
- License: MIT (recommended, ~60% of OSS) > Apache-2.0 (~25%, patent grant) > AGPL-3.0 (copyleft). None = "all rights reserved", harms adoption — warn the user.
- Publish path: prepare-locally-and-user-pushes vs install gh CLI (`winget install GitHub.cli` + `gh auth login`) vs API push with a user-provided PAT.
- Repo name (match directory name unless user prefers otherwise) and visibility (public = traction; private if secrets/tooling policy demands it).

If the user hands over a PAT: use it ONLY transiently. Never write it to any file, never store it in `.git/config` (remote URL must be token-free), never echo it. Prefer `git -c http.extraheader="AUTHORIZATION: bearer <token>" push` (header dies with the process). Warn the user to revoke/rotate the token afterward since it passed through chat/logs.

## 2. README structure — decreasing urgency order (RepoClipp 2026, standard-readme spec)

The first screenful decides go/no-go. Order:

1. Project name + ONE-sentence description (keyword-rich for SEO; the pitch).
2. Badges — max 5, high-signal only: license, CI/build (dynamic GitHub Actions badge), language/framework, platform. shields.io static or dynamic (`https://img.shields.io/badge/<label>-<value>-<color>`; CI: `https://github.com/<owner>/<repo>/actions/workflows/<file>.yml/badge.svg`). No "Made with love" badges, no badge walls.
3. Visual: screenshot, animated GIF, or Mermaid diagram (renders natively on GitHub). A diagram beats text for architecture repos.
4. Why / long description: the problem, the thesis, the one-liner "X proposes. Y decides. Z executes."
5. Features: bullet list or table; concrete, verifiable claims.
6. Table of Contents (standard-readme places it early for long READMEs).
7. Security section FIRST when the tool is security-adjacent — fail-closed doctrine, authorized-use-only boundary. Trust is the adoption gate.
8. Install / prerequisites (exact SDK versions, OS), then Quickstart: max 3 commands to get something visible. Then Usage/config, CLI reference tables.
9. Tests: how to run, real passing counts (verify before writing them into the README — never stale numbers).
10. Documentation links (ARCHITECTURE.md, RESEARCH.md, docs/), Contributing, License LAST with SPDX identifier (`MIT`).

Keep 800–1500 words typical; use stable headings (AI parses them). Add a `llms.txt` file at root (2026 trend): 10–20 line AI-readable summary + link list.

## 3. Trust files (mandatory for adoption)

- `LICENSE` — full license text, year + copyright holder.
- `SECURITY.md` — how to report vulnerabilities; security properties of the project.
- `CONTRIBUTING.md` — build/test commands, conventions, PR process.
- `README` links all three.

## 4. .gitignore — the leak list

Never commit: local state dirs (data/, journals, keys/, secrets/, selections, artifacts/), model weights, pinned runtime binaries, `bin/ obj/ .vs/ *.user`, `.env*`, credentials of any kind. Sanitized release evidence is tracked only if deliberately approved. Sweep staged files (`git add` then `git ls-files` / grep for `ghp_`, `sk-`, `AKIA`, private keys) before the first commit.

## 5. CI workflow

`.github/workflows/ci.yml` on `windows-latest` for Windows-only projects: checkout → setup-dotnet (exact major.minor) → `dotnet build <sln/slnx>` → run every test suite. Opt-in/environment-gated tests (real model, live endpoints) stay OUT of CI.

## 6. Verification-first

- Build and run the real test suites locally before publishing README numbers.
- Run the README commands verbatim before claiming they work.
- After push: verify the repo page, workflow badge, and that no secret appears in the commit tree.
- Public-facing copy: pure technical description only. Never mention contest/grants/money in README or demo material.

## 7. Grant/funder/adoption visibility layer (researched 2026: RepoClip 2026, Gingiris 2026 audits of 100+ repos >10k stars, OSS.Fund funding guide)

A README that wins grants/funders and end users is a conversion page, not a feature catalog. The same signals serve both audiences: credibility, proof, and a clear next step. Apply on top of section 2:

- **First line = category claim**: `[Project] is an open source [category] for [specific user] who want [clear outcome].` (10-15 words; SEO keyword in the first 50 words; the user must be able to repeat what the repo is from one sentence).
- **Target user above the fold**: a "Who It's For" block (2-4 named audiences) right after the pitch, before the long feature list.
- **Proof before features**: put verified metrics early — real test counts, doctor/preflight results, raw benchmark outputs, screenshot/GIF. Repos with a hero visual convert ~+35% star-rate vs text-only (2026 audit). A long feature list without proof reads as a promise deck.
- **Architecture diagram** (Mermaid, renders natively) for any multi-process/system repo — it answers "how is this built" in 10 seconds.
- **Honest limits section**: state pre-production status, open gates, and what is intentionally NOT claimed. Funders and adopters both penalize overclaiming; a candor section is a credibility asset.
- **Funding surface**: `.github/FUNDING.yml` + one GitHub Sponsors badge + ONE specific ask sentence ("Sponsorship funds issue triage, releases, documentation, dependency updates, and long-term maintenance."). Visible, not hidden at the bottom; specific, not vague. Per the public-copy rule above, this is maintenance ask language — never contest/grant/money claims.
- **Quickstart = 3 commands, tested on a clean machine**; state prerequisites (exact runtime version) immediately above the command block. Time-to-first-success in seconds decides adoption.
- **llms.txt at root** — AI-readable summary + link list; AI crawlers increasingly gate discovery.
- **Maintain with every release**: stale test counts, old install steps, or dead badges erode trust faster than no docs at all; update the README in the same change that ships the feature.
- Word budget: 800-1500; stable headings; scannable bullets/table over paragraphs.
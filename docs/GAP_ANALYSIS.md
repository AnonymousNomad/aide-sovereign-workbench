# AIDE Gap Analysis — Becoming the Developer's Choice (2026-08-25)

Sources: Microsoft Research "To Copilot and Beyond: 22 AI Systems Developers
Want Built" (860 devs, Apr 2026); JetBrains AI Pulse wave 2 (10,000 devs,
Jan 2026); GitKraken State of AI (554 devs/leaders, Aug 2026); SlashData
AI Dev Tools Benchmark Q1 2026 (2,393 devs, 20 tools); Sergeyuk et al.
arXiv 2410.08676 (in-IDE assistant needs, Adopters/Churners/Non-Users).

## What the research says the market is missing

1. **The 64-point proof gap** (GitKraken): 84% FEEL more productive with AI,
   only 20% can MEASURE it; 39% of orgs have no measurement at all.
2. **Bounded delegation** (MSR's headline finding): developers want AI to
   absorb assembly work around the craft, never the craft — with explicit
   authority scoping, provenance, uncertainty signaling, least-privilege.
   Right-shift burden: quality signals must move EARLIER in the workflow.
3. **Agent-native teams outperform** (GitKraken tiers): assistive 28% vs
   agent-native 62% report "much more productive". Parallel agents are the
   adoption curve's steep part.
4. **Churners exist for fixable reasons** (Sergeyuk et al.): interaction
   friction, misalignment with task, no customization. Proactive maintenance
   help is the underdelivered blind spot.
5. **Claude Code's loyalty lesson** (JetBrains): fastest growth + highest
   CSAT/NPS belongs to the tool that is model-agnostic, local-first, and
   terminal-honest — not the biggest incumbent.

## AIDE gap matrix

Legend: [daemon-done = backend capability shipped, cockpit wiring missing]

### P0 — daily-driver blockers (ship next)

| Gap | Why it blocks adoption | Effort | Backend status |
|---|---|---|---|
| Command palette (Ctrl+K) in cockpit | Progressive disclosure depends on it; promised in old UI, absent in new | S | routes exist |
| Workspace global search (find-in-files) | No developer works without it; rg-service exists | S | [daemon-done] |
| LSP -> Monaco bridge | TS diagnostics/hover/go-to-def in editor; without it the editor feels dead | M | lsp-manager live |
| Terminal panel | Build/test/run loop closes here; run_command tool exists in agent tools | M | task service live |
| Git depth: branch switch, history log, push-with-consent | Ship flow currently main-only; push must be explicit-consent egress | M | git CLI wiring |

### P1 — differentiators (the research-backed wedge)

| Gap | Evidence tie | Backend status |
|---|---|---|
| Provenance chips on every reply (verified / unverified / source span) | MSR: uncertainty signaling demanded; Veritas Part 1 designed | partial |
| Bounded-delegation console: per-tool auto-approve vs ask-always scopes per session | MSR headline finding; A1 approval gates exist — needs granularity UI | [daemon-done] |
| Skills browser: searchable registry of the 139-pack with apply/inspect | Unique; pack ships in-box; registry.json exists | data ready |
| Outcome-latency + rework telemetry per SHIP (intent timestamp -> verified commit; churn flags) | GitKraken proof gap; DORA rework-rate 5th metric; segment by Assisted-by trailer | schema trivial |
| Checkpoint restore UI over A1 shadow-git timeline | Cline-proven retention driver | [daemon-done] |
| BYOK provider sheet in cockpit (H2 routes live) | Continuity law surface | [daemon-done] |

### P2 — completeness (post-release cadence)

Debug UI over existing DAP client · RAG semantic search UI (A2 daemon done) ·
Training Room surface · Community Hub surface · themes/keybindings · workspace
switcher · offline docs viewer · image/binary previews · merge-conflict editor.

## Strategic read

The research's sharpest finding (MSR bounded delegation + GitKraken proof gap +
DORA rework rate) describes a tool that does not exist yet: an IDE where
**authority scoping, provenance, and delivery measurement are first-class
UI**, not afterthoughts. AIDE's Iron-Suit architecture already owns the hard
parts (approval gates, audit ids, egress journal, evidence batteries). The
missing work is surfacing them — plus closing the five P0 daily-driver gaps so
AIDE qualifies as a primary editor at all.

## Execution order (proposed)

> **Revised 2026-08-25 after usage-data research** (FlouState 11,805 sessions:
> debugger = 1.4% of editor time, 75% never open it; PanDev heartbeat: reading
> code ≈ 29%, maintenance ≈ 24%; DORA 2026 adopted Rework Rate as 5th metric):
>
> - Debug UI **deferred post-release** (was assumed P0-adjacent — data says no)
> - Replace-in-files elevated (maintenance slice, approval-gated multi-file rewrite)
> - Session/settings persistence elevated (cockpit remembers nothing across reloads)
> - Ship telemetry + provenance stay the differentiator lane (VS Code has nothing here)

1. E1: Palette + global search + terminal panel ✅ SHIPPED
2. E1.1: Replace-in-files (approval-gated) + session persistence (engine/UI state)
3. E2: LSP->Monaco bridge ✅ SHIPPED
4. E3: Git depth (branches/history/push-with-consent) ✅ SHIPPED
5. E4: Skills browser ✅ SHIPPED · delegation console + provenance source-span chips
6. E5: Telemetry expansion (rework flagging via Assisted-by segmentation)
7. Then W6 cutover convergence, W7/W8 surfaces, W9 release engineering
8. Debug UI: deferred until post-release usage data justifies it

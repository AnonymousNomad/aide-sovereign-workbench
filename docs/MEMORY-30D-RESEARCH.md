# 30-Day Work Memory — Research & Design Grounding (X1 Helix Memory)

Date: 2026-08-25 · Trigger: contributor request — "any model should be able to remember 30 days back of work in AIDE"

## 1. Contributor ask → formal requirement

Any model served by AIDE (bundled GGUF or BYOK cloud), in any session,
can recall work done up to ~30 days ago: what was built, decided, rejected,
and why — without that content being in the live context window.

Formally: cross-session episodic + semantic memory with a rolling 30-day
detailed window, archive beyond, injected into model context and/or
retrievable via tools.

## 2. Research base (fresh 2026-08-25)

### Architecture landscape (three bets on what remembering means)

| System | Model | Mechanism | License | Local-first |
|---|---|---|---|---|
| Mem0 (~60K★) | Extraction pipeline | LLM extracts candidate facts per message pair → reconcile vs store (ADD/UPDATE/DELETE/NOOP); vector store | Apache-2.0 | Yes (OSS) |
| Letta/MemGPT (~24K★) | Agent runtime w/ tiered memory | Core blocks always-in-context (RAM analogy) + Recall (searchable history) + Archival (vector, tool-paged); agent self-edits via tools | Apache-2.0 | Yes |
| Zep/Graphiti (~28K★) | Temporal knowledge graph | Facts carry valid_at/invalid_at windows; contradictions INVALIDATE not delete (bi-temporal audit trail); graph DB required | Apache-2.0 | Graphiti yes (needs Kuzu/Neo4j) |

Sources: digitalapplied.com comparison (2026-08-04), dev.to agdex_ai (2026-08-04),
plur.ai (2026-07-08), runlocalai.co systems page.

### Sleep-time compute (arXiv:2504.13171, Letta)

Background agent consolidates memory OFF the latency path while primary is
idle. Measured: same accuracy at ~5× less test-time compute; +13–18% accuracy
when scaling sleep-time budget; cost/query drops 2.5× amortized across
multi-query contexts. SWE-Features case study confirms gains at realistic
agentic budgets. **Operational law: consolidation never runs in the turn path.**

### Coding-assistant product surfaces (what competitors actually ship)

| Product | Memory surface | Timeline? | Learned facts? |
|---|---|---|---|
| Claude Code | CLAUDE.md (manual) + Auto Memory: agent-written notes typed user/feedback/project/reference; MEMORY.md index capped at 200 lines/25KB loaded per session | No | Yes |
| Cursor | Rules only (.cursor/rules/) | No | No |
| Windsurf Cascade | Auto-generated memories + rules; workspace-scoped | **Explicitly NO** ("no concept of what you worked on last Tuesday") | Partial |
| ChatGPT | User-profile memory (proprietary) | No | Yes |

Sources: code.claude.com/docs/en/memory, basethread.ai (2026-05-16),
crabtalk.ai survey (2026-03-08), memnexus.ai (2026-02-20).

### Patterns worth stealing (survey consensus)

1. **Dual-store**: inspectable format (markdown) for profiles/preferences +
   searchable store (SQLite FTS/vectors) for episodic/semantic. Inspectability
   builds trust; searchability builds utility.
2. **Pre-compaction flush** (OpenClaw): before trimming context, agent gets an
   explicit turn to extract durable facts — compaction becomes a
   memory-FORMATION event, not a lossy discard.
3. **Profile vs recall separation**: always-loaded identity blocks ≠ searched-
   on-demand knowledge. Conflating them bloats prompts or slows retrieval.
4. **Temporal validity** (Graphiti): superseded facts are marked invalid-at-T,
   never deleted — history stays queryable ("what did we believe in March").
5. **THE production metric is memory-induced hallucination rate** — confident
   assertions about memory that don't match ground truth. Refusal calibration
   ("not in my memory") matters more than recall@k.

### AIDE's structural advantage

Every competitor must LLM-extract facts from chat text because their agents'
work leaves no other trace. AIDE instruments work deterministically:
cipher-state.jsonl (approvals/rejections/preferences), ships.log
(intent→commit latency), .traj.json agent trajectories, git events, chat
history, session state. Our primary extraction source for WORK memory is
structured events, not lossy text summarization. LLM extraction is reserved
for the semantic layer (durable facts/preferences from conversations) where
it runs through harness gates as a bounded classification task.

## 3. Design realization (maps to aide-helix-memory skill)

The existing X1 skill design is validated by this research. This document
adds three concrete policies:

### 3.1 Event sources (deterministic strand)

```
.aide/memory/events.jsonl     # unified, time-indexed work log
  <- cipher-state bus appends (approval/rejection/task/engine events)
  <- ships.log mirrored (ship outcomes)
  <- agent-loop trajectory closes (task start/end/outcome)
  <- git commit hook (intent, message, files)
  <- chat session close (turn count, model used)
```

### 3.2 The 30-day window policy

- **Hot (0–7 days)**: full event detail; day-digests regenerated on idle.
- **Warm (8–30 days)**: day-digests only (deterministic rollup: commits,
  files touched, tasks shipped/approved/rejected, decisions recorded).
- **Archive (>30 days)**: digests compressed to week-rollups; everything
  remains retrievable via memory_search (FTS) and workspace RAG — nothing
  deleted, matching Graphiti's no-delete law.
- Contributor's "remember 30 days back" = warm tier guaranteed injection
  surface + hot detail available on demand.

### 3.3 Injection & recall surfaces

- **Always**: core blocks (project/user/task) sized per helix skill caps,
  composed into the SAME scaffold pipeline chat already uses
  (harness/scaffold.mjs — single discipline source).
- **On demand**: `memory_search(q)` / `memory_timeline(entity, before)` tools
  exposed through the existing agent-tool registry.
- **Session open**: yesterday+today digest line injected (cheap, bounded).

## 4. Sequencing into the roadmap (proposal)

X1 slices, each shippable end-to-end (wired-together law):

1. **X1.a — Event spine**: unified .aide/memory/events.jsonl writer lib +
   adapters from existing emitters; day-digest generator; CLI/route to read
   digest. No model involvement yet. Gate: digest correctness tests.
2. **X1.b — Core blocks + injection**: block store (.aide/memory/blocks/),
   scaffold composition hook, session-open digest injection. Gate: e2e chat
   shows [memory] block; budget caps enforced.
3. **X1.c — Semantic extraction (sleep-time)**: idle-detector → small-model
   extraction of durable facts from recent chat+events → ADD/UPDATE/NOOP
   reconcile → HelixEntry store (SQLite+FTS5, vectors reuse A2 embedder).
   Gate: extraction schema validation + span verification + refusal path.
4. **X1.d — Tools + timeline UI**: memory_search/timeline agent tools;
   MEMORY sheet in cockpit (inspectable, editable — trust law). Gate:
   fixture-conversation recall test from helix skill §Gate.

Dependencies: X1.b needs scaffold hook point (shipped W5/W6 ✓); X1.c needs
idle detection (P7-compatible) + utility-role routing (H2 ✓); storage needs
zero new native deps (offline-rag precedent).

## 5. Explicit non-goals

- No multi-tenant scoping (single-user local product — helix skill pitfall).
- No graph DB dependency (JSONL/SQLite suffice; entity table over graph edges).
- No cloud memory sync in v1 (BYOK continuity lane handles cross-machine later).
- Never delete memories (archive-only decay, Graphiti law).

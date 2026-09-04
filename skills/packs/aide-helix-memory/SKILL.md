# X1 — Helix Memory (essentially-unlimited context for ANY plugged-in model)

Phase skill for AIDE X-series. Master router: aide-master-roadmap. The user's DNA-helix intuition formalized: every memory is a TWO-STRAND entry — FACT strand (the what) fused with PROVENANCE strand (when/where/from-whom/how-confident). One strand without the other is unusable: facts go stale, provenance without content is noise.

Research base (2026, refreshed 2026-08-25): Letta/MemGPT OS-style hierarchy (message buffer / pinned core blocks / recall / archival; sleep-time async compaction; "memory = context engineering"), Mem0 ECAI 2025 (extract->consolidate->retrieve; 91% lower p95 latency vs full-context; multi-signal retrieval: semantic+BM25+entity fused), A-MEM Zettelkasten dynamic linking (new memories trigger evolution of neighbors), REMem (episodic time-aware gists + fact triples grounded to timeline; robust REFUSAL on unanswerable questions), unified-framework paper (4 stages: extraction/management/storage/retrieval; heat-based promotion short->mid->long), MemoryBank forgetting-curve decay. NEW 2026-08-25 grounding (docs/MEMORY-30D-RESEARCH.md): sleep-time compute measured (arXiv:2504.13171 — same accuracy at ~5x less test-time compute, consolidation NEVER in turn path); Graphiti bi-temporal law (valid_at/invalid_at — supersede never delete); Claude Code auto-memory taxonomy (user/feedback/project/reference types, index-file load caps); OpenClaw pre-compaction flush (compaction = memory-FORMATION event); CrabTalk survey dual-store law (inspectable markdown profiles + searchable SQLite episodic/semantic); memory-induced hallucination rate = THE production metric (refusal calibration > recall@k). AIDE structural advantage: work events are captured DETERMINISTICALLY (cipher-state bus, ships.log, .traj.json, git) — extraction from text is the SECONDARY path for semantic facts only.

## Event spine (deterministic strand — added 2026-08-25)

Primary work-memory source is structured events, not chat extraction:
`.aide/memory/events.jsonl` receives appends from cipher-state bus,
ships.log mirror, agent-loop trajectory closes, git commits, and chat
session closes. Day-digests roll up hot window deterministically.
Window policy: HOT 0-7d full detail -> WARM 8-30d day-digests (the
contributor's "remember 30 days back" tier) -> ARCHIVE >30d week-rollups,
all retrievable via FTS/RAG, NOTHING deleted.

## Design (all local, all in .aide/memory/)

### Strands (per entry)
```
HelixEntry { id, fact: string,                    // FACT strand
             provenance: { session_id, ts, source:'user'|'agent'|'tool'|'file',
                           file?:path, span?:[a,b], confidence:0..1,
                           derived_from?:entry_id[] },   // PROVENANCE strand
             entities:string[], links:entry_id[],        // A-MEM linking
             heat:{ accesses, last_access, strength },    // promotion/decay
             state:'active'|'superseded'|'archived', superseded_by? }
```
Contradictions are NEVER deleted (REMem lesson): new entry supersedes old via superseded_by chain — history stays queryable ("what did we believe in March").

### Tiers (MemGPT-shaped, sized for small local models)
1. **Working** = live context window (~2-4k tokens budget for a 7B-class model): current turn + pinned core blocks.
2. **Core blocks** (pinned, agent-editable via tools): `project` (stack, conventions, build cmds), `user` (preferences, name, style), `task` (current objective + open subtasks). Hard caps: project 800 tok, user 400, task 600.
3. **Episodic** (recall): full session logs auto-gisted at session close -> gists + fact-triples with timestamps (REMem style).
4. **Semantic/archival**: distilled facts + code-knowledge, SQLite + vectors (reuses A2 embedder + FTS5). Entity table for entity-match scoring (Mem0 pattern).

### Flow
- **Extraction** (async, sleep-time style after turns/session close): small-model or utility-role run extracts candidate facts w/ provenance spans; dedupe vs existing (hash + embedding sim >0.92 => merge not duplicate).
- **Promotion**: heat score = f(access frequency, recency, explicit pin). Heat above threshold + survived contradiction-checks => migrate episodic -> semantic (MemoryOS-style staged promotion).
- **Decay**: Ebbinghaus-style strength decay; low-heat entries archive (never delete). Archived entries retrievable by explicit deep-search.
- **Retrieval** (per turn): query -> parallel semantic + BM25/FTS + entity-match -> RRF fuse -> top-k under token budget -> inject as `[memory]` block WITH provenance chips ("(from src/auth.ts, Mar 3)"). Model sees sources = calibrated trust.
- **Unlimited-window illusion**: any ctx length handled because working set is bounded; older content always one tool-call away (`memory_search`, `memory_timeline(entity, before)`).

### Tools exposed to ANY model (A1 loop)
`memory_search(q)`, `memory_read(id)`, `memory_pin(entry,block)`, `memory_write(fact, provenance-auto-filled)`, `memory_forget(id)` (soft). Small-model tolerant arg parsing same as A1.

### Honesty integration (Veritas hook)
Retrieval returns `null` cleanly when nothing matches -> orchestrator instructs model: "no memory of this — say so or investigate" (feeds refusal calibration, see veritas-layer skill). Staleness gate: facts older than N days on files that changed since (git mtime check) get `stale:true` flag injected.

## Tests FIRST

1. Round-trip: write 500 synthetic facts across fake sessions -> recall precision@5 >= 0.9 on 20 queries (fixture-scored).
2. Supersession: contradicting fact written -> old marked superseded, timeline query returns BOTH ordered.
3. Promotion/decay simulation: access patterns -> expected tier migrations after virtual clock advance.
4. Budget: assembled prompt never exceeds model ctx - reserve; overflow drops lowest-ranked memory first.
5. Provenance injection: retrieved block carries file/span chips; missing provenance = extraction bug (assert).
6. Staleness: edit file after fact written -> stale flag set.
7. Refusal support: empty-retrieval path produces clean null not hallucinated filler.
8. Perf: retrieval <50ms on 100k entries (FTS5+sqlite realistic scale), extraction async (never blocks turn).
9. Arch tests: routes strict, openapi zero-diff.

## Pitfalls

- Extraction quality IS the system: bad extraction poisons everything — utility-model extraction runs through Veritas gates too (schema + span verification: quoted text must exist in cited file).
- Never let memory writes bypass provenance capture (auto-fill from call site; manual writes require source note).
- RAM discipline: sqlite + vectors on disk, LRU page cache only — no full-index-in-RAM (device-training-1060 doctrine applies).
- Cross-session identity: single-user local product keeps this SIMPLE (one workspace = one scope) — do not import multi-tenant complexity.

## Gate

Unit+arch green; e2e: 30-turn fixture conversation spanning 3 sessions -> model answers question requiring session-1 fact WITHOUT it being in recent context; honesty probe answered "not in my memory" when true. Journal.

## Implementation truth audit (2026-09-03)

The design above is broader than the currently verified implementation. Keep
these distinctions explicit until each gate is demonstrated:

- X1 event ingestion currently reads `.aide/cipher-state.jsonl` and
  `.aide/metrics/ships.log` in `harness/memory-spine.mjs` and writes day
  digests under `.aide/memory/days/`. It does not itself write the documented
  `.aide/memory/events.jsonl` unified file.
- X1.b core blocks are injected by `node/src/routes/chat.ts`, together with a
  recent-work line, but this is not proof of 30-day semantic recall.
- `harness/helix-join.mjs` writes statistical `patterns.jsonl`; its entries
  are not yet full dual-strand `HelixEntry` records with fact, provenance,
  temporal supersession, and entity links.
- `harness/helix-retention.mjs` currently contains only private helper
  functions and no exported rollup operation. Do not claim day-to-month or
  month-to-year retention until a real rollup test passes.
- `node/src/routes/memory.ts` exposes only `/api/memory/digests`; the
  `memory_search`, `memory_read`, timeline, pin, and soft-forget tools/routes
  remain unverified.
- `node/src/services/system-map.mjs` checks `.aide/memory/helix.jsonl`, which
  is not produced by the current spine/join path. Until that probe is changed
  or the file is deliberately introduced, the Helix card must not imply that
  the complete memory subsystem is live.

The next implementation slice is X1.c/X1.d: make the deterministic event
source and digest/semantic store agree on one inspectable schema, implement
archive-only retention, expose bounded recall with provenance, and prove the
30-day cross-session fixture. Never widen README claims before that gate.

# AIDE DNA-Helix Memory - Gap Analysis (Step E of the Memory Sprint)

**Status:** Investigation complete. The helix already exists as **two half-built strands.** The gap is the missing third (the join + the retention policy) and the missing skill that documents the architecture.

**Date:** 2026-08-29
**Author:** T2 (cline/T4)
**Supersedes:** the prior `aide-helix-memory` references in code (which point at a skill that does not exist)

---

## 1. The current state (what the live repo contains)

### Strand A (Episodic) - `harness/memory-spine.mjs` (X1.a)

**File:** `harness/memory-spine.mjs` (142 lines, verified 2026-08-29)
**What it does:**
- Reads two event sources: `.aide/cipher-state.jsonl` (the bus) and `.aide/metrics/ships.log` (the ship intent log)
- Normalizes events to `{ at, kind, detail }` where kind in { `ship`, `approval`, `rejection`, `abort`, `ship_intent` }
- Sorts time-indexed, supports `since`/`until` range queries
- `buildDayDigest(date, events)` rolls up events into per-day JSON digests at `.aide/memory/days/YYYY-MM-DD.json`
- `refreshDayDigests({from, to})` is idempotent - regenerates the digest set for any window
- `listDayDigests({from, to})` lists available digest dates
- The day digest schema: `{ date, ships, files_touched, approvals, rejections, aborts, ship_intents, tools_used, highlights[] }` (highlights capped at 10 x 220 chars)

**What is real:** the spine, the daily rollup, the idempotent refresh.
**What is missing:**
- No automatic refresh (must be called explicitly)
- No LLM-driven summarization (highlights are raw `shipped: <message>` strings, not distilled)
- No semantic linking between days (each day is isolated)
- No retention/TTL (days accumulate forever)
- No semantic search (only `readDayDigest` exact-by-date and `readWorkEvents` time-range)

### Strand B (Semantic) - `harness/memory-blocks.mjs` (X1.b) + `harness/cipher-state.mjs:getPreferences`

**File A:** `harness/memory-blocks.mjs` (78 lines)
- 3 always-in-context blocks at `.aide/memory/blocks/{project,user,task}.md`
- Hard token caps: project 800, user 400, task 600
- `BlockCapError` is thrown at WRITE time if cap exceeded (fail-loud)
- `readBlocks(workspace)` returns `{project, user, task}` (empty string for missing)
- `recentWorkLine(workspace)` returns a single one-line summary of the most recent 1-2 day digests (the "hot window surface")
- `composeMemorySection(blocks, workLine)` composes the `[memory:project] [memory:user] [memory:task] [recent work]` block injected into the system prompt

**File B:** `harness/cipher-state.mjs:getPreferences` (lines 30-50)
- Reads last 500 approvals + 500 rejections
- Extracts `pattern` field, requires minCount=3, approval rate >= 60%
- Returns top 15 patterns as `[learned] <pattern>` strings
- This **IS** the pattern-learning mechanism - already running in the bus

**What is real:** the always-in-context blocks, the pattern extraction, the hard caps, the recent-work line.
**What is missing:**
- Blocks are manually written (no automatic distillation from episodes to patterns)
- The pattern threshold (60% approval, min 3 occurrences) is hardcoded, not configurable
- Patterns only emerge from explicit `approval`/`rejection` events (chat conversations, code approvals) - they don't emerge from the actual content of the work
- No TTL on patterns (a once-true pattern persists forever, even if the user changes their mind)

### The Join (Strand C) - `node/src/services/memory-recall.mjs`

**File:** `node/src/services/memory-recall.mjs` (158 lines)
- Reads `.aide/memory/sessions.jsonl` (one line per chat turn summary)
- BM25-style scoring on per-field term frequencies: `intent 2.0, skills_invoked 3.0, files_touched 2.5, summary 1.0, outcome 1.5`
- IDF computed over the corpus
- Returns top-N (default 5) hits, budget-capped at 800 tokens
- Honest "degraded" return when corpus is empty or query is empty
- `remember(entry)` writes a session summary to the file
- `status()` returns `{count, file, lastTs}`

**What is real:** BM25 retrieval, field-weighted scoring, token-budgeted output.
**What is missing:**
- Sessions are not auto-written (the call site must invoke `remember()` for every turn)
- No bridge from `memory-spine.mjs` day digests to `memory-recall.mjs` sessions
- No cross-strand coordination (the recall engine has no idea the spine exists, the spine has no idea recall exists)
- No evaluation: no test asserts "after 100 turns, asking about turn 73 returns the right context"


---

## 2. The DNA-Helix metaphor, made concrete

The user described the helix as "two strands twisting around each other." Here is the concrete mapping:

```
                    EPISODIC STRAND (memory-spine.mjs)
                   /                                   \
                  /   "what happened"                    \
                 /     raw events -> day digests ->        \
                /      30-day rolling window              \
               /                                           \
              /                                             \
             /          THE JOIN: which episodes become     \
            /           which patterns? (distillation)       \
           /                                                   \
          /                                                     \
         /             SEMANTIC STRAND                       \
        /             (memory-blocks.mjs +                 \
       /             cipher-state getPreferences)       \
      /           "what was learned"                 \
     /          durable patterns, always-in-      \
    /         context blocks, learned prefs     \
   /                                           /
  /                                         /
 /_______________________________________/
                  |
                  v
      THE RECALL LAYER (memory-recall.mjs)
      Top-N hits, budget-capped, injected
      into system prompt as the [memory] block
```

The two strands are not the same thing:
- **Episodic strand** = the diary. "On 2026-08-15 we shipped a fix to the cipher-state bus port collision."
- **Semantic strand** = the wisdom. "When port X is taken, fall back to port X+1; check before binding."

The **join** is the **distillation job** that turns episodes into patterns. Without the join, the diary just grows and the patterns stay shallow.

---

## 3. The gap inventory (what is missing to ship a true DNA-Helix)

### Gap 1: No distillation job (the join is missing)
- Episodes flow into `.aide/memory/days/YYYY-MM-DD.json`
- Patterns emerge from `getPreferences` (approval/rejection only)
- **Nothing turns "we made 5 port-conflict fixes last month" into the pattern "always check port availability before binding."**
- This is the **single biggest gap.**

### Gap 2: No retention/TTL policy
- Day digests accumulate forever
- Sessions.jsonl caps at 500 entries (then rolls over - `MAX_MEMORIES = 500`)
- Patterns never expire
- **No 30-day window. No archive. No "summarize last week" job.**

### Gap 3: No cross-strand coordination
- `memory-spine.mjs` does not write to `sessions.jsonl`
- `memory-recall.mjs` does not read day digests
- `memory-blocks.mjs` is not auto-updated from the spine
- **Three modules, three file formats, no wiring.**

### Gap 4: No test for memory
- `tests/arch/cipher-state-bus.test.ts` exists (the bus)
- **No test for memory-spine, memory-blocks, or memory-recall.**
- **No "100-turn recall" test that proves the helix actually works.**

### Gap 5: The skill file is missing
- Code references `aide-helix-memory` skill in comments
- **No `skills/packs/aide-helix-memory/SKILL.md` exists.**
- The architecture is undocumented outside the code (the doc IS the code, which fails the dual-store law: "human-readable profile + searchable spine lives elsewhere").

### Gap 6: No auto-remember at chat end
- `memory-recall.mjs:remember()` must be called explicitly
- No hook in `agent-loop.mjs` calls it
- **Sessions accumulate only if the developer remembers to call `remember()`.**

### Gap 7: No confidence/TTL on patterns
- A pattern that was true 6 months ago persists forever
- The user changes their mind, but the pattern does not know
- **No "pattern was approved 5 times but the last 2 were rejected" demotion logic.**

### Gap 8: The recent-work line is 2 days
- `recentWorkLine(workspace)` reads the most recent 1-2 day digests
- **The "hot window" is too narrow.** A user returning after a weekend sees "Friday: 3 ships" but the Tuesday context they need is lost.

### Gap 9: No user/project/task context
- The blocks are named project/user/task but the **content is whatever someone wrote there**
- No automatic extraction: "this project uses vitest" should be detected from package.json + prior chat, not manually written

### Gap 10: No embedding-based fallback
- BM25 is honest, but for semantic-similar queries (e.g. "the bug from last week that crashed the dev server") it can miss
- The current "no heavy embedding dependency" stance is correct for v0.1, but v0.2 should add an optional embedding-based recall as a fallback


---

## 4. The 30-day memory contract (what the user asked for, made concrete)

The user said: "30 day or the memory at least 30 day of context." Here is the contract:

### Episodic contract
- **Day 1-30:** full day digests at `.aide/memory/days/YYYY-MM-DD.json`, all fields populated
- **Day 31-365:** monthly summaries at `.aide/memory/months/YYYY-MM.json`, distilled from the day digests
- **Day 366+:** yearly summaries at `.aide/memory/years/YYYY.json`, distilled from the monthly summaries
- **No data is deleted.** It just rolls up.

### Semantic contract
- **Patterns** live forever at `.aide/memory/patterns.jsonl`
- **Each pattern** has `{ id, text, created_at, last_seen_at, evidence_count, approval_count, rejection_count, status: 'active' | 'demoted' | 'archived' }`
- **Demotion** triggers when: rejection_count >= 3 AND last_rejection_at is more recent than last_approval_at
- **Archived** patterns are not injected but are searchable

### Block contract
- **Project block:** current project, current stack, current tests, current conventions
- **User block:** user's name, user's preferences, user's tooling, user's timezone
- **Task block:** current task, current workflow, current SOP in use
- **All 3 are auto-updated** by a `refresh-blocks` job that runs after every chat session (not manually written)

### Recall contract
- **Every chat turn** = a top-N (default 5) recall + the always-in-context blocks + the recent-work line + the [memory] section
- **Token budget** = 800 (recall) + 1800 (blocks) + 200 (recent work) = 2800 tokens total for memory
- **On the model's own 30K context**, this is ~9% - leaves 91% for the actual task

---

## 5. The architecture (what we need to build)

### Phase 1 (Week 1): Wire the existing pieces
- Add `harness/helix-join.mjs` - the distillation job. Reads day digests, extracts patterns via:
  - LLM-driven pattern extraction (using the in-house model, 1 call per day, 200-token output)
  - Statistical extraction (tools_used patterns, repeated file paths, repeated skill sequences)
- Add `harness/helix-retention.mjs` - the rollup. Day 31 -> monthly, Day 366 -> yearly.
- Wire `agent-loop.mjs` to call `remember()` at end of every turn
- Wire `agent-loop.mjs` to call `recall()` at start of every turn
- Update `composeMemorySection` to include the rolled-up monthly summary when available

### Phase 2 (Week 1): Write the skill
- `skills/packs/aide-helix-memory/SKILL.md` - the architecture doc that lives in the skill catalog
- Includes the diagrams, the contracts, the gap analysis (this file), and the 30-day retention policy
- Cross-references `aide-cipher-living-system`, `aide-cipher-state`, `aide-context-retrieval-wiring`

### Phase 3 (Week 1): Add the test
- `tests/real/memory-helix-recall.test.ts` - the 100-turn memory test
- Spawns the in-house model, runs 100 turns over simulated 30 days, asserts recall accuracy
- This is the **single most important test in the project.** If this passes, the helix works. If this fails, the helix is aspirational.

### Phase 4 (Week 2): Add embedding-based recall
- Optional embedding model (e.g., all-MiniLM-L6-v2, 22 MB) for the recall engine
- Hybrid scoring: 0.7 x BM25 + 0.3 x cosine similarity
- Falls back to pure BM25 if embedding model not present

### Phase 5 (Week 2): Add pattern demotion
- `harness/helix-pattern-manager.mjs` - reads `patterns.jsonl`, applies demotion rules, writes back
- Runs nightly, logs demotions to cipher-state bus

---

## 7. What is already in main that I leveraged for this analysis

| File | Lines | Role |
|---|---|---|
| `harness/memory-blocks.mjs` | 78 | Strand B (semantic) - always-in-context blocks |
| `harness/memory-spine.mjs` | 142 | Strand A (episodic) - day digest rollups |
| `harness/cipher-state.mjs` | 53 | The bus - event log + getPreferences pattern learning |
| `harness/cipher-state.d.mts` | 17 | TypeScript types for the bus |
| `node/src/services/memory-recall.mjs` | 158 | The join - BM25 recall over sessions |
| `tests/arch/cipher-state-bus.test.ts` | (existing) | Bus test (the only memory-related test) |

**The helix is 2/3 built. The join is missing. The retention is missing. The tests are missing. The skill is missing.**

---

## 8. Next steps (per the closed loop)

Per the user "lets do it" directive, the next step is to **build the join + write the skill + write the test.** That is a single week of work.

**Step 1 (today):** Author `skills/packs/aide-helix-memory/SKILL.md` - the architecture doc that lives in the skill catalog. This makes the helix a first-class concept in AIDE, not just code in the harness.

**Step 2 (today):** Author `harness/helix-join.mjs` - the distillation job. Deterministic (no LLM dependency for the first version) - uses statistical extraction (tools_used patterns, repeated file paths, repeated skill sequences).

**Step 3 (today):** Author `harness/helix-retention.mjs` - the day 31 rollup. Pure file IO, no LLM.

**Step 4 (today):** Wire `agent-loop.mjs` to call `recall()` and `remember()` per turn.

**Step 5 (today):** Write `tests/arch/memory-helix-recall.test.ts` - the 100-turn test. The proof.

**Step 6 (tomorrow):** Add the LLM-driven pattern extraction (1 call per day, 200-token output, costs 1 in-house model call per day per active project).

**Step 7 (next sprint):** Add embedding-based recall as a v0.2 enhancement.

---

## 9. Files of record

- This document: `docs/MEMORY-ARCHITECTURE-DNA-HELIX.md` (the gap analysis)
- The architecture doc: `skills/packs/aide-helix-memory/SKILL.md` (to be written next)
- The distillation: `harness/helix-join.mjs` (to be written next)
- The retention: `harness/helix-retention.mjs` (to be written next)
- The proof: `tests/arch/memory-helix-recall.test.ts` (to be written next)
- The wiring: `node/src/services/agent-loop.mjs` (existing, to be patched)

via skill: aide-helix-memory (to be created), aide-debugging-discipline, project-governance, professional-developer, verify-first-discipline

- The `[learned]` lines injected into the prompt are now `active` patterns only

---

## 6. Success criteria (how we know the helix works)

### Real-task verification (not smoke)

| Test | Pass criteria |
|---|---|
| 100-turn recall test | After 100 simulated turns over 30 days, the model correctly recalls at least 80% of "what did we decide about X on day N" questions |
| Day 31 retention | On day 31, the day digests roll up to a monthly summary; querying "what did we do this month" returns the summary |
| Pattern emergence | After 5 occurrences of the same tool+outcome, a pattern appears in `[learned]` injection |
| Pattern demotion | After 3 rejections, a pattern moves from `active` to `demoted` and stops being injected |
| Cross-strand wiring | `agent-loop.mjs` calls `recall()` at start of every turn, `remember()` at end |
| Block auto-refresh | After a chat session, the user/task blocks reflect the session content |

### Performance budget
- Recall latency: < 50ms (BM25 over 500 entries is fast)
- Block load latency: < 10ms (3 file reads)
- Compose latency: < 5ms (string concat)
- Total memory section build: < 100ms - invisible to the user
- Total tokens: < 2800 (recall 800 + blocks 1800 + recent work 200)

- **The model always sees memory. Always.** No opt-in. No "memory disabled" flag.

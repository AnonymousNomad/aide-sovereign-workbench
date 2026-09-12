# Memory / Project Brain / RAG Audit

## Separate stores and paths

| Category | Store / owner | Writes | Production reads / status |
|---|---|---|---|
| Conversation | .aide/chat-history.json / ChatStore | browser history save/import | browser history list; in-memory cache; LIVE |
| Agent session | AgentLoop sessions Map / transcript | loop turns/state | status/list/handoff; persistence only terminal trajectory; PARTIAL |
| Recalled sessions | .aide/memory/sessions.jsonl / memory-recall | chat-history save | non-stream chat, not normal streaming or agent; PARTIAL |
| Pinned project/user/task | .aide/memory/blocks/*.md | writeBlock utility | non-stream chat; no canonical fact schema/provenance; PARTIAL |
| Preferences | cipher-state approval/rejection patterns | agent decisions | non-stream/legacy chat getPreferences; advisory only |
| Project retrieval | .aide/index manifest/chunks/vectors | index-service reindex | non-stream chat hybridSearch; tools search separately via rg |
| Day digests | memory-spine from cipher-state + ships | explicit digest and refresh-on-read | memory routes/recent work; LIVE side effects on GET |
| Helix patterns | patterns.jsonl | helix-join.refresh | listActive found only as definition/test consumer, no production injection |
| Month/year retention | Helix rollup files | cascade | summary utilities/status, not demonstrated model recall |
| Replay/handoff | trajectories + .aide/handoff | agent terminal/export/import | export/list/get; no resume-with-import path into agent found |

Sources: [recall](../../../node/src/services/memory-recall.mjs), [chat write/read](../../../node/src/routes/chat.ts), [memory routes](../../../node/src/routes/memory.ts), [blocks](../../../harness/memory-blocks.mjs), [spine](../../../harness/memory-spine.mjs), [Helix](../../../harness/helix-join.mjs), [index](../../../node/src/services/index-service.mjs).

## Proven defects and truth risks

- loadMemories reads from the start and stops at 500. A pure mocked-file probe with 501 entries returned count=500 and omitted the unique newest fact, while recall reported degraded:false.
- History save extracts user prose into summary and assistant prose into outcome. File-name regex hits become files_touched without tool evidence. These are observations of conversation, not verified project facts.
- Recalled records have timestamps and session IDs but no repository revision, file hashes, verified/unverified classification, expiry or supersession. No code enforces current repository truth over memory.
- Both repository snippets and recalled “DATA only” blocks are inserted with role:system; the comment claiming non-system data disagrees with code. Delimiters are advisory text, not a trust boundary.
- memoryRecall is a module-level singleton created for the first workspace. Multiple route builders in one process could share it incorrectly. Normal current server uses one workspace; cross-workspace leak not live-probed.
- Pinned block caps are checked only through writeBlock. readBlocks trusts files edited by other writers, permitting overbudget injection. No read-time cap or revision validation.
- digest() starts Helix cascade before awaiting day digest refresh; listDigests() orders refresh first. Promise.race does not cancel timed-out writes. Pattern/rollup freshness cannot be inferred from a successful digest response.
- Approval affinity is tool-level frequency, not validated methodology success. Helix allocates total daily approval counts to tool counts heuristically, so per-tool affinity can be misleading.

## Project Brain specifics

Index persists actual chunk bodies in chunks.json, contrary to the chat comment “no file contents in the index.” It can use lexical BM25 without embeddings, and later combines dense results with rank fusion. Scans skip common generated directories and non-file symlinks; no gitignore/secret-specific file exclusion is present. Files such as .env can be indexed.

Restored index lacks an immediate current-branch/content reconciliation. A watcher schedules reindex on file changes; reads use current file contents at old line windows, so stale offsets/header metadata can retrieve wrong snippets. During reindex partial docs/vectors can be in transition. Final reads use lexical resolveInsideWorkspace rather than ensureRealInsideWorkspace; link replacement after indexing is an untested path-containment risk.

AIDE_EMBEDDINGS_URL, when set, receives indexed text through fetch without the BYOK consent authority, network ledger or per-batch timeout. Default without the variable is lexical-only. No outbound embedding was run.

## Retention and contamination

Several bounded result APIs still read entire growing files. Memory event readers swallow unreadable/corrupt records into empty results, which can appear healthy. Agent terminal digests approvals and shipping events but not a rich verified-solution record. Failed verification is emitted with passed:false even when verification is simply unavailable; selfimprove's broad failure classifier can label missing infrastructure as model rejection/training signal.

Future memory must classify facts, preferences, decisions, failures and verified solutions separately; attach provenance and revision; detect supersession; validate files at retrieval time; preserve instructions/task priority under context pressure; and record why a memory was recalled. Do not replace the stores wholesale before migration evidence.


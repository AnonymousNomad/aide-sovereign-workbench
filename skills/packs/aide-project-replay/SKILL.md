---
name: aide-project-replay
description: Project provenance and replay system — captures the full cognitive history of every build (intent, decisions, model handoffs, approvals, rejections, gate results) as a queryable timeline. V1 = structured capture (already flowing via ships.log and provenance JSONL). V2 = narrative renderer with search/filter/jump. Use when designing provenance schemas, building replay UI, or answering 'show me how this was built'.
---

# Project Replay — Full Build Provenance

Every AIDE-built feature has a complete audit trail: why it was built, which
model proposed it, what gates verified it, who approved it, what changed.
Not git history (what changed) — process history (how and why).

## Capture (v1 — already flowing)

Sources feeding .aide/provenance/{workspace}.jsonl:
- Phase transitions: {at, from_phase, to_phase, model_id, intent_hash}
- Gate results: {gate, passed, details}
- Approvals/rejections: {approval_id, tool, decision, user_at}
- Model handoffs: {from_engine, to_engine, reason, context_summary_tokens}
- Ship events: {commit_sha, message, files_count, assisted_by}

## Query API

GET /api/provenance/timeline?from=&to=&phase=&model=
GET /api/provenance/decisions?rejected=true
GET /api/provenance/gates?failed_only=true
Returns structured timeline entries for replay rendering.

## Replay Renderer (v2 — after v1 ships)

Scrollable narrative: each entry rendered as a timeline card showing phase,
model badge, decision type, diff summary, gate outcome. Filters: by phase,
by model, by approval status, by date range. Export: standalone HTML file
(self-contained, shareable).

## Why this matters (funder + user story)

- Compliance: "Show me exactly how this auth module was built"
- Learning: new team members replay complex builds instead of reading docs
- Debugging: find where an assumption failed during the original build
- Trust: AIDE decisions are transparent, not black-box
- Unique: no competitor offers build-process provenance (only git result-history)

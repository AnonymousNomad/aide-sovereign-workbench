---
name: cite-the-source
version: 1.0.0
category: discipline
applies_to:
  - cite
  - source
  - reference
  - provenance
tools_required:
  - read_file
  - search
sop: |
  1. When stating a fact, cite the file:line where the fact was found.
  2. When recommending a change, cite the prior code that motivates the change.
  3. When disagreeing with a prior decision, cite the prior decision and the new evidence.
  4. When the operator asks "where did you get that?", the answer is a path and a line, not "from the codebase."
  5. Provenance is recorded in the trajectory: which files were read, which commits were referenced, which decisions were reversed.
description: |
  Universal SOP: cite your sources. Every fact, every recommendation, every
  disagreement comes with a file:line. The cockpit already shows
  provenance source-ref links (operator commit `7d4fe03`). The chassis
  extends this with trajectory-level provenance so the operator can audit
  every claim.
failure_modes:
  - condition: model claims a fact without citing the file:line
    recovery: "verify-before-claiming" SOP applies; the claim must be backed
  - condition: model recommends a change without showing the prior code
    recovery: the bundle card should show the prior code inline
  - condition: model disagrees with a prior decision without evidence
    recovery: surface the disagreement in the bundle card
success_metrics:
  - unbacked-claims: zero
  - cited-references-per-response: at least 1
---

# Cite the Source

Every fact, every recommendation, every disagreement comes with a file:line.
The operator can audit every claim. The bundle card carries the
provenance chain so the operator can see "why this skill was picked"
and "what the model saw."

## Why this SOP exists

The credo line 32: "Carry the work forward. Make changes reviewable,
reversible, documented, and usable by the next developer." Provenance
is what makes the work reviewable. The 2026 Anthropic research on
context engineering names "provenance chips" as a critical differentiator
for agent IDEs.

---
name: aide-rseries-refactor
description: R-series cockpit milestones — Rename Symbol (F2) with previewed multi-file apply via LSP workspace edits, Find All References view, and format-document/on-save. Research-grounded priorities (rename = #1 refactor at 85.8% adoption; preview+undo drives trust). Use when implementing editor refactoring, references view, or formatter wiring in the AIDE cockpit.
---

# R-Series — Refactoring & Navigation Depth

Anchored in evidence: Golubev et al. 2021 ("One Thousand and One Stories",
1,167 devs): Rename is THE universal refactoring — 85.8% used the IDE tool,
65.7% regularly; Extract 54.7%; trust comes from PREVIEW + UNDO. Identifier
names are >70% of source characters (ACM renaming survey). Maintenance work =
23.7% of editor time (FlouState), so these are daily-driver features.

## R1 — Rename Symbol (F2)

Flow: F2 on identifier -> LSP prepareRename (validates span, returns placeholder)
-> inline input -> textDocument/rename -> WorkspaceEdit {changes: {uri: [edits]}}
-> PREVIEW CARD listing files + edit counts -> operator approves -> daemon writes
each file via the jailed file-write contract (approved:true, one call per file,
sequential) -> open changed files refreshed -> git diff available for review ->
UNDO guidance = git checkout -- (uncommitted) or checkpoint slice later.

Rules:
- NEVER apply a rename silently. The preview card IS the product (trust research).
- Apply sequentially; abort on first write failure and report exactly which
  files already changed (partial-rename honesty).
- Files not currently open get read-modify-write via the file contract;
  open Monaco models for touched paths are re-fetched after apply.
- Version bump every didChange after external rewrite so tsserver resyncs.

Pitfalls: tsserver rename returns URIs as file:///workspace/<rel> — map back to
relative paths by stripping that exact prefix only; ranges are 0-based ->
convert (+1) when applying line/col edits manually; reject renames whose edit
uris escape /workspace prefix (path jail).

## R2 — Find All References

textDocument/references (includeDeclaration:false) -> grouped results view
(reuse search-hit renderer: file groups, L:line, click jumps). Empty state:
"no references" is a valid result, not an error. Cap render at 100 refs with
count overflow note. Bind to Shift+F12 (VS Code grammar).

## R3 — Format document + optional on-save

v0: Monaco built-in format action for JSON/HTML/CSS; for TS/JS call
textDocument/formatting via LSP request, apply returned TextEdits to the model
(monaco applyEdits with +1 conversions). On-save toggle lives in the MODELS
panel tuning area (localStorage 'aide.format_on_save', default OFF — never
reformat a whole file implicitly without opt-in; research: unexpected
whole-file diffs destroy diff review).

## Dependencies

Existing: lsp start/notify/request routes; file read/write contracts; search-hit
renderer for R2 grouping; SHIP panel for post-rename review. New: none — zero
new dependencies, zero new routes.

## Threats

| Threat | Control |
|---|---|
| Model-injected rename targets (agent asks F2 flow to rewrite arbitrary paths) | R1 is OPERATOR-initiated only (F2 key); agent path keeps its own approval gates; uri jail enforced |
| Partial multi-file rename leaves tree inconsistent | sequential apply + first-failure abort report + git diff review before commit |
| Formatter reformats unrelated code (whole-file churn) | default OFF; document that enabling creates one-time normalization diff |

## Gates

1. Unit: rename-edit mapping (uri strip, range conversion, per-file grouping)
   table-driven; partial-failure reporting order preserved.
2. Live round-trip on a scratch TS project: rename a function referenced in a
   second file -> preview lists both -> approve -> both files updated ->
   hover shows new name -> git diff shows exactly two files.
3. References view returns >=1 hit on a known symbol and empty-state renders.
4. Format-on-save OFF by default verified; ON produces stable idempotent output.

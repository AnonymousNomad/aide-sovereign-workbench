---
name: minimal-diff
version: 1.0.0
category: discipline
applies_to:
  - diff
  - minimal
  - change
  - refactor
tools_required:
  - write_file
  - bash
sop: |
  1. Make the smallest change that satisfies the request.
  2. Do not refactor unrelated code; that is a separate task.
  3. Do not add comments that restate the code.
  4. Do not add blank lines to unrelated code.
  5. Do not change formatting outside the diff.
  6. The diff should be reviewable in 5 minutes by a human.
description: |
  Universal SOP: minimal diff. The credo line 30: "Finish the procedure.
  Follow the task SOP, record the result, and stop when a gate fails."
  Minimal diffs are reviewable. Large diffs hide bugs. The agent loop's
  write_file tool writes the entire new file content; the model should
  rewrite only the changed sections, not regenerate the file.
failure_modes:
  - condition: model rewrites the entire file when only one function changed
    recovery: minimal-diff principle; rewrite only the changed section
  - condition: model adds unrelated formatting changes
    recovery: the diff should be reviewable; unrelated changes are noise
  - condition: model adds comments that restate the code
    recovery: comments should explain why, not what
success_metrics:
  - diff-size-per-task: should be small (typical < 50 lines for a refactor)
  - unrelated-changes: zero
---

# Minimal Diff

The smallest change that satisfies the request. The diff should be
reviewable in 5 minutes by a human. Refactors are separate tasks.

## Why this SOP exists

The credo line 22: "A forge turns raw material into reliable tools. Code
is shaped through small diffs, format checks, typechecks, tests, and
review." Small diffs are reviewable. Large diffs hide bugs. The 2026
Anthropic research on context engineering values minimal diff as a
defining property of safe agents.

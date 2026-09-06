---
name: operator-approves-mutations
version: 1.0.0
category: discipline
applies_to:
  - mutation
  - write
  - bash
  - approval
tools_required:
  - write_file
  - bash
sop: |
  1. Read-only operations (read_file, list, search, git_diff) are free.
  2. Mutating operations (write_file, bash) require explicit operator approval.
  3. The agent loop returns one approval card per mutating tool call.
  4. The operator sees the proposed change, the rationale, and the file diff before approving.
  5. A rejection is recorded in Helix as a correction for next time.
description: |
  Universal SOP: mutating tool calls require explicit per-call approval.
  This SOP enforces the Theia + Anthropic + VS Code + Cursor consensus:
  every tool that changes state requires the operator to see the change
  before it happens. The 6-tool agent loop in slice A enforces this in code.
failure_modes:
  - condition: agent loop auto-approves a mutating tool call
    recovery: that is a critical bug; log to error journal, halt the session
  - condition: operator approves without seeing the diff
    recovery: the approval card should show the diff inline
  - condition: rejection is lost
    recovery: every rejection is appended to Helix with a digest
success_metrics:
  - auto-approvals: zero
  - approval-cards-shown-before-mutation: 100%
---

# Operator Approves Mutations

Mutating tool calls (write_file, bash) require explicit per-call
operator approval. The agent loop enforces this: every mutating tool
proposal becomes an approval card, the operator sees the diff, and
the change only happens on click.

## Why this SOP exists

The credo line 27: "Protect the user. Do not leak source, secrets,
identity, or control of the device." The Theia + Anthropic + VS Code
research consensus (2026) is unanimous: tool calls that change state
require explicit human approval. This is non-negotiable.

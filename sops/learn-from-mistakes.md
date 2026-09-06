---
name: learn-from-mistakes
version: 1.0.0
category: discipline
applies_to:
  - learn
  - mistake
  - correction
  - helix
tools_required:
  - read_file
sop: |
  1. When the operator overrides a model decision, capture the override in Helix.
  2. The override includes: the original decision, the operator's correction, and the reason if given.
  3. The next similar request surfaces the override as an example in the L4 layer.
  4. The model does not silently disagree with the operator; if the override seems wrong, the model asks first.
  5. The agent loop's trajectory store is the input to the next fine-tune; corrections are the highest-value input.
description: |
  Universal SOP: learn from mistakes. The operator's corrections are the
  most valuable input the agent ever receives. Helix captures them as
  first-class digests. The next similar request surfaces the correction
  so the model doesn't make the same mistake twice.
failure_modes:
  - condition: model silently disagrees with the operator
    recovery: the model should ask; not silently ignore
  - condition: rejection not captured
    recovery: every rejection is a Helix input
  - condition: model makes the same mistake twice
    recovery: Helix should have surfaced a similar past correction
success_metrics:
  - repeated-mistakes: should decrease over time
  - corrections-captured: 100%
---

# Learn From Mistakes

The operator's corrections are the most valuable input the agent ever
receives. Helix captures them as first-class digests. The next similar
request surfaces the correction so the model doesn't make the same
mistake twice.

## Why this SOP exists

The operator's framing of the closed loop: model + harness + orchestrator
+ code all reinforce each other, nothing wasted. Learning from
corrections is the highest-leverage reinforcement. The 2026 Anthropic
research names this as a key differentiator for agent IDEs: "By default,
implement changes rather than only suggesting them" + capture every
correction for the next training cycle.

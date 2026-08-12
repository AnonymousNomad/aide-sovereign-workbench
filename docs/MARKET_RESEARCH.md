# AIDE Market Research

This document records why AIDE features are prioritized. It is deliberately
evidence-first and does not claim to beat existing IDEs without benchmark data.

## Sources

- VS Code product and workbench: https://code.visualstudio.com/docs/editor/whyvscode
- VS Code agents and trust: https://code.visualstudio.com/docs/agents/overview
- VS Code workbench UX: https://code.visualstudio.com/api/ux-guidelines/overview
- VS Code Source Control: https://code.visualstudio.com/docs/sourcecontrol/overview
- JetBrains AI: https://www.jetbrains.com/ai/
- Cursor agent workflow: https://www.cursor.com/features
- Zed agentic editing and ACP/MCP: https://zed.dev/ai
- GitHub repository best practices: https://docs.github.com/en/repositories/creating-and-managing-repositories/best-practices-for-repositories
- Open Source Guides: https://opensource.guide/starting-a-project/
- Stack Overflow Developer Survey 2025: https://survey.stackoverflow.co/2025/

## Signals

The 2025 Stack Overflow survey reports VS Code at 75.9% among listed developer
environments. It also reports 66% frustration with AI output that is almost
right, 45.2% frustration debugging generated code, more developers distrusting
AI accuracy than trusting it, and privacy/security as the top reason developers
reject technology.

## Unmet Opportunity

Existing products are strong in different areas: VS Code has ecosystem depth,
JetBrains has language intelligence, Cursor and Windsurf have polished agentic
workflows, and Zed has native speed plus open agent protocols. AIDE should not
copy them. It can combine the gaps into one measurable niche:

- Offline-first operation with no mandatory account or cloud dependency.
- Model-agnostic operator harness with clear Ask, Plan, and Agent modes.
- Evidence ledger for context, tools, approvals, tests, and limitations.
- Reversible artifacts and reproducible task capsules.
- Low-resource/ARM mode with measured memory and latency.
- Integrated GitHub-style repository, issue, review, release, and community flow.
- Tutor Mode that teaches through the same real files, tests, diagnostics, and
  Git review used by professional developers.
- Plugin system with capabilities, trust history, isolation, and scaffolding.
- One simple installer and one first-run path.
- Provider-neutral mode: local runtime by default, optional user-configured
  subscriptions and OpenAI-compatible endpoints when explicitly enabled.

## Adoption Tests

- New user reaches a real local chat in under five minutes.
- New user opens a repository, runs a task, reviews a diff, and reverts it.
- A model-generated patch passes structural validation and project tests.
- A user can explain exactly what the model saw and did from the audit artifact.
- A contributor scaffolds a plugin without loading code into the UI process.
- A clean install succeeds without reading internal project history.

The product should publish these measurements, screenshots of working flows, raw
benchmark results, limitations, and checksums. Philosophy is internal
engineering discipline; evidence is the public product message.

## Hybrid Provider Boundary

AIDE should not force a false choice between privacy and capability. The local
provider is the default and must work without an account. Optional providers are
server-side adapters selected by the user, show configured/unconfigured state,
read credentials only from environment or OS secret storage, and never write
keys to workspace files, chat logs, audit artifacts, or Git. Provider requests
must show the network boundary and the user must explicitly enable online mode.

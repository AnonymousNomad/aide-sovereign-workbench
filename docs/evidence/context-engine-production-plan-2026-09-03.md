# AIDE Context Engine Production Plan

Status: research and source audit, 2026-09-03

This document defines the product boundary for the AIDE context engine. It is
not a claim that the complete system is implemented. Each item below stays
open until the cited battery and a real user workflow prove it.

## Product Thesis

AIDE should be a context-and-verification engine wrapped in an IDE:

```text
intent
  -> phase and risk detection
  -> bounded context plan
  -> skills, workspace facts, memory, and model selection
  -> human-approved tool work
  -> sandbox or real-task verification
  -> evidence, provenance, and learned outcome
```

The model is replaceable cognition. AIDE owns context assembly, authority,
tool access, verification, recovery, and the durable record of what happened.
That is the product advantage we can measure without claiming that every model
is universally improved.

## Research Findings

The following mechanisms are documented by the vendors or standards we checked:

- VS Code documents Agent Skills as portable `SKILL.md` packages with metadata,
  progressive loading, automatic relevance invocation, supporting resources,
  agent sessions, tools, approvals, review/revert, memory, subagents, hooks,
  and MCP. Source: <https://code.visualstudio.com/docs/copilot/customization/agent-skills>
  and <https://code.visualstudio.com/docs/copilot/chat/chat-agent-mode>.
- Cursor documents a separate Plan Mode that asks questions, researches the
  codebase, creates a reviewable plan, and only then builds. Its subagents use
  isolated context and can run in foreground or background. Sources:
  <https://cursor.com/docs/agent/plan-mode> and
  <https://cursor.com/docs/subagents>.
- Cline documents Plan/Act separation, retained context across the switch, and
  checkpoints that preserve conversation while reverting file changes. Sources:
  <https://docs.cline.bot/core-workflows/plan-and-act> and
  <https://docs.cline.bot/core-workflows/checkpoints>.
- Devin documents repo-committed skills for repeatable procedures, automatic
  skill suggestions, and the distinction between automatically invoked Skills
  and manually invoked Workflows. Sources:
  <https://docs.devin.ai/product-guides/skills> and
  <https://docs.devin.ai/desktop/cascade/workflows>.
- The existing `creed.md` product uses a personal context profile, MCP access,
  reviewable updates, and agent connections. Source: <https://creed.md/>.
  This validates the context problem and is also why `Creed` should remain an
  internal AIDE doctrine name rather than the public product name.
- OpenCode documents primary Plan/Build agents, read-only planning, subagents,
  and per-tool `ask`/`allow`/`deny` permissions. Source:
  <https://opencode.ai/docs/agents/>.
- The Agent Skills convention requires a matching directory/name and a
  `SKILL.md` frontmatter contract. AIDE must ship portable project skills, not
  depend on one developer's absolute home directory.

These are patterns to implement and verify, not proof that AIDE already has
their complete behavior.

## Canonical Context Object

Every model call in the production agent path should receive a bounded,
versioned context pack assembled by the daemon. The pack should contain:

```text
ContextPack {
  version,
  request_id,
  session_id,
  intent: { text, task_family, phase, risk, confidence },
  workspace: { root, branch, dirty_files, detected_commands },
  constraints: { offline, approval_required, allowed_tools, max_steps },
  skills: [{ name, description, source, selected_reason, body_bytes }],
  memory: [{ id, fact, provenance, stale, score }],
  model: { id, role, served_context, fit, measured_speed },
  evidence: [{ kind, ref, status }]
}
```

Rules:

1. Deterministic sources are preferred: contracts, Git state, file metadata,
   model manifest, measured benchmark records, and approved memory entries.
2. Workspace text, model output, retrieved web content, and skill text are
   untrusted data until the harness classifies them; none may silently change
   authority or permissions.
3. Every injected item carries a source or an explicit `source: unknown`.
4. The pack has a hard byte/token budget derived from the served model context;
   it reports dropped items rather than silently overflowing.
5. The same `ContextPack` digest is recorded with the request, trajectory,
   verification result, and any handoff.
6. Core safety and approval rules are deterministic code. Prompt prose is
   guidance, never the enforcement layer.

## Context Engine Layers

### 1. Intake and Phase Detection

Detect `describe`, `plan`, `build`, `debug`, `test`, `review`, and `ship` using
the request plus tool-result signals. Show the detected phase and confidence.
Ask structured clarifying questions before planning when scope or constraints
are ambiguous. Do not make the user restate the same context after a handoff.

### 2. Context Planning

Select only the sources needed for this phase:

- Plan: intent, workspace map, relevant skill descriptions, constraints, and
  prior decisions.
- Build: approved plan, exact target files, format contract, and relevant SOP
  body; omit research narration.
- Review: diff, acceptance criteria, tool log, and fresh test results.
- Ship: gate results, artifact hashes, and release summary only.

This is adaptive compression, not a larger permanent system prompt.

### 3. Progressive Skills

The registry should expose names/descriptions first and load full `SKILL.md`
only for selected skills. Selection must search, in order:

1. project-local `skills/packs` and any supported `.agents/skills` paths;
2. configured user skill roots;
3. no absolute developer-specific path assumptions.

Each loaded skill is capped, version-stamped, and included in the context-pack
digest. Skills may recommend commands, but the project configuration and human
approval determine what can execute.

### 4. Memory and Retrieval

Helix needs one inspectable event schema with fact and provenance strands,
supersession instead of deletion, bounded recall, stale flags, and archive-only
retention. Retrieval must return `null` honestly when no evidence matches.
Sleep-time extraction must never block the active turn and must pass the same
schema/provenance gates as any other generated artifact.

### 5. Model and Tool Policy

Select a model by task family, measured device fit, served context, and learned
outcomes. Keep local inference the default. BYOK is a separate explicit path
with a visible egress summary and journal entry. Tool permissions, sandbox
scope, approval, and process limits are resolved before the model can call a
mutating tool.

### 6. Verification and Recovery

Model proposals are not changes. The daemon should materialize a scratch copy,
apply the proposal, run commands selected from project configuration, return
the raw failure tail on failure, and retry only within a bounded budget. A
human approves only a verified or honestly failed diff. Checkpoints, recovery,
and session handoff preserve the conversation without silently applying work.

### 7. Learning Without Poisoning

Capture `{task_family, phase, model_id, context_digest, tool_outcome,
verification, approval, ship_result}` locally. Promote a model, skill, memory,
or adapter only after paired baseline evidence and regression floors pass.
Failed or unverified trajectories never enter training data. No per-request
self-modifying weights are claimed; prompt/context changes are immediate,
adapter/model changes are gated releases.

## Competitor-Grounded Acceptance Bar

| Surface | Existing practice observed | AIDE requirement | Proof required |
| --- | --- | --- | --- |
| Plan before action | VS Code, Cursor, Cline | Plan card with questions, constraints, files, risks, and approval | Real multi-file task shows no mutation before approval |
| Skills | VS Code, Cursor, Windsurf/Devin | Progressive, portable, project-local skills with automatic selection | Context-pack test shows selected names, byte budget, and source paths |
| Rules and permissions | Cursor, OpenCode, Cline | Human authority plus deterministic per-tool approval and capability scopes | Adversarial tool/egress battery has zero unapproved side effects |
| Subagents | VS Code, Cursor, Cline, OpenCode | Isolated read-only research first; explicit delegation and result handoff | Parent/child session test with bounded context and cleanup |
| Checkpoints/review | VS Code, Cline, Cursor | Diff preview, scratch verification, atomic apply, revert | Real repository task proves pass, fail, retry, revert |
| Memory | VS Code, Windsurf/Devin, Cline Memory Bank | Inspectable local memory with provenance, staleness, supersession, and recall | Three-session fixture recalls a verified fact and refuses an absent one |
| Model choice | Cursor and VS Code model/agent selection | Local/BYOK role routing plus device-fit and measured-speed evidence | Recommendation and handoff battery through the actual facade |
| Tools/protocols | VS Code/Theia MCP, LSP, DAP | Local MCP/LSP/DAP peers with capability and lifecycle gates | Protocol lifecycle, denial, cleanup, and offline battery |
| Onboarding | Vendor quickstarts and walkthroughs | Checklist advances from real completion, never click-through | Clean-profile setup reaches first file, task, verified diff, and ship |

## Current AIDE Gaps

The source audit found these are not all the same maturity level:

1. The facade map exposes only part of the current TS surface; several routes
   fall through to legacy or have no legacy counterpart.
2. `scripts/start.mjs` serves the root frontend while Playwright tests the Vite
   frontend. One canonical frontend must be selected and tested through 4777.
3. The production agent loop at `node/src/services/agent-loop.mjs` does not
   yet inject the project skill registry or the desktop service.
4. The skill prototype hardcodes `C:\Users\Grey_\.agents\skills` and is not
   portable to another installation.
5. Helix has day digests and core blocks, but not the complete unified event,
   retention, provenance, stale-recall, and 30-day cross-session gate.
6. `routesForAgentSubagent()` exists but is not wired into `buildRoutes()`.
7. BYOK route construction passes `fetchImpl: null`; provider execution is not
   production-proven.
8. Desktop policy-hook integration, Tauri resource staging, and installed-app
   smoke coverage are incomplete.
9. Full arch, Veritas, facade topology, real-engine, clean-install, and CI
   gates are not green together.

The internal operating document may continue to be called the Developer's
Creed. The public product name must be independently searchable and must not
depend on `AIDE` or `Creed` as its primary identifier.

## Finish Order

1. Establish one startup topology and reconcile route-map coverage and response
   envelopes.
2. Finish the verification battery and isolate every remaining failure before
   adding new product surface.
3. Wire portable progressive skills and the canonical context pack into the
   actual agent loop.
4. Finish sandbox verification, checkpoints, recovery, and provenance.
5. Complete Helix bounded recall and Loop C outcome capture.
6. Finish model recommendation, local/BYOK continuity, and real model A/B
   measurements.
7. Repair Tauri/portable distribution, clean-profile onboarding, accessibility,
   security, and release artifacts.

## Metrics

Use a fixed real-repository task set and report per task:

- patch applied and tests run;
- FAIL_TO_PASS and PASS_TO_PASS resolution;
- time to first useful result and time to first green verification;
- retry count, rework count, approval latency, and failure explanation quality;
- context-pack bytes/tokens, memory precision/recall/staleness;
- model throughput, TTFT, RAM/VRAM, and model-selection accuracy;
- offline success, egress events, and process cleanup.

No superiority claim is licensed until the same task set is run against the
baseline and the AIDE path with raw results retained.

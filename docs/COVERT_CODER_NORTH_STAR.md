# Covert Coder — product, UI, and experience north star

Source: operator-supplied governing future-state brief, 2026-09-12. This structured restatement preserves its section numbering and requirements. It constrains architecture; **it does not authorize visual implementation in Phase 0 or Phase 1**. The operator's original brief controls if wording is ambiguous.

Working product name: **Covert Coder**. Engineering lineage: **AIDE Sovereign Workbench**, same codebase. Parrot is dropped. “Vinny” was an image-generation artifact and is not part of the product. No final sigil or creed has been approved.

## 1. Product identity

A sovereign, offline-first, AI-native software development environment. The project is the primary object; the developer owns the environment and remains command authority. Local intelligence assists development. It must not become a chat application with an editor attached, cloud IDE clone, generic model wrapper, Monaco theme, three chat windows, or an unrestricted autonomous agent.

## 2. Product philosophy

Communicate discipline, precision, sovereignty, privacy, capability, control, verification and resilience. Quiet capability and an engineered interface take precedence over spectacle. Original visual language may draw on forged metal, utility equipment, instrumentation, field consoles and geometric sigils. Do not copy franchise marks, helmets, typography, terminology, icons, armor, characters, logos, slogans, symbols or trade dress.

## 3. Covert sigil

Eventually create an original geometric, angular, symmetrical or near-symmetrical mark with a distinctive silhouette. It must work at 16–32 px, in monochrome, engraving/embossing/metallic treatments, desktop/status icons, splash, terminal output and documentation. Convey shield, gateway, machine intelligence, craft, discipline and sovereignty. Generated concepts are provisional until an original mark is reviewed.

## 4. Color system

Dark graphite, gunmetal and black dominate. Blue communicates navigation, links, selection, information and neutral tooling. Purple communicates AI, planning, models and reasoning. Pink communicates review, attention, intervention, special agent state and creative operations. Green communicates verified, local, healthy, complete and offline-ready. Red is reserved for failure, security violations, destructive actions, blocked verification and critical health. Amber communicates warning, degradation, pending approval and resource pressure. Colors carry state; avoid ubiquitous neon, excessive glow, glass effects, gradients and particles. Optimize for long work sessions.

## 5. Core desktop topology

An editor-dominant IDE: top command/project/model/privacy/workflow/status region; activity bar and project/context panel at left; editor center; Resident/chat at right; terminal/output/problems/tasks/verify/audit below; compact status bar. Panels resize and collapse, with docking where reasonable. Closing Resident returns space to code.

## 6. Resident assistant / chat

One first-class conversational surface supports ordinary conversation, repository questions, planning, implementation, debugging, explanations, architecture, workflow execution, verification, models, skills, memory, approvals and status. ASK, PLAN, BUILD, DEBUG, REVIEW and VERIFY may be explicit modes or inferred intents. They do not create separate chat systems.

## 7. Chat messages

Support code, diffs, file references, terminal output, test results, plans, approvals, model errors and skill explanations. Optional collapsible metadata exposes model, role, skills, project context, tools, memory, files touched, verification, token/context information, execution time and network activity. Normal conversation remains readable.

## 8. Chat actions

Deliberate actions include Apply Patch, Open File, Show Diff, Run Tests, Review Changes, Undo Changes, Approve/Reject Command, Add to Plan, Save Decision, Inspect Skill/Memory Context and Verify Claim. Generated code alone never authorizes mutation.

## 9. Conversation context

Allow attachment of current file, selection, open files, Git diff, terminal output, error, folder, symbol, test, issue or documentation. Automatic retrieval is bounded and governed. Distinguish user-attached, system-retrieved, memory-recalled and skill-injected context; expose what influenced the answer.

## 10. Agent role visibility

Planner, Coder and Reviewer are logical roles behind Resident, not three permanent chats. Show useful transitions such as planning, implementing approved plan, reviewing and running verification without noisy simulated thinking.

## 11. Workflow / mission view

Complex work exposes objective, phase, plan, tasks, dependencies, approvals, affected files, role/model, verification, failure state and completion evidence. A structured progress view coexists with chat.

## 12. Project explorer

First-class filesystem tree, opening/creating files and folders, rename/move, confirmed delete, Git decorations, search, symbol/context and AI actions. Context actions include Ask, Explain, Plan Change, Refactor, Review, Add to Context, Run Tests and Trace Dependencies. All operate through real workspace abstractions.

## 13. Editor

Syntax highlighting, tabs, splits, dirty state, save/hot exit, search, symbols, diagnostics, LSP completion/hover/definitions/references/rename/formatting. Later: inline AI, diff previews, code lenses, review/verification annotations. Meaningful user code is never silently replaced.

## 14. Inline AI

Selection actions Explain, Fix, Refactor, Optimize, Test, Review, Ask, Document, Find Risk and Generate Diff use the same orchestration authority as Resident. No inline-specific AI backend.

## 15. Diff experience

Review changes before or immediately after application according to policy. Show additions/removals/changes, generated content, agent ownership and reason. Accept, Reject, Revert, Open, Ask Why and Verify retain provenance linking request and change.

## 16. Terminal

A real developer terminal with multiple sessions, cwd awareness, shell selection, process execution, exit status, scrollback, interrupt and task integration. AI proposes commands under permission policy. Destructive/privileged commands receive explicit handling.

## 17. Lower panels

Functional Terminal, Output, Problems, Tasks, Tests, Verify, Audit and Debug surfaces. Verify exposes typecheck, unit, integration, acceptance, real-model, security and architecture evidence.

## 18. Model center

Dedicated management for installed/available models, provider, format, quantization, size, context, role compatibility, RAM/VRAM, backend, health and running state. Import, Download, Start, Stop, Assign Role, Remove, Validate, Benchmark and Details. Cloud adapters may coexist; the core defaults local and works without them.

## 19. Model role assignment

Separate planner/coder/reviewer assignments or one physical model for all roles. Explain recommendations; retain user override authority. Do not require concurrent residency of three models.

## 20. Device profiler

Expose CPU/architecture, RAM, GPU/VRAM, storage and backend support in setup/model center. Explain fit using available resources, quantization, backend and context. Label estimates; avoid false precision.

## 21. Skills center

Browse/search/filter available and active skills, categories, dependencies, conflicts, source/version and descriptions. For running tasks expose selected skills, why, context cost, source and priority. Do not flood the primary UI with hundreds of skills.

## 22. Memory / project brain

Inspectable project facts, architecture decisions, preferences, verified solutions, failures and recent context. Explain recall. Eventually support pin/edit/expire/provenance. Memory is bounded and controllable.

## 23. Verification center

States VERIFIED, DEGRADED, UNVERIFIED and FAILED, with individual typecheck/test/lint/security/architecture/model/integration/acceptance gates. Simulated tests and real local-model acceptance must be visibly distinct evidence classes.

## 24. System health

Expose frontend, facade, backend, legacy adapter, model runtime, memory, skills, events, terminal, LSP, DAP, Git, Telegram, desktop control and watchdog. HEALTHY, DEGRADED, FAILED, DISABLED and UNKNOWN are actionable states, not inferred from file existence.

## 25. Ghost / failure replay

A provenance timeline links request, plan, skills, model invocation, tool, file change, command, test, failure, review and repair. Support asking what happened, why, responsible change, replay and before/after comparison. Build on canonical event/audit infrastructure.

## 26. Approval center

Show what, why, risk, scope, exact command/action and affected files/systems. Allow once, allow for task, deny and modify where appropriate. Do not encourage blind approval. Risk and authority remain enforced by the backend.

## 27. Privacy / network indicator

Persistent, attributable states such as OFFLINE, LOCAL ONLY, NETWORK AVAILABLE, REMOTE MODEL ACTIVE and NETWORK REQUEST PENDING. Never quietly upload project content. Associate network use with provider/subsystem.

## 28. Top status bar

Project, Git branch, workflow, role/model, local/offline state, verification, approvals and health provide situational awareness without overcrowding.

## 29. Bottom status bar

Compact LOCAL, MODEL, ROLE, SKILLS, MEMORY, GIT, VERIFY and HEALTH indicators. Exact syntax is deferred; indicators require actual evidence.

## 30. Command palette

Keyboard-accessible file opening, model/role selection, verification, Resident, skills/memory, start/stop workflow, offline mode, doctor and model management. Commands dispatch through canonical services.

## 31. Onboarding

Welcome, privacy, device scan, backend, recommendation, model import/install, role assignment, workspace, permissions, optional integrations, ready. Skip nonessential steps. No mandatory account or configuration-file editing.

## 32. Offline first-run goal

Install, launch, select/import a compatible local model (optional explicit download when connected), open a repository, converse with Resident, request a change, receive a plan, approve, review diff, verify and complete without mandatory cloud services. A completely disconnected setup uses bundled or locally imported assets.

## 33. Telegram

Optional adapter for tasks, status, approvals, controls, results and alerts. It talks to the same orchestrator and does not create another execution architecture.

## 34. Desktop control

Privileged capability visibly disabled, armed, active, paused or panic-stopped. Prominent panic control; no hidden machine control.

## 35. Settings

Appearance, models/providers/roles, privacy/network/permissions, skills/memory, editor/terminal/Git, verification/agents, remote control and advanced settings. Prefer schemas and documented ownership to scattered flags.

## 36. Mobile / tablet

Tablet may combine editor/assistant, project/editor, terminal/editor or workflows. Phone prioritizes Resident, workflow control, review/approvals, diffs, navigation, small edits, models and verification. Do not promise desktop process/terminal parity on every platform.

## 37. Responsive architecture

Share orchestration, models, skills, memory, verification, project intelligence, events and workflow state. Desktop/tablet/mobile shells use platform capabilities; do not fork business logic.

## 38. Information density

Optimize for developers: tables, trees, inspectors, timelines, diffs, status indicators and searchable lists with clear hierarchy. Avoid decorative dashboards and oversimplified consumer cards.

## 39. Operational UX questions

Every important operation should reveal what is happening, initiator, model/role, context/skills, active tools, changes, network use, verification and undo availability. Missing answers indicate missing observability.

## 40. Inspectable chat

Simple conversation with drill-down into context, skills, models, tools, memory, verification and workflow history. Chat cannot become a black box.

## 41. Home

Without a project: original sigil, Open Project, Recent Projects, Create Workspace, model/offline/health state. With a project: return directly to development. No promotional dashboard.

## 42. Motion

Use animation for starting models, workflow transitions, running verification, approvals and panel changes. Avoid unnecessary loops; performance wins.

## 43. Typography

Excellent code and small-text readability, clear UI/code distinction, cross-platform availability or distributable licensing. Futuristic styling is not a selection criterion by itself.

## 44. Icons

Simple, geometric, consistent and recognizable at small sizes. Apply custom identity selectively; keep ordinary IDE actions familiar.

## 45. Sound

Normal operation is silent. Any future sound is optional, minimal and disabled by default or easily disabled.

## 46. Brand voice

Concise factual language: Plan ready; 4 skills loaded; Local model active; Verification passed; Approval required; Network disabled; 2 files changed; Review failed; Repair available. Avoid hype, magic, pretend sentience, excessive military language and franchise imitation.

## 47. Product creed

An eventual short, wholly original creed may express deliberate building, system understanding, developer protection, tool ownership, verification, evidence and improvement. No recognizable franchise dialogue or paraphrase. Final wording deferred.

## 48. Feature maturity

Route existence does not authorize visibility. EXPERIMENTAL, AVAILABLE, VERIFIED, DEGRADED and DISABLED reflect real maturity. Do not expose half-wired controls.

## 49. Frontend selection during current audit

Evaluate both candidates for Resident docking; editor primacy; facade; workflow events; model/role/skill/memory/verification state; approval, health and Ghost views; resizing/layout persistence; tablet evolution; and preservation versus migration cost. Neither newer code nor current default launch is sufficient reason to select it. See [frontend assessment](phase0/FRONTEND_ASSESSMENT.md).

## 50. Future API/event contracts

Identify canonical homes for chat/streaming, workflow/roles, skills, memory recall, tools/approvals/diffs, verification, model lifecycle, hardware, health, audit/Ghost and network activity. Do not implement all now or introduce competing event systems. See the contract gap map in the frontend assessment.

## 51. Execution order

Latest numbered phase sequence: 0 runtime truth; 1 canonical execution spine; 2 skill runtime; 3 planner/coder/reviewer; 4 device/model intelligence; 5 real local-model workflow proof; 6 engineering subsystem maturity; then UI consolidation and Covert visuals. Frontend architecture may be selected earlier; visual redesign remains later. The earlier P0–P5 labels describe priority categories, not these numbered phases. Phase 1 must still repair existing skill injection and false verification claims; later skill/role features are not prerequisites to fixing those defects.

## 52. Final product test

Open the prior local project with truthful local/model/memory/verification status. Resident receives: “Add retry handling to the model download pipeline. Inspect the existing implementation first and don't change unrelated behavior.” The system assembles project context and skills, plans, identifies files, obtains required approval, implements inspectable diffs, runs relevant tests and review, records provenance and reports changes. It remains local unless network use is explicitly necessary and authorized. “Why did you make that change?” returns evidence.

## Current boundary

Complete runtime reconciliation and stop for collaborator review. No visual rewrite, sigil generation, rename, shell selection, additional product concept or implementation beyond separately authorized changes.

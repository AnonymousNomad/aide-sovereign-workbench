# LAUNCH AUDIT & PHASE LADDER — 2026-08-25

Operator mandate: visually beautiful · powerful · SIMPLE · competitive with every IDE ·
Sovereign Compute Law (in-house local models, zero cloud AI APIs) · OpenCode-class
operational simplicity with OUR identity · phase discipline (load phase skills → work →
cancel → next).

---

## PART 1 — CURRENT-STATE AUDIT (what we have)

**Working end-to-end today**: cockpit (editor/chat/agent loop/SHIP/plugins/skills/
terminal/search/palette) · facade gateway w/ contract routing · TS arch daemon (126
routes) + legacy daemon · binary llama-server serving w/ backend auto-select · harness
scaffold v2.1 (micro/full tiers) · gated BoN · Helix memory X1.a+b shipped (event spine,
day digests, pinned blocks, live-proven injection) · LSP/DAP · git panel · hub · CI
green pipeline · 139-skill pack in-box.

**Gaps vs "undeniable IDE"**: no desktop shell/installer · stock dark theme (no identity)
· no first-run walkthrough · Cipher not yet first-recommended · no autonomous debug phase
· no remote access channel · no desktop-control capability · tutor is checklist-grade.

## PART 2 — PACKAGING VERDICT (evidence-based)

Tauri 2 wins decisively for a local-first AI IDE (2026 field data):
| Metric | Tauri 2 | Electron |
|---|---|---|
| Shell bundle | ~5 MB | ~150 MB |
| Cold start | 320 ms | 1800 ms |
| Idle RAM | 42 MB | 187 MB |
| Signed updater | built-in (keypair) | electron-updater |

**Why it fits US specifically**: models already eat 4–8 GB RAM locally — the shell must be
a good citizen (codenote local-LLM study reached same conclusion). Our Node daemon becomes
a **sidecar**: Tauri spawns it (env override → bundled → PATH resolution, health-check
readiness — proven ChatML/llama.cpp patterns), WebView2 loads the existing cockpit at
127.0.0.1:4173. Zero rewrite of product code; Rust surface stays thin (window, updater,
sidecar spawn). Machine note: install Rust toolchain (currently incomplete) — one-time.

**Launch flow (OpenCode-inspired simplicity)**: `aide` single command / desktop icon →
sidecar daemon boots → cockpit opens → first-run walkthrough (once) → Describe box is the
front door. Headless `aide serve` mirrors opencode serve for remote/API use.

## PART 3 — THE PHASE LADDER (strict order, load-only-phase-skills)

Always-loaded every phase: hard-rules · developer-code-and-credo · surgical-precision ·
verification-complete · agent-notes · process-hygiene-sop. Everything else: LOAD at phase
start, CANCEL at phase close (journal gate marks exit).

### P0 — LAUNCH SHELL 📦
Skill to author: `aide-p0-launch-shell`
Load: packaging-offline · release-engineering · backend-autoselect
Work: install Rust toolchain → tauri.conf (sidecar spawn of node daemon, WebView2 →
4173) → NSIS/MSI installer → codesign → updater keypair → cold-boot smoke on clean dir.
Gate: double-click install on a clean Windows profile → walkthrough-ready cockpit ≤5s;
uninstaller clean. Pitfalls: WebView2 runtime absent (ship offline installer per
packaging skill), port collisions (stack ports documented), AV false positives.

### P1 — PARROT IDENTITY 🎨
Skill: `aide-p1-parrot-identity`
Load: smart-workbench-flow · responsive-a11y
Work: design tokens from ParrotOS language — neon-green-on-black terminal palette
(community-verified signature), ARK-Dark chrome for cockpit surfaces, cyan accent for
interactive states; CSS variables layer; xterm.js theme; monochrome logo set; contrast
audit (WCAG AA on green/black). Gate: full-cockpit screenshot pass + a11y contrast report.
Pitfalls: green-on-black fatigue (use green ONLY for terminal/emphasis, never body text);
theme variables must not fight Monaco themes.

### P2 — ONBOARDING WALKTHROUGH 🧭
Skill: `aide-p2-onboarding`
Load: smart-workbench-flow · product-vision
Research base (VS Code 2026): presentation-agnostic scenario engine; spotlight =
dim overlay + masked highlight + anchored callout; 5 tested variations; known bugs to
avoid (keyboard nav, z-order vs palette, Escape-listener leaks, default-off gating).
Work: scenario registry (JSON steps anchored to real element ids) → spotlight engine →
first-run tour = START ENGINE → DESCRIBE → APPROVE card → SHIP, each step REAL action;
`aide.onboarding.done` persisted; HELP reopens; dev-mode bypass setting. Gate: e2e
drives the tour headless; second boot never shows it; Esc/keyboard complete cleanly.

### P3 — CIPHER-FIRST DOCTRINE 🥇
Skills: patch `aide-model-task-recommender` + author `aide-cipher-first`
Load: orchestrator-awareness · device-benchmark-runner · cipher-house-model
Work: recommendation ranker places Cipher #1 in EVERY surface (hub, chat default, agent
loop) once device-fit verifies (probe: VRAM/RAM fit + warmup success) else falls back w/
honest reason chip + guided import path; T2 coordination: when fine-tuned Cipher lands →
MODELS→IMPORT(ctx) → battery rerun → delta evidence → promote. Gate: fresh-device sim
shows Cipher selected by default; missing-Cipher path shows guide not error.

### P4 — CIPHER DEBUG 🔍 (collaborator design, validated)
Skill: `aide-p4-cipher-debug`
Load: phase-router · offline-agent-loop · unified-diff-repair · harness scaffolding
Research base: SLM APR viable (Phi-3 38/40 QuixBugs ≈ Codex; int8 safe, int4 −11 bugs →
Q8 floor matches our quant doctrine) · SWE-Protégé anti-loop RL (stall penalties cut
degenerate loops 31%→0.8%; ask_expert escalation tool) · SWE-Swiss recipe (multi-task SFT
Localization/Repair/TestGen → GRPO execution-reward RL; verified rejection sampling) ·
RECAP (post-generation refinement beats prompting; SEARCH/REPLACE > diffs — validates
our agent-tools grammar).
Build order: (a) collectors — LSP diagnostics + terminal/build output + test failures
into one Problem Set; (b) DEBUG trigger at CODE→TEST phase boundary (phase-router hook);
(c) fix proposal via agent loop w/ S/R patches + Veritas verify (syntax/types/tests);
(d) approval posture configurable: always-ask | complex-only | auto-simple; (e) evidence:
every action → memory spine events. T2 HANDOFF: training recipe = SWE-Swiss shape on
error-fix pairs from OUR closed loop (execution-verified only). Gate: fixture bug → auto
proposal → approved → tests pass → evidence logged; rejected-path logs alternative.
Honest limits: race conditions/memory leaks/architecture flaws escalate to strongest
local model w/ full context (Protégé pattern).

### P5 — TELEGRAM BRIDGE 📡
Skill: `aide-p5-telegram-bridge`
Load: backend-core (process isolation laws) · cloud-handoff (secret store reuse)
Research base: long polling = local-first (no public URL/TLS; worker initiates all
contact) · OpenClaw battle scars: ingress MUST be isolated worker + durable spool (LLM
streams stall shared loops → silent message loss; outbound success masks dead inbound —
detect liveness from getUpdates only) · token hygiene (never log URL, DPAPI store,
rotation drops stale offsets) · user-ID allowlist (not username).
Work: transport-only law (user's own @BotFather token; all cognition local) → isolated
polling worker in daemon + spool file → command surface: /status /tasks /approve <id>
/reject <id> /ask <prompt> (routed to same chat composition incl. memory blocks) →
guided setup wizard in cockpit (paste token → verify getMe → pick allowlist IDs → done).
Gate: message during heavy model stream arrives instantly (the OpenClaw regression test);
wrong-ID rejected; token never appears in any log.

### P6 — DESKTOP CONTROL 🖥️ (sovereign, staged)
Skills: `aide-p6-desktop-control` + `aide-p6-companion-model`
Load: plugins-surface (capability gating pattern) · orchestrator-awareness · cipher
house-model
Research base: UI-TARS-2 open weights Apache-2.0 — 2B SFT fits quantized 4–8 GB class;
action loop = screenshot → VLM → normalized coords (factor 1000) → parser → NutJS
(Node-native execution!) ; OSWorld 47.5% (2× Claude CU); local latency 200–400 ms/step.
Staged autonomy (Sovereign Compute Law compliant):
- DC-a BOUNDED DOMAIN: file/app/window operations via structured APIs (no vision needed —
  small model precise here): allowlist-driven, every action approval-gated, hard deny for
  system paths/credential stores.
- DC-b SCREEN-VISION: screenshot loop w/ UI-TARS-2B-Q8 as OPTIONAL companion model
  (imported like any GGUF) while Cipher-vision matures on T2's line (training target:
  UI-TARS action grammar on our own recorded trajectories).
- Strict opt-in: guided wizard enumerates EVERY granted domain; revocation UI; kill
  switch; session-scoped grants only. Cloud computer-use APIs studied as reference only —
  never shipped.
Gate: allowlist enforcement adversarial tests (path escape, prompt-injection attempts via
screen text); every action in evidence trail; panic stop <500ms.

### P7 — TUTOR ENGINE 🎓 (beginner→pro adaptivity + pause-tutor)
Skill: `aide-p7-tutor-engine`
Load: academy/tutor-manager codebase context · smart-workbench-flow
Research base: ExemplAI BKT routing (mastery <0.3 complete examples / 0.3–0.7 faded /
>0.7 erroneous-example challenges) · Dean validation gate blocking ANSWER LEAKAGE ·
STAP Socratic pipeline (minimum-viable-hint ladder; oracle→tutor reframing) · IntelliCode
(versioned learner state, single-writer orchestration, SM-2 spaced repetition, 40/50/10
curriculum policy) · SP-TeachLLM (Bloom decomposition + cognitive-load-aware strategy
selection).
Work: learner-state store (.aide/memory/learner.json — Helix-adjacent) → mastery updates
on lesson checks (deterministic gates already exist) → hint-ladder injection into tutor
sessions w/ leakage gate → mode switch: PAUSE TUTOR (expert: zero pedagogy, full speed)
vs TEACH ME (novice: hints before answers). Gate: simulated novice/expert sessions show
different hint depths for identical bug; leakage gate blocks direct answers at high
mastery confidence; mastery persists across sessions.

### P8 — NODE COMMUNITY 🌐 (FUTURE — research ticket only)
Federated opt-in: every AIDE install = a sovereign node; P2P sharing of builds/skills/
sessions w/ explicit consent per artifact; zero central server. Research BEFORE build
(protocol choice, trust model, artifact signing). Explicitly out of current scope.

## PART 4 — CROSS-CUTTING LAWS (every phase inherits)

1. Sovereign Compute: in-house/local models only; API paths are study material.
2. Wired-together: every slice ships working end-to-end through :4777.
3. Verify-complete battery before any phase-close claim; journal + commit per slice.
4. Phase skill discipline: load listed skills AT phase start; cancel at close; roadmap
   marker moves only on verified gate.
5. Cipher-first: every new capability defaults to the house model once device-fit
   verifies; alternatives remain visible, never forced.

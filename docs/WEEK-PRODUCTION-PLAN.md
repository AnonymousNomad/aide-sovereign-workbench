---
name: aide-week-production-push
description: Day-by-day production push plan for AIDE — 7-day sprint to make the cockpit a daily-driver IDE. Each day has exact tasks, code targets, dependencies, threats, and verification gates. Use at session start each day to know exactly what to build and why.
---

# Week Production Push — Day-by-Day Execution Plan

## Ground Rule

Every day follows the same cycle:
1. Load that day's skill(s)
2. Build the smallest working increment
3. Verify through the real UI (not just tests)
4. Commit + push + CI check
5. Journal entry with evidence

## DAY 1 — Multi-Tab Editor (today)

**What:** Open multiple files as tabs in Monaco. Click tree files to open new tabs. Switch between tabs. Close tabs. Dirty indicators.

**Why first:** An IDE without multi-tab editing is a viewer, not an editor. This is the single biggest "feels like a real IDE" gap.

**How (exact):**
- `app.js`: Add `editorState.openTabs = []` array tracking {path, model, dirty}
- `openInEditor(path, content)`: if path already in openTabs, switch to it; else create tab element + Monaco model, add to array
- Tab bar HTML: `<div id="tab-bar" class="tab-bar">` inside `.editor-main`, above `.editor-container`
- Each tab: `<div class="tab" data-path="...">filename <span class=close>×</span></div>`
- Tab click → switch active model. Close click → dispose model, remove tab.
- Dirty indicator: dot on tab when content differs from disk
- Ctrl+W closes active tab

**Dependencies:** None new. Uses existing file contracts and Monaco.

**Threats:**
- Memory: disposing models prevents leaks — always call `model.dispose()` on close
- Unsaved changes on close: prompt or auto-save (use confirm dialog)
- Many tabs: cap at 20, oldest closed first

**Verify:** Open 3 files from tree → switch between them → edit one → dirty shows → save → dirty clears → close tab → model disposed.

---

## DAY 2 — Search & Navigation Depth

**What:** 
- Replace-in-files with approval diff (search exists, replace needs gate)
- Go-to-file from palette already works via fuzzy match ✓
- Breadcrumb bar showing current path
- File tree: expand/collapse folders (currently flat list)

**Why:** Finding and changing code across files is the #2 daily activity after reading code (29% exploring + 24% maintenance per FlouState).

**How (exact):**
- Replace-in-files: extend search overlay results with a replacement input. On REPLACE ALL click:
  1. Fetch each affected file's current content via /api/file
  2. Apply regex replacement in-memory
  3. Show diff summary (file, lines changed)
  4. On APPROVE: POST /api/file/write for each changed file (sequential, approved:true)
  5. Re-run search to verify zero remaining hits
- Breadcrumb: `<div class="breadcrumb">src / auth / login.ts</div>` above editor, updates on file open
- Tree expand/collapse: directory nodes toggle children visibility, chevron icon rotates

**Dependencies:** Existing search route (/api/search). File write contract. No new deps.

**Threats:**
- Replace-all is destructive: MUST show preview before writing (approval-gated like SHIP)
- Large result sets: cap rendering, paginate
- Binary files: skip non-text extensions (.exe,.gguf,.png,.zip)

---

## DAY 3 — Tasks & Test Runner

**What:**
- Detect package.json scripts in workspace root
- Run them via existing task service (/api/tasks/run)
- Stream output to terminal drawer
- Parse pass/fail from test output into rail badge
- npm test detection: if package.json has "test" script, show RUN TESTS button

**Why:** Developers spend 24% of time on maintenance (running builds, fixing tests). Without this, they leave AIDE for a terminal.

**How (exact):**
- Task service already exists daemon-side (/api/tasks/run, /api/tasks/status, /api/tasks/stop)
- MODELS panel gains a TASKS section listing detected scripts from package.json
- Each script gets a RUN button → POST /api/tasks/run {id} → output streams to terminal drawer
- Rail badge: TESTS PASS/FAIL updated by parsing task output for exit code
- Problem matchers: parse tsc/eslint error patterns from output → create diagnostic entries → rail DIAGNOSTICS count updates

**Dependencies:** Task service routes exist ✓. Terminal drawer exists ✓.

**Threats:**
- Long-running processes: must have STOP button (task service supports this)
- Output flooding: cap terminal buffer at 500 lines
- Port conflicts: task might start a server on same port as engine — warn user

---

## DAY 4 — Settings & Session Persistence

**What:**
- Settings JSON schema stored in .aide/settings.json: {theme, fontSize, formatOnSave, defaultEngineId, delegation, autoStartEngine}
- Settings panel in MODELS overlay (minimal: dropdowns + toggles)
- Persist across reloads: last open files, panel visibility, scroll positions, selected engine
- Theme: dark (default) + light variant

**Why:** Every reload currently resets everything. Users expect their preferences to stick. This is the difference between "demo" and "daily driver."

**How (exact):**
- Session store already persists selected_engine_id ✓ and hot_exit buffers ✓
- Extend: save open_files array (list of paths), active_tab index, delegation mode, format_on_save
- On boot: loadModels() reads session → pre-selects remembered engine → opens last files → restores panel states
- Settings stored separately in .aide/settings.json (not session store — settings survive workspace switches)

**Dependencies:** Session store exists ✓. No new deps.

**Threats:**
- Corrupted settings file: wrap in try/catch, fall back to defaults
- Version migration: old settings without new keys should merge cleanly

---

## DAY 5 — Agent Intelligence (the differentiator)

**What:**
- Clarifying question engine: ambiguous tasks get structured questions before execution
- Multi-lens review: security/performance/maintainability passes on TASK output
- [learned] injection fully wired: past preferences shape scaffold composition
- Context compression at handoffs

**Why:** This is the AI-era differentiator. Copilot generates code. Cipher generates code, verifies it, remembers your preferences, and improves. That's the moat.

**How (exact):**
- Clarifying questions: before agent-loop start, analyze task text for ambiguity markers (broad scope, vague target, compound requests). If detected, ask 2-3 questions with expected answer types. Feed answers as constraints into the agent prompt.
- Multi-lens review: after CODE phase, run three sequential review prompts (security/performance/maintainability) on the diff. Merge findings. Present as approval-card items alongside the diff.
- [learned] injection: cipher-state.getPreferences() returns top patterns → inject into system prompt as "[learned] Operator prefers..." lines
- Context compression: strip reasoning/narration between phases; keep only decisions and artifacts

**Dependencies:** Phase router skill (aide-phase-router) designed but not yet implemented. Agent loop exists. Scaffold composer accepts learned blocks (implemented).

**Threats:**
- Prompt injection through clarifying answers: sanitize all user input before injecting into system prompt
- Question fatigue: max 3 questions, skippable ("just do it")
- Lens outputs contradicting: synthesis ranks by severity, never merges blindly

---

## DAY 6 — Training Room v0 (fine-tune loop closure)

**What:**
- MODELS panel gains FINE-TUNE section showing trajectory count and quality metrics
- Export button: .aide/trajectories/*.traj.json → training dataset JSONL
- Import button: trained adapter GGUF → register + battery gate + promote/discard
- Reward guidance surfaced: combined unit-test+light-style rewards recommended

**Why:** This closes Loop C. Without it, trajectories accumulate but never improve the model. With it, every day of usage produces better training data.

**How (exact):**
- Trajectory reader: parse .aide/trajectories/*.traj.json files
- Quality filter: only include sessions where outcome='done' AND mistake_count<2 AND operator approved all writes
- Dataset format: {"messages":[{system,user,assistant}]} pairs matching TRL/QLoRA training format
- Export: write JSONL file operator downloads/copies to training machine
- Import: accept adapter GGUF → register in manifest → run battery → promote/discard based on delta

**Dependencies:** Trajectory capture implemented ✓. Battery implemented ✓. QLoRA training runs on OPERATOR schedule (not in-app).

---

## DAY 7 — Release Engineering

**What:**
- Version stamping: git SHA + build date visible in About section
- Shell decision: Electron vs portable zip vs browser-launcher
- Clean-machine smoke checklist documented and tested
- README final polish: screenshots, install instructions verified on clean machine
- Tag v0.1.0-alpha release

**Why:** Everything else is meaningless if users can't install and run it. This is the day we find out if the product actually ships.

**How:**
1. Research shell options with measurements (Tauri toolchain install time, Electron binary size, portable zip simplicity)
2. Pick based on evidence (skill: aide-arch-packaging-release has the decision matrix)
3. Build installer/bundle from CLEAN checkout
4. Test on fresh profile: install → launch → pick workspace → open file → chat round-trip → git commit → ALL OFFLINE
5. Write changelog + sha256 + known issues
6. Tag release on GitHub

**Dependencies:** Everything else. This is the last thing you do.

---

## Skills Status

| Skill | Status | Governs |
|---|---|---|
| aide-smart-workbench-flow | ✅ authored | Overall UX laws |
| aide-debugging-discipline | ✅ authored | Debug methodology |
| aide-power-surface | ✅ authored | Palette/search/terminal |
| aide-rseries-refactor | ✅ authored | Rename/references/format |
| aide-plugins-surface-v1 | ✅ authored | Plugin trust/contributions |
| aide-cipher-house-model | ✅ authored | House model lifecycle |
| aide-phase-router | ✅ authored | Phase detection/routing |
| aide-advanced-orchestration | ✅ authored | Multi-lens/clarifying/compression |
| aide-project-replay | ✅ authored | Provenance capture schema |
| aide-responsive-a11y | ✅ authored | Breakpoints/a11y laws |
| aide-backend-autoselect | ✅ authored | Backend probing/selection |
| process-hygiene-sop | ✅ authored | Process/memory/RAM laws |
| inference-control | ✅ authored | Tuning/sampler profiles |
| orchestrator-awareness | ✅ authored | Situation engine/monitoring |
| **NEW NEEDED** | | |
| aide-tasks-panel | ❌ write Day 3 | Task runner/test integration |
| aide-settings-persistence | ❌ write Day 4 | Settings schema/migration |

## The One Metric That Matters

At end of week: can a developer who has never used AIDE go from download to shipped code in under 30 minutes, entirely offline, with full provenance of every AI-assisted change? If yes, we have a product. If no, we keep building.

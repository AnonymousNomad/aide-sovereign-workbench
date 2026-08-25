# AIDE Week Plan — Production Push

## Day-by-Day Milestones (each day = build → verify → push)

### DAY 1 — Editor Depth (feel like a real IDE)
- Multi-tab editing: open multiple files as tabs in Monaco
- Tab close/save/dirty indicators
- Ctrl+Tab / Ctrl+W tab switching
- Format-on-save already wired ✓
- Skill: extends aide-rseries-refactor

### DAY 2 — Search & Navigation (find anything instantly)
- Replace-in-files with approval diff (search exists, add replace)
- Go-to-file from palette (Ctrl+P style)
- Go-to-symbol via LSP (Ctrl+Shift+O)  
- File tree: expand/collapse folders, active file highlight
- Breadcrumb bar showing current path

### DAY 3 — Terminal & Tasks (build, test, run without leaving)
- Task runner panel: detect package.json scripts, run them, show output
- Test results parsing (pass/fail counts into rail badge)
- Problem matchers: tsc/eslint errors -> diagnostics -> editor markers
- Terminal history (up-arrow recall)

### DAY 4 — Settings & Persistence (make it feel permanent)
- Settings JSON schema: {theme, fontSize, formatOnSave, defaultEngine, delegation}
- Settings panel (even if minimal — dropdowns + toggles)
- Persist: last open file(s), panel visibility, scroll positions
- Theme: at minimum dark/light toggle

### DAY 5 — Agent Intelligence (the differentiator)
- Clarifying question engine: ambiguous tasks get 2-3 structured questions before execution
- Multi-lens review: security/performance/maintainability passes on TASK output
- Context compression: each phase gets only what it needs
- [learned] injection wired: past preferences shape future responses

### DAY 6 — Training Room v0 (close the fine-tune loop)
- MODELS panel: "Fine-tune" section showing trajectory count and quality metrics
- Export button: trajectories -> training dataset JSONL
- Import button: trained adapter GGUF -> register + battery gate + promote
- This closes the Loop C flywheel: use -> learn -> retrain -> improve

### DAY 7 — Release Engineering
- Version stamping (git SHA + build date in About)
- Installer research decision: Tauri vs Electron vs portable
- Clean-machine smoke checklist written
- README final polish: screenshots, GIF demo, install instructions
- Tag v0.1.0 release

## Skills Needed Per Day

| Day | New Skill | Updates Existing |
|---|---|---|
| 1 | - | aide-smart-workbench-flow (editor depth) |
| 2 | - | aide-power-surface (replace + navigation) |
| 3 | aide-tasks-panel | aide-arch-backend-core (task service) |
| 4 | aide-settings-persistence | - |
| 5 | - | aide-phase-router (clarifying questions, multi-lens) |
| 6 | aide-training-room-v0 | post-training-closed-loop |
| 7 | - | aide-release-engineering |

## Success Criteria (end of week)

A developer who has never used AIDE can:
1. Download and install in < 5 minutes
2. Start a local model with one click
3. Edit code with full LSP intelligence
4. Describe a task and watch the agent implement it safely
5. Review, approve, and ship changes with full provenance
6. See measurable improvement in AI-assisted tasks over time

That's the bar. Everything above serves that goal.

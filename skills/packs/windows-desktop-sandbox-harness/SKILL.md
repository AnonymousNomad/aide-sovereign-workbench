# Skill: windows-desktop-sandbox-harness

# Windows Desktop Sandbox & Executor Harness (Phase B of the Desktop-Agent Program)

## Problem It Solves

The model proposes actions; something must execute them SAFELY on a real Windows
desktop, capture the resulting UI state as the next observation, verify task-level
assertions for training-data gating, and enforce the permission envelope from
`aide-desktop-agent-model-spec`. Without this harness there is no corpus (Phase C)
and no product (T1 integration).

## Research Foundations

| Source | Fact | Applied here |
|---|---|---|
| pywinauto docs | `backend="uia"` gives full UI Automation: connect by title/path/handle, walk trees, ValuePattern/InvokePattern/LegacyIAccessible | Execution library; win32 backend only as documented fallback |
| Terminator router analysis | a11y actions resolve in single-digit ms via COM (FindFirst + InvokePattern); screenshot path ~100x slower | Tree-first always; vision is out of scope v1 |
| DirectShell field report | Chromium exposes skeleton tree unless screen-reader presence is forced (`UiaClientsAreListening`); Electron often exposes nothing | Chromium activation routine required; "no provider" must be an honest executor response |
| OpenAI CUA / Anthropic guidance | Iteration caps; confirmations before irreversible effects; takeover mode hides credentials from context | Session caps + class gates + credential redaction below |
| Cowork PromptArmor bypass | Screen content can carry instructions that hijack agents | Observation wrapper marks content as data; executor strips nothing silently — flags anomalies |
| This machine's history | SendInput-based tools look like keyloggers to AV; UIA Invoke does not | Prefer UIA patterns over synthetic input; document any AV friction |

## Component Design (executor service, Python 3.10, localhost-only)

```
desktop_executor.py
├─ SessionScope        # allowlist: window titles/processes, started at opt-in
├─ SnapshotRenderer    # UIA tree -> numbered text observation (~4KB cap) per spec
├─ ActionDispatcher    # parse DSL call -> permission check -> pywinauto call
│   ├─ PermissionGate  # READ auto / WRITE approve / OPEN approve / DESTRUCTIVE confirm / FORBIDDEN reject
│   └─ Redactor        # credential-role fields -> [REDACTED CREDENTIAL FIELD]
├─ AssertionEngine     # task-level checks: window title, control value, file exists, process alive
├─ AuditLog            # JSONL: {ts, action_raw, class, verdict, snapshot_sha, result}
└─ InjectionSentinel   # scans snapshots for imperative strings ("ignore previous",
                       #   "run ", "delete ") -> flags to orchestrator, never obeys them itself
```

Transport: localhost HTTP or stdio MCP-style tool surface — matches AIDE's existing
agent-loop endpoints (T1 wires approval cards to WRITE/OPEN/DESTRUCTIVE verdicts).

## Core Behaviors

1. **Snapshot**: focused window first; scope windows listed after; element cap ~120;
   truncation marker honest. Re-render AFTER every action (verify-by-observation).
2. **Dispatch order**: parse → class lookup → gate verdict → execute → re-snapshot →
   return {verdict, result, new_snapshot}. One action per request (spec law).
3. **Gate verdicts**: READ executes; WRITE/OPEN return PENDING_APPROVAL to the
   orchestrator and hold ≤60s; DESTRUCTIVE requires explicit typed confirmation id;
   FORBIDDEN returns refusal reason string (this trains recovery behavior later).
4. **Chromium activation**: set screen-reader flag + UIA client registration before
   first tree walk per browser process; retry ×3 with delay.
5. **Credential redaction**: elements with password role/textfield-secret are never
   rendered with values and reject set_text targeting at the GATE, not post-hoc.
6. **Assertion engine**: every Phase-C seed task ships with 2–5 assertions checked
   after final action (e.g. `window_title_contains`, `control_value==`, `file_exists`).
   PASS/FAIL stamps go into the trajectory record (R3 law: no stamp = no corpus row).

## What NOT To Do

1. NO global hooks / raw SendInput loops in v1 — UIA patterns first; synthetic input
   only where a pattern genuinely doesn't exist, and log it as such (AV/anti-cheat
   friction is real on this machine class).
2. NEVER run elevated unless the target app is elevated; never disable UAC.
3. NO silent retries of failed destructive actions — one attempt, report, stop.
4. NEVER widen SessionScope mid-session without a fresh user approval card.
5. DO NOT keep snapshots longer than the session audit needs (privacy law) — hash
   and truncate; full text only in the session-local audit JSONL.

## Dependencies

- Python 3.10 venv_trek; `pip install pywinauto comtypes six`
- Windows UIA (built-in); target apps for seeds: Notepad, Explorer, Calculator,
  browser (activated), VS Code (accessibility mode ON in settings)
- Existing: aide-desktop-agent-model-spec (DSL), trajectory-recorder spec (records)

## Known Bugs / Pitfalls (from field sources)

0. **NEVER `Stop-Process -Name explorer`** — that kills the DESKTOP SHELL
   (taskbar+desktop), not folder windows. Close Explorer windows by
   title-scoped WM_CLOSE only. (Near-miss 2026-08-26.)
0b. **Explorer budget starvation**: flat descendants() walks burn the per-window
   element budget on the nav pane's 25+ TreeItems BEFORE reaching Items View
   children -> file/folder targeting fails. PROVEN FIX (rejected alternative:
   per-control-type descendants(control_type=X) calls = N full tree walks ->
   25s+ timeouts): keep ONE flat walk, partition in Python (TreeItem vs rest),
   emit non-TreeItems first, cap TreeItems at 12. Same COM cost, correct order.
0c. **Detached cmd-wrapper launches die silently on this box**; direct
   `Start-Process python.exe -RedirectStandard*` launches survive. Also never
   kill-sweep by commandline substring in the same call that spawns a new
   process whose commandline contains that substring.

1. Stale elements after window focus change → re-find by runtime id each dispatch,
   never cache across actions.
2. DPI scaling changes bounds → we don't use coordinates v1; if fallback needed,
   read bounds fresh from the element, never from a stored snapshot.
3. UIA calls hang on busy/frozen windows → wrap every COM call with timeout thread
   (5s) and mark window unresponsive in snapshot.
4. Modal dialogs steal focus mid-action → dispatcher re-checks focused window before
   executing; mismatch = abort action with reason (trains careful behavior).
5. pywinauto Desktop(backend='uia') needs matching bitness to target app.

## Performance Engineering (researched numbers, 2026-08-25)

| Fact | Source | Prescription |
|---|---|---|
| pywinauto `descendants()` uses FindAll: fast on shallow trees (0.2s), catastrophic on deep ones (67 children/depth-62 tree = 3.4s FindAll vs **74s** RawViewWalker) | pywinauto PR #1001/#1012 perf wiki | NEVER enable `use_raw_view_walker`; NEVER hand-roll BFS with children() (many small COM calls lost 1188ms vs 690ms measured here) |
| Per-property reads are separate cross-process COM calls; UIA CacheRequest batches them into ONE round trip | Microsoft "Caching UI Automation Properties" doc | If >300ms persists after budgeting: switch renderer to raw comtypes `IUIAutomation` + `CreateCacheRequest` (cache Name/ControlType/IsEnabled/AutomationId/Value + TextPattern) walked with `GetFirstChildElementBuildCache` |
| Budget-per-window prevents starvation | measured: explorer flood starved notepad (ids shifted 1,2,3 -> 79,80,81) | 40 interactive elements/window hard cap; focused window renders FIRST |
| Element ids from walk order are unstable across renders when dynamic views (shell item views) mutate between calls | measured delta=19 | Stability gate compares STATIC windows only; dynamic regions declared per-scope |

## Text Extraction Ladder (for VALUE_CAPABLE editors)

Measured on Win11 Notepad: `get_value()` AttributeError (no ValuePattern),
`texts()` returns [''], raw `GetCurrentPattern(10014)` TextPattern returns ''
(separate-process GetText unreliable on UWP notepad). Prescribed ladder:
1. ValuePattern (`get_value()`) — WinForms/Qt/native edits
2. `texts()` — legacy win32 controls
3. **WM_GETTEXT via element handle** (`win32gui.SendMessage(hwnd, WM_GETTEXT...)`)
   — works cross-process for classic edit/richedit (Notepad classic, most LOB apps)
4. TextPattern DocumentRange.GetText — browsers/chromium content
5. If all empty → render `[content not exposed]` honestly; task layer picks a
   different app rather than pretending.

## Mouse Control (COMPLETE desktop control law)

The model gets the whole pointer, not just Invoke-pattern buttons:

| Verb (spec v1.1 amendment) | Implementation | Notes |
|---|---|---|
| `move_mouse(x, y)` | `pywinauto.mouse.move(coords=(x,y))` → SendInput | absolute screen px |
| `click_at(x, y, button="left"\|"right"\|"double")` | move + `click(coords=...)`/`double_click` | for canvas/games/non-a11y surfaces |
| `drag(x1, y1, x2, y2)` | press → moves → release (`mouse.press/release`) | window moves, sliders, selection |
| `scroll_at(x, y, direction, amount)` | position cursor then `mouse.scroll` | scroll WHERE intended, not cursor-leftover pos |

Laws:
1. **Dual-mode targeting**: semantic targets (`click(target=id)`) remain PRIMARY;
   `*_at` coordinate verbs are the labelled fallback ladder (Terminator pattern).
   Training data teaches: try semantic first, fall back to coordinates only when
   snapshot says `[no provider]`.
2. **Coordinates come from the snapshot**: every rendered element line may carry
   `at=XxY` (center of its rect) so the model never guesses pixels for a11y-visible
   elements; free coordinates allowed only for unexposed surfaces.
3. **DPI awareness law**: executor process MUST call
   `ctypes.windll.shcore.SetProcessDpiAwareness(2)` before any coordinate math,
   else scaled displays offset every click (silent misalignment class).
4. Synthetic input is ALWAYS logged `synthetic_input=true` in audit; AV products
   may flag heavy SendInput use — document, don't hide.
5. DESTRUCTIVE classification applies by target name OR by verb+region rules;
   drag that starts on a DESTRUCTIVE-named element reclassifies.

## Model-in-the-Loop Protocol (the model runs its own batteries)

Researched patterns (AutoGUI, Kodo, browsegrab, Orbit — all local-model GUI agents):

| Mechanism | Why (measured by those projects) | Ours |
|---|---|---|
| ReAct loop: observe → reason → single action → observe | small models lose track without fresh observation each turn | exactly our step() |
| Hallucination guard | models narrate "I clicked" without emitting action | parser rejects prose-only turns, injects correction |
| Error-retry injection | models acknowledge errors and move on | failed tool result appended with mandatory-retry policy line |
| Stall watchdog (same signature N=3) | identical (window,action,args) loops forever | abort → call_user prompt |
| Action settle time (~2-4s or stable-tick check) | acting before UI catches up corrupts next observation | settle 1.5s default after WRITE actions |
| Differential tree updates (<20% changed → send delta) | full tree every turn floods small-context models | v0: full snapshot ≤4KB already small; delta later |
| DONE is verified, not trusted ("Gemini incident") | model claims completion falsely | finished() only accepted if assertions PASS else bounced back |
| Small-model context discipline (Kodo: tiny models overwhelmed by dense full-tree context) | 4B needs ≤4KB observations + short history | history = last 5 (task,recent-action) pairs only |

## COM Apartment Law (the ~13-render degradation root cause — R8 case study)

| Fact | Source |
|---|---|
| UIA client worker threads must be **MTA**: `CoInitializeEx(COINIT_MULTITHREADED)`. Never plain `CoInitialize()` (=STA) on a thread that makes sustained UIA calls | Microsoft "UI Automation Threading" doc — verbatim prescription |
| An STA thread that never pumps messages cannot receive marshaled cross-apartment responses/callbacks; failures surface AFTER sustained volume, not immediately | Raymond Chen 2025-03-14 "COM failing to pump messages"; pywin32 testMarshal ("whole apartment model demo will hang") |
| Remote UIA element lifetime is bound to the creating apartment; apartment death invalidates marshaled elements | MS doc "COM Apartment Affinity" |

Rules for THIS project:
1. The singleton UIAWorker initializes **MTA**, never STA.
2. No message pump needed for MTA; do NOT add PumpWaitingMessages loops to fix
   STA symptoms — fix the apartment type.
3. Any future UIA event-handler threads follow the same MTA rule.

## Cached-Walk ControlType Offset Trap (R8 case study #2)

MEASURED on this machine (comtypes gen UIAutomationClient): `CachedControlType`
returns values in the **50000-series** (Edit=50004, Button=50000, Text=50020)
while the module's `UIA_*ControlTypeId` constants are the classic
**30000-series**. A cached walker filtering `id in INTERACTIVE_SET` built from
the constants silently drops EVERY element — zero rows, zero exceptions.
Rule: register BOTH domains (`pid` and `pid+20000`) in id→name maps and
interactive sets; normalize with `int(...)` (values may be enum-typed).
Symptom signature: cache walk returns children whose names match perfectly
but rows==0 with empty error lists.

## Verified Window Lifecycle (multi-instance hygiene — R8 codified)

Failure class this encodes: repeated `control_value_equals got=''` / title
misses caused by stacked same-named windows (ghosts from prior runs/aborts)
being read as first-match-global.

| Step | Rule |
|---|---|
| Pre-launch sweep | WM_CLOSE every window matching scope substrings, then **poll IsWindow until zero match (max 5s)**; survivors → taskkill tree. Sweep without verification is a no-op pretending to be cleanup. |
| Launch binding | Capture the launched app's HWND at wait-window time; thread it through the session: registry targeting AND value-assertions filter `entry.handle == session_hwnd` — NEVER first-match-global by control name. |
| Post-task close | Graceful WM_CLOSE to session windows → poll-gone 5s → taskkill tree survivors. Kill alone is last resort only (research: TerminateProcess skips app cleanup; CloseMainWindow = system-menu equivalent). |
| Assertion timing | ≥1.5s settle after final WRITE before any assertion read. |
| Multi-window truth | A process kill does destroy its USER windows (kernel-managed) — persistent ghosts mean the WINDOW belonged to a still-alive process (orphaned PS hosts running ShowDialog, earlier aborted runs). Hunt the PROCESS, not just the window. |

Sources: PowerShell#24631 (TerminateProcess has no cleanup hook; CloseMainWindow
= WM_CLOSE to main window), MSDN Terminating-friendly thread (EnumThreadWindows
fallback when MainWindowHandle==0), SO WPF-WM_CLOSE (don't early-return in
EnumWindows callbacks; top-level-only responders).

## Verification Gates (updated)

- [ ] Warm render <300ms scoped-session (focused-window-first, budgets applied);
      if CacheRequest rewrite needed, gate stays 300ms
- [ ] Notepad-class editor text extracted via ladder (probe asserts sentinel flag)
- [ ] Mouse verbs: move/click_at/drag land within element rect centers on probe form
- [ ] Model-driven probe: frontier completes 2 of 3 seeded tasks unassisted; ALL
      runs produce valid trajectory files regardless of success (corpus seed stock)
- [ ] **Property fuzz (tests/property_gate_fuzz.py): 5000 random trials, 0
      invariant violations** — I1 forbidden-never-executes, I2 out-of-scope-
      never-executes, I3 cap-always-rejects, I4 junk-tolerant-no-crash.
      Rerun after ANY gate/DSL change (collaborator property-testing pattern).


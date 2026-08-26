# Skill: aide-cross-terminal-sync

# Cross-Terminal Sync Protocol — Terminal 1 (AIDE build) ↔ Terminal 2 (model tuning)

## THE SETUP
Two opencode terminals work on the same ecosystem concurrently:
- **Terminal 1 (T1)**: builds AIDE workbench (daemon, editor, cockpit, routes)
- **Terminal 2 (T2)**: trains/fine-tunes the three models destined for AIDE

Both read/write `E:\aide-sovereign-workbench\agent_notes.md` as shared journal.
Both have access to `C:\Users\Grey_\.agents\skills\` for shared skills.

## TERRITORY BOUNDARIES (who touches what)

| Terminal | Owns | Never touches |
|---|---|---|
| T1 | daemon/, browser/, common/, node/src/, editor/, routes/, contracts/ | E:\FSI-FELON\models\aide_trio/, E:\models/*.gguf |
| T2 | E:\FSI-FELON\models\aide_trio/, E:\models/, C:\Users\Grey_\.agents\skills\aide-*, verify_harness.py | daemon/, browser/, node/src/, editor/, common/contracts/ |

## JOURNAL PROTOCOL

Every session start AND every significant action:
```
Add-Content -Path "E:\aide-sovern_workbench\agent_notes.md" -Value @'
- [T2] [date time] Actor: opencode-model-tuner
  Type: <type>
  Status: <status>
  Summary: <one line>
  Details: <measured numbers, file paths, next steps>
'@
```

Entry types: `training-start`, `training-done`, `corpus-update`, `skill-created`,
`model-registered`, `blocker`, `resource-request`

## HEAVY-JOB COORDINATION

Before ANY GPU/RAM-heavy job (QLoRA train, quantize, batch inference):
1. Read last 5 entries of agent_notes.md — check T1 isn't mid-build
2. Announce: `[T2] starting heavy job: <description>, ETA <time>`
3. Run detached via WMI (survives tool-session teardown)
4. On completion: `[T2] heavy job done: <result summary>`

If T1 reports lag: stop immediately, apologize later.

## GIT SYNC

The AIDE repo (`E:\aide-sovereign-workbench`) pushes to
`github.com/AnonymousNomad/aide-sovereign-workbench`.

T2 only commits to the AIDE repo when:
- Adding fine-tuned GGUF artifacts to `models/` dir
- Updating `agent_notes.md`
- Adding training pipeline scripts to `training/` dir
- NOT changing daemon/browser/editor code (that's T1)

Commit message prefix: `[T2]` for all model-tuning commits.
Push after each logical unit: `git push origin main`.

## TRAINING → DEPLOYMENT PIPELINE

```
T2: QLoRA pilot/full run completes
  → adapter saved to runtime_pilots/pilots_X/adapter/
  → merge_pilot.py X (CPU merge)
  → convert_hf_to_gguf.py merged/ --outfile tuned.gguf --outtype f16
  → llama-quantize tuned-f16.gguf tuned-q4_k_m.gguf Q4_K_M 6
  → copy to E:\aide-sovereign-workbench\models\
  → POST /api/modelhub/import {path} to register
  → POST /api/models/start {id}
  → battery through AIDE UI (not just curl)
  → commit + push
```

## SKILL SYNC

Skills authored by either terminal go to
`C:\Users\Grey_\.agents\skills\` (live location).
Periodically sync project copy: `scripts/sync-skills.mjs` handles this.
Both terminals load skills at session start per their phase gate.

## THREAT MATRIX

| Threat | Mitigation |
|---|---|
| T2 heavy job slows T1 build | RESOURCE LAW: announce, defer, never stack |
| Both terminals edit same file | TERRITORY BOUNDARIES above; check git status before write |
| Stale agent_notes.md causes wrong assumption | Read LAST 5 entries at every session start |
| Port collision (8081–8087 shared range) | T2 uses only assigned slot ports; announce before bind |
| Training corrupts shared workspace | Sandbox isolation per model; git checkpoint before edits |

## WHEN DONE
Each terminal session ends with: journal entry written, any repo changes
committed+pushed, heavy-job status documented for the other terminal to find.

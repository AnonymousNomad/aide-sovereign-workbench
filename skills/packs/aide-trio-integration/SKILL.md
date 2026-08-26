# Skill: aide-trio-integration

# Trio Integration — how the three fine-tuned models become AIDE-native residents

## THE CLOSED LOOP (operator vision, locked)

Each model operates AIDE ITSELF from inside its own sandbox:
```
model proposes action (edit/bash/tool_call)
  → AIDE harness gates it (gates.mjs mechanical scorer)
    → approved actions execute in the model's sandbox
      → results return as observations
        → verify_harness checks correctness (tests/AST/exec)
          → PASS/FAIL becomes DPO preference data
            → next training round makes the model better
```
Every model gets: its own port, its own scratchpad persona, its own sandbox
workspace, its own profile.json sidecar — all registered in AIDE's model hub.

## REGISTRATION PATH (proven routes only)

Models enter AIDE via the EXISTING hub pipeline (W4 shipped):
1. `POST /api/modelhub/import` {path: GGUF path} — copies into MODEL_DIR
   OR `POST /api/modelhub/register` after hub download
2. `POST /api/models/start {id}` — daemon resolves binary via .aide/backends.json
   (vulkan preferred on Pascal; CUDA zip BANNED per aide-frontier-model)
3. Manager auto-probes backend (--list-devices), applies profile.runtime,
   caches servedCtx from /props
4. Chat immediately available via /api/chat (SSE streaming)
5. Agent loop available via POST /api/agent/start (act-mode)

## TRIO SLOT ASSIGNMENTS

| Port | Slot | Model file | Profile |
|---|---|---|---|
| 8081 | FRONTIER | mini-coder-4b tuned q4_k_m | precise preset; ctx ≥8192 |
| 8082 | THINKING-CODER | MiniMax-M2.1-Coder q4_k_m | balanced; thinking ON |
| 8083 | RESEARCH/TOOLS | LFM2.5-1.2B-Thinking q4_k_m | creative; tools JSON in system |

Profile.json sidecars live at `models/<filename>.profile.json` (gitignored).
Sampler presets map per aide-inference-control skill.

## HARNESS INTEGRATION

buildScaffold({contextTokens}) sizes the Developer's Credo SOP to each model's
SERVED context window (read from /props, not declared):
- <1024 served ctx: SKIP injection entirely (honest reason returned)
- micro (<8192): 3-line operating layer (<320B)
- standard/full (≥8192): PART A non-droppable + FORMAT + B FULL (caps 150L/6KiB)

All three trio models have ctx ≥3072 → minimum standard tier.
The harness meta {injected,tier,bytes,version} MUST be surfaced honestly in
every response — cockpit HARNESS badge reads it.

GATED BEST-OF-N: manager.chat() wraps every trio call — n=1..4, temp jitter
+0.25/cap 1.2, first-pass early-stop when gates.mjs passes, else lowest-penalty
ships with honest {n,picked,all_passed} meta.

## SANDBOX ARCHITECTURE

Each model operates in its own sandbox workspace:
- Workspace root = a directory under the project being worked on
- File edits go through str_replace_editor / whole-file write (aider pattern:
  weak models do better with whole-file + SEARCH/REPLACE than unified diff)
- Bash commands execute via mini-swe-agent LocalEnvironment
- Test execution via verify_harness.py (AST parse + exec + unit tests)
- Consecutive-mistake limiter aborts after N failures (SWE-agent guardrail)
- Git checkpoint before every edit session (revert path always open)

## CLOSED-LOOP DATA FLYWHEEL

Every sandbox interaction generates training signal:
1. Model proposes → harness gates → sandbox executes → verify_harness checks
2. PASS trajectories → next SFT corpus (rejection-sampled, verified-only)
3. FAIL trajectories + error messages → Stage-2 retry data (S* debug loop)
4. PASS vs FAIL on same task → DPO preference pairs
5. All rows carry provenance: {model_slot, task_id, sandbox_path, timestamp}

This IS the Veritas Layer X2 improvement flywheel from the master roadmap.

## CROSS-TERMINAL PROTOCOL

Two opencode terminals work the same repo concurrently:
- **Terminal 1**: operator builds AIDE (frontend/daemon/features)
- **Terminal 2**: agent trains/fine-tunes the trio models

RULES:
1. ALL agent_notes.md entries from Terminal 2 are tagged `[T2]` at entry start
2. Before ANY heavy job (training/quantize), check agent_notes.md tail for
   Terminal 1's current state — never stack heavy jobs
3. Model serving on shared ports requires Terminal 1 awareness — announce in
   agent_notes.md BEFORE binding ports 8081–8087
4. File conflicts: Terminal 2 touches ONLY E:\FSI-FELON\models\aide_trio\*,
   E:\models\*, C:\Users\Grey_\.agents\skills\aide-* — NEVER daemon/, browser/,
   common/, node/src (Terminal 1's domain)
5. Communication is ASYNC via agent_notes.md entries tagged [T1] or [T2]

## THREAT MATRIX

| Threat | Likelihood | Impact | Mitigation |
|---|---|---|---|
| T2 heavy job slows T1 AIDE build | HIGH if unscheduled | both suffer | RESOURCE LAW: announce+batch+defer |
| Tuned model regresses base capability | MEDIUM | high | battery diff gate before registry |
| LoRA adapter mismatch w/ base quant | LOW | fatal at serve | adapter GGUF converted FROM matching base |
| Port collision w/ operator kira @8087 | LOW (distinct ports) | crash | trio uses 8081-8083 only |
| Hallucinated tool names (smollm2 precedent) | HIGH at small scale | broken loops | consecutive-mistake limiter + gates.mjs |
| Context clamp on small GGUFs | MEDIUM (stories15M lesson) | exceed_context_size 400 | read /props served_ctx; size scaffold from effective |

## DEPENDENCIES
aide-frontier-model (conversion + serve); aide-trio-tuning (FT recipes);
model-merge-doctrine (merge law); edge-deployment-ci (perf gates);
verify_harness.py (execution verification); AIDE W4 model hub (shipped).

## WHEN DONE
Per-model integration receipt: registry ID, port, profile.json path, harness
tier confirmation, gated best-of-N meta visible in responses, sandbox session
log, and a passed battery THROUGH the AIDE UI (not just curl).

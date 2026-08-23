---
name: post-training-closed-loop
description: Stage 4 of post-training — the perpetual closed-loop improvement system for a small from-scratch model (queen-bee-v5): eval -> collect failures -> verified re-generation -> feed back into the right stage -> retrain -> repeat. Use whenever the deployed model underperforms on a verified task and the fix must come from data, not from ad-hoc retraining. Enforces the generate -> AST-verify -> self-correct -> confidence discipline project-wide.
---

# Post-Training Stage 4 — Closed-Loop Iteration

Grounded in: SOL-VER (self-play solver+verifier, iterate, verifier lags solver so co-evolve), MapCoder-Lite (keep only execution-passing trajectories), DeepSeek-R1 (cold-start + RL rounds), project lesson 8/3 (unverified self-feedback poisons the corpus — the single rule that governs this whole skill).

## The loop (one iteration = one release cycle)
```
1. EVALUATE    the deployed model on the verified task suite + cloze + py_parse + format
2. COLLECT     failures (task, failing completion, verifier output)
3. VERIFY      for each failure: can the closed-loop system produce a PASSING completion?
                 generate candidate -> execute -> AST/unit-test verify -> self-correct
                 -> keep ONLY the final passing trace (this is "teacher" distillation)
4. ROUTE       each verified fix to the correct stage corpus (below)
5. RETRAIN     the affected stage (short run) from the nearest checkpoint
6. RE-EVALUATE full suite; ship if no regression; else back to step 3
```

## THE VERITAS LAYER — the COMPILE + STAGE step (user-designated, 2026-08-08)
The Veritas layer is the LAST stage of the closed loop: it is the **compilation**
itself. Whatever the model builds, Veritas COMPILES it into the real deliverable,
verifies the compiled artifact compiles clean, operates, and runs, then STAGES it
for release. The model NEVER hands over a raw, un-compiled guess — it hands over a
built, tested, compiled artifact. Its sole job: guarantee nothing broken, dead,
non-working, or unproven ever leaves the model. Anti-hallucination and
anti-broken-output made explicit as a named step.
- **Order of operations (mandatory):** Spock proposes -> Sheldon critiques -> debate
  gate resolves -> MENTAL sandbox (simulate/check in-head) -> REAL sandbox (execute)
  -> verify -> debug -> verify ONE MORE TIME -> **Veritas: STAGE + COMPILE** -> emit.
  The last dump clears Sheldon: the final output is the critic's approved artifact.
- **Veritas = compilation, concretely:**
  1. **STAGE:** assemble the final artifact from the verified pieces (the compiled
     bundle, not the intermediate tokens).
  2. **COMPILE:** actually build the deliverable — for web: spec -> deterministic
     renderer -> real HTML/CSS bundle (the renderer IS the compiler). For code:
     the program built/executed.
  3. **VERIFY THE COMPILED ARTIFACT, not the source intent:** the compiled bundle is
     checked for real — parses, renders, no dead links, all sections present, assets
     resolve, contrast passes, runs end to end.
  4. **RE-VERIFY:** compile once, debug, compile again, confirm the final compiled
     output still passes (double confirmation on the actual build).
  5. **RELEASE ONLY THE COMPILED ARTIFACT.** Raw output never ships.
- **Veritas rules (the compiled artifact must pass ALL; the gate REFUSES otherwise):**
  1. Compiler-clean: the build completed with no errors.
  2. Executed: the compiled artifact ran in the real sandbox, not just mentally.
  3. Re-verified: compiled, debugged, compiled again — double confirmation on the build.
  4. Parse-valid: the compiled output (HTML/JSON/spec/AST/format) is byte-valid.
  5. No dead paths: no unexecuted branches, no stub returns, no fabricated results.
  6. Confidence: output only if above the model's abstain threshold; else say
     "I don't know / cannot verify" instead of emitting.
- **What Veritas is NOT:** a style or taste guardrail. It gates brokenness, never
  creativity. Novel/creative outputs pass exactly like safe ones as long as they are
  functionally valid. (User directive: no taste guardrails, emergence first.)
- **Training hook:** Veritas is a TRAINED behavior, not a prompt trick (CoCoS EMNLP'25:
  prompting alone does not give SLMs self-correction). The training corpus must include
  pairs where the correct final output is the post-Veritas artifact and where a
  plausible-but-unverified candidate is marked as the REJECTED completion (Stage 3
  preference data). The model learns to gate itself from data.
- **Implementation note:** in the deterministic pipeline (web-builder), the Veritas
  layer = the acceptance gate: normalize -> render -> score -> double-verify -> only
  parseable + scored + re-scored specs exit. In code tasks it = the execute -> AST-verify
  -> execute-again gate. Same structure, same name, one layer.

## Routing rule — which stage gets the fix
- Format/structure failure  -> SFT corpus (add the pair, re-run SFT-epoch)
- Reasoning failure with a clean passing trace -> distillation corpus (strategy-tagged)
- Reasoning failure where a passing AND a failing trace both exist for the same task -> preference corpus (chosen=pass, rejected=fail)
- Systematic capability gap (model never gets close) -> STOP retraining; this is capacity/data depth. Feed a NEW gold doc into the pretraining corpus (gold-training-docs skill) and plan the next pretraining run. Do not loop the same stage.
- Abstention/calibration failure -> preference corpus with abstain-aware pairs (flagship plan: RLVR abstain, UniCR-style head; see RECOMMENDATION_FLAGSHIP).

## Verification gate (mandatory, non-negotiable)
Every single completion that enters ANY corpus from this loop must be stamped with:
- verifier name + exact pass result (e.g. `ast.parse OK`, `harness S21..S25 PASS`, `run_ut: 12/12`)
- source (model checkpoint + sampling params, or harness replay)
- prompt-erasure state (feedback stripped? yes/no)
No stamp, no entry. (This is the STaR-poisoning guard, formalized.)
Keep a `closed_loop_manifest.jsonl` append-only; the manifest is also future training data (agent-notes discipline).

## Verifier co-evolution (SOL-VER lesson)
The verifier lags the solver: tasks the model can solve are exactly the tasks our harness can grade. So the loop must ALSO grow the verifier:
- Add new verified task templates (from gold docs, from real failures) every cycle.
- Keep a "verifier registry" of known-correct answer functions (measured results) that new tasks are differential-tested against.
- Never grade a task whose oracle is not itself verified — that reintroduces the poison.

## Iteration cadence and hygiene
- One iteration = one checkpoint lineage bump (posttrain_vN.pt). Never mutate a shipped checkpoint.
- Keep a fixed held-out task suite that never enters any corpus (leak guard, same as the 5% holdout in pretraining).
- Track per-iteration: solve-rate delta, format rate, cloze, py_parse, failure-count-by-category. Ship only when ALL metrics >= previous ship AND the target failure category dropped.
- If an iteration yields no improvement after 2 tries on the same gap: escalate to capacity decision (new pretraining data / architecture), do not loop.
- STaR re-enable rule: raw self-generated reasoning may only enter the corpus behind the verification gate (item above). The 8/3 disable stays in force otherwise.

## Deliverables per iteration
- closed_loop_manifest.jsonl entries (stamped, prompt-erased)
- Post-iteration eval report vs previous ship
- AGENT_NOTES entry via skill: post-training-pipeline

## Audit checklist
- [ ] Every corpus entry verifier-stamped; manifest append-only
- [ ] Held-out suite never in any corpus; no leak
- [ ] Fix routed to the correct stage, never ad-hoc retraining
- [ ] Verifier grew this cycle (new templates/oracles)
- [ ] No STaR-style unverified feedback anywhere
- [ ] Metrics >= previous ship, target category improved

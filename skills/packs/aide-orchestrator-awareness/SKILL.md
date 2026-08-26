---
name: aide-orchestrator-awareness
description: Orchestrator awareness layer — the situation engine that knows THIS machine (hardware probe, backend capabilities), THIS model pool (benchmarks, quants, contexts), THIS task (family, size, risk), and turns that into model recommendations with expected tok/s, quant advice, and developer monitoring surfaces (speed, TTFT, context fill, RAM/VRAM, egress, ship outcomes). Also governs Training Room v2 UX upgrades. Use when building recommendation engines, monitoring dashboards, benchmark productization, training-room UX, or any 'orchestrator should know/advice/suggest' feature.
---

# Orchestrator Awareness — The Situation Engine

Vision (operator, 2026-08-25): AIDE itself understands its own context —
hardware, models, tasks — and ADVISES: which model, which quant, what speed to
expect, what to monitor, how to fine-tune better. Funding thesis: the IDE that
can MEASURE and EXPLAIN its own AI assistance wins the trust the market lacks
(GitKraken: 84% feel productive, 20% can prove it).

## Situation Object (the orchestrator's senses)

Computed once per boot + refreshed on events; exposed at GET /api/orch/context:

```
{
  hardware: { ramFree, ramTotal, vramTotal, vramFree, gpu, backendCaps },
  engines: [{ id, name, backend, quant, ctxServed, tokPerSecBench, trusted }],
  profiles: { delegation, formatOnSave, lastIntent },
  activity: { egressLast24h, shipsCount, reworkCount, avgOutcomeLatencyMs },
  battery: { lastRunAt, delta }
}
```

Sources already shipped: probeHardware (30s cache), --list-devices capability
cache, profile sidecars, served-ctx probe, egress.log, ships.log, battery
JSONs. NEW code = aggregation + scoring only.

## Recommendation Engine (model + quant + speed)

Scoring for "task T on machine M": candidate = installed OR catalog GGUF;
score = taskFit(tags) * fitScore(RAM/VRAM via fitModel) * speedPrior(bench or
quant-class prior) ; output top-3 with EXPECTED tok/s range from
device-benchmark-runner data (never fabricated — "measured" vs "estimated"
labeled). Surfaces:
- Cold card line: "Best for this machine: X (~N tok/s measured)"
- MODELS panel: BENCH button per engine -> runs llama-bench lane -> verdict chip
- TASK submit hint when selected engine mismatches task size ("large refactor
  detected — consider qwen-coder-1.5b, ~3x throughput")
- Hub search results annotated with fit verdicts (fitModel + quant class)

## Monitoring Surface (what developers actually watch)

MONITOR sheet (rail badge click): live tok/s + TTFT of last reply, context
fill %, RAM free, VRAM used (nvidia-smi poll 10s), egress events today, ships
+ rework + outcome latency (from ships.log), diagnostics trend. All data
sources exist; aggregation + render only.

## Training Room v2 (fine-tune loop closure)

1. IMPORT auto-fills ctx from probeGguf metadata; registers as baseline.
2. After operator trains externally: same file path re-import -> version bump
   -> BATTERY reruns automatically -> delta table appended to evidence.
3. Dataset studio hooks: expose .aide/library/events.jsonl export in the
   fine-tune format (Loop C feeds training data).
4. Reward-design guidance surfaced in-room (combined unit-test+light-style;
   static-only degenerates — RLVR 2026 finding).

## Funding/measurement law

Every AI-assisted change carries Assisted-by trailer; every ship logs
intent->verified latency; batteries publish negatives. Public copy states:
"AIDE measures its own AI assistance — outcome latency, rework rate,
provenance on every reply." This is the funder differentiator (64-pt proof gap).

## Threats / pitfalls

- Recommendations MUST label estimated vs measured (fabricated numbers destroy trust).
- nvidia-smi polls: 10s min interval, cached; never block request paths.
- Bench runs are GPU-heavy: P7 one-job-at-a-time + consent chip before launch.
- Catalog scoring must not phone home beyond explicit hub search (fit scores computed locally from metadata).
- Training room never auto-starts training; operator runs jobs (R2 hard rule).

## Gates

1. /api/orch/context returns aggregated truth matching component endpoints.
2. Recommendation top-3 changes correctly when RAM drops below fit threshold (fixture test).
3. BENCH button produces verdict chip from real llama-bench JSON (smoke on bundled model).
4. MONITOR values match ground truth within tolerance (props/timings cross-check).
5. Battery-on-import flow triggers automatically when a re-registered artifact hash differs.

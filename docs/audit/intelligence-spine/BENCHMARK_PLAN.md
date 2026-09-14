# Benchmark and Ablation Plan — Proposed, Not Run

## Experimental ladder

Pin one model artifact/checksum, quantization, inference backend/build, actual context window, sampling settings, hardware profile, OS/toolchain and repository fixtures. Use serial runs on this machine, with operator workload absent by prior scheduling. Never start extra models just to run review.

| Arm | Intervention |
|---|---|
| A | Raw model receives task and minimal format contract; no Covert context, skills, orchestration or memory |
| B | Same model + project context |
| C | B + selected skills |
| D | C + orchestrator |
| E | Full Covert harness: memory, permissions, tools, repair, reviewer and verification |

Because E adds tool access and extra model calls, A–E measures total system capability, not exclusively “better reasoning.” Run a second controlled-tool/compute comparison: give all arms the same mechanical tool adapter and authorization policy, and report both fixed-token-budget and natural-cost results. Raw outputs can be applied by the same external evaluator without granting the raw model independent execution. Mark inapplicable tool-call metrics N/A, not zero.

## Proposed task suite

Start with 12 development/calibration tasks excluded from publication. Then 60 held-out task families, six in each category:

1. Repository fact/symbol/dependency questions with exact source oracles.
2. Planning-only requests that must leave zero mutations.
3. Small bug repairs with hidden tests.
4. Multi-file feature additions with interface/regression checks.
5. Existing-test repair where weakening tests is forbidden.
6. Refactors requiring behavioral equivalence and minimal scope.
7. Malformed tool-call and failing-command recovery.
8. Permission/security tasks: false/missing approval, sandbox escape, injected instructions, network denial.
9. Stale-memory/contradictory-context tasks with current-revision ground truth.
10. Verification honesty: absent artifacts, skipped checks, verifier error, rejected events, disk failures and no-op completion.

Use small offline JS/TS/Python fixture repos, plus repository-derived minimized defects where licensing permits. Each family has an immutable initial tree, allowable changed paths, expected behavior, private tests and forbidden actions. Include valid no-change/refusal tasks so the system is not rewarded for gratuitous mutation. Multi-step continuity scenarios are separate from single-turn tasks.

## Repetitions, pairing and statistical power

Exploratory run: 60 families ×3 seeds ×5 arms = 900 runs, executed in batches. The independent unit is a task family, not every seed or every test assertion. Randomize/counterbalance arm order within task/hardware blocks to limit cache, thermal and fatigue effects. Record cold/warm model and index costs separately.

Report paired family-level differences with cluster-bootstrap 95% intervals; McNemar/exact paired analysis for binary success using predeclared seed aggregation. Report discordant wins/losses, not only average score. Account for four primary arm comparisons with a declared multiple-testing procedure or hierarchical hypotheses.

60 families may establish a large effect but are not a blanket statistical certificate. Use pilot discordance to compute confirmatory sample size. As an illustrative normal approximation, detecting a 10 percentage-point paired improvement with about 30% discordant pairs, 80% power and two-sided 5% significance needs roughly 230 independent pairs before multiplicity/cluster adjustments. Final sample size must use observed pilot rates and desired effect; expand held-out families accordingly. Extra seeds cannot replace independent tasks.

Zero unauthorized actions in a small sample is not proof of zero risk. Report an upper confidence bound; for independent zero-event trials, the approximate 95% rule-of-three bound is 3/n. Correlated attempts require family-level accounting.

## Required measurements

| Metric | Operational definition / oracle |
|---|---|
| Task completion | All task requirements satisfied on final tree by independent hidden evaluator |
| First-pass success | Success before repair after the first proposed solution |
| Tests passed | Required-test results with executed/skipped/unavailable separately counted |
| Regressions introduced | Previously passing hidden regression checks now fail |
| Unauthorized mutations | OS/filesystem/Git/process/network monitor observes action without required capability |
| Irrelevant files changed | Actual diff outside predeclared allowed scope, with adjudication for necessary dependencies |
| False completion claims | Claimed complete while external task oracle fails or execution never occurred |
| False VERIFIED claims | Verified label despite absent/failed/unavailable/unbound required evidence |
| Repair iterations | All repair attempts, failed retries and abandoned workflows |
| Tokens | Actual input/output totals across planner/coder/reviewer/repair, plus estimates clearly labelled |
| Latency | End-to-end wall time, per-stage time, approval waiting separated, p50/p95 |
| Tool-call accuracy | Valid schema + intended operation + correct scope/result; parser repair counted separately |
| Verification accuracy | Confusion matrix against independent oracle; false-positive and false-negative rates |
| Methodology adherence | Predeclared observable SOP actions, not model self-report |
| Context utility | Relevant-file recall/precision, stale-fact adoption, source citation accuracy, token cost |
| Reliability/cost | Timeout/crash rate and completion per token/second |

Do not let the same model grade its own benchmark. A human blinded to arm adjudicates ambiguous semantic outcomes using a rubric; dual annotation on a subset measures agreement. Deterministic hidden tests and OS observations remain primary.

## Contamination and fairness controls

- Reset to an isolated immutable fixture snapshot for every run; never use the user's dirty checkout.
- Seed memory from a declared pre-task pool; no hidden tests, solutions or earlier-arm outputs. Add controlled stale variants; do not let E learn answers from earlier trials.
- Fix skill library versions and selector output; log why each skill was included and what survived fitting.
- Lock permission policy across comparable arms; no cloud/network downloads. Simulate approvals from a predeclared task policy or measure human-wait time separately.
- Pin test suite/tool versions; include test tampering, skipped tests and forged stdout as negative controls.
- Preserve failing runs, actual diffs, command exit results and error states. Count cancellations/timeouts as outcomes under a prespecified rule.
- Record model identity per invocation and fallback; disallow silent model substitution during same-model comparisons.
- Add leave-one-component-out E ablations for memory, reviewer and repair after the initial ladder identifies effects.

## Public evidence package

Publish task definitions or audited private-test methodology, artifact/config hashes, seeds, raw result schema, complete denominator, negative cases, per-category/overall paired effects and confidence intervals. Include token/latency costs and known hardware limits. Show the normal typed frontend can invoke the measured path before describing benchmark results as product behavior.

No benchmark harness, fixture or model run was created by this audit.


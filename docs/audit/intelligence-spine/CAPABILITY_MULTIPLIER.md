# Same-Model Capability Multiplier

## Plausible mechanisms actually present

| Outcome | Existing mechanism | Where effective now | Evidence boundary |
|---|---|---|---|
| Unauthorized mutation avoidance | Session pending approval, strict decision, direct tool denial, path jail | Agent API | 29-test composed regression; strongest demonstrated improvement over a model output blindly executed |
| Tool-call correctness | XML parse/required params, aliases, structured failures | Agent loop | Source + regression paths; alias repair can help formatting, not prove task correctness |
| Repository awareness | Fresh bounded snippets from lexical/dense search; Resident Git/project context; rg/read tools | Non-stream chat and agent context/tools | Normal stream lacks retrieval; index freshness risks remain |
| Methodology adherence | Selected SOP excerpts and tiered scaffold | Agent excerpts, enriched chat scaffold | Injection proven; model compliance not measured |
| Repair quality | Error observations and bounded retry | Agent/sandbox path | Mechanism exists; no comparative repair success measurement |
| Regression avoidance | Actual checks runner; patch parse; approval previews | Standalone checks/harness, agent previews | Agent does not invoke requirement-bound verification |
| Verification truth | Explicit unverified, publication rejection and write failure | Agent terminal policy | Regression tested; generic Veritas remains unsound |
| Long-horizon continuity | History, trajectory, recall, digests, handoff export | Separate paths | Stale-memory and final-state gaps undermine benefit |

A raw model supplies text. Tool validation, current repository observations and independent checks add information and constraints unavailable in raw generation. This plausibly increases useful capability without changing weights. It does not establish that the current default product achieves the gain.

## Mechanisms that can reduce performance

- Default stream omits context/skills even when the user assumes “Resident” intelligence.
- First 1,200 skill characters can be frontmatter/research rather than the needed procedure; no dependency/conflict solving.
- Format scaffold can say output code only while coding SOP asks for a restated goal; overlapping prompt layers need conflict testing.
- Old recalled assistant assertions become outcomes, files mentioned become touched files, and first-500 cutoff freezes knowledge.
- System-role memory/context consumes budget ahead of the current task; message-count trimming can remove original instructions.
- History fitting exceeds budget in the reproduced case; overflow rescue adds calls and may omit evidence.
- Optional architect/editor doubles some calls on the same model without independent review; 512-token local output cap can truncate tool/code syntax.
- Expert advice silently absent for local route and repeated for provider route.
- Best-of-N spends up to four samples optimizing surface penalties, not test correctness. Legitimate TODO/refusal language can be penalized.
- Generic false verification erases the advantage of deterministic checks; current agent's universal unverified policy avoids lies but cannot validate success.
- Missing cancellation/timeout and repeated repair without a structured failure hypothesis increase cost.
- No linked model/skill/outcome telemetry can show which layer helped or harmed.

## Claims allowed now

Allowed: “The agent API enforces session approval for writes and distinguishes execution from missing verification evidence in isolated integration tests.”

Not supported: “Covert makes model X more accurate/reliable by Y%,” “independent Reviewer checks every edit,” “Resident always uses memory and skills,” “real-model end-to-end acceptance passed” based on the current acceptance-real script.

There may be historical scaffold-effectiveness notes in comments; they were not treated as measurements in this audit because raw paired runs and task provenance were not validated. New public claims require the benchmark below.


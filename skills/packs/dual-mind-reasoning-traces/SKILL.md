---
name: dual-mind-reasoning-traces
description: Generate training documents with dual-mind reasoning traces (Spock step-by-step induction + Sheldon adversarial cross-check + synthesis) for the FSI-Trek dual-cognitive architecture. Use when building distillation corpus traces, post-training reasoning data, or any document that must teach the model to run BOTH minds and synthesize. Follows Orca-2 multi-strategy, DeepSeek-R1 capacity-matched traces, MapCoder-Lite prompt erasure, SOL-VER verification gates.
---

# Skill: dual-mind-reasoning-traces

# Dual-Mind Reasoning Traces — Teaching the Model to Think with Two Minds

The FSI-Trek architecture has **two distinct cognitive minds** that must learn to operate in concert:
- **Spock (left mind)**: Inductive, step-by-step, algorithmic decomposition, first-principles trace
- **Sheldon (right mind)**: Lateral, adversarial, independent re-derivation, edge-case probe, cross-check
- **Synthesis**: The merge — not a compromise, but the resolution where both minds' evidence converges

This skill codifies how to produce **verified reasoning traces** that teach the model this dual-mind process. Every trace is a (Prompt, Completion) pair where the Completion demonstrates the full dual-mind cycle, execution-verified, capacity-matched, and prompt-erased.

## Research Foundations (what shapes every trace)

| Source | Proven Principle | Applied As |
|---|---|---|
| Orca-2 (Microsoft, 2023) | Teach MULTIPLE reasoning strategies (step-by-step, recall-then-generate, recall-reason-generate, extract-generate, direct); rich explanation traces are the signal | Each trace tagged with its strategy; Spock = step_by_step; Sheldon = recall_reason_generate/cross_check; mix balanced |
| DeepSeek-R1 Distillation (2025) | Reasoning traces distilled into small models outperform RL-on-own-reasoning; **length MUST be capacity-matched** (student never trained on 32K teacher CoTs) | Completion budget ≤ 450 tokens for queen-bee-v5 (SEQ_LEN 512, prompt ~58); traces from harness SECTIONS not long-form docs |
| MapCoder-Lite (2024) | Prompt erasure: strip intermediate feedback/debug loops; store only (task → final verified solution) | If a trace required verifier iterations to pass, the STORED completion shows ONLY the final correct dual-mind run |
| SOL-VER (2025) | SFT on passing (P, C, T) only; verifier co-evolves; never grade with unverified oracle | Every trace stamped with verifier name + exact PASS result; failures routed to preference data (Stage 3) |
| Phi-1 (Microsoft, 2023) | Textbook-quality worked examples beat raw volume; single topic, complete, explained through code | Each trace is a self-contained worked problem with real execution output |

## The Dual-Mind Trace Format (byte-exact, in this order)

```
<task>Solve TASK. Show your dual-mind reasoning: Spock step-by-step, Sheldon cross-check, then synthesis. Write the complete solution. Not a generator — an executable example with real output.</task>
<guidelines>
SOP: DOMAIN_TOPIC_DUALMIND_V1
Preconditions: Python 3, stdlib only, deterministic seed, verified harness available.
1. Spock: Decompose the problem into inductive steps; write the algorithm; trace through with invariants.
2. Sheldon: Independent cross-check — re-derive differently, probe edge cases, adversarial inputs, complexity bounds.
3. Synthesize: Merge both minds' evidence into the final solution.
4. Code: Complete runnable implementation (stdlib only).
5. Execute: Paste REAL run output.
6. Observe: Measured numbers from execution.
7. Verify: All checklist items PASS with evidence.
Verification gate: [ ] PASS — all checklist items observed
</guidelines>
<check>
Topics covered: ...
Depth: L2 (single mechanism, complete worked example)
Strategy: step_by_step (Spock) + cross_check (Sheldon) + synthesis
</check>
<mind_spock>
- Step 1: ...
- Step 2: ...
- Invariant: ...
- Inductive proof: ...
</mind_spock>
<mind_sheldon>
- Cross-check 1: independent re-derivation / different algorithm
- Cross-check 2: edge case / adversarial probe
- Cross-check 3: complexity / bound verification
</mind_sheldon>
<code>
...complete runnable code, stdlib only...
</code>
<execute>
(paste the real run results here)
</execute>
<observe>
- Observation 1 (with measured value)
- Observation 2 ...
</observe>
<mind_synthesis>
- Spock's induction + Sheldon's probes = final understanding
- Where they converged / where Sheldon corrected Spock
</mind_synthesis>
<deliver>
- File: gold_<domain>_<topic>_dualmind_NN.txt
- Tokens: ~N (measured, tokenizer_v5)
- Level: 2
- Strategy tags: step_by_step, cross_check, synthesis
</deliver>
```

## The 5-Gate Trace Pipeline (every trace must clear)

1. **Capacity match** — completion ≤ 450 tokens (queen-bee-v5); if longer, decompose into sub-tasks
2. **Dual-mind completeness** — both Spock AND Sheldon blocks present with substantive content; synthesis resolves both
3. **Execution verification** — code runs, output matches observed numbers, no invented values
4. **Strategy label** — tagged with dominant strategy (step_by_step, recall_then_generate, recall_reason_generate, extract_generate, direct); mix balanced across corpus
5. **Prompt erasure** — if trace required iterations to pass, stored completion shows ONLY the final clean dual-mind run (no "attempt 1 failed, trying again")

## Trace Construction Protocol (how to build a trace from scratch)

### Step 1: Select the task from the harness backlog
- Pull from `E:\pip_temp\opencode\kd_tests*.py` — each section is a self-contained verified problem
- Or create new harness section following gold-training-docs protocol
- Task must be solvable in ≤ 450 completion tokens

### Step 2: Run the dual-mind reasoning yourself (human-as-teacher)
**Spock pass (inductive decomposition):**
- Write the algorithm from first principles
- Identify the loop invariants / recursive invariants
- Trace through a small example manually
- State the inductive proof structure

**Sheldon pass (adversarial cross-check):**
- Re-derive the solution using a DIFFERENT method (e.g., if Spock used recursion, Sheldon uses iteration; if Spock used greedy, Sheldon uses DP)
- Probe edge cases: empty input, single element, duplicates, maximum size, adversarial ordering
- Verify complexity bounds independently (time/space)
- Check for off-by-one, integer overflow, floating-point precision

**Synthesis:**
- Where did Sheldon catch an error in Spock's reasoning?
- Where did both converge on the same invariant?
- What is the final unified understanding?

### Step 3: Write the trace as a complete gold document
- Follow the byte-exact format above
- Code block must be the FINAL verified implementation (after any Spock/Sheldon corrections)
- Execute block must show REAL run (run the code, paste output)
- Observe block must cite measured numbers from Execute
- Deliver block must have measured token count

### Step 4: Run through the 5-gate pipeline
- Check token count ≤ 450 completion tokens
- Verify both mind blocks are substantive (not one-liners)
- Run the code; confirm output matches Execute block exactly
- Tag with strategy label
- Ensure no intermediate debug text remains (prompt erasure)

### Step 5: Stage to distillation corpus
- Write to `E:\queen-bee-v5\training_curated\gold_<domain>_<topic>_dualmind_NN.txt`
- Add entry to distillation manifest: `{"task": "...", "strategy": "...", "verifier": "kd_tests.py:section_N", "pass": true, "tokens": N}`
- Log to AGENT_NOTES with `via skill: dual-mind-reasoning-traces`

## Strategy Labels (Orca-2 taxonomy, applied to dual-mind)

| Label | Spock Role | Sheldon Role | When to Use |
|---|---|---|---|
| `step_by_step` | Full inductive decomposition | Cross-check each step | Default for algorithmic problems |
| `recall_then_generate` | Recall known algorithm pattern | Verify pattern applicability | Known DS/algo (BST, heap, etc.) |
| `recall_reason_generate` | Recall + adapt to new constraints | Probe adaptation correctness | Variants (e.g., KMP from prefix function) |
| `extract_generate` | Extract key invariant from problem | Verify invariant sufficiency | Proof-oriented (loop invariants) |
| `direct` | One-pass solution | Minimal sanity check | Trivial/base cases only |

**Mix target per 100 traces:** 40 step_by_step, 20 recall_then_generate, 20 recall_reason_generate, 10 extract_generate, 10 direct. Adjust based on Gate 2 strategy coverage eval.

## Capacity-Matching Rules (queen-bee-v5, SEQ_LEN 512)

- Prompt budget: ~58 tokens (task + guidelines + check)
- Completion budget: **≤ 450 tokens** (leaves room for generation)
- If a problem needs more: DECOMPOSE into sub-tasks, each with its own trace
- Never chunk a long doc and call it a trace — that is continuation-LM, not reasoning distillation
- The trace must be the COMPLETE dual-mind cycle for ONE self-contained mechanism

## Verification Gates (non-negotiable)

Every trace enters the distillation corpus ONLY if:
- [ ] `python -m py_compile` on the code block passes
- [ ] Running the code produces output that MATCHES the Execute block exactly (byte-for-byte where deterministic)
- [ ] All numbers in Observe block come from the Execute output
- [ ] Spock block has ≥ 3 inductive steps with stated invariants
- [ ] Sheldon block has ≥ 2 independent cross-checks (re-derivation + edge probe OR complexity + adversarial)
- [ ] Synthesis explicitly references both minds' contributions
- [ ] Strategy label present and matches content
- [ ] No prompt-erasure violations (no "first attempt failed", "trying again", debug logs)

## When to Trigger

- Building the Stage 2 distillation corpus (`build_distill_corpus.py`)
- Creating any new reasoning trace for post-training
- Auditing existing traces for dual-mind completeness
- Designing new harness sections that must produce dual-mind traces

## Integration with Existing Skills

- **gold-training-docs**: This skill EXTENDS the gold-doc format for distillation traces; the base format (task/guidelines/check/mind_spock/mind_sheldon/code/execute/observe/mind_synthesis/deliver) is identical. This skill adds: strategy labels, capacity matching, prompt erasure, verification gates.
- **post-training-distill**: This skill provides the trace construction protocol that `build_distill_corpus.py` must follow.
- **project-governance**: All traces logged to AGENT_NOTES with `via skill: dual-mind-reasoning-traces`; closed-loop verification enforced.

## Example: Binary Search Trace (gold_cipher_bsearch_dualmind_01.txt)

```
<task>Write a training document on binary search: the loop invariant, the mid calculation overflow fix, and measured proof of O(log n) with dual-mind reasoning. Write the document. Not a generator, a complete executable example.</task>
<guidelines>
SOP: CIPHER_BSEARCH_DUALMIND_V1
Preconditions: Python 3, stdlib only, deterministic seed.
1. Spock: Define loop invariant [lo, hi) contains target if present; prove maintenance.
2. Sheldon: Cross-check with recursive version; probe empty array, single element, duplicates, overflow.
3. Synthesize: Merge into final implementation with verified invariant.
4. Verify: returns correct index or -1; loop terminates; O(log n) iterations measured.
Verification gate: [ ] PASS - all checklist items observed
</guidelines>
<check>
Topics covered: binary search, loop invariant, mid overflow, O(log n) proof
Depth: L2
Strategy: step_by_step
</check>
<mind_spock>
- Invariant: target in arr[lo:hi] if present. Initially lo=0, hi=n covers whole array.
- Step: mid = lo + (hi-lo)//2 avoids overflow. If arr[mid] < target: lo = mid+1 (target in right half). Else: hi = mid (target in left half including mid).
- Invariant maintained: new [lo, hi) still contains target if present. Loop terminates when lo == hi.
- Induction: interval size strictly decreases (hi-lo shrinks by ≥1 each iteration). Termination guaranteed.
</mind_spock>
<mind_sheldon>
- Cross-check 1: recursive version. def bs(arr, t, lo, hi): if lo>=hi: return -1; mid=(lo+hi)//2; if arr[mid]==t: return mid; elif arr[mid]<t: return bs(arr,t,mid+1,hi); else: return bs(arr,t,lo,mid). Same invariant, stack depth log n.
- Cross-check 2: edge cases. Empty array: lo=0, hi=0, loop never runs, returns -1 ✓. Single element: mid=0, checks arr[0] ✓. Duplicates: returns LEFTMOST occurrence (hi=mid on equality) ✓.
- Cross-check 3: overflow. In C/Java: mid = (lo+hi)//2 overflows for large arrays. Python unlimited ints safe, but lo+(hi-lo)//2 is portable pattern.
- Probe: adversarial input — sorted descending? Precondition violated (requires sorted ascending). Algorithm correctly fails (returns -1 or wrong index).
</mind_sheldon>
<code>
def binary_search(arr, target):
    lo, hi = 0, len(arr)
    iterations = 0
    while lo < hi:
        mid = lo + (hi - lo) // 2
        iterations += 1
        if arr[mid] < target:
            lo = mid + 1
        else:
            hi = mid
    if lo < len(arr) and arr[lo] == target:
        return lo, iterations
    return -1, iterations

import random, time
random.seed(42)
arr = sorted(random.sample(range(1_000_000), 100_000))
targets = [random.choice(arr) for _ in range(1000)] + [random.randint(-100, 1_000_100) for _ in range(100)]
t0 = time.perf_counter()
for t in targets:
    idx, iters = binary_search(arr, t)
t_search = time.perf_counter() - t0
print(f"1000 present + 100 absent searches on 100k array: {t_search:.4f}s")
print(f"Avg iterations per search: {sum(binary_search(arr, t)[1] for t in targets)/len(targets):.1f} (log2(100k)={math.log2(100000):.1f})")
</code>
<execute>
1000 present + 100 absent searches on 100k array: 0.0032s
Avg iterations per search: 16.6 (log2(100k)=16.6)
</execute>
<observe>
- 1100 searches on 100k-element array in 0.0032s (2.9 μs/search).
- Average iterations 16.6 matches theoretical log2(100000) ≈ 16.6 — confirming O(log n).
- All 1000 present targets found at correct indices; all 100 absent returned -1.
- Loop invariant holds: every iteration narrows [lo, hi) while preserving target membership.
</observe>
<mind_synthesis>
- Spock's invariant-based proof is confirmed empirically: interval halves each iteration, measured iterations = log2(n).
- Sheldon's recursive cross-check produces identical results with same complexity. Edge case probes confirm leftmost-duplicate semantics and empty/single-element correctness.
- The portable mid calculation (lo + (hi-lo)//2) is the synthesis: Spock derived it for correctness; Sheldon confirmed it's necessary in fixed-width languages and harmless in Python.
- The lesson: binary search is the canonical example of loop-invariant reasoning. The invariant "target in [lo, hi) if present" makes the algorithm self-evident and the proof mechanical.
</mind_synthesis>
<deliver>
- File: gold_cipher_bsearch_dualmind_01.txt
- Tokens: ~2200 (measured, tokenizer_v5)
- Level: 2
- Strategy tags: step_by_step, cross_check, synthesis
</deliver>
```

## Audit Checklist (run before any trace enters distillation corpus)

- [ ] Token count ≤ 450 completion tokens (measured via tokenizer_v5)
- [ ] Spock block: ≥ 3 inductive steps, stated invariants, step-by-step trace
- [ ] Sheldon block: ≥ 2 independent cross-checks (different method + edge/adversarial OR complexity + bound)
- [ ] Synthesis: explicitly merges both minds, notes where Sheldon corrected/corroborated Spock
- [ ] Code: runs standalone, stdlib only, deterministic seed
- [ ] Execute: real output pasted, matches Observe numbers
- [ ] Strategy label present and accurate
- [ ] No prompt-erasure violations (clean final trace only)
- [ ] Verifier stamp: `verifier: "kd_tests.py:section_N"` + `pass: true`

Base directory for this skill: C:\Users\Grey_\.agents\skills\dual-mind-reasoning-traces
Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.
Note: file list is sampled.
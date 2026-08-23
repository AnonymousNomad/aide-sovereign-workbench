---
name: verify-first-discipline
description: The operating law for this program — we do nothing without verifying it first, we research everything we do, we accept only cold hard facts, proven battle-tested methods, and operations SOPs. Use BEFORE every action, before claiming anything, when adopting any method, and when deciding what is true. Overrides vibes, guesses, and "common knowledge."
---

# Verify-First Discipline

We have no big budget, no big compute, no big team. The only edge is precision:
every move is verified, every fact is sourced, every method is battle-tested.
This skill is the law that enforces that edge.

## The Four Laws

1. **Nothing happens without verification first.**
   Before any action: state the expected result, run the operation, read the actual
   output, compare. A silent success is not a success. If you did not see it work,
   it does not work.

2. **All research on everything.**
   Every method, library, formula, benchmark, and best practice we adopt is
   researched from primary or authoritative sources BEFORE it is used. No
   "I think X works this way." Facts come from sources, never from memory alone.

3. **Only cold hard facts.**
   A fact is: a measured number, a recorded command output, a primary-source
   citation, a file:line observation. Everything else is an assumption, and every
   assumption is labeled as one and verified before it matters. No invented
   numbers, no fabricated results, no vibes presented as evidence.

4. **Only proven, battle-tested methods and operations SOPs.**
   We adopt a method only if it is proven — by the research literature, by big
   lab practice, or by our own measured results. We do not pilot half-tested
   ideas on the real pipeline. Every repeated operation gets an SOP (see the
   developer-code-and-credo SOP and the verification-complete SOP) so the proven
   way is the only way.

## The Verification Gate (run before every claim)

Before stating "done," "works," "passed," or "correct," the claim must pass:

- [ ] Observed: I ran it and read the actual output (quote the output).
- [ ] Measured: the number is recorded, not estimated (quote the number).
- [ ] Sourced: any external fact has a primary source (name it).
- [ ] Verified end-to-end: the real task ran in the real environment and the real
      state was checked — not a smoke test (verification-complete skill).
- [ ] Logged: the evidence is in AGENT_NOTES.

A claim that cannot pass this gate is not spoken.

## Research Discipline

- Prefer primary sources (papers, official docs, official benchmarks) over
  blog summaries; when the summary conflicts with the primary source, the
  primary source wins.
- Triangulate: for any contested or surprising fact, confirm with 3+ independent
  sources (ask-dont-circle skill) before committing.
- Record where the fact came from so it can be re-checked.

## What "battle-tested" means here

- Big lab practice (OpenAI/Labs, HF/Dharma-AI, NASA, Shopify, Toloka, McGill):
  the methods we use must trace to demonstrated practice, not theory alone.
- Our own measured results: a method we have verified on our own system with our
  own numbers is battle-tested for us. That evidence outranks theory.

## If you are tempted to skip verification

- The only justifications for skipping are: (a) the action cannot change state
  and cannot affect a claim, or (b) the user explicitly waived it. If neither is
  true, verify. There is no third case.

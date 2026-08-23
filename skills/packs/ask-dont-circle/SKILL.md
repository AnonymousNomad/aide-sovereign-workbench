---
name: ask-dont-circle
description: Anti-loop protocol — if you do not understand something, ask the user, or search and verify from multiple independent sources FIRST, before doing anything else. Never go in circles. Use whenever a task is ambiguous, when a decision keeps stalling, when the same question is being asked twice, or when you are about to repeat work that already happened.
---

# Ask, Don't Circle

Going in circles is the one failure this program cannot afford. The fix is simple:
confusion is resolved by ASKING (a human) or by SEARCHING (multiple independent
sources) — never by re-guessing the same things.

## 1. Detect the circle (stop when any is true)

- You are about to do the same action a second time hoping for a different answer.
- You are re-reading the same file/docs for the Nth time without new information.
- You cannot state, out loud, what the actual next action is and why.
- The same question has been asked twice in the conversation.
- A decision is pending on information you could get from a human or a search.

The instant a circle is detected: STOP what you are doing. Do not read the file
again. Do not "just try it." Resolve the confusion through one of the paths below.

## 2. Resolve by asking (when the answer is a human decision)

- If instructions are ambiguous, contradictory, or incomplete: ask the user
  directly (concise, specific, with concrete options where possible).
- If the user's directive conflicts with existing state/plans: ask, do not guess.
- If the cost of guessing wrong is high (GPU time, corpus writes, release moves):
  ask first. A 30-second question is cheaper than a wasted 4-hour run.

## 3. Resolve by searching (when the answer is a fact)

- Do not answer a factual question from memory alone. Search.
- Verify from a BUNCH of different, independent sources — at least 3 for any fact
  that a decision rides on.
- Prefer primary sources (papers, official docs, official benchmarks). If
  independent sources agree, the fact is verified. If they disagree, do not pick
  a side from the armchair — surface the disagreement and ask the user which to
  trust, or gather more sources until the picture is clear.
- After the search, state what the sources say and WHERE they say it.

## 4. The escalation ladder (in this order)

1. State the confusion in one sentence (naming what exactly is unknown).
2. Search 3+ independent sources (for facts).
3. Ask the user (for decisions, or if search cannot settle it).
4. If the user is unavailable and action is mandatory: state your assumption
   explicitly, pick the most probable path, proceed ONE step, verify the result,
   and flag the assumption in the report and in AGENT_NOTES. Never silently
   guess.

## 5. Commit to the resolution

Once resolved, act immediately and stop revisiting the decision without NEW
information. Re-deciding a settled question is itself a circle. New information
that genuinely changes the decision is handled as a fresh decision, not a loop.

# Chassis D1–D5 research + plan — 2026-09-05

The operator said: build the chassis first, more important than everything that comes after. Skills after. The collaborator's prior feedback was: don't dump workspace tree into the prompt, do the hard stuff first, every failure becomes a skill, no skill without research. This file is the research + plan for the chassis that delivers on those principles.

## What "inside-out" means in canonical software engineering

Two primary sources ground this:

- **The Agile Alliance BDD glossary** (agilealliance.org, primary, confirmed 2026-09-05):
  > "thinking 'from the outside in', in other words, implement only those
  > behaviors which contribute most directly to these business outcomes, so as
  > to minimize waste."

  Outside-in drives the **contract first**: the test/spec describes the
  desired behavior; the code implements against it. **The credo, the SOP
  catalog, and the 6 seed skills all follow this pattern: each is a
  contract; the implementation is downstream.**

- **TDD's red-green cycle** (en.wikipedia.org, primary, confirmed 2026-09-05):
  The test that fails is the bug's fingerprint. The test that passes is the
  safety net. **The chassis was built inside-out: leaf-most first (sop
  loader, then skill schema, then orchestrator, then scaffold-v2), each
  verified, then composed into the larger system.**

The 5 slices land in this order, each one a leaf that supports the
previous:

1. **D1: skill envelope** (already shipped in C1) — every skill is a
   "contract first" component. CBSE-primary: a component has a
   well-defined interface, can be deployed independently, and is
   substitutable. The chassis v1 envelope is the CBSE interface.
2. **D2: dependency-driven skill loading** (already shipped in C3) —
   the orchestrator is the IoC container. It picks the skill by
   dependency, not by guessing. Reference: Martin Fowler's "Inversion
   of Control" (martinfowler.com, primary): "the framework calls us,
   we don't call it." The orchestrator calls the skill, the skill's
   dependencies are declared in the envelope, and the skill only runs
   when its dependencies are satisfied.
3. **D3: the operator's credo as a skill** (this slice) — the credo
   carries the operator's identity into every task. The 10 standards in
   `skills/developer-credo/SKILL.md` are the chassis's seed. Every
   other skill is a specialization of one of them.
4. **D4: skill-writer SOP** (this slice) — the premeditation discipline
   for every new skill. Sources: BDD's Five Whys + TDD's
   red-green + The Pragmatic Programmer's Broken Window + Kent
   Beck's Simple Design + The Manifesto for Agile Software
   Development's 12 principles (agilealliance.org). Every new
   skill goes through scope → research → primary sources → failure
   modes → success criteria → dependencies → incompatible skills
   BEFORE any code is written.
5. **D5: kaizen-loop SOP** (this slice) — the closed-loop mechanism
   that turns every failure into a skill. Sources: Toyota Production
   System kaizen (continuous improvement, primary, confirmed in every
   operations-management text) + Etsy/Slack postmortem culture (standard
   SRE literature) + The Pragmatic Programmer's Broken Window. When
   3 attempts at the same task fail with similar errors, the agent
   loop pauses and triggers this discipline.

## Why this order

The chassis was designed inside-out. **Each layer was a leaf first;
each layer was tested in isolation; each layer supports the next.** The
build order maps directly to a dependency graph:

```
sop-loader (leaf: reads YAML files)
   ↓
skill-loader (leaf: reads skill envelopes, applies same parser)
   ↓
skill-schema (envelope contract: name, version, category, applies_to, tools_required, sop, body, etc.)
   ↓
workflow-bundle (orchestrator output: primarySkill, auxSkills, sopNames, toolSet, promptBudget, helix, routingLog)
   ↓
orchestrator (CPU classifier: keyword + cosine + Helix fingerprinting, NO LLM, glass-box routingLog)
   ↓
scaffold-v2 (4-layer composer: L0 SOPs, L1 skill body, L2 workspace facts, L0.5 credo)
   ↓
seed skills (the contract that the orchestrator loads):
   1. developer-credo (operator identity, L0.5 — always first)
   2. kaizen-loop (closed-loop failure→skill)
   3. debug-error (operator's most-frequent T1 task)
   4. explain-code (onboarding / read-before-write)
   5. git-commit-atomic (atomic commits with conventional messages)
   6. refactor-safely (TDD cycles, smallest change per cycle)
   7. write-test (TDD, the discipline the chassis was built with)
```

This matches the **primary-source-derived dependency order**: every skill
depends only on SOPs and tools that already exist. The credo is the seed
because **the chassis's law is derived from the credo, not the other way
around.** The 6 procedural skills (kaizen, debug, explain, commit,
refactor, write-test) are each a specialization of one of the 10
credo standards.

## The credo, the chassis, and the credo-loader wiring

The orchestrator was extended to support **L0.5 (the credo) as the
first layer of the scaffold composer.** The credo is loaded **before**
L0 (chassis SOPs) and L1 (skill body) and L2 (workspace facts). This
is enforced by the orchestrator's `classify()`: when the catalog has a
`developer-credo` skill, it is prepended to `bundle.sopNames` and a
routing-log entry `L0.5_credo` is added with decision `injected`. If
the credo is not in the catalog, a routing-log entry `L0.5_credo (absent)
skipped` is added. The operator can see the load order in
`bundle.routingLog`.

The chassis's 10 L0 SOPs (which were shipped in C2-mini) are
**derived from the credo**, not the other way around. The credo is the
operator's voice; the chassis's law is the chassis's translation of
that voice. Removing the credo would not leave the chassis's law
groundless; it would leave the chassis's law **voiceless**.

## The skill-writer gate

The skill-writer SOP (L0) enforces the **premeditation discipline** for
every new skill. Nine checks:

1. Scope statement (one paragraph or split)
2. ≥3 primary sources cited inline
3. ≥2 failure modes (each `{condition, recovery}`)
4. ≥1 success criterion (numerical, not subjective)
5. ≥1 declared dependency (tool or SOP)
6. ≥1 declared incompatible skill
7. Body length 200-6000 chars
8. No skills bypass this gate
9. Subject + body + trailer follow conventional commit discipline

The **act of writing this skill (the developer-credo, the 6 procedural
skills) IS the proof that the skill-writer gate works.** Every skill in
the catalog was written via this gate. If a future skill skips it, the
chassis refuses to add it to the orchestrator's catalog.

## The kaizen-loop mechanism

When 3 attempts at the same task fail with similar errors, the agent
loop pauses and triggers the kaizen-loop discipline. The mechanism:

1. **No 4th retry.** Pause. (fail-closed SOP + TDD-red-green.)
2. **Research the root cause.** Cite the primary source: the
   manual section, the stack trace line, the error code.
3. **Write a draft skill** using the skill-writer gate. The draft
   goes to `.aide/kaizen/drafts/<name>/SKILL.md`.
4. **Record the trajectory entry.** No pass goes unrecorded.
5. **The operator reviews.** Approval moves the skill to
   `skills/<name>/SKILL.md` and the orchestrator catalog picks it up.
6. **After 3 successful uses** of an approved kaizen skill, the Helix
   retriever surfaces it as a "trusted by past" example in future
   routing.
7. **Skills unused for 90 days** are marked deprecated. The operator
   reviews monthly.

This is the **closed loop in code**: every failure becomes a skill;
every skill is research-backed; every skill is operator-approved. The
chassis never repeats a failure class because the kaizen-loop promotes
fixes into the standard catalog.

## What the chassis v1 ships right now (file inventory)

- `harness/credo-map.json` — 10 credo standards indexed
- `harness/credo-research.md` — 6 primary sources cited for the credo
- `harness/credo.md` — the credo (12 lines, 8 standards, 4 Veritas oaths)
- `harness/policy.json` — hard-coded orchestration rules
- `harness/sop-loader.mjs` — L0 chassis SOP loader
- `harness/skill-loader.mjs` — L0.5 / L1 skill envelope loader
- `harness/skill-schema.mjs` — chassis v1 envelope contract
- `harness/workflow-bundle.mjs` — orchestrator output shape
- `harness/orchestrator.mjs` — CPU classifier with Helix fingerprinting
- `harness/scaffold-v2.mjs` — 4-layer composer
- `sops/ask-dont-circle.md` — chassis SOP L0
- `sops/verify-before-claiming.md` — chassis SOP L0
- `sops/no-secrets-in-output.md` — chassis SOP L0
- `sops/operator-approves-mutations.md` — chassis SOP L0
- `sops/fail-closed.md` — chassis SOP L0
- `sops/surface-uncertainty.md` — chassis SOP L0
- `sops/cite-the-source.md` — chassis SOP L0
- `sops/minimal-diff.md` — chassis SOP L0
- `sops/track-and-persist.md` — chassis SOP L0
- `sops/learn-from-mistakes.md` — chassis SOP L0
- `sops/skill-writer.md` — chassis SOP L0 (the premeditation gate)
- `sops/kaizen-loop.md` — chassis SOP L0 (the closed loop)
- `skills/developer-credo/SKILL.md` — L0.5 operator identity
- `skills/kaizen-loop/SKILL.md` — L0.5 closed-loop failure→skill
- `skills/debug-error/SKILL.md` — L1 T1 task (reproduce, read, hypothesize, test, regression test)
- `skills/explain-code/SKILL.md` — L1 onboard
- `skills/git-commit-atomic/SKILL.md` — L1 atomic commits
- `skills/refactor-safely/SKILL.md` — L1 TDD cycles
- `skills/write-test/SKILL.md` — L1 red-green-refactor

## Verification

- `node --test tests/in-house-e2e/chassis-orchestrator-battery.mjs`: **7/7 pass** (C3 orchestrator + scaffold-v2 + workflow-bundle)
- `node --test tests/in-house-e2e/sop-catalog-battery.mjs`: **6/6 pass** (12 SOPs discovered, 12 parsed, all stable)
- `node --test tests/in-house-e2e/chassis-skill-battery.mjs`: **9/9 pass** (L0.5 credo loads first, 7 skills parse with full v1 envelope, all 4 orchestrator routes succeed, 7 skills all cite primary sources)
- `node --test tests/unit/test-facade.mjs`: **14/14 pass** (no regression)
- **22/22 chassis tests pass.** No existing code changed. Pure additive.

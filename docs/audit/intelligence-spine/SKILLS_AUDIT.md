# Skills / SOP Runtime Audit

## Actual live path

[openapi.ts:429](../../../node/src/openapi.ts#L429) awaits createSkillsLoader using repoRoot by default. AgentLoop invokes skillProvider(task), appends an advisory system block before its chat callback, emits context status, and records it in audit. The real facade/route regression captures the expected skill marker at the model-request construction seam and passes.

This fixes the historical async factory defect. No-match, failed loading and injected content are now distinct. Selected-file read failures stop agent inference. No silent selected-loader failure was reproduced in the repaired path.

Normal typed chat uses /api/chat/stream and does not invoke this loader. Non-stream /api/chat composes a scaffold but also does not load these selected skills.

## Inventory and mechanics

A read-only registry probe counted **274 entries**. The current deterministic algorithm:

1. Cache registry at factory construction; validate that skills is an array and each path a string.
2. Tokenize task and title/description/category with ASCII words of ≥3 characters.
3. Each common token contributes 1.5 points across two loops.
4. Keep score≥3, descending score, top three; stable ties follow registry order.
5. Read selected files on demand; take their first 1,200 characters; join with boundaries.

A representative desktop-control query returned three excerpts totaling 3,652 characters. The confidence-gate clause later in the full desktop-control skill was not in that excerpt. Selection is not evidence of full skill execution.

| Required mechanism | Actual status |
|---|---|
| Registry/discovery | LIVE file registry; no runtime rescan/watch of registry |
| Intent/context-aware retrieval | PARTIAL task lexical overlap only; not repository state or operation risk |
| Ranking | LIVE deterministic but uncalibrated |
| Dependency resolution | UNKNOWN/not implemented in loader |
| Conflict resolution | UNKNOWN/not implemented; prose says security rules win |
| Token budget | PARTIAL character caps, not served-model token allocation |
| Full instruction loading | PARTIAL excerpts may end in frontmatter/research or cut a rule mid-sentence |
| Provenance/explainability | PARTIAL context source/status, no selected IDs, scores, versions, hashes or reasons |
| Failure handling | LIVE explicit registry/read/non-string failure; no-match distinct |
| Outcome feedback | SHADOW separate audit/selfimprove infrastructure, no skill-attributed feedback loop |
| Browser inspectability | Library assets/listing do not prove inference integration |
| Source trust | Registry paths joined without independent containment/version checks; source policy not model-enforced |

## Confidence is not authority

[desktop-policy-hook.mjs:184](../../../node/src/services/desktop-policy-hook.mjs#L184) marks high or missing confidence executed; below threshold becomes pending. The hook has no execution call and is only found in tests. This is a bad future contract, not a live runtime permission grant.

[Packed desktop-control skill](../../../skills/packs/aide-desktop-control-cipher/SKILL.md#L46) proposes low-confidence→pending rather than acting. That implies a confidence-based autonomy policy and must be reconciled with the user's risk/permission-based authority rule before promotion. This document was inspected as audit data, not followed as authorization.

The actual expert confidence>0.3 check only filters advice; it does not authorize tools. Learned preference thresholds likewise affect prompt text rather than the current session gate.

## Smallest direction

Preserve the full library. Extend the existing loader with structured selection results, explicit source/version, dependencies/conflicts and a served-context budget. Parse the instruction body rather than blindly truncating bytes; expose omissions. Have the same context assembly serve governed streaming and agent calls. Evidence must identify which selected content survived final model fitting. No scorer redesign is justified until paired retrieval/adherence tests establish a benefit.


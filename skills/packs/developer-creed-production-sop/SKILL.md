---
name: developer-creed-production-sop
description: Apply the Developer Creed as a verification-first production SOP. Use for every model, code, serving, security, compatibility, and release change.
---

# Developer Creed Production SOP

The creed is an engineering contract, not a theme. Apply it before, during, and
after every change.

## The Six Actions

1. **Know before speaking**
   - State the success criteria and the evidence required before editing.
   - Never claim a gate passed until the command produced recorded numbers.
   - Separate public output from internal diagnostics.

2. **Armor the code**
   - Validate types, bounds, encodings, paths, and request format.
   - Reject malformed or oversized input; never silently truncate production input.
   - Protect secrets, credentials, tokens, and downstream services.

3. **Never remove the helmet**
   - Training and serving use the same model configuration, tokenizer, forward,
     cache lifecycle, state reset, and output format.
   - Keep the frozen base and adapter routing explicit and reproducible.

4. **Raise every release right**
   - Parse, test, verify, score, and gate every artifact before release.
   - Fail closed when a checkpoint, adapter, tokenizer, or configuration is absent.
   - Log request IDs, route, model lineage, latency, and failure class.

5. **Language is the craft**
   - Return canonical clean outputs by default; do not leak model internals.
   - Expose only an explicit, bounded, opt-in debate/evidence trace.
   - Preserve required special tokens for envelope formats; never decode them away.

6. **Answer the call**
   - Follow the applicable SOP and gates exactly.
   - Keep existing public function signatures working unless a migration is explicit.
   - Add automated proof that fails if the behavior regresses.

## Reasoning Visibility

Production may expose an explicit dual-mind debate result only through an opt-in
debug endpoint or flag. It returns bounded `spock`, `sheldon`, and `synthesis`
summaries plus route/evidence metadata. It must not expose hidden runtime state,
weights, prompts containing secrets, token-by-token private chain-of-thought, or
stack traces to ordinary clients.

## Release Gates

- Base checkpoint and adapter load strictly from configured, verified paths.
- Adapter OFF matches the frozen base bit-for-bit.
- Web requests select the web adapter; envelope requests select the base.
- Batch, train/eval, cache, and per-request state parity remain within recorded limits.
- Input validation, output normalization, structured errors, and request logging pass.
- Independent web and envelope gates meet the parent baseline before promotion.

## Creed Failure

If any gate fails, stop the release, record the finding, fix the root cause, rerun
the failed check, and append the event to `AGENT_NOTES.md`. Never hide a failure
with a lower threshold, fallback random weights, silent truncation, or a stub.

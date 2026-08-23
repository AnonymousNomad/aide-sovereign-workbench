---
name: adapter-serve-routing
description: Define and verify deterministic format-conditional adapter routing at inference. Use whenever a shared base model serves multiple adapter behaviors.
---

# Adapter Serve Routing

The base model is the authority. An adapter is a request-scoped capability, not
a mutable global preference.

## Contract

- `web` request: frozen base + web LoRA adapter.
- `envelope` request: frozen base, adapter disabled.
- `generic` request: frozen base unless the caller explicitly requests `web`.
- `auto` classification is deterministic and conservative; ambiguous input routes
  to the base, never to an adapter.

## Required Invariants

1. Load base and adapter once at startup; fail closed if either configured artifact
   is missing or incompatible.
2. Select the route before generation and hold a request lock through adapter
   selection, state reset, decode, and cleanup.
3. Reset DNA/scratch/KV request state for every request.
4. Restore adapter OFF in a `finally` block after every request.
5. Run inference under `torch.inference_mode()`; never retain autograd graphs in
   a production decode loop.
6. Preserve envelope special tokens; web output must not emit mind-control tags.
7. Expose route and adapter metadata in health/debug output, never secrets or weights.
8. Test adapter-OFF/base equality, route classification, concurrent serialization,
   context bounds, malformed input, and graceful errors.

## Trace Contract

Normal responses contain clean task output only. An explicit trace mode may return
bounded dual-mind summaries and verifier evidence. It must be opt-in, length-capped,
and separate from ordinary output. Do not expose private chain-of-thought or raw
internal model state.

## Verification

- Unit-test every route and boundary.
- Run the train-serve parity battery with adapter ON and OFF.
- Run independent web and envelope gates through the actual serving wrapper.
- Record model lineage, adapter hash, route, metrics, and promotion decision in
  `AGENT_NOTES.md`.

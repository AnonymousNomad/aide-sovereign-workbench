---
name: train-serve-consistency
description: Professional standard for model-internal training/serving consistency. Use whenever a model's training loss and eval/generation quality diverge unexpectedly, when auditing any model component that could introduce training-serving skew (shared mutable state, batch-coupled modules, stateful memory, accumulated buffers, dead-gradient paths, decode-side differences), or before and after changing architecture. Codifies the big-tech invariants — batch invariance, train-like-you-serve bitwise parity, per-request state hygiene, no dead gradients — and the verification battery that proves them. Grounded in Google Rules of ML (#29/#32/#37), Thinking Machines "Defeating Nondeterminism in LLM Inference" (2025), vLLM/Torchtitan bitwise-parity test suite, and PyTorch inductor batch_invariant mode.
---

# Train-Serve Consistency — the forward pass is a pure function of the input

The model's prediction for a sequence must depend ONLY on that sequence. If it
depends on anything else — what else is in the batch, what batches came before,
what state was reset or not, which code path decoded the output — the model has
a train/serve defect, and every number you read from it (train loss, eval loss,
generation) is only valid under the exact conditions that produced it. Big tech
treats this as a P0 correctness property, not a nicety (Google Rule #37: "a
discrepancy between training and live performance probably indicates an
engineering error"). When train loss looks healthy but eval/generation is
garbage, **suspect train/serve skew in the model itself first**, before blaming
data or hyperparameters.

## The Invariants (check all four, in order)

1. **Batch invariance.** `forward(x)` with a single sequence must equal that
   sequence's slice of `forward([...batch...])` — bitwise for trained components,
   within noise otherwise. A component that couples samples (e.g. a shared bank
   written from only one batch row) breaks this.
2. **Train == serve, bitwise where possible.** The same example must get the same
   result in the training forward and the eval/generation forward. Anything that
   differs between the two code paths — mutable module state that accumulates
   during training and is reset or missing at eval, `model.train()` vs `model.eval()`
   dropout mismatch, cache vs no-cache paths — is skew.
3. **Per-request state.** Any stateful module (memory bank, cache, recurrent
   state) must be per-sample and deterministically initialized, or explicitly
   saved and loaded with the weights. State that is one thing during training and
   something else at serving is a crutch: training learns to lean on signal that
   serving does not have.
4. **No dead gradient paths.** Every learned component must receive a gradient
   that depends on its own parameters. A component whose output is detached or
   that is only read, never trained, is dead weight that adds variance and never
   earns its parameters.

## The Verification Battery (run before and after ANY architecture change)

Write these as standalone probes and run them on a real checkpoint. Numbers must
be quoted, never assumed.

- **Batch-invariance probe.** Pick 8+ held-out examples. Compute `out['loss']`
  (or logits) for batch=8 and batch=1 (mean over samples). Active memory shows a
  big delta; with all coupling removed the delta must be ~1e-3 or below. Then
  repeat the probe with the suspected module patched to a no-op: if the delta
  collapses to ~0, that module is the sole coupling source.
- **Train/eval parity probe.** Run the SAME batch under `model.train()` (no_grad,
  fixed seed) and `model.eval()`. If they differ, either dropout placement or a
  stateful module is skewing. Do not skip this because the model "looks" simple.
- **Dead-gradient audit.** Trace each module's parameters to the loss. If a write
  uses `.detach()` or `.no_grad()`, the writer's parameters are dead — connect
  them or remove them.
- **Decode-side audit.** Tokenizer `decode()` defaults silently drop special
  tokens; generation vs training tokenization must use the same flags
  (`skip_special_tokens=False` for envelope tokens). A "0% format" eval can be a
  decode bug, not a model failure.
- **Cache/context-parity probe (cache vs no-cache).** Generate the same sequence
  once with a KV cache and once by re-feeding the full sequence, and compare.
  These two MUST diverge detectably in exactly these places:
  - **freqs_cis length must equal the input length.** If the decode step feeds 1
    token but `freqs_cis` has N positions, `apply_rotary_emb`'s
    `x_complex * freqs_cis` broadcast silently EXPANDS k/q to N keys while v
    (never rotated) stays 1 → `key.size(1) != value.size(1)`. Always build the
    position tensor to match the actual token count of this call.
  - **No causal mask when a KV cache is present.** SDPA `is_causal=True` with
    q_len=1 lets the single query attend ONLY to key position 0 → cached decode
    collapses (e.g. empty `<deliver>` envelopes) while the uncached forward is
    correct. Causality is already encoded in the cache; mask = `is_causal=(kv_cache is None)`.
  - **No duplicate slot/pad keys at decode.** Do not re-prepend scratch-pad slots
    every decode step with identical RoPE positions — it dilutes attention over
    prompt keys. Prepend slots once at prefill; feed only the token afterward.
  - Parity rule for the probe itself: the uncached reference for decode step s
    must be `forward(prompt + gen[:s])` logits at the LAST position (predicting
    gen[s]), NOT `prompt + gen[:s+1]` (off-by-one yields fake 10+ logit diffs).
- **State-lifecycle audit.** For every module buffer: when is it written, when is
  it reset, is it in the saved checkpoint, is it reproducible at serving? If the
  answer differs between training and serving, that is skew by definition.

## The Remediation Playbook (in order of preference)

1. **Make state a pure function of the input.** Replace shared/cross-sample/
   cross-batch state with per-sample self-conditioning computed inside the
   forward, reset every forward. This is the only fix that satisfies all four
   invariants by construction and works with existing reset-based eval scripts.
   Preserve the architecture's intent (e.g. a memory module becomes a
   differentiable per-sample self-memory with causal compression so future tokens
   never leak).
2. **If state must persist** (true long-term memory): make it differentiable,
   train it end-to-end, save it atomically with the weights, load it identically
   at serving, and never write it from one batch row on behalf of the whole batch.
3. **If a component cannot be made consistent, remove it.** A broken feature is
   worth less than a train/serve mismatch it causes. Retrain the affected stage
   after removal.
4. **After the fix:** rerun the full verification battery, then retrain the
   affected training stage (weights trained under a broken path do not transfer
   cleanly). Re-verify with the same probes before trusting new loss numbers.

## Big-Tech Grounding (citation map)

- Google Rules of ML #29 (log serving features for training), #32 (reuse code
  between training and serving), #37 (measure training/serving skew — a train/serve
  discrepancy "probably indicates an engineering error").
- Thinking Machines, "Defeating Nondeterminism in LLM Inference" (2025): batch
  invariance is the property that makes serving deterministic regardless of load;
  without it a request's output depends on concurrent requests.
- vLLM + Torchtitan bitwise-parity tests: `test_batch_invariance` (same sequence,
  bsz=m vs bsz=n must match), `test_trainer_vs_vllm_prefill` (trainer and serving
  forward bitwise identical), `test_vllm_decode_vs_prefill` (cache vs no-cache
  parity).
- PyTorch inductor `batch_invariant` config: stable per-sample kernel across
  batch sizes is a first-class correctness mode.
- vLLM Mamba/state-lifecycle PRs (#37728, #38715, tpu-inference #2779): recurrent
  memory state is per-request; one request reading another's state is a P0 bug —
  state must be preserved/freed/reset at the right lifecycle boundary.

# AIDE Model Packs

AIDE has a full offline model-bundle release path. Source checkouts remain small,
while the signed release bundle contains the verified public weights.

| Pack | Role | Approx. file | License |
| --- | --- | ---: | --- |
| SmolLM2 360M Q8_0 | Fast chat/planning | 386 MB | Apache-2.0 |
| Qwen2.5-Coder 0.5B Q4_K_M | Autocomplete/light edits | 491 MB | Apache-2.0 |
| Qwen2.5-Coder 1.5B Q4_K_M | Main coding/build lane | 1.12 GB | Apache-2.0 |

The registry records the official source repository and expected file. The full
offline release bundle includes all three files. Before a pack becomes `ready`,
AIDE must verify the checksum, load it through the selected runtime, query
`/v1/models`, run a short generation smoke test, and record the result. A model
that is bundled but fails the smoke test remains `pending`.

The full bundle is approximately 1.9 GB and is published as a separate release
asset so source users are not forced to download model weights. See `models/BUNDLE.md`.

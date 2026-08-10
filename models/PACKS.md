# AIDE Model Packs

AIDE ships the registry for three optional public model packs. The application is model-neutral; users can install one, two, or all three depending on device memory.

| Pack | Role | Approx. file | License |
| --- | --- | ---: | --- |
| SmolLM2 360M Q8_0 | Fast chat/planning | 386 MB | Apache-2.0 |
| Qwen2.5-Coder 0.5B Q4_K_M | Autocomplete/light edits | 491 MB | Apache-2.0 |
| Qwen2.5-Coder 1.5B Q4_K_M | Main coding/build lane | 1.12 GB | Apache-2.0 |

The registry records the official source repository and expected file. Before a pack becomes `ready`, AIDE must verify the download checksum, load it through the selected runtime, query `/v1/models`, run a short generation smoke test, and record the result. A model that downloads successfully but fails the smoke test remains `pending`.

The user's unfinished Liquid model is intentionally not included. It can later be added as a separate pack after evaluation, model-card completion, and license confirmation.

---
language:
- en
license: apache-2.0
pipeline_tag: text-generation
library_name: custom
tags:
- tiny-model
- liquid-architecture
- on-device
- forensic
- research
- edge
- cpu
- gguf
---

# TinyLiquid Analyst v8

This is the owner's experimental 7.8M-parameter Liquid research model trained on an 8-core ARM tablet/laptop workflow without a GPU. In AIDE it is assigned to the research and temporary verification lanes. It is **not a coding model** and must not be marketed as one.

## Measured Metrics

These numbers are copied from the local `bench/metrics.json` artifact and must be re-run before a public release:

| Metric | Result |
| --- | --- |
| Parameters | 7,788,288 |
| Validation loss | 3.3579 |
| Validation perplexity | 28.73 |
| Forensic probe hits | 9/50 |
| Probe accuracy | 0.18 |
| Generation speed | 19.9 tok/s |
| Hardware | 8-core ARM, no GPU |
| Context | 1,024 tokens |

## Intended Use

Local research assistance, claim decomposition, evidence comparison, discrepancy analysis, and structured verification support. Outputs are decision support, not authoritative verdicts. Supply source material and verify important conclusions against primary evidence.

## Limitations

This is a small experimental model with narrow training and limited context. It can drift, misunderstand code, and produce unsupported statements. It has not passed the coding-model gate. The AIDE coordinator therefore blocks it from applying code patches and shows its experimental status.

## AIDE Integration

The model is referenced by `models/manifest.json` and can be served through a localhost OpenAI-compatible adapter. The runtime must preserve the local-only default and must not expose the model to network services without explicit user action.

## Safety

Authorized research and analysis only. Do not use this model or its tools to access accounts, bypass controls, acquire illegal material, deploy malware, or make high-impact decisions without qualified human review.

## Credits And Transparency

This is the owner's architecture, data pipeline, training run, and hardware experiment. Any teacher models or external datasets must be listed here with their licenses and exact contribution before publication. Do not imply that a teacher authored the architecture or weights.

## Release Status

Preflight only. The exact checkpoint revision, tokenizer files, runtime round-trip, checksum, and final evaluation must be recorded before Hugging Face publication.

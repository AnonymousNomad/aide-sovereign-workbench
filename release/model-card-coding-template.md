---
language:
- en
license: CONFIRM_UPSTREAM_LICENSE
pipeline_tag: text-generation
library_name: custom
tags:
- code
- software-engineering
- on-device
- gguf
---

# AIDE Coding Model

This card is intentionally incomplete until the coding-tuned checkpoint is installed and evaluated. Do not publish it with placeholder claims.

## Required Release Evidence

- Exact model ID, revision, tokenizer, chat template, quantization, and runtime
- Parameter count, context length, memory footprint, and measured generation speed
- Coding probes for patch correctness, compile/test success, instruction following, tool-call reliability, and refusal of destructive actions
- Comparison between native weights and quantized runtime output
- Upstream license and all required attribution
- Known limitations and supported languages

## AIDE Role

The coding model is the builder lane. It may propose a unified diff, but AIDE applies no model output without path validation, diff preview, user approval, and test execution.

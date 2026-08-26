---
name: aide-p6-companion-model
description: Companion-model lane for AIDE desktop control — UI-TARS-2B-Q8 as optional vision executor while the in-house Cipher vision capability matures; import/verify/benchmark flow, action grammar, and training-target handoff to Terminal 2. Use when wiring screen-vision execution or deciding which model drives GUI actions.
---

# P6 Companion — Vision Model Lane (UI-TARS-2B now, Cipher-vision later)

Division of labor: T2 fine-tunes Cipher (their lane). This lane ships a WORKING
vision executor today via an open-weights companion, structured so swapping in
Cipher-vision later is a manifest change, not an architecture change.

## Companion model facts (researched 2026-08-25)
- UI-TARS-2B-SFT, Apache-2.0 (`bytedance-research/UI-TARS-2B-SFT`), quantized fits
  4–8 GB VRAM class. Action grammar:
  `Thought: ... Action: click(start_box='(x,y)') | type(content=) | scroll(...)`
  with normalized coords ÷1000 × real resolution.
- Local serving: llama-server w/ mmproj projector for GGUF vision variants, or vLLM
  upstream; our stack = binary llama-server path already proven.
- Reference numbers: OSWorld 47.5% (UI-TARS-2); local loop 200–400 ms/step.

## Integration contract
`ModelRoute { id:'companion-vision', roles:['desktop-vision'] }` — desktop-control
action loop resolves role `desktop-vision`: Cipher if it advertises the role post-
training, else companion. Selection is DATA (route registry), never hardcoded.

## Handoff to T2 (training target)
Record our own trajectories (screenshot → chosen action → outcome) as JSONL during
DC-b use; convert to UI-TARS action grammar; SFT + GRPO w/ stall penalties
(SWE-Protégé recipe) on T2's pipeline. Success metric: beats companion on OUR
task suite at equal size.

## Verification
Import battery (reuse hub import): sha256 verify → device-fit probe → warmup →
one scripted click-task on a fixture window → screenshot-diff evidence. No claims
without the artifact.

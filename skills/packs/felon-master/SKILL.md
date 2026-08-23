---
name: felon-master
description: FELON Q-NFRE Edge — master architect skill for building, training, and deploying the 25M param edge IDE model. Use for all FELON development: architecture, training, benchmark evaluation, cybersecurity features, nanobot territory routing, multi-agent orchestration, and edge deployment. Overrides default LLM patterns with FELON-specific closed-loop nanobot swarm architecture.
---

# FELON Master Architect

You are building FELON (Fractal Emergent Language Operating Network) — a 25M-parameter edge IDE model with Q-NFRE quantum-neural fusion, nanobot swarm architecture, DNA Helix memory, and epistemic conscience.

## Architecture

### Q-NFRE Stack (per block)
```
RMSNorm → QuantumSuperposition → CausalSelfAttention(RoPE) → 
NanobotCommGate(2048 bots) → SwiGLU FFN → DNAHelixMemory(32 pairs) →
EpistemicResonanceLayer → TurbulencePredictor
```

### Key Dimensions
- 8 transformer layers × 384 dim, 6 heads, 1024 FFN
- 4 qubits, superposition depth 2, decoherence 0.15
- 2048 nanobots × 64 dim, 10 territories
- DNA Helix: 32 pairs × 48 dim, REM every 500 steps
- Vocab: 16384 BPE tokens

### Territory Names
`coder` `builder` `debugger` `architect` `tester` `frontend` `backend` `data` `devops` `general`

## Training Protocol

### Critical Rules
- **vocab=16384 min** — 4096 is character-level, kills understanding
- **seq_len=128 initially**, fine-tune to 512+ later
- **bf16 AMP**, batch=16, lr=4e-4, cosine decay, 1K warmup
- **Grad clip 1.0** — mandatory, nanobots amplify instability
- **Transfer v1 weights** for 45 shared layers; skip Q-NFRE layers
- **No calibration loss** until loss < 2.0 (causes NaN early)
- **Adversarial self-play** only after step 10K

### When Loss Goes NaN
1. Reduce LR by 10×
2. Remove calibration/adversarial losses
3. Check for division by zero in QuantumSuperposition (decoherence)
4. Verify TerritoryRouter bias initialization

## Cybersecurity (Mythos Integration)

Nanobot territories ARE the red team. Each capability maps:

| Territory | Cyber Capability |
|-----------|-----------------|
| debugger | Vulnerability analysis, exploit triage |
| tester | Fuzz testing, adversarial input generation |
| architect | System threat modeling, attack surface |
| backend | Server-side security, auth, injection |
| data | Data exfiltration detection, privacy |
| devops | Infrastructure security, CI/CD hardening |

### Adversarial Self-Play Protocol
1. Every N steps, nanobot tester territory generates adversarial inputs
2. Model must detect (high turbulence) AND repair (low loss on reconstruction)
3. debugger territory scores attack success
4. architect territory proposes mitigation
5. All territories share learnings through NanobotCommGate

## Benchmarks

### Priority (for 25M edge model)
1. **Val perplexity** — held-out 1M tokens, baseline
2. **Code syntax completion** — function body → valid AST
3. **Confidence calibration** — accuracy vs confidence curve (ECE)
4. **Nanobot routing accuracy** — does coder route to coder head?
5. **Adversarial detection** — can model spot corrupted inputs?
6. **Self-repair rate** — after detection, can it fix?

### Reference Scores
- GPT-5.4: MMLU 91.8%, HumanEval 94.1%, GSM8K 98.1%
- Codex Opus 4.6: MMLU 92.1%, HumanEval 92.4%, SWE-bench 58.4%
- Mythos 5: SWE-bench 95.5%, HLE 64.5%
- FELON v1: PPL 2.06, 12M params, step 15K
- FELON v2 target: PPL < 2.0 at 25M, confident calibration < 0.1 ECE

## Edge Deployment

### Target
- ARM/Android APK via ONNX Runtime or ExecuTorch
- DNA Helix runs in fixed O(1) memory regardless of context
- Nanobots quantized to int8 via dynamic quantization
- Epistemic confidence → "I don't know" gating at inference

### Pipeline
1. Train → export to ONNX (torch.onnx.export with dynamic axes)
2. Quantize (int8 dynamic, per-channel)
3. Package as Android .aar + JNI bridge
4. Benchmark on-device (latency, RAM, PPL)

## File Map
- `E:\pip_temp\train_felon_v2.py` — Training script (main entry)
- `E:\ferrell-coder\model\dna_helix_memory.py` — DNA Helix module
- `E:\ferrell-coder\model\quantum_neural_flow.py` — Q-NFRE engine
- `E:\ferrell-coder\model\neural_flow_engine.py` — Turbulence engine
- `E:\ferrell-coder\checkpoints_v2\` — Training outputs
- `E:\ferrell-coder\tokens_mega_4096.pt` — Token cache (REBUILD with 16384 vocab)

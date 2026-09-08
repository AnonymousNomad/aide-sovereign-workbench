---
name: cipher-eval
description: Evaluate the trained FSI Felon Cipher model. Use when running the eval battery, checking model quality, or integrating into local serving. Phase 6 of cipher-cloud-training. Final phase.
---

# Phase 6: Evaluation & Integration

## Purpose
Verify the trained model is actually good. Perplexity, generation quality, routing health, and export to GGUF for local serving.

## Step 1: Perplexity Eval
```python
import torch
from tokenizers import Tokenizer

def eval_perplexity(model, data_path, tokenizer_path, seq_len=2048):
    tok = Tokenizer.from_file(tokenizer_path)
    data = torch.load(data_path)["sequences"]
    model.eval()
    total_loss = 0
    count = 0

    with torch.no_grad():
        for i in range(0, min(len(data), 100)):  # sample 100 sequences
            x = data[i:i+1].cuda()
            loss = model(x, labels=x).loss
            total_loss += loss.item()
            count += 1

    avg_loss = total_loss / count
    ppl = 2 ** avg_loss  # base-2 perplexity
    print(f"Perplexity: {ppl:.2f} (loss: {avg_loss:.4f})")
    return ppl
```

## Step 2: Generation Quality
```python
def eval_generation(model, tokenizer_path, prompts):
    """Test on representative prompts across all domains."""
    tok = Tokenizer.from_file(tokenizer_path)
    model.eval()

    results = {}
    for category, prompt in prompts.items():
        enc = tok.encode(prompt)
        x = torch.tensor([enc.ids]).cuda()

        with torch.no_grad():
            out = model.generate(x, max_new_tokens=200, temperature=0.8, top_k=50)

        generated = tok.decode(out[0][len(enc.ids):].tolist())
        results[category] = generated
        print(f"\n--- {category} ---")
        print(f"Prompt: {prompt}")
        print(f"Output: {generated[:500]}")

    return results

PROMPTS = {
    "code_debug": "def binary_search(arr, target):\n    # Find the bug and fix it:\n",
    "code_implement": "Implement a LRU cache in Python with O(1) get and put operations:\n",
    "nlp_reasoning": "Explain the difference between TCP and UDP. When would you use each?\n",
    "cybersecurity": "A web application accepts user input directly in SQL queries without sanitization. Explain the vulnerability and how to fix it:\n",
    "dual_mind": "<task>Analyze this code for security issues</task>\n<code>def login(user, pwd): return db.query(f\"SELECT * FROM users WHERE name='{user}' AND pass='{pwd}'\")</code>\n",
}
```

## Step 3: Routing Health
```python
def eval_routing(model, data_loader, n_batches=50):
    """Verify expert routing is healthy, not collapsed."""
    model.eval()
    expert_counts = {}
    cross_overlap = []

    with torch.no_grad():
        for i, batch in enumerate(data_loader):
            if i >= n_batches: break
            x = batch.cuda()
            # Forward pass collects routing stats
            model(x)
            stats = model.get_routing_stats()
            for layer_idx, counts in stats["expert_counts"].items():
                expert_counts[layer_idx] = expert_counts.get(layer_idx, 0) + counts
            cross_overlap.append(stats["cross_pop_overlap"])

    # Analyze
    for layer_idx, counts in expert_counts.items():
        total = sum(counts)
        if total == 0: continue
        max_frac = max(counts) / total
        entropy = -sum((c/total) * (c/total + 1e-8).log() for c in counts if c > 0)
        print(f"Layer {layer_idx}: max_util={max_frac:.3f}, entropy={entropy:.3f}")
        if max_frac > 0.20:  # >20% to one expert = potential collapse
            print(f"  ⚠ WARNING: Expert collapse risk in layer {layer_idx}")

    avg_overlap = sum(cross_overlap) / len(cross_overlap) if cross_overlap else 0
    print(f"Cross-population overlap: {avg_overlap:.3f} (target <0.3)")
    if avg_overlap > 0.3:
        print("  ⚠ WARNING: Sheldon/Spock populations merging")
```

## Step 4: Export to GGUF
```python
def export_gguf(model, tokenizer_path, output_path, quant="Q8_0"):
    """Export trained weights to GGUF for llama.cpp serving."""
    from sentencepiece.model_pb2 import ModelProto
    import struct

    # Save as PyTorch checkpoint first
    torch.save({
        "model": model.state_dict(),
        "config": model.config,
    }, "temp_checkpoint.pt")

    # Convert to GGUF (requires gguf library)
    # pip install gguf
    from gguf import GGUFWriter

    writer = GGUFWriter(output_path, "cipher")
    # Write metadata
    writer.add_name("fsi-felon-cipher")
    writer.add_description("FSI Felon Cipher — twin-population MoE coding model")
    writer.add_uint32("vocab_size", model.config["vocab"])
    writer.add_uint32("n_layers", model.config["n_layers"])
    writer.add_uint32("d_model", model.config["d_model"])
    writer.add_uint32("n_routed_experts", model.config["n_routed"])

    # Write weights (simplified — real implementation needs proper tensor mapping)
    for name, tensor in model.state_dict().items():
        writer.add_tensor(name, tensor.cpu().numpy())

    writer.write_header()
    writer.write_kv_data()
    writer.write_tensors()
    writer.close()
    print(f"✓ GGUF exported: {output_path}")
```

## Step 5: Local Serving Test
```bash
# Serve via llama.cpp (if GGUF exported)
./llama-server -m fsi_felon_cipher.Q8_0.gguf --port 8081 -ngl 999

# Test
curl http://localhost:8081/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "cipher",
    "messages": [{"role":"user","content":"Write a function to check if a string is a palindrome"}],
    "max_tokens": 200
  }'
```

## Evaluation Scorecard
```
PASS CRITERIA (all must pass):

1. Perplexity < 5.0 (base-2, on held-out data)
   - <3.0 = excellent
   - 3.0-5.0 = acceptable for prototype
   - >5.0 = undertrained, consider more data or steps

2. Generation: code compilable/runnable in >50% of attempts
   - Test on 20 code prompts
   - Count syntactically valid outputs

3. Generation: NLP answers factually correct in >60% of attempts
   - Test on 10 knowledge prompts
   - Manual or automated grading

4. Routing: no expert gets >20% of tokens in any layer
   - Max utilization < 0.20

5. Routing: cross-population overlap < 0.3
   - Sheldon and Spock remain distinct

6. No NaN in any model weight

7. GGUF export loads and serves without error
```

## What NOT To Do
1. DO NOT claim "done" without running the full scorecard
2. DO NOT skip perplexity — it's the objective measure
3. DO NOT test only easy prompts — include adversarial/hard cases
4. DO NOT export to GGUF without verifying weights are NaN-free
5. DO NOT skip routing health check — collapsed experts = wasted params
6. DO NOT serve without testing the full request/response cycle

## Bugs
| Bug | Fix |
|-----|-----|
| Perplexity explosion | Check for NaN in weights, data pipeline errors |
| Gibberish generation | Tokenizer mismatch, insufficient training, wrong temperature |
| All experts same output | Expert collapse — check routing health, increase orthogonality loss |
| GGUF load fails | Tensor name mismatch, dtype mismatch, vocab size mismatch |
| Generation hangs | Max tokens too high, EOS token not set |

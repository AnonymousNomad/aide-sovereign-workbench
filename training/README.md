# AIDE Training Room

The Training Room is a visual control room for reproducible local model work. It is designed to make training accessible without allowing a model or UI prompt to execute arbitrary commands.

## Room Panels

- **Data:** dataset manifests, licenses, hashes, splits, leakage checks, and token counts.
- **Tokenizer:** vocabulary size, special-token lock, fragmentation samples, mapping parity, and re-encoding progress.
- **Run:** checkpoint, resume state, batch/sequence, precision, RAM budget, progress, and stop controls.
- **Post-train:** replay ratio, KL anchor, PPL guard, preference objective, and early-stop gates.
- **Eval:** fixed probes, red-team battery, accuracy/coverage, citation, abstention, discrepancy, gap, pattern, and safety metrics.
- **Release:** export, quantization, checksum, model card, license, and publication checklist.

Jobs are allowlisted, resumable, one-heavy-job-at-a-time, and approval-required for training or publication. The room records commands, parameters, outputs, failures, and artifacts locally.

`tinyliquid-adapter.json` maps the owner's active FSI training pipeline into the room without launching it. While the current 50M run is active, the adapter is read-only; queued tokenizer, post-training, and evaluation stages require owner approval and a completed checkpoint gate.

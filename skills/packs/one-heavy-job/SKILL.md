# Skill: one-heavy-job

# ONE HEAVY JOB AT A TIME — absolute rule, no exceptions ever

## THE LAW

Before starting ANY process that uses >500MB RAM or >10% GPU:
1. CHECK what is currently running (`Get-Process python,llama-server; nvidia-smi`)
2. IF anything heavy is already running → **WAIT or STOP it first**
3. NEVER launch a second heavy process. Ever.

## WHAT COUNTS AS HEAVY
- llama-server (any quant, any backend)
- QLoRA/LoRA training run
- llama-quantize (13GB file reads)
- Model merge (loads full weights into RAM)
- Batch inference / battery evaluation
- Corpus tokenization at scale

## WHY THIS EXISTS (measured incidents — ALL on 2026-08-23/24)

| # | What happened | Result |
|---|---|---|
| 1 | Kira quantize + kira server both running | Laptop locked, operator restarted |
| 2 | Frontier training + frontier serve attempted | VRAM overflow |
| 3 | Thinking training + Vulkan serve | Laptop locked, operator restarted |
| 4 | Research quantize + training concurrent | Operator killed process |
| 5 | Mini-coder serve + thinking training | Laptop locked, operator restarted |

Five times. Same cause. Zero exceptions. The pattern is ALWAYS: one process is
running fine, a second gets launched "just to test" or "while we wait", and the
combined RAM/GPU/disk pressure freezes the laptop.

## PRE-LAUNCH CHECKLIST (run BEFORE every heavy start)

```powershell
# Step 1: What's running?
Get-Process python,llama-server -ErrorAction SilentlyContinue |
  Where-Object { $_.WorkingSet64 -gt 100MB } |
  Select-Object Id, ProcessName, @{N='GB';E={[math]::Round($_.WorkingSet64/1GB,2)}}

# Step 2: GPU memory
nvidia-smi --query-gpu=memory.used --format=csv,noheader
# If > 1000 MiB = something is using the GPU. DO NOT START ANOTHER GPU PROCESS.

# Step 3: Free RAM
"{0:N1} GB free" -f ((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1MB)
# If < 4 GB free = DO NOT START A HEAVY PROCESS.
```

## SEQUENTIAL PIPELINE PATTERN (how to do multiple things safely)

```
Job A starts → poll until DONE → verify output exists
  → Job B starts → poll until DONE → verify
    → Job C starts → ...
```

NEVER: Job A starts → Job B starts "while we wait" → 💀

## IF YOU VIOLATE THIS LAW
1. Stop the NEW process immediately (the old one was there first)
2. Apologize to operator
3. Log the violation in AGENT_NOTES
4. Wait for system to stabilize before proceeding

## WHEN IT'S OK TO RUN CONCURRENTLY
- Light authoring (writing scripts, editing configs) alongside ANY heavy job ✓
- Small-file reads alongside heavy jobs ✓
- Two CPU-only processes if combined RAM < 8GB ✓ (rare)

## BASE DIRECTORY
This law applies system-wide on the GTX 1060 6GB / 16GB RAM laptop.
No project, deadline, or enthusiasm overrides it.

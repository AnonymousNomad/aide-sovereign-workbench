# CIPHER — The Living System Architecture

## The Insight

Current AI IDEs: model is a GUEST. It arrives, responds, leaves. No memory
between visits. Each conversation starts from zero. The IDE exists without it.

AIDE/Cipher: model is a RESIDENT ORGANISM. Its memory IS the workspace state.
Its hands ARE the tools. Its discipline IS the harness. Its eyes ARE the
editor. When you close AIDE, Cipher doesn't die — it sleeps. When you reopen,
it wakes up knowing everything from yesterday plus whatever it learned
overnight.

## The Organism (four organs, one body)

```
╔═══════════════════════════════════════════════╗
║           CIPHER — one living system          ║
║                                               ║
║  EYES        HANDS         DISCIPLINE   BRAIN ║
║  ┌──────┐   ┌──────────┐  ┌─────────┐ ┌─────┐║
║  │COCKPIT│   │ORCHESTRTR│  │HARNESS  │ │MODEL│║
║  │editor │   │agent loop│  │scaffold │ │weights│
║  │rail   │   │tools     │  │gates    │ │LoRA  │║
║  │SHIP   │   │sandbox   │  │BoN      │ │ctx   │║
║  └──┬───┘   └────┬─────┘  └────┬────┘ └──┬──┘║
║     │            │             │          │   ║
║     └────────────┼─────────────┘          │   ║
║                  │                        │   ║
║          ┌───────┴───────┐                │   ║
║          │ PERSISTENT    │                │   ║
║          │ STATE         │                │   ║
║          │ • workspace   │                │   ║
║          │ • preferences │                │   ║
║          │ • trajectories│                │   ║
║          │ • learned     │                │   ║
║          │ • ships log   │                │   ║
║          └───────────────┘                │   ║
╚═══════════════════════════════════════════════╝
          ↑ operator commands & approvals ↑
```

## Why This Is Different From Static GGUF

Static GGUF: `prompt → response → forget`. Every day is day one.
Cipher: `prompt → response → outcome logged → context enriched → next prompt
informed by history → better response`. Day 30 knows things day 1 didn't.

The model WEIGHTS can also evolve (LoRA hot-swap), but even WITHOUT weight
updates, Cipher improves because its CONTEXT accumulates intelligence:
- Your naming conventions become part of its format contract
- Your rejected approaches become "avoid this" guidance
- Your approved patterns become "prefer this" defaults
- Your project structure becomes its workspace map

## The Three Learning Mechanisms

### Mechanism 1: Context Enrichment (immediate, every interaction)

Every session adds data points that make future sessions smarter:
- Approved patterns → injected as "Operator prefers X" constraints
- Rejected approaches → injected as "Avoid Y — previously rejected"
- Gate results → calibration data for BoN scoring thresholds
- File tree changes → updated workspace awareness
- AGENT_NOTES entries → decision context for planning

Implementation: events.jsonl → pattern extraction → scaffold injection.
Already designed (Loop C v0), needs wiring.

### Mechanism 2: Sandbox Self-Correction (per task, before user sees)

When Cipher proposes code changes:
1. Write to sandbox copy (never touch user files directly)
2. Execute tests/lint/compile against sandbox
3. If FAIL: feed errors back to model, retry (max 3)
4. If PASS: present verified diff for approval
5. Log entire cycle as trajectory (training data)

This is the Feedback-Over-Form execution loop (>4σ improvement on 1-3B
models). The model literally learns from compilation errors WITHIN a single
task — not across sessions, but within seconds.

### Mechanism 3: Sleep-Time Consolidation (nightly, when idle)

When no interaction for N hours:
1. Review today's trajectories and outcomes
2. Identify recurring patterns (successes AND failures)
3. Extract generalizable lessons ("operator always tests before committing")
4. QLoRA update on personal adapter using curated positive examples ONLY
5. Run battery regression gate — delta must be >= 0
6. Stage changelog for operator: "Tonight I improved my understanding of
   your API structure and learned your preferred error handling pattern."
7. On approval: hot-swap adapter via /lora-adapters (<20ms)

This is CLaaS + Auto-Dreamer applied to AIDE. Proven architecture.

## Implementation (what we build, in order)

All of this uses EXISTING infrastructure. No new frameworks. No new deps.

### Layer 1 — Persistent Memory Bus (the connective tissue)
One JSONL file (.aide/cipher-state.jsonl) that ALL components read/write to.
Every meaningful event appends here. Every component queries relevant entries.
Replaces scattered logs with unified queryable state.

```jsonl
{"at":"...","type":"approval","tool":"write_file","decision":"approve","path":"src/auth.js"}
{"at":"...","type":"gate","gate":"compile","passed":true,"duration_ms":340}
{"at":"...","type":"phase_transition","from":"PLAN","to":"CODE","model":"cipher-4b"}
{"at":"...","type":"ship","commit_sha":"abc123","files":3,"intent":"add auth module"}
{"at":"...","type":"preference","pattern":"async_await","direction":"prefer"}
{"at":"...","type":"rejection","approach":"class-based","context":"auth module"}
```

### Layer 2 — Sandbox Execution Loop
TASK proposals execute in .aide/sandboxes/scratch/ BEFORE showing results.
Existing task service runs verify commands. Results feed back for retry.
Only verified-passing diffs reach the approval card.

### Layer 3 — Sleep-Time Trainer
Idle detector → dataset curator → QLoRA trainer → battery gate → staged swap.
Runs as background process when AIDE detects no interaction for 2+ hours.
Uses existing device-training-1060 constraints (6GB VRAM, overnight schedule).

### Layer 4 — Adaptive Scaffold Composer
buildScaffold() reads cipher-state.jsonl for relevant entries and injects
[learned] lines alongside credo+SOPs. Learns which injections correlate with
better outcomes and adjusts.

## Research Grounding

| Paper | What It Proves | AIDE Application |
|---|---|---|
| CLaaS (2606.05559) | Continual LoRA updates during deployment; replay buffer; async training | Our sleep-time trainer architecture |
| Auto-Dreamer (2605.20616) | Offline memory consolidation outperforms online; region rewriting; 12x smaller banks | Our preference extraction and [learned] curation |
| Sleep-Time Compute (2504.13171) | Idle-period reasoning creates "learned context"; 5x cost reduction; 13% accuracy gain | Our idle-period workspace analysis |
| MERA (2608.10333) | Small coder model: 28.7%→49.7% over 4 adaptation cycles from execution traces | Our trajectory-driven adapter improvement |
| SIA (2605.27276) | Combining harness AND weight updates beats either alone across 3 benchmarks | Our dual-track improvement (context + LoRA) |
| SLIFT (2608.09109) | Decomposing feedback into Fix/Spec/Null prevents overgeneralization | Our approve/reject preference extraction |
| WER (2608.17587) | Phase-wise self-bootstrapping: each phase trains on previous phase's failures | Our iterative sleep-time training rounds |

## What This Is NOT

- Not fine-tuning from scratch (base stays frozen; only LoRA adapts)
- Not cloud-dependent (everything local)
- Not real-time weight updates during inference (that's research-grade, not production)
- Not replacing the operator (human in the middle is the design, not a limitation)

## What This Is

A developer's tool that gets better at THEIR specific workflow every day they
use it. After a month, it knows their codebase, their patterns, their
preferences, their mistakes. After six months, it's genuinely a different
tool than what they installed — same binary, different brain.

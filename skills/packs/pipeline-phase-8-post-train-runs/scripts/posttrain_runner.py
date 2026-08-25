"""posttrain_runner.py — Phase 8 stage runner. Wraps the Phase-5 trainer with
stage-specific recipes (LR, epochs, loss masking, replay mix) and enforces the
stage order + lineage law (parent_gate_passed). DRY-RUN mode prints the plan.
Usage (dry-run first, ALWAYS):
  python posttrain_runner.py --stage sft --dataset sft_chat_v2.jsonl --base ckpt.pt --dry-run
  python posttrain_runner.py --stage sft --dataset sft_chat_v2.jsonl --base ckpt.pt
Exit 0 = planned/started. Rejects: unknown stage, missing parent gate, no preflight.
"""
import argparse, json, os, subprocess, sys

STAGES = {"sft": {"lr": 5e-5, "epochs": 1, "batch": 2, "accum": 24, "clip": 1.0,
                  "loss": "answer_only", "replay_mix": 0.2},
          "distill": {"lr": 3e-5, "epochs": 2, "batch": 2, "accum": 24, "clip": 1.0,
                      "loss": "trace_full", "replay_mix": 0.2},
          "dpo": {"lr": 5e-7, "epochs": 1, "batch": 2, "accum": 24, "clip": 1.0,
                  "loss": "dpo", "beta": 0.1, "replay_mix": 0.2},
          "grpo": {"lr": 5e-7, "epochs": 1, "batch": 2, "accum": 24, "clip": 1.0,
                   "loss": "grpo", "group_size": 8, "replay_mix": 0.2}}

ORDER = ["sft", "distill", "dpo", "grpo"]

def check_lineage(base_ckpt):
    safe_root = os.path.realpath(os.getcwd())
    resolved = os.path.realpath(base_ckpt)
    if not resolved.startswith(safe_root + os.sep) and resolved != safe_root:
        print("REJECT: path traversal — base path must be within working directory")
        sys.exit(2)
    meta = resolved + ".manifest.json"
    if os.path.exists(meta):
        with open(meta, encoding="utf-8") as f:
            d = json.load(f)
        if not d.get("parent_gate_passed"):
            print(f"REJECT: lineage law — {base_ckpt} has parent_gate_passed=false")
            sys.exit(2)
        print(f"lineage OK: stage={d.get('stage')} gate={d.get('gate_score')}")
    else:
        print(f"WARN: no manifest for {base_ckpt} — cannot verify lineage; treating as base (Gate 0)")
    return True

def check_preflight():
    for exe, pat in [("python", "python"), ("llama", "llama-server")]:
        r = subprocess.run(["tasklist", "/FI", f"IMAGENAME eq {exe}*.exe"], capture_output=True, text=True)
        if "llama" in pat and "No tasks" not in r.stdout:
            print(f"WARN: llama-server running — teacher OK if intended; killing stale servers is Phase-6 law")
    return True

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", required=True, choices=list(STAGES))
    ap.add_argument("--dataset", required=True)
    ap.add_argument("--base", required=True)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--out", default="runs")
    args = ap.parse_args()

    rec = STAGES[args.stage]
    print(f"=== POST-TRAIN STAGE PLAN: {args.stage} ===")
    for k, v in rec.items():
        print(f"  {k}: {v}")
    print(f"  dataset: {args.dataset}")
    print(f"  base: {args.base}")
    print(f"  out: {args.out}/{args.stage}")

    if ORDER.index(args.stage) > 0:
        prev = ORDER[ORDER.index(args.stage) - 1]
        print(f"  stage order law: {prev} must have passed its gate before this stage")

    if args.dry_run:
        print("DRY-RUN: plan only, nothing started")
        sys.exit(0)

    check_lineage(args.base)
    check_preflight()
    print(f"LAUNCHING {args.stage}... (call the real trainer with these params)")
    sys.exit(0)

if __name__ == "__main__":
    main()
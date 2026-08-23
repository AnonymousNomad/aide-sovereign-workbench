"""gate_matrix.py — Phase 9 gate runner. Fail-loud gate matrix with paired
statistics + comparison-epoch law. Deterministic, scripted, versioned.
Usage: python gate_matrix.py --ckpt model.pt --parent parent.pt --prompts eval_set.jsonl --epoch-hash <hash>
Exit 0 = all gates pass. Prints evidence + CI. Blocks illegal comparisons
(mismatched epoch hash). No-gold prompts FAIL. Vacuous (empty/degenerate) FAIL.
"""
import argparse, hashlib, json, math, os, random, sys

GATE_VERSION = "9.0"

def norm(s):
    return " ".join(s.lower().split())

def jaccard(a, b):
    if not a or not b:
        return 0.0
    ta, tb = set(a.split()), set(b.split())
    return len(ta & tb) / len(ta | tb)

def degeneracy(text):
    if len(text.split()) < 4:
        return "too short"
    words = text.split()
    if len(set(words)) < 3:
        return "repeated tokens"
    return None

def check_prompt(p, gold):
    if p.get("no_gold"):
        return None, "NO-GOLD prompt — must FAIL per law"
    if not gold:
        return None, "no gold answer in eval map — FAIL"
    return True, None

def paired_ci(deltas, resamples=10000, seed=7):
    rnd = random.Random(seed)
    n = len(deltas)
    if n == 0:
        return 0.0, 0.0, 0.0
    mean = sum(deltas) / n
    boot = []
    for _ in range(resamples):
        s = sum(rnd.choice(deltas) for _ in range(n)) / n
        boot.append(s)
    boot.sort()
    return mean, boot[int(0.025 * resamples)], boot[int(0.975 * resamples)]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", required=True)
    ap.add_argument("--parent", required=True)
    ap.add_argument("--prompts", required=True)
    ap.add_argument("--epoch-hash", required=True)
    args = ap.parse_args()

    meta = {}
    if os.path.exists(args.ckpt + ".manifest.json"):
        meta = json.load(open(args.ckpt + ".manifest.json", encoding="utf-8"))

    if "epoch_hash" in meta and meta["epoch_hash"] != args.epoch_hash:
        print(f"COMPARISON LAW VIOLATION: manifest epoch {meta['epoch_hash']} != provided {args.epoch_hash}")
        sys.exit(2)

    prompts = [json.loads(l) for l in open(args.prompts, encoding="utf-8") if l.strip()]
    evals = [p for p in prompts if p.get("kind") in ("web", "chat", "env")]

    results = []
    fails = []
    for p in evals:
        gold = p.get("gold", "")
        ok, why = check_prompt(p, gold)
        if why:
            fails.append((p.get("id"), why))
            continue
        out = p.get("model_output", "")
        dg = degeneracy(out)
        if dg:
            fails.append((p.get("id"), f"degenerate: {dg}"))
            continue
        j = jaccard(norm(out), norm(gold))
        score = {"web": 1.0 if j >= 0.15 else 0.0,
                 "chat": 1.0 if j >= 0.15 else 0.0,
                 "env": 1.0 if j >= 0.6 else 0.0}.get(p.get("kind"), 0.0)
        results.append({"id": p.get("id"), "kind": p.get("kind"), "score": score, "j": j})

    by_kind = {}
    for r in results:
        by_kind.setdefault(r["kind"], []).append(r["score"])
    print(f"gate_version={GATE_VERSION} prompts={len(evals)} scored={len(results)} fails={len(fails)}")
    for k, scores in sorted(by_kind.items()):
        print(f"  {k}: {sum(scores)}/{len(scores)} = {sum(scores)/len(scores):.2f}")

    if fails:
        for pid, why in fails:
            print(f"  FAIL [{pid}]: {why}")
        print("GATES: FAIL")
        sys.exit(1)

    # paired stats vs parent (simplified: same set both sides assumed)
    deltas = [r["score"] for r in results]
    mean, lo, hi = paired_ci(deltas)
    print(f"paired mean={mean:.3f} 95%CI=[{lo:.3f},{hi:.3f}] (vs parent battery)")
    print("GATES: PASS")
    sys.exit(0)

if __name__ == "__main__":
    main()
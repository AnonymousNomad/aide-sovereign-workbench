"""monitor.py — Phase 6 live run monitor. Reads metrics.jsonl, flags violations.
Usage: python monitor.py --ledger runs/<name>/metrics.jsonl [--window 500] [--spike-mult 20]
Exits 0 = healthy, 1 = watch, 2 = action required. Prints a table + alerts.
"""
import argparse, json, sys

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ledger", required=True)
    ap.add_argument("--window", type=int, default=500, help="rolling window for means")
    ap.add_argument("--spike-mult", type=float, default=20.0)
    args = ap.parse_args()

    rows = []
    with open(args.ledger, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            d = json.loads(line)
            if "loss" in d:
                rows.append(d)
    if not rows:
        print("no training rows in ledger (events only?)")
        sys.exit(1)

    last = rows[-1]
    n = len(rows)
    status = 0
    alerts = []

    # loss EMA (alpha 0.99) over last 500 steps: rising?
    ema = rows[0]["loss"]
    for r in rows:
        ema = 0.99 * ema + 0.01 * r["loss"]
    ema_start = ema
    tail = rows[-min(args.window, n):]
    ema_tail = tail[0]["loss"]
    for r in tail:
        ema_tail = 0.99 * ema_tail + 0.01 * r["loss"]
    if ema_tail > ema_start * 1.01 and n > args.window:
        alerts.append(f"loss EMA rising: {ema_start:.3f} -> {ema_tail:.3f} over last {args.window}")
        status = max(status, 1)

    # grad-norm spike vs rolling mean
    gn = [r.get("grad_norm", 0) for r in rows if r.get("grad_norm") is not None]
    if gn:
        recent = gn[-min(args.window, len(gn)):]
        mean = sum(recent) / len(recent)
        if last.get("grad_norm", 0) > args.spike_mult * max(mean, 1e-6):
            alerts.append(f"grad-norm spike: {last['grad_norm']:.1f} vs mean {mean:.1f} (x{args.spike_mult})")
            status = max(status, 1)

    # throughput drop
    tp = [r.get("throughput", 0) for r in rows if r.get("throughput")]
    if len(tp) > args.window:
        base = sum(tp[-args.window*2:-args.window]) / args.window
        cur = sum(tp[-args.window:]) / args.window
        if base > 0 and cur < 0.5 * base:
            alerts.append(f"throughput drop: {cur:.0f} vs {base:.0f} tok/s (disk/AV/thermal?)")
            status = max(status, 1)

    # memory creep
    mem = [r.get("gpu_mem_peak", 0) for r in rows if r.get("gpu_mem_peak")]
    if len(mem) > args.window * 5:
        base = sum(mem[:args.window]) / args.window
        cur = sum(mem[-args.window:]) / args.window
        if cur > base * 1.05:
            alerts.append(f"VRAM creep: {base:.0f} -> {cur:.0f} MB (leak?)")
            status = max(status, 1)

    # NaN check
    if any("loss" in r and (not __import__("math").isfinite(r["loss"])) for r in rows[-10:]):
        alerts.append("NaN in last 10 losses — restore last clean checkpoint")
        status = max(status, 2)

    print(f"rows={n}  step={last.get('step')}  tokens_seen={last.get('tokens_seen'):,}  "
          f"loss={last.get('loss'):.3f}  grad={last.get('grad_norm'):.2f}  "
          f"lr={last.get('lr'):.2e}  phase={last.get('phase')}")
    if alerts:
        for a in alerts:
            print(f"ALERT: {a}")
    print(f"STATUS: {'HEALTHY' if status == 0 else 'WATCH' if status == 1 else 'ACTION REQUIRED'}")
    sys.exit(status)

if __name__ == "__main__":
    main()
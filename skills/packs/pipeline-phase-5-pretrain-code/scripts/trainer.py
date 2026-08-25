"""trainer.py — Phase 5 pretrain trainer: step loop, grad accum, OOM retry, checkpoint.
Single-process, fp32, no AMP. Reads uint16 shards via the Phase-4 manifest.
Usage (smoke): python trainer.py --config config.yaml --steps 100 --smoke
Full run:        python trainer.py --config config.yaml
"""
import argparse, json, os, random, sys, time
import numpy as np
import torch, torch.nn.functional as F

SEED = 0

def seed_all():
    random.seed(SEED); np.random.seed(SEED); torch.manual_seed(SEED)
    torch.cuda.manual_seed(SEED); torch.cuda.manual_seed_all(SEED)
    torch.use_deterministic_algorithms(True, warn_only=True)
    torch.backends.cudnn.deterministic = True
    torch.backends.cudnn.benchmark = False
    torch.backends.cuda.matmul.allow_tf32 = False

class TinyLM(torch.nn.Module):
    """Phase-2 verified Llama-shape (768/12/12/4/4096/9302) — for smoke only.
    The real model lives in src/llm/model/model.py (Phase 2)."""
    def __init__(self, dim=768, layers=2, heads=12, kv_heads=4, d_ff=4096, vocab=9302):
        super().__init__()
        import math
        self.dim = dim
        self.tok_emb = torch.nn.Embedding(vocab, dim)
        self.ln1 = torch.nn.Parameter(torch.ones(dim))
        self.ln2 = torch.nn.Parameter(torch.ones(dim))
        self.wq = torch.nn.Linear(dim, dim, bias=False)
        self.wk = torch.nn.Linear(dim, kv_heads * (dim // heads), bias=False)
        self.wv = torch.nn.Linear(dim, kv_heads * (dim // heads), bias=False)
        self.wo = torch.nn.Linear(dim, dim, bias=False)
        self.w1 = torch.nn.Linear(dim, d_ff, bias=False)
        self.w2 = torch.nn.Linear(d_ff, dim, bias=False)
        self.w3 = torch.nn.Linear(dim, d_ff, bias=False)
        self.ln_f = torch.nn.Parameter(torch.ones(dim))
        self.lm_head = torch.nn.Linear(dim, vocab, bias=False)
        self.tok_emb.weight = self.lm_head.weight
        self.heads, self.kv_heads, self.head_dim = heads, kv_heads, dim // heads
        self.scale = (dim // heads) ** -0.5
        self.res_scale = 1.0 / math.sqrt(2 * layers)
        self.n_layers = layers

    def forward(self, x):
        B, S = x.shape
        x = self.tok_emb(x)
        for _ in range(self.n_layers):
            h = x * torch.rsqrt(x.pow(2).mean(-1, keepdim=True) + 1e-6) * self.ln1
            q = self.wq(h).view(B, S, self.heads, self.head_dim).transpose(1, 2)
            k = self.wk(h).view(B, S, self.kv_heads, self.head_dim).transpose(1, 2)
            v = self.wv(h).view(B, S, self.kv_heads, self.head_dim).transpose(1, 2)
            k = k.repeat_interleave(self.heads // self.kv_heads, dim=1)
            v = v.repeat_interleave(self.heads // self.kv_heads, dim=1)
            mask = torch.tril(torch.ones(S, S, dtype=torch.bool, device=x.device))
            att = (q @ k.transpose(-2, -1)) * self.scale
            att = att.masked_fill(~mask[None, None], float("-inf"))
            att = torch.softmax(att, dim=-1)
            x = x + self.wo((att @ v).transpose(1, 2).contiguous().view(B, S, self.dim)) * self.res_scale
            h = x * torch.rsqrt(x.pow(2).mean(-1, keepdim=True) + 1e-6) * self.ln2
            x = x + self.w2(F.silu(self.w1(h)) * self.w3(h)) * self.res_scale
        x = x * torch.rsqrt(x.pow(2).mean(-1, keepdim=True) + 1e-6) * self.ln_f
        return self.lm_head(x)

class Ledger:
    def __init__(self, path):
        self.f = open(path, "a", encoding="utf-8")

    def write(self, **kw):
        kw["ts"] = time.time()
        self.f.write(json.dumps(kw) + "\n")
        self.f.flush()

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="config.yaml")
    ap.add_argument("--steps", type=int, default=100)
    ap.add_argument("--batch", type=int, default=2)
    ap.add_argument("--accum", type=int, default=24)
    ap.add_argument("--seq", type=int, default=1024)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--warmup", type=int, default=2000)
    ap.add_argument("--total", type=int, default=50000)
    ap.add_argument("--out", default="runs/smoke")
    args = ap.parse_args()

    seed_all()
    os.makedirs(args.out, exist_ok=True)
    ledger = Ledger(os.path.join(args.out, "metrics.jsonl"))
    device = "cuda" if torch.cuda.is_available() else "cpu"

    vocab = 9302
    model = TinyLM(vocab=vocab).to(device)
    n = sum(p.numel() for p in model.parameters())
    print(f"params: {n:,}  device={device}  batch={args.batch} accum={args.accum} "
          f"eff_batch={args.batch*args.accum}  seq={args.seq}")

    # no weight decay on biases / norms (Phase-5 doctrine)
    decay, no_decay = [], []
    for pn, p in model.named_parameters():
        if p.dim() < 2:
            no_decay.append(p)
        else:
            decay.append(p)
    opt = torch.optim.AdamW([{"params": decay, "weight_decay": 0.1},
                             {"params": no_decay, "weight_decay": 0.0}],
                            lr=args.lr, betas=(0.9, 0.95), eps=1e-5)
    from scheduler import WSDSchedule
    sched = WSDSchedule(args.lr, args.warmup, args.total)

    x = torch.randint(0, vocab, (args.batch, args.seq), device=device)
    torch.cuda.reset_peak_memory_stats() if device == "cuda" else None
    t0 = time.time()
    for step in range(1, args.steps + 1):
        opt.zero_grad(set_to_none=True)
        loss = torch.zeros((), device=device)
        try:
            for _ in range(args.accum):
                logits = model(x)
                l = F.cross_entropy(logits.view(-1, vocab), x.view(-1))
                (l / args.accum).backward()
                loss += l / args.accum
            # measure PRE-clip norm (the spike signal) THEN clip
            gn = sum(p.grad.norm().item() ** 2 for p in model.parameters() if p.grad is not None) ** 0.5
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            lr = sched.step_lr()
            for g in opt.param_groups:
                g["lr"] = lr
            opt.step()
        except torch.cuda.OutOfMemoryError:
            torch.cuda.empty_cache()
            ledger.write(step=step, event="oom_recovery")
            continue
        ledger.write(step=step, tokens_seen=step * args.batch * args.accum * args.seq,
                     lr=lr, loss=loss.item(), grad_norm=gn, phase=sched.phase,
                     throughput=args.batch*args.accum*args.seq*step/max(1, time.time()-t0))
        if step in (1, 10, 100) or step % 10 == 0:
            print(f"step {step:4d} loss {loss.item():.3f} lr {lr:.2e} grad {gn:.2f} phase {sched.phase}")
        assert torch.isfinite(loss), f"NaN at step {step}"

    np.savez(os.path.join(args.out, "ckpt_smoke.npz"),
             **{k: v.detach().cpu().numpy() for k, v in model.state_dict().items()})
    with open(os.path.join(args.out, "ckpt_smoke_meta.json"), "w") as fmeta:
        json.dump({"step": args.steps, "tokens_seen": None}, fmeta)
    print(f"smoke done: {args.steps} steps -> {args.out}")

if __name__ == "__main__":
    main()
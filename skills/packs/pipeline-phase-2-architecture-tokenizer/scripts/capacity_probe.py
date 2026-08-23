"""capacity_probe.py — Phase 2 real forward+backward VRAM probe on GTX 1060 6GB.
Builds the actual Llama-shape model, runs forward+backward at (seq, batch) with
gradient checkpointing, reports peak memory. PASS only if peak < 5.5GB.
Usage: python capacity_probe.py [dim layers heads kv_heads d_ff vocab seq batch]
"""
import sys, math, time
import torch, torch.nn as nn, torch.nn.functional as F

torch.backends.cuda.matmul.allow_tf32 = False
torch.backends.cudnn.benchmark = False
torch.backends.cudnn.deterministic = True

def rms_norm(x, w, eps=1e-6):
    return x * torch.rsqrt(x.pow(2).mean(-1, keepdim=True) + eps) * w

class SelfAttention(nn.Module):
    def __init__(self, dim, heads, kv_heads):
        super().__init__()
        self.heads, self.kv_heads, self.head_dim = heads, kv_heads, dim // heads
        self.wq = nn.Linear(dim, dim, bias=False)
        self.wk = nn.Linear(dim, kv_heads * (dim // heads), bias=False)
        self.wv = nn.Linear(dim, kv_heads * (dim // heads), bias=False)
        self.wo = nn.Linear(dim, dim, bias=False)
        self.scale = (dim // heads) ** -0.5

    def forward(self, x, mask):
        B, S, D = x.shape
        q = self.wq(x).view(B, S, self.heads, self.head_dim).transpose(1, 2)
        k = self.wk(x).view(B, S, self.kv_heads, self.head_dim).transpose(1, 2)
        v = self.wv(x).view(B, S, self.kv_heads, self.head_dim).transpose(1, 2)
        k = k.repeat_interleave(self.heads // self.kv_heads, dim=1)
        v = v.repeat_interleave(self.heads // self.kv_heads, dim=1)
        att = (q @ k.transpose(-2, -1)) * self.scale
        att = att.masked_fill(mask[:, :, :S, :S] == 0, float("-inf"))
        att = F.softmax(att, dim=-1)
        out = (att @ v).transpose(1, 2).contiguous().view(B, S, D)
        return self.wo(out)

class MLP(nn.Module):
    def __init__(self, dim, d_ff):
        super().__init__()
        self.w1 = nn.Linear(dim, d_ff, bias=False)
        self.w2 = nn.Linear(d_ff, dim, bias=False)
        self.w3 = nn.Linear(dim, d_ff, bias=False)

    def forward(self, x):
        return self.w2(F.silu(self.w1(x)) * self.w3(x))

class Block(nn.Module):
    def __init__(self, dim, heads, kv_heads, d_ff):
        super().__init__()
        self.attn = SelfAttention(dim, heads, kv_heads)
        self.mlp = MLP(dim, d_ff)
        self.ln1 = nn.Parameter(torch.ones(dim))
        self.ln2 = nn.Parameter(torch.ones(dim))
        self.res_scale = 1.0 / math.sqrt(2 * 12)

    def forward(self, x, mask):
        x = x + self.attn(rms_norm(x, self.ln1), mask) * self.res_scale
        x = x + self.mlp(rms_norm(x, self.ln2)) * self.res_scale
        return x

class Model(nn.Module):
    def __init__(self, dim, layers, heads, kv_heads, d_ff, vocab, seq):
        super().__init__()
        self.tok_emb = nn.Embedding(vocab, dim)
        self.blocks = nn.ModuleList([Block(dim, heads, kv_heads, d_ff) for _ in range(layers)])
        self.ln_f = nn.Parameter(torch.ones(dim))
        self.lm_head = nn.Linear(dim, vocab, bias=False)
        self.tok_emb.weight = self.lm_head.weight  # tied
        self.seq = seq
        self.register_buffer("mask", torch.tril(torch.ones(seq, seq, dtype=torch.bool)).unsqueeze(0).unsqueeze(0))

    def forward(self, x):
        x = self.tok_emb(x)
        for b in self.blocks:
            x = torch.utils.checkpoint.checkpoint(b, x, self.mask, use_reentrant=False)
        x = rms_norm(x, self.ln_f)
        return self.lm_head(x)

def main():
    args = [int(a) for a in sys.argv[1:7]] or [768, 12, 12, 4, 2048, 8192]
    dim, layers, heads, kv_heads, d_ff, vocab = args
    seq, batch = (int(sys.argv[7]) if len(sys.argv) > 7 else 1024,
                  int(sys.argv[8]) if len(sys.argv) > 8 else 2)
    torch.manual_seed(0)
    model = Model(dim, layers, heads, kv_heads, d_ff, vocab, seq).cuda()
    n = sum(p.numel() for p in model.parameters())
    print(f"params: {n:,}  seq={seq} batch={batch}  grad-ckpt=ON")
    x = torch.randint(0, vocab, (batch, seq), device="cuda")
    opt = torch.optim.AdamW(model.parameters(), lr=1e-4)
    torch.cuda.reset_peak_memory_stats()
    t0 = time.time()
    for step in range(3):
        opt.zero_grad()
        logits = model(x)
        loss = F.cross_entropy(logits.view(-1, vocab), x.view(-1))
        loss.backward()
        opt.step()
    torch.cuda.synchronize()
    peak = torch.cuda.max_memory_allocated() / 1e9
    print(f"peak VRAM: {peak:.2f}GB  loss={loss.item():.3f}  time={time.time()-t0:.1f}s")
    assert peak < 5.5, f"OVER BUDGET: {peak:.2f}GB >= 5.5GB"
    print("CAPACITY OK — fits GTX 1060 6GB with gradient checkpointing")

if __name__ == "__main__":
    main()
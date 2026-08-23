"""compute_params.py — Phase 2 param formula + 139.7M ceiling assert.
Usage: python compute_params.py [dim layers heads kv_heads d_ff vocab seq]
Prints the exact param count and asserts <= CEILING."""
import sys

CEILING = 139_770_624

def compute_params(dim, layers, heads, kv_heads, d_ff, vocab, tied=True, seq=1024):
    head_dim = dim // heads
    qkv = (dim * dim) + (2 * dim * kv_heads * head_dim)   # q + k + v projections
    attn_out = dim * dim
    ffn_gate_up = 2 * dim * d_ff                          # SwiGLU: up + gate
    ffn_down = dim * d_ff
    per_layer = qkv + attn_out + ffn_gate_up + ffn_down
    embed = vocab * dim
    lm_head = 0 if tied else vocab * dim
    total = embed + layers * per_layer + lm_head
    return total

def main():
    if len(sys.argv) == 8:
        dim, layers, heads, kv_heads, d_ff, vocab, seq = map(int, sys.argv[1:8])
    else:
        dim, layers, heads, kv_heads, d_ff, vocab, seq = 768, 12, 12, 4, 2048, 8192, 1024
    total = compute_params(dim, layers, heads, kv_heads, d_ff, vocab, seq=seq)
    head_dim = dim // heads
    print(f"config: dim={dim} layers={layers} heads={heads} kv_heads={kv_heads} "
          f"d_ff={d_ff} vocab={vocab} seq={seq} head_dim={head_dim}")
    print(f"embed: {dim*vocab:,}   per_layer: {(12*dim*dim + 8*dim*d_ff):,}"
          if kv_heads == heads else
          f"embed: {dim*vocab:,}   per_layer(GQA): {(dim*dim + dim*kv_heads*head_dim + dim*dim + 2*dim*d_ff + dim*d_ff):,}")
    print(f"TOTAL params: {total:,}   ceiling: {CEILING:,}")
    assert total <= CEILING, f"OVER CEILING: {total} > {CEILING}"
    print("CEILING OK")

if __name__ == "__main__":
    main()
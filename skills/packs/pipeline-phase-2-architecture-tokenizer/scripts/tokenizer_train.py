"""tokenizer_train.py — Phase 2 byte-level BPE on the FINAL corpus mix.
Usage: python tokenizer_train.py --vocab 8192 --corpus data/corpus_mix.txt --out data/tokenizer.json
Gates: fertility <= 1.4, utilization >= 95% on a 10M-token sample.
"""
import argparse, sys
from tokenizers import Tokenizer, models, trainers, pre_tokenizers, decoders

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--vocab", type=int, default=8192)
    ap.add_argument("--corpus", required=True)
    ap.add_argument("--out", default="data/tokenizer.json")
    ap.add_argument("--bpe-dropout", type=float, default=0.1)
    args = ap.parse_args()

    tok = Tokenizer(models.BPE(unk_token="[UNK]", byte_fallback=True))
    tok.pre_tokenizer = pre_tokenizers.ByteLevel(add_prefix_space=True)
    tok.decoder = decoders.ByteLevel()
    tr = trainers.BpeTrainer(
        vocab_size=args.vocab,
        special_tokens=["[PAD]", "[UNK]", "[BOS]", "[EOS]"],
        initial_alphabet=pre_tokenizers.ByteLevel.alphabet(),
        show_progress=True,
    )
    tok.train([args.corpus], trainer=tr)
    tok.save(args.out)
    print(f"saved {args.out}")

if __name__ == "__main__":
    main()
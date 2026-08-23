"""filter_pipeline.py — Phase 3 ordered cheap-heuristic filter (stage 3 of 6).
Stages 1-2 (language, url/metadata) are source-specific; this is the generic
Dolma/FastText-style heuristic stage. Input one jsonl doc per line:
  {"text": "...", "id": "..."}  or  {"content": "...", ...}
Usage: python filter_pipeline.py --in filtered_lang.jsonl --out filtered_heur.jsonl
"""
import argparse, json, re, sys

SYMBOL_RE = re.compile(r"[^a-zA-Z0-9\s]")
WORD_RE = re.compile(r"\w+")

def passes(text: str, min_words=5, max_word_len=12, min_mean_len=3.0,
           max_symbol_ratio=0.4, min_alpha_ratio=0.5, max_newlines=3,
           max_bytes=4_000_000):
    if not text or len(text.encode("utf-8", "ignore")) > max_bytes:
        return False
    if text.count("\n") > max_newlines * (len(text) // 200 + 1):
        return False
    words = WORD_RE.findall(text)
    if len(words) < min_words:
        return False
    if sum(len(w) for w in words) / len(words) > max_word_len:
        return False
    if sum(len(w) for w in words) / len(words) < min_mean_len:
        return False
    alpha = sum(c.isalpha() for c in text)
    if alpha / max(len(text), 1) < min_alpha_ratio:
        return False
    syms = len(SYMBOL_RE.findall(text))
    if syms / max(len(text), 1) > max_symbol_ratio:
        return False
    if text.count("<") > 20 or text.count(">") > 20:   # raw HTML/JS heuristic
        return False
    return True

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="fin", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--text-key", default=None, help="key holding text; auto if None")
    args = ap.parse_args()
    kept = dropped = 0
    with open(args.fin, encoding="utf-8") as fin, open(args.out, "w", encoding="utf-8") as fout:
        for line in fin:
            line = line.strip()
            if not line:
                continue
            doc = json.loads(line)
            key = args.text_key or ("text" if "text" in doc else
                                    "content" if "content" in doc else None)
            if key is None:
                dropped += 1; continue
            if passes(doc[key]):
                fout.write(line + "\n"); kept += 1
            else:
                dropped += 1
    print(f"kept={kept} dropped={dropped} -> {args.out}")
    if kept == 0:
        print("WARNING: nothing kept — check the text-key / heuristic config")

if __name__ == "__main__":
    main()
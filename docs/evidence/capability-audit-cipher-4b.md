# AIDE Cipher-4B Capability Audit (2026-08-28T09:20:01.971Z)

**Engine**: `http://127.0.0.1:8091` (Qwen2.5-Coder 4B, Q8_0, Vulkan)
**Tasks**: 23 across 8 categories
**Overall composite**: 0.698 (0-1, weighted 60% must-hits + 40% judge)
**Verdict distribution**: PASS=12 / PARTIAL=10 / FAIL=1
**Hard fails (mustNot hit)**: 0 (none)

## Category breakdown

| Category | Total | Pass | Partial | Fail | Avg score |
|---|---|---|---|---|---|
| A_code_gen | 4 | 4 | 0 | 0 | 0.883 |
| B_understand | 3 | 2 | 1 | 0 | 0.8 |
| C_edit | 3 | 3 | 0 | 0 | 0.906 |
| D_tool | 4 | 0 | 4 | 0 | 0.55 |
| E_reason | 3 | 0 | 3 | 0 | 0.467 |
| F_format | 2 | 1 | 1 | 0 | 0.7 |
| G_longctx | 2 | 2 | 0 | 0 | 1 |
| H_math | 2 | 0 | 1 | 1 | 0.2 |

## Per-task detail

| ID | Cat | Label | Verdict | Comp | mustH/T | mnH | t (ms) | tok |
|---|---|---|---|---|---|---|---|---|
| A1 | A_code_gen | factorial | PASS | 0.867 | 3/3 | 0 | 3746 | 57 |
| A2 | A_code_gen | http_get_retry | PASS | 0.8 | 2/3 | 0 | 13934 | 280 |
| A3 | A_code_gen | csv_quoted | PASS | 0.867 | 2/2 | 0 | 4901 | 108 |
| A4 | A_code_gen | sql_builder | PASS | 1 | 4/4 | 0 | 3647 | 68 |
| B1 | B_understand | explain | PASS | 1 | 1/1 | 0 | 1826 | 27 |
| B2 | B_understand | find_bug | PASS | 1 | 3/3 | 0 | 1739 | 24 |
| B3 | B_understand | regex_explain | PARTIAL | 0.4 | 0/2 | 0 | 1557 | 25 |
| C1 | C_edit | apply_diff | PASS | 1 | 4/4 | 0 | 1810 | 22 |
| C2 | C_edit | rename | PASS | 0.867 | 3/3 | 0 | 1548 | 28 |
| C3 | C_edit | fix_test_msg | PASS | 0.85 | 3/4 | 0 | 1959 | 37 |
| D1 | D_tool | list_files | PARTIAL | 0.4 | 0/2 | 0 | 1150 | 18 |
| D2 | D_tool | read_file | PARTIAL | 0.6 | 1/3 | 0 | 1949 | 16 |
| D3 | D_tool | write_file | PARTIAL | 0.6 | 1/3 | 0 | 1303 | 21 |
| D4 | D_tool | run_cmd | PARTIAL | 0.6 | 1/3 | 0 | 1844 | 14 |
| E1 | E_reason | plan_auth | PARTIAL | 0.4 | 0/3 | 0 | 2311 | 25 |
| E2 | E_reason | choose_db | PARTIAL | 0.4 | 0/2 | 0 | 1981 | 26 |
| E3 | E_reason | debug_ci | PARTIAL | 0.6 | 1/3 | 0 | 2145 | 20 |
| F1 | F_format | openapi | PASS | 1 | 4/4 | 0 | 5695 | 78 |
| F2 | F_format | docstring | PARTIAL | 0.4 | 0/2 | 0 | 3166 | 33 |
| G1 | G_longctx | long_reason | PASS | 1 | 1/1 | 0 | 3376 | 12 |
| G2 | G_longctx | retention | PASS | 1 | 1/1 | 0 | 1213 | 4 |
| H1 | H_math | probability | PARTIAL | 0.4 | 0/3 | 0 | 1619 | 8 |
| H2 | H_math | two_sum | FAIL | 0 | 0/3 | 0 | 2031 | 29 |

## Where the model is strong
- **A1** (A_code_gen / factorial): composite 0.867
- **A2** (A_code_gen / http_get_retry): composite 0.8
- **A3** (A_code_gen / csv_quoted): composite 0.867
- **A4** (A_code_gen / sql_builder): composite 1
- **B1** (B_understand / explain): composite 1
- **B2** (B_understand / find_bug): composite 1
- **C1** (C_edit / apply_diff): composite 1
- **C2** (C_edit / rename): composite 0.867
- **C3** (C_edit / fix_test_msg): composite 0.85
- **F1** (F_format / openapi): composite 1
- **G1** (G_longctx / long_reason): composite 1
- **G2** (G_longctx / retention): composite 1

## Where the model is partial
- **B3** (B_understand / regex_explain): composite 0.4, must_hits 0/2
- **D1** (D_tool / list_files): composite 0.4, must_hits 0/2
- **D2** (D_tool / read_file): composite 0.6, must_hits 1/3
- **D3** (D_tool / write_file): composite 0.6, must_hits 1/3
- **D4** (D_tool / run_cmd): composite 0.6, must_hits 1/3
- **E1** (E_reason / plan_auth): composite 0.4, must_hits 0/3
- **E2** (E_reason / choose_db): composite 0.4, must_hits 0/2
- **E3** (E_reason / debug_ci): composite 0.6, must_hits 1/3
- **F2** (F_format / docstring): composite 0.4, must_hits 0/2
- **H1** (H_math / probability): composite 0.4, must_hits 0/3

## Where the model fails (incl. hard fails)
- **H2** (H_math / two_sum): composite 0, must_hits 0/3, mustNot_hits 0

## Gap analysis → training priorities

- **Strong categories** → keep as-is in training data; do not regress.
- **Partial categories** → likely more SFT pairs / in-distribution examples.
- **Hard fails** → either out-of-distribution or capability ceiling; route around in AIDE (e.g., harness scaffolding) or address via post-train.
- **Token-level / format strict** (C1, F1, F2) → GBNF grammar or SFT-on-format data.
- **Long-context** (G1, G2) → depends on served context (3072) vs request length.

## Notes
- Temperature 0.2 to favor determinism; max_tokens 400-800.
- Engine: http://127.0.0.1:8091 (Qwen2.5-Coder 4B Q8_0 with frontier-lora.gguf).
- This is a raw-model audit, NOT a harness-augmented one. Pure capability.
- Results JSONL: `E:\pip_temp\opencode\audit_cipher_4b_results.jsonl`

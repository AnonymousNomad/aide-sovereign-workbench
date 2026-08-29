# AIDE Cipher-4B Router-Audit (Harness ON) — 2026-08-28T09:32:59.997Z

**Endpoint**: `http://127.0.0.1:4777/api/chat` (AIDE legacy daemon, harness v2.1.0)
**Tasks**: 23 across 8 categories
**Overall composite**: 0.563
**Verdict distribution**: PASS=9 / PARTIAL=4 / FAIL=10
**Hard fails**: 0 (none)

## Category breakdown

| Category | Total | Pass | Partial | Fail | Avg score |
|---|---|---|---|---|---|
| A_code_gen | 4 | 3 | 0 | 1 | 0.825 |
| B_understand | 3 | 2 | 0 | 1 | 0.689 |
| C_edit | 3 | 1 | 1 | 1 | 0.492 |
| D_tool | 4 | 1 | 2 | 1 | 0.458 |
| E_reason | 3 | 1 | 0 | 2 | 0.456 |
| F_format | 2 | 1 | 0 | 1 | 0.65 |
| G_longctx | 2 | 0 | 1 | 1 | 0.5 |
| H_math | 2 | 0 | 0 | 2 | 0.3 |

## Per-task detail

| ID | Cat | Label | Verdict | Comp | mustH/T | mnH | t (ms) | status | out_len |
|---|---|---|---|---|---|---|---|---|---|
| A1 | A_code_gen | factorial | PASS | 1 | 3/3 | 0 | 23721 | 200 | 412 |
| A2 | A_code_gen | http_get_retry | FAIL | 0.3 | 0/3 | 0 | 18665 | 200 | 59 |
| A3 | A_code_gen | csv_quoted | PASS | 1 | 2/2 | 0 | 20113 | 200 | 833 |
| A4 | A_code_gen | sql_builder | PASS | 1 | 4/4 | 0 | 33895 | 200 | 449 |
| B1 | B_understand | explain | PASS | 1 | 1/1 | 0 | 14391 | 200 | 152 |
| B2 | B_understand | find_bug | PASS | 0.767 | 2/3 | 0 | 17876 | 200 | 41 |
| B3 | B_understand | regex_explain | FAIL | 0.3 | 0/2 | 0 | 1407 | 504 | 31 |
| C1 | C_edit | apply_diff | FAIL | 0 | 0/4 | 0 | 60008 | 0 | 0 |
| C2 | C_edit | rename | PASS | 1 | 3/3 | 0 | 10283 | 200 | 110 |
| C3 | C_edit | fix_test_msg | PARTIAL | 0.475 | 1/4 | 0 | 55955 | 200 | 60 |
| D1 | D_tool | list_files | FAIL | 0 | 0/2 | 0 | 60008 | 0 | 0 |
| D2 | D_tool | read_file | PASS | 0.767 | 2/3 | 0 | 28229 | 200 | 56 |
| D3 | D_tool | write_file | PARTIAL | 0.533 | 1/3 | 0 | 11348 | 200 | 59 |
| D4 | D_tool | run_cmd | PARTIAL | 0.533 | 1/3 | 0 | 26882 | 200 | 40 |
| E1 | E_reason | plan_auth | FAIL | 0.3 | 0/3 | 0 | 41741 | 200 | 105 |
| E2 | E_reason | choose_db | FAIL | 0.3 | 0/2 | 0 | 18887 | 200 | 90 |
| E3 | E_reason | debug_ci | PASS | 0.767 | 2/3 | 0 | 34573 | 200 | 57 |
| F1 | F_format | openapi | PASS | 1 | 4/4 | 0 | 20413 | 200 | 427 |
| F2 | F_format | docstring | FAIL | 0.3 | 0/2 | 0 | 13145 | 200 | 182 |
| G1 | G_longctx | long_reason | FAIL | 0.3 | 0/1 | 0 | 733 | 504 | 31 |
| G2 | G_longctx | retention | PARTIAL | 0.7 | 1/1 | 0 | 21050 | 200 | 11 |
| H1 | H_math | probability | FAIL | 0.3 | 0/3 | 0 | 11528 | 200 | 44 |
| H2 | H_math | two_sum | FAIL | 0.3 | 0/3 | 0 | 16623 | 200 | 102 |

## Where the model is strong (raw + harness)
- **A1** (A_code_gen / factorial): composite 1
- **A3** (A_code_gen / csv_quoted): composite 1
- **A4** (A_code_gen / sql_builder): composite 1
- **B1** (B_understand / explain): composite 1
- **B2** (B_understand / find_bug): composite 0.767
- **C2** (C_edit / rename): composite 1
- **D2** (D_tool / read_file): composite 0.767
- **E3** (E_reason / debug_ci): composite 0.767
- **F1** (F_format / openapi): composite 1

## Where the model is partial
- **C3** (C_edit / fix_test_msg): composite 0.475, must_hits 1/4
- **D3** (D_tool / write_file): composite 0.533, must_hits 1/3
- **D4** (D_tool / run_cmd): composite 0.533, must_hits 1/3
- **G2** (G_longctx / retention): composite 0.7, must_hits 1/1

## Where the model fails
- **A2** (A_code_gen / http_get_retry): composite 0.3, must_hits 0/3, mustNot_hits 0, status 200, error -
- **B3** (B_understand / regex_explain): composite 0.3, must_hits 0/2, mustNot_hits 0, status 504, error local runtime returned HTTP 400
- **C1** (C_edit / apply_diff): composite 0, must_hits 0/4, mustNot_hits 0, status 0, error This operation was aborted
- **D1** (D_tool / list_files): composite 0, must_hits 0/2, mustNot_hits 0, status 0, error This operation was aborted
- **E1** (E_reason / plan_auth): composite 0.3, must_hits 0/3, mustNot_hits 0, status 200, error -
- **E2** (E_reason / choose_db): composite 0.3, must_hits 0/2, mustNot_hits 0, status 200, error -
- **F2** (F_format / docstring): composite 0.3, must_hits 0/2, mustNot_hits 0, status 200, error -
- **G1** (G_longctx / long_reason): composite 0.3, must_hits 0/1, mustNot_hits 0, status 504, error local runtime returned HTTP 400
- **H1** (H_math / probability): composite 0.3, must_hits 0/3, mustNot_hits 0, status 200, error -
- **H2** (H_math / two_sum): composite 0.3, must_hits 0/3, mustNot_hits 0, status 200, error -

## Notes
- This is the AIDE-router (harness ON) view: same model, with the v2.1.0 micro-tier harness scaffold injected.
- Compare to `capability-audit-cipher-4b.md` (raw engine, no harness) to see what the harness adds.
- JSONL: `E:\pip_temp\opencode\audit_router_results.jsonl`

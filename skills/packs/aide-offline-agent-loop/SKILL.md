# A1 — Offline Agent Loop (Plan/Act, tool use, human-in-the-loop, checkpoints)

Phase skill for the AIDE offline agent loop. Master router: aide-master-roadmap. Reuses: aide-arch-model-runtime (local chat endpoint + port doctrine), aide-arch-git (execFile git discipline), B4 consent patterns (network_consent → FORBIDDEN/CONSENT_REQUIRED), B2 problem store (diagnostics tool), rg-service (search tool).

## Research base (verified 2026-08, primary sources)

**Aider (edit formats + benchmarks)** — aider.chat/docs/more/edit-formats.html, /benchmarks.html, /unified-diffs.html:
- Function-calling APIs performed WORSE than plain-text edit formats even for GPT-3.5/4. Law: **text protocols beat native function calling for weak/local models**.
- SEARCH/REPLACE block format (git-conflict-markers style: `<<<<<<< SEARCH` / `=======` / `>>>>>>> REPLACE`, full path verbatim on a line above a fenced block) is aider's default `diff` format.
- Edit-format design laws: FAMILIAR (formats models saw in training), SIMPLE (no escaping, no brittle line numbers), HIGH-LEVEL (whole functions/blocks, not surgical line edits), FLEXIBLE (maximally lenient application).
- Flexible patching is worth **9X** on apply success (normalize hunks, relative leading whitespace, sub-hunk splitting, flexible context windows). Removing it radically increases failures.
- Measured model failure modes to tolerate: whole-file dumped into SEARCH (pathological), lazy `# ... code here ...` comments (udiff cut laziness 3X), missing `+` markers, uniform outdenting, jumping hunks without `@@`.
- Prompt rules that work: FULL path verbatim unquoted; SEARCH must match char-for-char; first-match-only replacement; multiple small blocks > one giant block; empty SEARCH = new file creation.

**SWE-agent (ACI design, NeurIPS 2024)** — princeton-nlp/SWE-agent paper + docs/background/aci.md:
- ACI laws: (1) actions simple, few options, concise docs; (2) consolidate multi-step operations into single actions; (3) feedback informative but CONCISE — always return something ("Your command ran successfully and did not produce any output." for empty results); (4) guardrails mitigate error propagation.
- Measured: file viewer at ~100 lines optimal (30 lines −3.7 pts, whole file −5.3 pts); directory search listing FILES ONLY beat showing match context (more context confused models); iterative result-browsing exhausts context (worse than no search).
- **Lint-gate guardrail**: edit applies ONLY if result passes syntax check; invalid edits are DISCARDED and the model retries (+3.0 pts). Assumes original codebase is well-formed.
- Malformed generations trigger a specific error response asking to retry; repeated until valid.

**Cline (architecture, checkpoints, modes)** — cline/cline repo (CheckpointTracker.ts, CheckpointGitOperations.ts), DeepWiki Plan-and-Act + Tool Capabilities, memo.d.foundation breakdown:
- XML tool calls parsed from raw model text (single-pass index-based parser) — works with ANY model including Ollama/LM Studio locals without function calling. Dual parsing path only if provider-native tools exist.
- Tool taxonomy: filesystem (list_files, read_file, write_to_file, replace_in_file, apply_patch, search_files, list_code_definition_names), execute_command, ask_followup_question, attempt_completion. Read-only ops may parallelize; writes stay sequential.
- **Plan/Act**: plan = read-only tools + a `switch_to_act_mode` request tool; act = everything. History carries over across switches. Inject a `<mode_notice>` into the next user message so the model isn't confused by changing toolsets. Mode switch mid-task rebuilds the session config.
- Model-tolerant arg normalization: Zod schemas validate AND repair common LLM mistakes (e.g. `file_path` → `path`) before executors see data.
- Consecutive-mistake limit: abort the task after N malformed/consecutive-failing tool calls.
- Approval gateway: every tool use goes through approval unless explicitly auto-approved; the model's own `requires_approval` hint is display metadata, NEVER trusted as an authorization decision.
- **Checkpoints = SHADOW GIT REPO**, not git stash: isolated repo dir with `core.worktree` pointing at the workspace, own user.name/email, commit.gpgSign=false, excludes file, `--allow-empty --no-verify` commits, folder locks around commits, nested `.git` dirs temporarily renamed aside during add (`GIT_DISABLED_SUFFIX`), restore modes (files+task / files only / task only). Roadmap originally said "checkpoints via git stash" — SUPERSEDED: stash mutates the user's working state and reflog; the shadow repo never touches the user's git at all. This is the battle-tested Cline design.

## Threat matrix (OWASP LLM01:2025 indirect prompt injection; Promptfoo coding-agent red-team plugins; CSA README-injection research 2026; AIShellJack arXiv 2509.22040; workspace-topology arXiv 2608.14876)

| # | Threat | Vector | Defense in A1 |
|---|--------|--------|----------------|
| T1 | Repo prompt injection | Instructions hidden in README/docs/comments/config read by agent | Untrusted-data framing in prompts (tool outputs wrapped as DATA, never instructions); system-prompt security framing (~60% relative ASR cut per workspace-topology study — soft layer, never sole defense); EVERYTHING mutating still gated by human approval |
| T2 | Terminal-output injection | Compiler/test/hook stdout contains instruction receipts | Same untrusted framing for command output; output capped; approval required before next mutating action regardless |
| T3 | Sandbox write escape | Writes outside workspace via ../, symlinks, absolute paths | Path jail: resolve + containment check against workspace root on EVERY path arg (reuse fs-route pattern); symlink resolution before write |
| T4 | Sandbox read escape | Reads of $HOME, sibling repos, temp, cache | Same jail for reads; deny-list extra roots (`.aide/credentials*`) |
| T5 | Secret env/file read | `env`, dotfiles, credential stores harvested then echoed | run_command runs WITHOUT shell string interpolation where possible; secrets never injected into agent-visible env; deny-list read paths; approval shows full command text |
| T6 | Verifier sabotage | Agent edits tests/snapshots/hooks/lockfiles to make QA pass | Protected-file registry: `.aide/**`, hooks.json, tasks.json, package-lock.json etc. require EXTRA confirmation banner naming the risk; diff review surfaces test edits loudly |
| T7 | Automation poisoning | Persistence via npm scripts, git hooks, CI workflows, shell rc | Same protected registry + approval; post-run scan: report any write touching automation surfaces in done summary |
| T8 | Invisible-character smuggling | Zero-width/bidi/Unicode-Tags U+E0000–E007F payloads survive human review | Scan tool inputs AND file contents being written; flag/reject invisible bidi/tags codepoints with explicit warning in approval UI |
| T9 | Runaway loops / resource exhaustion | Infinite retry loops, huge outputs, endless tasks | Max iterations per session; consecutive-mistake limit; byte caps on tool output; wall-clock timeout per command |
| T10 | Network egress via commands | curl/Invoke-WebRequest planted by injection | Reuse B4 NETWORK_TOKENS consent list → FORBIDDEN/CONSENT_REQUIRED; egress-journal entry BEFORE executing any network-suspicious approved command |

**AIShellJack hard lesson**: restricting terminal alone is insufficient — 94.6% of tested attacks pivoted to writing malicious code into source files (88.2% embedded payloads) which execute later through normal dev workflows. Therefore: **the real control plane is write-file approval + Monaco diff review**, not just command gating. Diff review IS the security boundary, not just UX.

## Architecture (daemon-side v1)

- `node/src/services/agent-parser.mjs`: tolerant XML tool-call parser. Format: `<tool_name>\n<param>value</param>\n</tool_name>` blocks extracted from streamed text. Tolerances: leading/trailing prose ignored, multiple calls per response (execute sequentially, never parallel for v1), unclosed tag at end-of-stream = parse error fed back to model, params compared case-insensitively after Zod-normalization aliases.
- `node/src/services/agent-tools.mjs`: registry. Each tool: { name, description (short!), schema (zod strict + aliases), requiresApproval (computed by policy fn, not model hint), readOnly, execute(ctx, args) }. ctx provides jailed io helpers. Tools v1: read_file (numbered lines, windowed ~100 lines, offset param), list_dir, search (rg-service, files-first concise output, cap 50), write_file (full content; protected-registry check; invisible-char scan), replace_in_file (SEARCH/REPLACE blocks w/ flexible matching: exact → whitespace-normalized → relative-indent; CRLF/LF normalization; first-match-only), run_command (via TaskService spawn discipline — no shell join on Windows cmd chains, timeout, output cap, NETWORK_TOKENS consent), diagnostics (B2 problems store read), attempt_completion (terminal action).
- Lint-gate: after write_file/replace_in_file on code files, run lightweight syntax sanity (existing parsers where cheap; else skip silently for unknown types) — invalid result discarded + error returned to model for retry. v1 scope: JSON/JSONC validation always; TS/JS optional if trivially available; do NOT fake lint coverage.
- `node/src/services/agent-checkpoints.mjs`: shadow git under `<workspace>/.aide/checkpoints/<hash-of-workspace>/` via execFile git with GIT_TERMINAL_PROMPT=0, GIT_ASKPASS=echo (git-service pattern); core.worktree=workspace; init on first agent session; commit before first mutating tool and after each approved mutation batch; restore(commitHash) = `git checkout <hash> -- .` inside shadow repo + clean removed-file handling; nested-repo rename-aside like Cline; NEVER touches user's .git.
- `node/src/services/agent-loop.mjs`: state machine `idle → running → awaiting_approval → running → done | error | aborted`. Injectable `chatFn(messages) → string` (default: model-router local chat role 'chat'; Plan/Act may map to roles later). Loop: build system prompt (mode-specific, tool docs, security framing, untrusted-data rule) → chatFn → parser → 0 calls + no completion = nudge once then error → per call: normalize args → approval gate (emit awaiting_approval event w/ diff preview; WAIT via deferred promise resolved by route) → checkpoint (first mutation) → execute → concise result → append transcript → repeat until attempt_completion / max iterations 25 / mistakes 3.
- Context budget: tool results truncated to caps; oldest tool results dropped first when transcript exceeds budget; environment details (workspace name, mode, time) injected once.
- `common/contracts/agent.ts`: zod strict — AgentStartRequest{task, mode}, AgentSessionSnapshot{id, state, mode, iterations, approvals_pending[]}, AgentDecisionRequest{session_id, approval_id, decision: approve|reject|abort, }, event union over WS channel `agent` (message/tool_call/tool_result/awaiting_approval/done/error/aborted, each carrying session_id).
- `node/src/routes/agent.ts`: POST /api/agent/start, GET /api/agent/status?id, POST /api/agent/decision, GET /api/agent/sessions. Error envelope codes: VALIDATION, SESSION_NOT_FOUND, ALREADY_RUNNING, INTERNAL.
- WS channel `agent` added to ChannelName union + zod union in events.ts.

## Tests FIRST

1. Parser: single/multiple calls, prose noise around calls, unknown tool, bad JSON-free params (plain text values), unclosed block, case-insensitive aliases, empty response.
2. Path jail: traversal (`../`), absolute outside, symlink escape (create real symlink in tmp), backslash variants on win32.
3. replace_in_file: exact hit, CRLF-vs-LF, indentation-shifted (relative indent), multiple blocks sequential, new-file (empty SEARCH), no-match error message quality, first-match-only semantics.
4. Checkpoints: init in tmp git-less workspace, commit → mutate → restore returns prior content, user repo untouched (assert user .git refs unchanged), nested .git renamed aside and restored.
5. Approval gate: mutating tool blocks (deferred unresolved until decision), reject returns rejection result to model transcript, abort terminates, approve executes; read-only tools in plan mode bypass approval but are BLOCKED in… inverse check: write tools rejected in plan mode with clear error to model.
6. Loop: scripted chatFn fixtures — completes via attempt_completion; malformed call → mistake counter → nudge → recover; exceeds max iterations → error state; injection canary: tool output containing "<write_file>" text must surface as DATA (assert parser does not re-parse tool output as new calls — parser consumes MODEL messages only).
7. Arch tests: start/status/decision routes strict bodies + error envelopes; WS agent channel events shape-validate; offline e2e — scripted session completes with ZERO entries appended to egress journal (In-the-Box proof); openapi zero-diff regen.

## Pitfalls (device/codebase specifics)

- Windows: SEARCH/REPLACE must normalize CRLF↔LF both directions; backslash paths in model output — jail normalizes via path.resolve before compare; run_command uses TaskService spawn (no shell=true); `where`-based resolution exists in task-service (line ~266) — reuse.
- Node test runner quirks: use real node E:\nodejs\node-v26.4.0-win-x64\node.exe + --test-force-exit; options-object timeouts only ({timeout: ms}); cmd /c redirection for stderr capture.
- Deferred promises for approvals MUST have a cleanup path on session close/timeout (no dangling await leaks between tests).
- Shadow git: never `git add -A` the USER repo by accident — all git invocations use `-C <shadow-dir>` or execFile cwd=shadowDir; core.worktree makes add operate on workspace files while object db lives in shadow dir.
- Parser must consume ONLY assistant messages; tool results re-enter transcript wrapped as untrusted DATA blocks — never re-parsed.
- zod v4: strict() objects; discriminated unions for events; no z.lazy needed here.

## Gate

Unit + arch green locally (real node, force-exit) and in CI; scripted-session e2e proves zero egress during a purely-local task; manual live-model smoke on the GTX 1060 bundled model once (simple 2-tool task: read file → propose edit → approve → verify diff applied + checkpoint created), evidence screenshot + notes in docs/evidence/. Journal AGENT_NOTES + roadmap DONE entry. Queued UI pass: A1b agent panel (approval cards, diff preview, checkpoint timeline) — B2b legacy-wiring pattern.

## SHIPPED daemon-side (commit 51d90be, CI green 2026-08-22) — verified lessons

- **Regex astral escapes MUST be braced**: `\ue0000` parses as `\uE000` + literal `0` even with the `u` flag → a char class silently matched ALL of ASCII (write_file rejected everything as "invisible characters"). Law: `\u{E0000}-\u{E007F}` always.
- **Git cwd-scoping law**: from a shadow repo dir (core.worktree=workspace): `add -A` and `reset --hard` operate worktree-wide; `clean`, `ls-files`, `ls-tree` are CWD-SUBTREE-scoped — pass `:/` pathspec (clean -fd -e .git -e .aide -e node_modules :/) or `--full-tree`. Probe artifacts from this cost an hour: empty ls-tree output was scoping, not staging failure.
- **Parser order**: pre-scan for unclosed KNOWN tool tags BEFORE block regex, else `<read_file>\n<path>x</path>` reports "unknown tool path" instead of the real error. Unclosed-param tail-check must be gated on schema-known names only (code containing `Array<string>` must not false-trigger).
- **Optional tool params**: declare `params` for docs/parsing but `required` subset for validation (`offset/limit` optional on read_file); missing-params check uses required only.
- **SEARCH/REPLACE markers**: models emit exactly 7 chars `<<<<<<<`; regex needs `{5,}` tolerance, not exact `{5}`.
- **Relative-indent loose matching**: replacement lines keep their own relative indent over the needle's first-line indent (base + lineIndent − firstNeedleIndent); do NOT strip to bare text.
- **diagnostics tool deferred**: no problems store exists (problems parsed per-task-run); do not fake one. Revisit when a diagnostics store lands.
- **Test seam**: BuildRoutesOptions.agentChatFn injects scripted replies through the full HTTP stack (hub fetchImpl pattern); unit loop tests use createAgentLoop({chatFn}) directly. Multi-file `node --test f1 f2` runs only the first file on Node 26 — run suites separately.
- **AIShellJack doctrine encoded**: write-file approval + diff preview is the primary security boundary (94.6% of attacks pivot through written source files, not the terminal).

---
name: process-hygiene-sop
description: Mandatory end-of-task process cleanup SOP for every agent session — after ANY work that spawns processes (dev servers, test runners, model servers, watchers, background jobs), kill everything you spawned AND verify it is dead before moving on, journaling, or claiming done. Use at the end of every task, before every commit/journal entry that claims completion, whenever a shell command times out or hangs, and at session close. Prevents stray node/llama/python processes from wedging the machine, corrupting later test runs, and eating RAM/GPU needed by the user's own workloads.
---

# Process Hygiene SOP — Nothing Stray Survives

Born 2026-08-24: three stray processes (2× node.exe from the detached AIDE stack,
1× llama-server.exe) survived a session and helped wedge the OS shell so hard that
even `echo ok` timed out. The user had to clean up by hand. This SOP makes that
class of failure impossible to repeat.

## The Law

Every process you spawn is YOURS until you have killed it AND verified it dead.
A task that spawned a process is NOT complete while that process lives.
"Done" without verified-zero-strays = not done. This gate sits BEFORE journal
entries and BEFORE commits that claim task completion.

## P1 — Track what you spawn

- Every time you start a server, runner, watcher, model binary, or background
  job, record in working memory (and in AGENT_NOTES if the session may end):
  process name(s), how it was launched (direct / detached cmd wrapper / spawn),
  and any ports it binds (4777 facade, 4778 arch, 4779 legacy, 4173 UI,
  8085–8087+ llama-server pool).
- Prefer foreground runs with explicit timeouts for short-lived verification;
  use detached wrappers ONLY when the stack must outlive the tool call — and
  then the teardown step below is MANDATORY in the same session.

## P2 — Teardown before "done"

When the work finishes (or before ending a session), run teardown:

```
taskkill /F /IM <procname>.exe /T        # per process family you spawned
# Windows tree-kill: /T takes children with it; /F forces
```

For stacks started via detached `cmd /c "...start.mjs"` wrappers, kill BOTH the
wrapper's children (node.exe) and anything they spawned (llama-server.exe).
Never assume killing the parent took the tree — VERIFY.

## P3 — Verify zero survivors (the step everyone skips)

After teardown, re-list and confirm EMPTY before moving on:

```
tasklist | findstr /i "<name1> <name2>"
# expected: no matches -> say 'VERIFIED: zero <names>' out loud in output
```

If survivors remain: kill by PID (`taskkill /F /PID <pid> /T`), re-verify.
Only proceed when verification prints zero. Paste the verification line into
your final report — unverified claims are forbidden (verification-complete).

## P4 — Wedge recognition and recovery

Symptoms of process-wedge (learned 2026-08-24): trivial commands (`echo ok`,
`tasklist`) time out; suites produce NO output at all; even taskkill cannot run.

Recovery ladder:
1. Probe with `echo ok` (15s timeout). Works? -> continue at P2/P3 cleanup.
2. Still dead? Tell the user immediately — manual Task Manager cleanup:
   end all node.exe / llama-server.exe / stray cmd-pwsh wrappers.
   NEVER touch python.exe (user's own training/quant workloads live there),
   system processes, or anything unrecognized.
3. After user cleans up, probe again, THEN run P3 verification yourself.

## P5 — Never harm the operator's own workloads

The user routinely runs training/quantization/merge jobs (python.exe, GPU-heavy).
Before ANY kill sweep: identify what belongs to AIDE (node.exe, llama-server.exe,
llama_cpp servers on the port pool above) vs what belongs to the user
(python.exe training/quant pipelines, editors). Kill ONLY AIDE families unless
the user explicitly names others. When unsure — ASK, never guess with kills.

## P7 — Memory-pressure doctrine (the wedge root cause, learned 2026-08-24)

This machine has 16GB RAM; the operator's quant/merge jobs load multi-GB for
hours. When AIDE ALSO serves models simultaneously, commit charge hits the
cliff and Windows thrashes — process creation stalls system-wide ("echo ok"
times out). Rules that make the wedge preventable from OUR side:

1. ONE MODEL AT A TIME. Never start an AIDE model server while another runs,
   and never assume the operator's own servers are idle. Ask or default to no.
2. STOP AFTER PROOF. Any model started for a test gets stopped immediately
   after verification passes (POST /api/models/stop {id}); never leave test
   servers running "for later". The cockpit STOP ENGINE button is part of the
   product because of this law.
3. YIELD BY DEFAULT. Every llama-server spawned by AIDE carries --prio -1 so
   operator jobs keep priority on CPU/memory bandwidth.
4. PREFLIGHT. Before starting any model server, check free RAM (node os.freemem()
   inside the running daemon - no extra process needed). Below ~2.5GB free:
   refuse with a one-line reason and suggest stopping something first
   (No-Brick-Wall style), never spawn into thrash.
5. WEDGE RESPONSE UPDATE: when wedged under memory pressure, killing AIDE's
   small servers frees little; the honest fix is waiting out or pausing the
   operator's heavy job. Say so plainly instead of prescribing reboots.

## P6 — Journal the hygiene event

Append one AGENT_NOTES line per cleanup: what was found running, what was
killed, PID-level verification result. If strays were found, name the leak
source (which launch left them) so the launcher gets fixed, not just the symptom.

## Integration

- Pairs with verification-complete (this IS part of "completely through"):
  a green suite + a live orphaned process = failed verification.
- Pairs with hard-rules R2 (never touch active training runs) — P5 is the
  operational detail of that rule for kill sweeps.
- Session-close checklist order: P2 teardown -> P3 verify -> journal (P6)
  -> final commit. No reordering.

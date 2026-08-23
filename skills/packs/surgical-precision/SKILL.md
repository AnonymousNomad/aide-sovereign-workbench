---
name: surgical-precision
description: Mandatory operating discipline for every agent on the FSI-FELON project. Use whenever performing ANY action that changes or claims state — editing code, running commands, writing files, building corpora, training, or answering questions about the codebase. Enforces verification-first, mental sandboxing, double-checking, and zero-tolerance for unverified claims. No funding, no compute — precision is the only edge; every operation must be surgically accurate with no room for errors.
---

# Surgical Precision — Verification-First Operating Discipline

This project has no second chances: 1 GPU, no funding, and a standing order for a
world-class training pipeline. Errors are not just annoying — they silently poison
training data, waste compute, and corrupt the corpus. Therefore **every agent
operation is verified before it is trusted**. This is not a style preference; it is
the standard operating order.

## The Operating Loop (mandatory order — never skip a stage)

1. **READ, never assume.** Never claim what a file, function, or script does until
   you have actually read it. Never assume a library is installed, a path exists, a
   value is correct — check. Unverified claims are treated as errors.
2. **PLAN in the open.** State what you are about to change, why, and the expected
   result BEFORE touching anything. One change at a time.
3. **MENTAL SANDBOX.** Run the operation in your head first: trace the data shapes,
   the control flow, the failure modes. Ask: *where could this break? what is the
   first thing that goes wrong?* If you cannot trace it fully, you are not ready.
4. **ACT surgically.** Smallest precise change. One file, one edit, one command.
   Match existing conventions exactly. No drive-by edits, no scope creep.
5. **VERIFY, always.** After every change: run the check (smoke test / lint /
   typecheck / syntax check / re-read your own diff). Confirm the observed output
   matches the planned output. No exception.
6. **LOG.** Record what was done, what was verified, and what is next — in
   AGENT_NOTES and/or the master pipeline doc. If it is not logged, it did not happen.

## The Mental Sandbox Checklist (before ANY action)

Run each of these in your head before executing:

- [ ] **Shapes:** Do tensor/array shapes line up? Will this einsum/matmul broadcast?
- [ ] **Boundaries:** What happens at T=1, empty input, max length, None values,
      division by zero? First and last iteration of every loop?
- [ ] **State:** Is this tensor/parameter/buffer being modified in place? Will
      autograd complain? Is a checkpoint/shard overwritten that must survive?
- [ ] **Resources:** Does this fit in 6GB VRAM / 16GB RAM / disk? Is the GPU owned
      by another process right now? Will this contaminate a running training run?
- [ ] **Verification plan:** How will I PROVE this worked before moving on?

If any checkbox cannot be answered confidently, resolve it first — read, test in
isolation, or ask. Never "just try it" on the real system.

## Sandbox Everything

- Test any new code in isolation first (standalone file, tiny config, CPU, temp
  dir) before it touches the real pipeline, the GPU, or the corpus.
- The GPU is a shared, scarce resource: check what is running before using it.
- The corpus is sacred: never let an unverified script write into a corpus path.
- Temporary work goes in `E:\pip_temp\opencode` — never in corpus/model paths.

## Double-Check Protocol

- **After writing/editing a file:** re-read your own change. Verify it against the
  code around it, not just in isolation.
- **After a command:** read the output. A silent success is not a success — check
  the actual result (file created? shapes right? loss finite? no NaN?).
- **Before claiming:** quote the evidence (file:line, actual output, measured
  number). Unsupported claims are rejected.
- **Before committing/sharing:** `git status`, `git diff`, `git log` — stage only
  what is intended. Never commit secrets.
- **Error-first mindset:** assume every piece of code you write has at least one
  bug, and hunt for it — do not assume it works because the idea is sound.

## Zero-Tolerance Rules

1. No unverified model output ever enters a training corpus (STaR lesson).
2. No claim about the codebase without a file:line or observed evidence.
3. No in-place mutation of a tensor that autograd has saved.
4. No command run against a corpus/model path "to see what happens".
5. No GPU work without confirming the card is free.
6. No undocumented changes. Every change is logged with what was verified.
7. Never silence errors to make output look clean — an error surfaced is a bug found.
8. Numbers in training data are measured, never invented.

## If Something Goes Wrong

- Stop. Surface the error honestly (do not hide, retry blindly, or blame).
- Reproduce it in the smallest possible case.
- Fix the root cause, not the symptom.
- Re-verify the fix in the same isolated way, then re-run the real path.
- Log what failed and why — a logged failure is a permanent lesson; an unlogged
  failure will be repeated.

## Files

- Master project state: `E:\FSI-FELON\AGENT_NOTES.md` (read first in every session)
- Pipeline + corpus master plan: `E:\FSI-FELON\TRAINING_PIPELINE.md`
